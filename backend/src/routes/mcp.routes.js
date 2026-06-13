import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { getRoles, getFlags } from '../auth.js'
import { effectivePerms } from '../permissions.js'
import { ah, audit, notify, todayISO, addDays, getSetting, usersWithPerm } from '../lib.js'
import { sha256, mcpLimiter, statsSnapshot } from '../security.js'
import { getWeather } from '../weather.js'
import { nextTicketCode, logTicketEvent, chatWatchers } from './tickets.routes.js'
import { resolveOAuthToken, baseUrl } from './oauth.routes.js'
import { buildCalendar } from './calendar.routes.js'

/* WoodsOS Model Context Protocol server — the AI-native front door.
   Streamable-HTTP transport, stateless: every POST carries one JSON-RPC
   message (or a batch). No SDK, no sockets, no API keys — staff mint a
   personal access token in Claude & AI and connect plain Claude:

     claude mcp add --transport http woodsos http://<host>/api/mcp \
       --header "Authorization: Bearer wos_pat_…"

   Tools mirror the holder's live permissions exactly: tools/list only shows
   what they can do, write tools additionally require ai.write, and module
   kill-switches apply. The token IS the person. */

export const router = Router()

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

// ---- auth: personal access tokens OR OAuth bearer tokens ------------------
// A 401 carries WWW-Authenticate pointing at the OAuth discovery doc — that's
// what lets Claude.ai chat / Cowork start the "Add connector → sign in" flow.
function challenge(req, res, msg) {
  res.set('WWW-Authenticate',
    `Bearer realm="woodsos", resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`)
  return res.status(401).json({ error: msg })
}

async function patAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : null
    if (!raw) return challenge(req, res, 'Authentication required — use a WoodsOS personal access token, or connect via the OAuth flow.')

    // wos_pat_… → personal access token; anything else → OAuth access token.
    let uid = null, patId = null
    if (raw.startsWith('wos_pat_')) {
      const pat = await one(
        `SELECT p.id, p.user_id FROM pats p JOIN users u ON u.id = p.user_id
         WHERE p.token_hash = $1 AND NOT p.revoked AND u.active
           AND (p.expires_at IS NULL OR p.expires_at > now())`, [sha256(raw)])
      if (pat) { uid = pat.user_id; patId = pat.id; q(`UPDATE pats SET last_used_at = now() WHERE id = $1`, [pat.id]).catch(() => {}) }
    } else {
      uid = await resolveOAuthToken(raw)
    }
    if (!uid) return challenge(req, res, 'This token is invalid, revoked, or expired')

    const aiSetting = await getSetting('ai', {})
    if (aiSetting.enabled === false) return res.status(403).json({ error: 'AI access is switched off for this organization' })
    const flags = await getFlags()
    if (flags.get('ai') && !flags.get('ai').enabled) {
      return res.status(403).json({ error: 'The Claude & AI module is switched off' })
    }
    const user = await one(`SELECT * FROM users WHERE id = $1 AND active`, [uid])
    if (!user) return challenge(req, res, 'Account not found or inactive')
    user.perms = effectivePerms(user, (await getRoles()).get(user.role_key))
    if (!user.perms['ai.use']) return res.status(403).json({ error: 'Your account does not have the “Connect Claude” permission' })
    delete user.password_hash
    req.user = user
    req.patId = patId || `u${uid}`   // rate-limit key (per token, or per user for OAuth)
    req.flags = flags
    next()
  } catch (e) { next(e) }
}

// ---- tool plumbing ---------------------------------------------------------
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false })
const str = description => ({ type: 'string', description })
const num = description => ({ type: 'number', description })
const bool = description => ({ type: 'boolean', description })

async function findLocation(ref) {
  if (ref == null || ref === '') return null
  if (/^\d+$/.test(String(ref))) return (await one(`SELECT id, name FROM locations WHERE id = $1`, [Number(ref)]))
  return await one(`SELECT id, name FROM locations WHERE active AND name ILIKE $1 ORDER BY length(name) LIMIT 1`, [`%${ref}%`])
}
async function findUser(ref) {
  if (!ref) return null
  return await one(
    `SELECT id, name, email FROM users WHERE active AND (lower(email) = lower($1) OR name ILIKE $2)
     ORDER BY (lower(email) = lower($1)) DESC LIMIT 1`, [String(ref), `%${ref}%`])
}
async function findTicket(ref) {
  const byCode = await one(`SELECT * FROM tickets WHERE code = $1`, [String(ref).toUpperCase()])
  if (byCode) return byCode
  if (/^\d+$/.test(String(ref))) return await one(`SELECT * FROM tickets WHERE id = $1`, [Number(ref)])
  return null
}
async function findBooking(ref) {
  const byCode = await one(`SELECT * FROM bookings WHERE code = $1`, [String(ref).toUpperCase()])
  if (byCode) return byCode
  if (/^\d+$/.test(String(ref))) return await one(`SELECT * FROM bookings WHERE id = $1`, [Number(ref)])
  return await one(`SELECT * FROM bookings WHERE name ILIKE $1 ORDER BY start_date DESC LIMIT 1`, [`%${ref}%`])
}
async function findInvoice(ref) {
  const byNum = await one(`SELECT * FROM invoices WHERE number = $1`, [String(ref).toUpperCase()])
  if (byNum) return byNum
  if (/^\d+$/.test(String(ref))) return await one(`SELECT * FROM invoices WHERE id = $1`, [Number(ref)])
  return null
}
async function findIncident(ref) {
  const byCode = await one(`SELECT * FROM incidents WHERE code = $1`, [String(ref).toUpperCase()])
  if (byCode) return byCode
  if (/^\d+$/.test(String(ref))) return await one(`SELECT * FROM incidents WHERE id = $1`, [Number(ref)])
  return null
}
const invoiceSubtotal = items => (items || []).reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0)
function invoiceDerived(inv, paid) {
  const total = invoiceSubtotal(inv.items) * (1 + Number(inv.tax_rate || 0) / 100)
  if (inv.status === 'draft' || inv.status === 'void') return inv.status
  if (paid >= total - 0.005 && total > 0) return 'paid'
  if (inv.due_date && String(inv.due_date) < todayISO()) return 'overdue'
  if (paid > 0) return 'partial'
  return 'sent'
}
const PRIORITY = { 0: 'low', 1: 'normal', 2: 'high', 3: 'urgent', 4: 'ASAP' }
const csvCell = v => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCSV = list => !list.length ? '' :
  [Object.keys(list[0]).join(','), ...list.map(r => Object.values(r).map(csvCell).join(','))].join('\n')

/* Each tool: { name, title, description, perm, flag, write?, schema, run(args, user) }
   `perm` gates visibility AND execution; `write` additionally requires ai.write. */
const TOOLS = [
  // ============ identity & orientation ============
  {
    name: 'whoami', title: 'Who am I', flag: null, perm: null,
    description: 'The signed-in person behind this token, their role, department, and exactly which WoodsOS permissions and modules they have. Call this first to learn what you can do.',
    schema: S({}),
    run: async (a, user, flags) => ({
      name: user.name, email: user.email, role: user.role_key, department: user.dept, title: user.title,
      write_tools_enabled: !!user.perms['ai.write'],
      modules_on: [...flags.values()].filter(f => f.enabled).map(f => f.key),
      permissions: Object.entries(user.perms).filter(([, v]) => v).map(([k]) => k).sort(),
    }),
  },
  {
    name: 'daily_brief', title: 'Daily brief', flag: null, perm: null,
    description: 'A morning-huddle summary of camp today: who is on site, arrivals and departures, open and overdue tickets, tasks due, who is off property, overdue gear, budget alerts, expiring certifications, and the message of the day. Sections are filtered to the caller’s permissions.',
    schema: S({}),
    run: async (a, user) => {
      const today = todayISO()
      const p = user.perms
      const brief = { date: today, for: user.name }
      if (p['bookings.view']) {
        brief.groups_on_site = await rows(
          `SELECT code, name, headcount, start_date, end_date FROM bookings
           WHERE status IN ('confirmed','in_progress') AND start_date <= $1 AND end_date >= $1 ORDER BY headcount DESC`, [today])
        brief.arriving_today = await rows(`SELECT code, name, headcount FROM bookings WHERE status != 'cancelled' AND start_date = $1`, [today])
        brief.departing_today = await rows(`SELECT code, name, headcount FROM bookings WHERE status != 'cancelled' AND end_date = $1`, [today])
      }
      if (p['tickets.view']) {
        brief.tickets = await one(
          `SELECT COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open,
                  COUNT(*) FILTER (WHERE guest_unread AND status != 'closed')::int AS guest_waiting,
                  COUNT(*) FILTER (WHERE status NOT IN ('closed') AND due_date < $1)::int AS overdue,
                  COUNT(*) FILTER (WHERE status = 'pending_close')::int AS awaiting_close_approval,
                  COUNT(*) FILTER (WHERE assignee_id IS NULL AND status IN ('open','in_progress'))::int AS unassigned
           FROM tickets`, [today])
      }
      if (p['tasks.view']) {
        brief.tasks_due_today = await rows(
          `SELECT t.title, t.due FROM tasks t JOIN task_statuses s ON s.id = t.status_id
           WHERE s.kind != 'done' AND t.parent_id IS NULL AND t.due <= $1 ORDER BY t.due LIMIT 12`, [today])
      }
      if (p['signout.board']) {
        brief.off_property = await rows(
          `SELECT u.name, t.destination, t.expected_return FROM trips t JOIN users u ON u.id = t.user_id
           WHERE t.signed_in_at IS NULL`)
      }
      if (p['gear.view']) {
        brief.gear_overdue = await rows(
          `SELECT g.name AS item, l.qty, COALESCE(u.name, l.borrower_name) AS borrower, l.due_at
           FROM gear_loans l JOIN gear_items g ON g.id = l.item_id LEFT JOIN users u ON u.id = l.borrower_id
           WHERE l.returned_at IS NULL AND l.due_at < now()`)
      }
      if (p['budgets.view']) {
        brief.budget_alerts = await rows(
          `SELECT b.name, b.amount::float, COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)::float AS spent
           FROM budgets b LEFT JOIN expenses e ON e.budget_id = b.id WHERE b.active
           GROUP BY b.id HAVING COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0) >= b.amount * 0.9`)
      }
      if (p['people.view']) {
        brief.certs_expiring_30d = await rows(
          `SELECT u.name, c.name AS cert, c.expires FROM user_certs c JOIN users u ON u.id = c.user_id
           WHERE c.expires BETWEEN $1 AND $2 ORDER BY c.expires`, [today, addDays(today, 30)])
      }
      brief.message_of_the_day = await rows(`SELECT title, body FROM motd_messages WHERE active ORDER BY created_at DESC LIMIT 3`)
      return brief
    },
  },
  {
    name: 'search', title: 'Search WoodsOS', flag: null, perm: null,
    description: 'Global search across bookings, leads, tickets, tasks, people, gear, locations, incidents, lost & found, and assets (each respecting the caller’s permissions). Use when you have a name or keyword but not an id.',
    schema: S({ q: str('Search text — names, codes, keywords') }, ['q']),
    run: async ({ q: term }, user) => {
      const like = `%${term}%`
      const out = {}
      if (user.perms['bookings.view']) out.bookings = await rows(
        `SELECT id, code, name, status, start_date, end_date FROM bookings WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 6`, [like])
      if (user.perms['bookings.leads']) out.leads = await rows(
        `SELECT id, name, organization, stage FROM leads WHERE name ILIKE $1 OR organization ILIKE $1 LIMIT 6`, [like])
      if (user.perms['tickets.view']) out.tickets = await rows(
        `SELECT id, code, title, status FROM tickets WHERE title ILIKE $1 OR code ILIKE $1 LIMIT 6`, [like])
      if (user.perms['tasks.view']) out.tasks = await rows(`SELECT id, title FROM tasks WHERE title ILIKE $1 LIMIT 6`, [like])
      if (user.perms['people.view']) out.people = await rows(
        `SELECT id, name, dept, title FROM users WHERE active AND name ILIKE $1 LIMIT 6`, [like])
      if (user.perms['gear.view']) out.gear = await rows(
        `SELECT id, name, category, qty_total FROM gear_items WHERE active AND name ILIKE $1 LIMIT 6`, [like])
      if (user.perms['locations.view']) out.locations = await rows(
        `SELECT id, name, category FROM locations WHERE active AND name ILIKE $1 LIMIT 6`, [like])
      if (user.perms['incidents.view']) out.incidents = await rows(
        `SELECT id, code, title, status, severity FROM incidents i
         WHERE (title ILIKE $1 OR code ILIKE $1) ${user.perms['incidents.confidential'] ? '' : 'AND NOT i.confidential'} LIMIT 6`, [like])
      if (user.perms['lostfound.view']) out.lost_found = await rows(
        `SELECT id, kind, description, status FROM lf_items WHERE description ILIKE $1 LIMIT 6`, [like])
      if (user.perms['assets.view']) out.assets = await rows(
        `SELECT id, name, category, status FROM assets WHERE name ILIKE $1 LIMIT 6`, [like])
      return out
    },
  },

  // ============ bookings ============
  {
    name: 'list_bookings', title: 'List bookings', flag: 'bookings', perm: 'bookings.view',
    description: 'Guest groups overlapping a date range (default: today through two weeks out), with status, headcount, and dates.',
    schema: S({ from: str('ISO date, default today'), to: str('ISO date, default +14 days'), status: str('tentative | confirmed | in_progress | completed | cancelled') }),
    run: async ({ from, to, status }) => {
      const f = from || todayISO(), t = to || addDays(todayISO(), 14)
      return await rows(
        `SELECT b.id, b.code, b.name, b.status, b.segment, b.start_date, b.end_date, b.headcount, b.value::float,
                c.name AS customer
         FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
         WHERE b.start_date <= $2 AND b.end_date >= $1 ${status ? 'AND b.status = $3' : ''}
         ORDER BY b.start_date LIMIT 100`, status ? [f, t, status] : [f, t])
    },
  },
  {
    name: 'get_booking', title: 'Booking detail', flag: 'bookings', perm: 'bookings.view',
    description: 'Everything about one booking: dates, rooms assigned, meal services (if you hold catering), and invoices (if you hold billing). Accepts the numeric id or the BK- code.',
    schema: S({ id: str('Booking id or code, e.g. "BK-2026" or "12"') }, ['id']),
    run: async ({ id }, user) => {
      const b = await one(
        `SELECT b.*, b.value::float AS value, c.name AS customer FROM bookings b
         LEFT JOIN customers c ON c.id = b.customer_id
         WHERE b.code = $1 OR b.id = $2`, [String(id).toUpperCase(), /^\d+$/.test(id) ? Number(id) : -1])
      if (!b) throw new Error(`No booking matches “${id}”`)
      b.rooms = await rows(
        `SELECT l.name, r.date_from, r.date_to FROM booking_rooms r JOIN locations l ON l.id = r.location_id
         WHERE r.booking_id = $1 ORDER BY r.date_from`, [b.id])
      if (user.perms['bookings.catering']) {
        b.meals = await rows(`SELECT date, meal, time, headcount, menu, dietary FROM meal_services WHERE booking_id = $1 ORDER BY date, meal`, [b.id])
      }
      if (user.perms['bookings.billing']) {
        b.invoices = await rows(
          `SELECT i.number, i.status, i.due_date,
            (SELECT COALESCE(SUM((it->>'qty')::numeric * (it->>'unit_price')::numeric), 0) FROM jsonb_array_elements(i.items) it)::float AS subtotal
           FROM invoices i WHERE i.booking_id = $1`, [b.id])
      }
      return b
    },
  },
  {
    name: 'create_lead', title: 'Create lead', flag: 'bookings', perm: 'bookings.leads', write: true,
    description: 'Add a new inquiry to the leads pipeline (stage: new). Use when someone reaches out about booking the property.',
    schema: S({
      name: str('Lead / group name'), organization: str('Organization'), contact_name: str('Contact person'),
      email: str('Contact email'), phone: str('Phone'), expected_headcount: num('Expected guests'),
      segment: str('retreat | school | corporate | wedding | family_camp | other'), message: str('What they asked for'),
    }, ['name']),
    run: async (a, user) => {
      const l = await one(
        `INSERT INTO leads (name, organization, contact_name, email, phone, expected_headcount, segment, message, source, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'claude',$9) RETURNING id, name, stage`,
        [a.name, a.organization || '', a.contact_name || '', a.email || '', a.phone || '',
         a.expected_headcount || null, a.segment || 'retreat', a.message || '', user.id])
      await audit(user, 'ai.lead.create', 'lead', l.id, { name: a.name })
      return { created: l, note: 'Lead is in the New column of the pipeline.' }
    },
  },
  {
    name: 'create_booking', title: 'Create booking', flag: 'bookings', perm: 'bookings.edit', write: true,
    description: 'Create a guest-group booking. Customer matches an existing organization by name or is created. Status defaults to tentative.',
    schema: S({
      name: str('Group name'), start_date: str('ISO arrival date'), end_date: str('ISO departure date'),
      status: str('tentative | confirmed (default tentative)'), segment: str('retreat | school_trip | corporate | church | internal | other'),
      headcount: num('Expected guests'), value: num('Booking value in dollars'), customer: str('Customer organization name'),
      notes: str('Notes'), dietary: str('Dietary needs summary'),
    }, ['name', 'start_date', 'end_date']),
    run: async (a, user) => {
      if (a.end_date < a.start_date) throw new Error('The end date is before the start date')
      let customerId = null
      if (a.customer) {
        const c = await one(`SELECT id FROM customers WHERE name ILIKE $1 LIMIT 1`, [`%${a.customer}%`])
        customerId = c ? c.id
          : (await one(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [a.customer])).id
      }
      const last = await one(`SELECT code FROM bookings WHERE code LIKE 'BK-%' ORDER BY id DESC LIMIT 1`)
      const n = last ? parseInt(last.code.slice(3), 10) + 1 : 1001
      const code = `BK-${isNaN(n) ? Date.now() % 100000 : n}`
      const b = await one(
        `INSERT INTO bookings (code, name, customer_id, status, segment, start_date, end_date, headcount, value, notes, dietary, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, code, name, status, start_date, end_date, headcount`,
        [code, a.name, customerId, ['tentative', 'confirmed'].includes(a.status) ? a.status : 'tentative',
         a.segment || 'retreat', a.start_date, a.end_date, a.headcount || 0, a.value || 0, a.notes || '', a.dietary || '', user.id])
      await audit(user, 'ai.booking.create', 'booking', b.id, { code: b.code, name: a.name })
      return { created: b }
    },
  },
  {
    name: 'update_booking', title: 'Update booking', flag: 'bookings', perm: 'bookings.edit', write: true,
    description: 'Change a booking: status (tentative, confirmed, in_progress, completed, cancelled), dates, headcount, value, dietary notes. Accepts id or BK- code.',
    schema: S({
      id: str('Booking id or code'), status: str('New status'), start_date: str('ISO date'), end_date: str('ISO date'),
      headcount: num('Guests'), value: num('Dollar value'), notes: str('Replace notes'), dietary: str('Dietary needs'),
    }, ['id']),
    run: async (a, user) => {
      const b = await findBooking(a.id)
      if (!b) throw new Error(`No booking matches “${a.id}”`)
      if (a.status && !['tentative', 'confirmed', 'in_progress', 'completed', 'cancelled'].includes(a.status)) {
        throw new Error('Status must be tentative, confirmed, in_progress, completed, or cancelled')
      }
      const out = await one(
        `UPDATE bookings SET status = COALESCE($2, status), start_date = COALESCE($3, start_date),
           end_date = COALESCE($4, end_date), headcount = COALESCE($5, headcount), value = COALESCE($6, value),
           notes = COALESCE($7, notes), dietary = COALESCE($8, dietary), updated_at = now()
         WHERE id = $1 RETURNING id, code, name, status, start_date, end_date, headcount, value::float`,
        [b.id, a.status || null, a.start_date || null, a.end_date || null, a.headcount ?? null,
         a.value ?? null, a.notes ?? null, a.dietary ?? null])
      await audit(user, a.status ? `ai.booking.${a.status}` : 'ai.booking.update', 'booking', b.id, { code: b.code })
      return { updated: out, was: { status: b.status, start_date: b.start_date, end_date: b.end_date } }
    },
  },
  {
    name: 'room_availability', title: 'Room availability', flag: 'accommodation', perm: 'accommodation.view',
    description: 'Which lodges and cabins are free or taken for a date range — beds, capacity, housekeeping condition, and the group occupying each taken unit.',
    schema: S({ from: str('ISO date (default today)'), to: str('ISO date (default +7 days)') }),
    run: async (a) => {
      const f = a.from || todayISO(), t = a.to || addDays(todayISO(), 7)
      const lodging = await rows(
        `SELECT id, name, zone, beds, capacity, condition FROM locations
         WHERE active AND NOT exclude_from_accom ORDER BY sort, name`)
      const blocks = await rows(
        `SELECT br.location_id, br.date_from, br.date_to, b.name, b.code, b.status, b.headcount
         FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
         WHERE br.date_from <= $2 AND br.date_to >= $1 AND b.status != 'cancelled'`, [f, t])
      const byLoc = new Map()
      for (const bl of blocks) {
        if (!byLoc.has(bl.location_id)) byLoc.set(bl.location_id, [])
        byLoc.get(bl.location_id).push({ group: bl.name, code: bl.code, status: bl.status, from: bl.date_from, to: bl.date_to })
      }
      const units = lodging.map(l => ({ ...l, occupied_by: byLoc.get(l.id) || [], free: !byLoc.has(l.id) }))
      return {
        from: f, to: t, units,
        summary: {
          free: units.filter(u => u.free).length, taken: units.filter(u => !u.free).length,
          free_beds: units.filter(u => u.free).reduce((s, u) => s + (u.beds || 0), 0),
        },
      }
    },
  },
  {
    name: 'housekeeping_board', title: 'Housekeeping board', flag: 'accommodation', perm: 'housekeeping.board',
    description: 'The daily turnover board: which units have groups leaving, arriving, or flipping same-day, and which are not yet guest-ready.',
    schema: S({ date: str('ISO date (default today)') }),
    run: async (a) => {
      const date = a.date || todayISO()
      const lodging = await rows(
        `SELECT id, name, zone, beds, condition, condition_note FROM locations
         WHERE active AND NOT exclude_from_accom ORDER BY sort, name`)
      const [leaving, arriving, staying] = await Promise.all([
        rows(`SELECT br.location_id, b.name, b.code FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
              WHERE br.date_to = $1 AND b.status != 'cancelled'`, [date]),
        rows(`SELECT br.location_id, b.name, b.code FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
              WHERE br.date_from = $1 AND b.status != 'cancelled'`, [date]),
        rows(`SELECT br.location_id, b.name FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
              WHERE br.date_from < $1 AND br.date_to > $1 AND b.status != 'cancelled'`, [date]),
      ])
      const idx = list => new Map(list.map(r => [r.location_id, r]))
      const out = idx(leaving), inn = idx(arriving), stay = idx(staying)
      const units = lodging.map(l => ({
        unit: l.name, zone: l.zone, condition: l.condition, note: l.condition_note || undefined,
        leaving: out.get(l.id)?.name || null, arriving: inn.get(l.id)?.name || null, staying: stay.get(l.id)?.name || null,
        same_day_flip: !!out.get(l.id) && !!inn.get(l.id),
      })).filter(u => u.leaving || u.arriving || u.staying || u.condition !== 'clean')
      return {
        date, units,
        summary: {
          turnovers: units.filter(u => u.leaving).length,
          same_day_flips: units.filter(u => u.same_day_flip).length,
          arrivals: units.filter(u => u.arriving).length,
          not_ready: units.filter(u => u.condition !== 'clean').length,
        },
      }
    },
  },
  {
    name: 'list_leads', title: 'List leads', flag: 'bookings', perm: 'bookings.leads',
    description: 'The inquiry pipeline: every lead with stage, contact, expected headcount and value, plus the funnel totals.',
    schema: S({ stage: str('new | contacted | tour | proposal | won | lost'), q: str('Search names / organizations') }),
    run: async (a) => {
      const where = ['TRUE'], params = []
      if (a.stage) { params.push(a.stage); where.push(`ld.stage = $${params.length}`) }
      if (a.q) { params.push(`%${a.q}%`); where.push(`(ld.name ILIKE $${params.length} OR ld.organization ILIKE $${params.length})`) }
      const leads = await rows(
        `SELECT ld.id, ld.name, ld.organization, ld.contact_name, ld.email, ld.phone, ld.stage, ld.segment,
                ld.expected_headcount, ld.preferred_start, ld.preferred_end, ld.value_estimate::float, u.name AS owner
         FROM leads ld LEFT JOIN users u ON u.id = ld.owner_id
         WHERE ${where.join(' AND ')} ORDER BY ld.updated_at DESC LIMIT 100`, params)
      const funnel = await rows(`SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(value_estimate),0)::float AS value FROM leads GROUP BY stage`)
      return { leads, funnel }
    },
  },
  {
    name: 'update_lead', title: 'Update lead', flag: 'bookings', perm: 'bookings.leads', write: true,
    description: 'Move a lead through the pipeline (new → contacted → tour → proposal → won/lost) or update its details. Use convert_lead to turn a won lead into a booking.',
    schema: S({
      id: num('Lead id (see list_leads)'), stage: str('New stage'), owner: str('Owner name or email'),
      value_estimate: num('Estimated value'), expected_headcount: num('Guests'), message: str('Append context to the notes'),
      lost_reason: str('Why it was lost (when stage = lost)'),
    }, ['id']),
    run: async (a, user) => {
      const before = await one(`SELECT * FROM leads WHERE id = $1`, [a.id])
      if (!before) throw new Error(`No lead #${a.id}`)
      if (a.stage && !['new', 'contacted', 'tour', 'proposal', 'won', 'lost'].includes(a.stage)) throw new Error('Unknown stage')
      const owner = a.owner ? await findUser(a.owner) : null
      const message = a.message ? `${before.message ? before.message + '\n' : ''}${a.message}` : null
      const ld = await one(
        `UPDATE leads SET stage = COALESCE($2, stage), owner_id = COALESCE($3, owner_id),
           value_estimate = COALESCE($4, value_estimate), expected_headcount = COALESCE($5, expected_headcount),
           message = COALESCE($6, message), lost_reason = COALESCE($7, lost_reason), updated_at = now()
         WHERE id = $1 RETURNING id, name, stage, value_estimate::float`,
        [a.id, a.stage || null, owner?.id || null, a.value_estimate ?? null, a.expected_headcount ?? null,
         message, a.lost_reason || null])
      if (a.stage && a.stage !== before.stage) await audit(user, `ai.lead.${a.stage}`, 'lead', a.id, { from: before.stage })
      else await audit(user, 'ai.lead.update', 'lead', a.id, {})
      return { updated: ld, was_stage: before.stage }
    },
  },
  {
    name: 'convert_lead', title: 'Convert lead to booking', flag: 'bookings', perm: 'bookings.leads', write: true,
    description: 'Win a lead: creates the customer record (if new) and a tentative booking in one move. Dates default to the lead’s preferred window.',
    schema: S({ id: num('Lead id'), start_date: str('ISO arrival (default: preferred start)'), end_date: str('ISO departure') }, ['id']),
    run: async (a, user) => {
      const ld = await one(`SELECT * FROM leads WHERE id = $1`, [a.id])
      if (!ld) throw new Error(`No lead #${a.id}`)
      if (ld.booking_id) throw new Error('Already converted')
      const s = a.start_date || ld.preferred_start
      const e = a.end_date || ld.preferred_end || s
      if (!s) throw new Error('Pick the booking dates — the lead has no preferred window')
      let customerId = ld.customer_id
      if (!customerId) {
        const c = await one(
          `INSERT INTO customers (name, type, email, phone, notes) VALUES ($1,'organization',$2,$3,$4) RETURNING id`,
          [ld.organization || ld.name, ld.email, ld.phone, ld.contact_name ? `Contact: ${ld.contact_name}` : ''])
        customerId = c.id
      }
      const last = await one(`SELECT code FROM bookings WHERE code LIKE 'BK-%' ORDER BY id DESC LIMIT 1`)
      const n = last ? parseInt(last.code.slice(3), 10) + 1 : 1001
      const b = await one(
        `INSERT INTO bookings (code, name, customer_id, status, segment, start_date, end_date, headcount, value, notes, created_by)
         VALUES ($1,$2,$3,'tentative',$4,$5,$6,$7,$8,$9,$10) RETURNING id, code, name, start_date, end_date`,
        [`BK-${isNaN(n) ? Date.now() % 100000 : n}`, ld.name, customerId, ld.segment, s, e,
         ld.expected_headcount || 0, ld.value_estimate || 0, ld.message ? `From lead: ${ld.message}` : '', user.id])
      await q(`UPDATE leads SET stage = 'won', customer_id = $2, booking_id = $3, updated_at = now() WHERE id = $1`,
        [ld.id, customerId, b.id])
      await audit(user, 'ai.lead.convert', 'lead', ld.id, { booking: b.code })
      return { booking: b, note: 'Lead marked won and linked to the booking.' }
    },
  },
  {
    name: 'list_invoices', title: 'List invoices', flag: 'bookings', perm: 'bookings.billing',
    description: 'Invoices with live derived statuses (draft, sent, partial, paid, overdue, void) plus outstanding and overdue totals.',
    schema: S({ status: str('Filter by derived status'), q: str('Search number / customer / group') }),
    run: async (a) => {
      const list = await rows(
        `SELECT i.id, i.number, i.status, i.issue_date, i.due_date, i.tax_rate::float, i.items,
                b.name AS booking, b.code AS booking_code, c.name AS customer,
                COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id),0)::float AS paid
         FROM invoices i LEFT JOIN bookings b ON b.id = i.booking_id LEFT JOIN customers c ON c.id = i.customer_id
         ORDER BY i.created_at DESC LIMIT 200`)
      let out = list.map(i => {
        const subtotal = invoiceSubtotal(i.items)
        const total = subtotal * (1 + Number(i.tax_rate || 0) / 100)
        const derived = invoiceDerived(i, i.paid)
        return { id: i.id, number: i.number, customer: i.customer, booking: i.booking, booking_code: i.booking_code,
          status: derived, issue_date: i.issue_date, due_date: i.due_date,
          total: Math.round(total * 100) / 100, paid: i.paid, owing: Math.round((total - i.paid) * 100) / 100 }
      })
      if (a.status) out = out.filter(i => i.status === a.status)
      if (a.q) { const needle = a.q.toLowerCase(); out = out.filter(i => [i.number, i.customer, i.booking].join(' ').toLowerCase().includes(needle)) }
      return {
        invoices: out,
        outstanding: Math.round(out.filter(i => ['sent', 'partial', 'overdue'].includes(i.status)).reduce((s, i) => s + i.owing, 0) * 100) / 100,
        overdue: Math.round(out.filter(i => i.status === 'overdue').reduce((s, i) => s + i.owing, 0) * 100) / 100,
      }
    },
  },
  {
    name: 'get_invoice', title: 'Invoice detail', flag: 'bookings', perm: 'bookings.billing',
    description: 'One invoice in full: line items, tax, payments received, and the balance owing. Accepts the number (INV-…) or id.',
    schema: S({ id: str('Invoice number or id') }, ['id']),
    run: async ({ id }) => {
      const i = await findInvoice(id)
      if (!i) throw new Error(`No invoice matches “${id}”`)
      const payments = await rows(
        `SELECT p.date, p.amount::float, p.method, p.reference, u.name AS recorded_by
         FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.invoice_id = $1 ORDER BY p.date`, [i.id])
      const paid = payments.reduce((s, p) => s + p.amount, 0)
      const subtotal = invoiceSubtotal(i.items)
      const total = subtotal * (1 + Number(i.tax_rate || 0) / 100)
      const ctx = await one(
        `SELECT b.name AS booking, b.code AS booking_code, c.name AS customer FROM invoices i
         LEFT JOIN bookings b ON b.id = i.booking_id LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`, [i.id])
      return {
        number: i.number, ...ctx, status: invoiceDerived(i, paid),
        issue_date: i.issue_date, due_date: i.due_date, items: i.items, tax_rate: Number(i.tax_rate),
        subtotal: Math.round(subtotal * 100) / 100, total: Math.round(total * 100) / 100,
        paid: Math.round(paid * 100) / 100, owing: Math.round((total - paid) * 100) / 100, payments, notes: i.notes,
      }
    },
  },
  {
    name: 'create_invoice', title: 'Create invoice', flag: 'bookings', perm: 'bookings.billing', write: true,
    description: 'Draft an invoice against a booking. Items are {descr, qty, unit_price} lines; tax defaults to the org rate (HST 13%).',
    schema: S({
      booking: str('Booking id or BK- code'),
      items: { type: 'array', description: 'Line items', items: S({ descr: str('Line description'), qty: num('Quantity'), unit_price: num('Unit price in dollars') }, ['descr', 'qty', 'unit_price']) },
      due_date: str('ISO date payment is due'), notes: str('Notes printed on the invoice'),
    }, ['booking', 'items']),
    run: async (a, user) => {
      const b = await findBooking(a.booking)
      if (!b) throw new Error(`No booking matches “${a.booking}”`)
      if (!Array.isArray(a.items) || !a.items.length) throw new Error('Give me at least one line item')
      const billing = await getSetting('billing', {})
      const last = await one(`SELECT number FROM invoices ORDER BY id DESC LIMIT 1`)
      const n = last ? parseInt(String(last.number).replace(/^\D+/, ''), 10) + 1 : 1001
      const number = `${billing.invoice_prefix || 'INV-'}${isNaN(n) ? Date.now() % 100000 : n}`
      const inv = await one(
        `INSERT INTO invoices (number, booking_id, customer_id, status, issue_date, due_date, tax_rate, items, notes, created_by)
         VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9) RETURNING id, number, status, due_date`,
        [number, b.id, b.customer_id, todayISO(), a.due_date || null, billing.tax_rate ?? 13,
         JSON.stringify(a.items), a.notes || '', user.id])
      await audit(user, 'ai.invoice.create', 'invoice', inv.id, { number, booking: b.code })
      return { created: inv, subtotal: invoiceSubtotal(a.items), note: 'Saved as a draft — mark it sent from the Billing page.' }
    },
  },
  {
    name: 'record_payment', title: 'Record payment', flag: 'bookings', perm: 'bookings.billing', write: true,
    description: 'Record money received against an invoice. The invoice status derives automatically (partial / paid).',
    schema: S({
      invoice: str('Invoice number or id'), amount: num('Dollar amount received'),
      method: str('e-transfer | cheque | card | cash'), date: str('ISO date (default today)'), reference: str('Reference #'),
    }, ['invoice', 'amount']),
    run: async (a, user) => {
      const i = await findInvoice(a.invoice)
      if (!i) throw new Error(`No invoice matches “${a.invoice}”`)
      if (!(a.amount > 0)) throw new Error('Amount must be positive')
      await one(
        `INSERT INTO payments (invoice_id, date, amount, method, reference, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [i.id, a.date || todayISO(), a.amount, a.method || 'e-transfer', a.reference || '', user.id])
      await q(`UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, updated_at = now() WHERE id = $1`, [i.id])
      const paid = (await one(`SELECT COALESCE(SUM(amount),0)::float AS p FROM payments WHERE invoice_id = $1`, [i.id])).p
      const total = invoiceSubtotal(i.items) * (1 + Number(i.tax_rate || 0) / 100)
      await audit(user, 'ai.payment.record', 'invoice', i.id, { number: i.number, amount: a.amount })
      return { ok: true, invoice: i.number, paid_to_date: paid, owing: Math.round((total - paid) * 100) / 100 }
    },
  },
  {
    name: 'catering_sheet', title: 'Kitchen sheet', flag: 'bookings', perm: 'bookings.catering',
    description: 'The kitchen sheet for a date range: every meal service with time, headcount, menu and location, plus the dietary rollup for groups on site.',
    schema: S({ start: str('ISO date (default today)'), end: str('ISO date (default +6 days)') }),
    run: async (a) => {
      const start = a.start || todayISO(), end = a.end || addDays(start, 6)
      const services = await rows(
        `SELECT m.date, m.meal, m.time, m.headcount, m.menu, m.dietary, b.name AS booking, b.code, l.name AS location
         FROM meal_services m JOIN bookings b ON b.id = m.booking_id LEFT JOIN locations l ON l.id = m.location_id
         WHERE m.date >= $1 AND m.date <= $2 AND b.status != 'cancelled'
         ORDER BY m.date, array_position(ARRAY['breakfast','lunch','dinner','snack'], m.meal), m.time`, [start, end])
      const dietary = await rows(
        `SELECT b.name, b.code, b.headcount, b.dietary FROM bookings b
         WHERE b.dietary != '' AND b.status IN ('confirmed','in_progress') AND b.start_date <= $2 AND b.end_date >= $1
         ORDER BY b.start_date`, [start, end])
      return { start, end, services, dietary_rollup: dietary }
    },
  },
  {
    name: 'add_meal_service', title: 'Add meal service', flag: 'bookings', perm: 'bookings.catering', write: true,
    description: 'Put a meal on the kitchen sheet for a booking. Headcount defaults to the group size.',
    schema: S({
      booking: str('Booking id or BK- code'), date: str('ISO date'), meal: str('breakfast | lunch | dinner | snack'),
      time: str('Serving time, e.g. "18:00"'), headcount: num('Covers (default: group headcount)'),
      menu: str('What’s being served'), dietary: str('Dietary notes for this service'), location: str('Where it’s served'),
    }, ['booking', 'date', 'meal']),
    run: async (a, user) => {
      const b = await findBooking(a.booking)
      if (!b) throw new Error(`No booking matches “${a.booking}”`)
      if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(a.meal)) throw new Error('Meal must be breakfast, lunch, dinner, or snack')
      const loc = await findLocation(a.location)
      const m = await one(
        `INSERT INTO meal_services (booking_id, date, meal, time, headcount, menu, location_id, dietary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, date, meal, headcount`,
        [b.id, a.date, a.meal, a.time || '', a.headcount ?? b.headcount ?? 0, a.menu || '', loc?.id || null, a.dietary || ''])
      await audit(user, 'ai.meal.create', 'booking', b.id, { date: a.date, meal: a.meal })
      return { created: m, booking: b.name, location: loc?.name || null }
    },
  },

  // ============ facilities / tickets ============
  {
    name: 'list_tickets', title: 'List tickets', flag: 'facilities', perm: 'tickets.view',
    description: 'Maintenance tickets and guest reports. Filter by status (open, in_progress, on_hold, pending_close, closed, or "active" for all unresolved), priority 1–4 (4 = ASAP), tag name, guest-waiting, or free text.',
    schema: S({
      status: str('active | open | in_progress | on_hold | pending_close | closed'),
      q: str('Search title / code'), priority: num('0 low … 4 ASAP'),
      tag: str('Tag name'), waiting: bool('Only tickets where the guest is waiting on a reply'),
      overdue: bool('Only tickets past their due date'),
    }),
    run: async (a) => {
      const where = [], params = []
      if (a.status === 'active' || !a.status) where.push(`t.status != 'closed'`)
      else { params.push(a.status); where.push(`t.status = $${params.length}`) }
      if (a.priority) { params.push(a.priority); where.push(`t.priority = $${params.length}`) }
      if (a.waiting) where.push(`t.guest_unread = true`)
      if (a.overdue) { params.push(todayISO()); where.push(`t.due_date < $${params.length} AND t.status != 'closed'`) }
      if (a.q) { params.push(`%${a.q}%`); where.push(`(t.title ILIKE $${params.length} OR t.code ILIKE $${params.length})`) }
      if (a.tag) { params.push(a.tag); where.push(`EXISTS (SELECT 1 FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = t.id AND g.name ILIKE $${params.length})`) }
      const list = await rows(
        `SELECT t.id, t.code, t.title, t.status, t.priority, t.category, t.due_date, t.guest_unread,
                l.name AS location, u.name AS assignee,
                (SELECT array_agg(g.name) FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = t.id) AS tags
         FROM tickets t LEFT JOIN locations l ON l.id = t.location_id LEFT JOIN users u ON u.id = t.assignee_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY t.priority DESC, t.created_at DESC LIMIT 50`, params)
      return list.map(t => ({ ...t, priority: PRIORITY[t.priority] || t.priority }))
    },
  },
  {
    name: 'get_ticket', title: 'Ticket detail', flag: 'facilities', perm: 'tickets.view',
    description: 'One ticket in full: the conversation thread (staff, internal notes, guest messages), status history, attachments, watchers, and any pending closure request. Accepts id or MW- code.',
    schema: S({ id: str('Ticket id or code, e.g. "MW-10219"') }, ['id']),
    run: async ({ id }) => {
      const t = await findTicket(id)
      if (!t) throw new Error(`No ticket matches “${id}”`)
      const [thread, events, atts, watchers, closure, tags] = await Promise.all([
        rows(`SELECT author_name, body, is_internal, is_guest, created_at FROM ticket_responses WHERE ticket_id = $1 ORDER BY created_at`, [t.id]),
        rows(`SELECT kind, detail, user_name, created_at FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at`, [t.id]),
        rows(`SELECT original_name, mime, size FROM ticket_attachments WHERE ticket_id = $1`, [t.id]),
        rows(`SELECT u.name FROM ticket_watchers w JOIN users u ON u.id = w.user_id WHERE w.ticket_id = $1`, [t.id]),
        one(`SELECT cr.*, u.name AS requested_by_name FROM closure_requests cr LEFT JOIN users u ON u.id = cr.requested_by
             WHERE cr.ticket_id = $1 AND cr.status = 'pending'`, [t.id]),
        rows(`SELECT g.name, g.color FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = $1`, [t.id]),
      ])
      delete t.public_token; delete t.triage
      return { ...t, priority: PRIORITY[t.priority] || t.priority, thread, events, attachments: atts, watchers: watchers.map(w => w.name), pending_closure: closure, tags }
    },
  },
  {
    name: 'create_ticket', title: 'Create ticket', flag: 'facilities', perm: 'tickets.edit', write: true,
    description: 'Open a new maintenance ticket. Location and assignee match by name. Priority 0 low, 1 normal, 2 high, 3 urgent, 4 ASAP (needs the Set-priority permission, otherwise it lands as normal).',
    schema: S({
      title: str('Short summary'), details: str('Full description'),
      category: str('maintenance | housekeeping | safety | it | grounds | other'),
      priority: num('0–4'), location: str('Location name (fuzzy matched)'), assignee: str('Assignee name or email'),
      due_date: str('ISO date the work is due'),
    }, ['title']),
    run: async (a, user) => {
      const loc = await findLocation(a.location)
      const assignee = a.assignee ? await findUser(a.assignee) : null
      const prio = user.perms['tickets.priority'] && Number.isInteger(a.priority) ? Math.min(4, Math.max(0, a.priority)) : 1
      const t = await one(
        `INSERT INTO tickets (code, title, details, category, priority, location_id, assignee_id, due_date, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'staff',$9) RETURNING id, code, title, status, priority, due_date`,
        [await nextTicketCode(), a.title, a.details || '', a.category || 'maintenance', prio,
         loc?.id || null, assignee?.id || null, a.due_date || null, user.id])
      await logTicketEvent(t.id, 'created', { source: 'claude' }, user)
      if (assignee && assignee.id !== user.id) {
        notify(assignee.id, { icon: '🎫', title: `Assigned to you: ${a.title}`, body: t.code, link: `/tickets/${t.id}` })
      }
      await audit(user, 'ai.ticket.create', 'ticket', t.id, { code: t.code, title: a.title })
      return { created: { ...t, priority: PRIORITY[t.priority] }, location: loc?.name || null, assignee: assignee?.name || null }
    },
  },
  {
    name: 'reply_ticket', title: 'Reply on ticket', flag: 'facilities', perm: 'tickets.edit', write: true,
    description: 'Add a reply to a ticket thread. internal=true posts a staff-only note; otherwise the reply is visible to the guest on their tracking page (needs the Guest-chat permission when a chat link exists).',
    schema: S({ id: str('Ticket id or code'), body: str('The message'), internal: bool('Staff-only internal note (default false)') }, ['id', 'body']),
    run: async (a, user) => {
      const t = await findTicket(a.id)
      if (!t) throw new Error(`No ticket matches “${a.id}”`)
      const internal = !!a.internal
      if (!internal && t.public_token && !user.perms['tickets.chat']) {
        throw new Error('Messaging the guest needs the Guest-chat permission — set internal=true for a staff note')
      }
      await one(
        `INSERT INTO ticket_responses (ticket_id, user_id, author_name, body, is_internal)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t.id, user.id, `${user.name} (via Claude)`, String(a.body).trim(), internal])
      await q(`UPDATE tickets SET updated_at = now(),
               first_response_at = CASE WHEN first_response_at IS NULL AND NOT $2 THEN now() ELSE first_response_at END
               WHERE id = $1`, [t.id, internal])
      for (const uid of new Set([t.created_by, t.assignee_id].filter(u => u && u !== user.id))) {
        notify(uid, { icon: '💬', title: `${user.name} replied on ${t.code}`, body: String(a.body).slice(0, 90), link: `/tickets/${t.id}` })
      }
      await audit(user, 'ai.ticket.reply', 'ticket', t.id, { internal })
      return { ok: true, ticket: t.code, visible_to_guest: !internal && !!t.public_token }
    },
  },
  {
    name: 'set_ticket_status', title: 'Set ticket status', flag: 'facilities', perm: 'tickets.edit', write: true,
    description: 'Move a ticket to open, in_progress, on_hold, or closed. Closing needs the Close-tickets permission. Hold time is banked automatically.',
    schema: S({ id: str('Ticket id or code'), status: str('open | in_progress | on_hold | closed') }, ['id', 'status']),
    run: async (a, user) => {
      const t = await findTicket(a.id)
      if (!t) throw new Error(`No ticket matches “${a.id}”`)
      const status = String(a.status)
      if (!['open', 'in_progress', 'on_hold', 'closed'].includes(status)) throw new Error('Status must be open, in_progress, on_hold, or closed')
      if (status === 'closed' && !user.perms['tickets.close']) {
        throw new Error('Closing needs the Close-tickets permission — ask in the app for a closure request instead')
      }
      let holdSql = ''
      if (status !== t.status) {
        if (status === 'on_hold') holdSql = `, on_hold_at = now()`
        else if (t.status === 'on_hold') holdSql = `, hold_seconds = hold_seconds + COALESCE(EXTRACT(EPOCH FROM now() - on_hold_at), 0)::int, on_hold_at = NULL`
      }
      await q(`UPDATE tickets SET status = $2, updated_at = now(),
               closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END ${holdSql} WHERE id = $1`, [t.id, status])
      await logTicketEvent(t.id, 'status', { from: t.status, to: status }, user)
      await audit(user, `ai.ticket.${status}`, 'ticket', t.id, { code: t.code })
      return { ok: true, ticket: t.code, from: t.status, to: status }
    },
  },
  {
    name: 'assign_ticket', title: 'Assign ticket', flag: 'facilities', perm: 'tickets.edit', write: true,
    description: 'Hand a ticket to someone (matched by name or email). They get a notification.',
    schema: S({ id: str('Ticket id or code'), assignee: str('Name or email — empty string unassigns') }, ['id', 'assignee']),
    run: async (a, user) => {
      const t = await findTicket(a.id)
      if (!t) throw new Error(`No ticket matches “${a.id}”`)
      const person = a.assignee === '' ? null : await findUser(a.assignee)
      if (a.assignee !== '' && !person) throw new Error(`Nobody matches “${a.assignee}”`)
      await q(`UPDATE tickets SET assignee_id = $2, updated_at = now() WHERE id = $1`, [t.id, person?.id || null])
      await logTicketEvent(t.id, 'assigned', { to: person?.id || null, to_name: person?.name || 'unassigned' }, user)
      if (person && person.id !== user.id) {
        notify(person.id, { icon: '🎫', title: `Assigned to you: ${t.title}`, body: t.code, link: `/tickets/${t.id}` })
      }
      await audit(user, 'ai.ticket.assign', 'ticket', t.id, { code: t.code, to: person?.name || 'unassigned' })
      return { ok: true, ticket: t.code, assignee: person?.name || null }
    },
  },
  {
    name: 'set_ticket_priority', title: 'Set ticket priority', flag: 'facilities', perm: 'tickets.priority', write: true,
    description: 'Change a ticket’s priority: 0 low, 1 normal, 2 high, 3 urgent, 4 ASAP.',
    schema: S({ id: str('Ticket id or code'), priority: num('0–4') }, ['id', 'priority']),
    run: async (a, user) => {
      const t = await findTicket(a.id)
      if (!t) throw new Error(`No ticket matches “${a.id}”`)
      const p = Math.min(4, Math.max(0, Number(a.priority) || 0))
      await q(`UPDATE tickets SET priority = $2, updated_at = now() WHERE id = $1`, [t.id, p])
      await logTicketEvent(t.id, 'priority', { from: t.priority, to: p }, user)
      await audit(user, 'ai.ticket.priority', 'ticket', t.id, { code: t.code, to: p })
      return { ok: true, ticket: t.code, priority: PRIORITY[p], was: PRIORITY[t.priority] }
    },
  },
  {
    name: 'tag_ticket', title: 'Tag ticket', flag: 'facilities', perm: 'tickets.tag', write: true,
    description: 'Add or remove tags on a ticket by tag name. Unknown tags are only created when the caller can manage the tag catalog.',
    schema: S({
      id: str('Ticket id or code'),
      add: { type: 'array', description: 'Tag names to add', items: str('Tag name') },
      remove: { type: 'array', description: 'Tag names to remove', items: str('Tag name') },
    }, ['id']),
    run: async (a, user) => {
      const t = await findTicket(a.id)
      if (!t) throw new Error(`No ticket matches “${a.id}”`)
      const added = [], missing = [], removed = []
      for (const name of a.add || []) {
        let tag = await one(`SELECT id, name FROM tags WHERE name ILIKE $1 AND active LIMIT 1`, [String(name)])
        if (!tag && user.perms['tickets.tags_manage']) {
          tag = await one(`INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET active = true RETURNING id, name`, [String(name).trim()])
        }
        if (!tag) { missing.push(name); continue }
        await q(`INSERT INTO ticket_tags (ticket_id, tag_id, by_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [t.id, tag.id, user.id])
        added.push(tag.name)
      }
      for (const name of a.remove || []) {
        const gone = await one(
          `DELETE FROM ticket_tags tt USING tags g
           WHERE tt.ticket_id = $1 AND g.id = tt.tag_id AND g.name ILIKE $2 RETURNING g.name`, [t.id, String(name)])
        if (gone) removed.push(gone.name)
      }
      const tags = await rows(`SELECT g.name FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = $1`, [t.id])
      await audit(user, 'ai.ticket.tag', 'ticket', t.id, { code: t.code, added, removed })
      return { ticket: t.code, tags: tags.map(x => x.name), added, removed, ...(missing.length ? { not_in_catalog: missing } : {}) }
    },
  },
  {
    name: 'watch_ticket', title: 'Watch ticket', flag: 'facilities', perm: 'tickets.view', write: true,
    description: 'Follow or unfollow a ticket for the token holder — watchers are notified on every status change and reply.',
    schema: S({ id: str('Ticket id or code'), watch: bool('true to watch (default), false to stop') }, ['id']),
    run: async (a, user) => {
      const t = await findTicket(a.id)
      if (!t) throw new Error(`No ticket matches “${a.id}”`)
      const watch = a.watch !== false
      if (watch) await q(`INSERT INTO ticket_watchers (ticket_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.id, user.id])
      else await q(`DELETE FROM ticket_watchers WHERE ticket_id = $1 AND user_id = $2`, [t.id, user.id])
      return { ticket: t.code, watching: watch }
    },
  },
  {
    name: 'request_ticket_closure', title: 'Request closure', flag: 'facilities', perm: 'tickets.edit', write: true,
    description: 'Ask for a ticket to be closed (the path when the caller lacks the Close permission). Approvers are notified and decide.',
    schema: S({ id: str('Ticket id or code'), reason: str('Why it’s done') }, ['id']),
    run: async (a, user) => {
      const t = await findTicket(a.id)
      if (!t) throw new Error(`No ticket matches “${a.id}”`)
      if (t.status === 'closed') throw new Error('Already closed')
      if (t.status === 'pending_close') throw new Error('A closure request is already pending')
      const cr = await one(
        `INSERT INTO closure_requests (ticket_id, requested_by, reason, previous_status) VALUES ($1,$2,$3,$4) RETURNING id`,
        [t.id, user.id, String(a.reason || '').slice(0, 400), t.status])
      await q(`UPDATE tickets SET status = 'pending_close', pending_close_by = $2, updated_at = now() WHERE id = $1`, [t.id, user.id])
      await logTicketEvent(t.id, 'close_requested', { reason: a.reason || '' }, user)
      for (const uid of await usersWithPerm('tickets.approve_close')) {
        if (uid !== user.id) notify(uid, { icon: '🙋', title: `${user.name} wants to close ${t.code}`, body: a.reason || t.title, link: `/tickets/${t.id}` })
      }
      await audit(user, 'ai.ticket.close_request', 'ticket', t.id, { code: t.code })
      return { ok: true, ticket: t.code, request_id: cr.id, note: 'Approvers have been notified.' }
    },
  },
  {
    name: 'decide_ticket_closure', title: 'Decide closure request', flag: 'facilities', perm: 'tickets.approve_close', write: true,
    description: 'Approve or deny the pending closure request on a ticket. Approving closes it; denying returns it to its previous status.',
    schema: S({ id: str('Ticket id or code'), approve: bool('true approves, false denies'), note: str('Decision note for the requester') }, ['id', 'approve']),
    run: async (a, user) => {
      const t = await findTicket(a.id)
      if (!t) throw new Error(`No ticket matches “${a.id}”`)
      const cr = await one(`SELECT * FROM closure_requests WHERE ticket_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [t.id])
      if (!cr) throw new Error('No pending closure request on that ticket')
      const decided = a.approve ? 'approved' : 'denied'
      await q(`UPDATE closure_requests SET status = $2, decided_by = $3, decision_note = $4, decided_at = now() WHERE id = $1`,
        [cr.id, decided, user.id, String(a.note || '').slice(0, 400)])
      if (a.approve) {
        await q(`UPDATE tickets SET status = 'closed', closed_at = now(), pending_close_by = NULL, updated_at = now() WHERE id = $1`, [t.id])
      } else {
        await q(`UPDATE tickets SET status = $2, pending_close_by = NULL, updated_at = now() WHERE id = $1`, [t.id, cr.previous_status])
      }
      await logTicketEvent(t.id, a.approve ? 'close_approved' : 'close_denied', { note: a.note || '' }, user)
      notify(cr.requested_by, { icon: a.approve ? '✅' : '↩️', title: `Closure ${decided}: ${t.code}`, body: a.note || t.title, link: `/tickets/${t.id}` })
      await audit(user, `ai.ticket.close_${decided}`, 'ticket', t.id, { code: t.code })
      return { ok: true, ticket: t.code, decided }
    },
  },
  {
    name: 'list_canned_responses', title: 'Saved replies', flag: 'facilities', perm: 'tickets.view',
    description: 'The saved-reply library — reuse these verbatim (or adapted) when replying on tickets.',
    schema: S({}),
    run: async () => (await rows(`SELECT id, title, body FROM canned_responses WHERE active ORDER BY title`)),
  },

  // ============ tasks ============
  {
    name: 'list_tasks', title: 'List tasks', flag: 'tasks', perm: 'tasks.view',
    description: 'Tasks from the unified board. scope: open (default), overdue, mine (assigned to the token holder), done_recent, or all.',
    schema: S({ scope: str('open | overdue | mine | done_recent | all'), q: str('Search titles') }),
    run: async (a, user) => {
      const where = ['t.parent_id IS NULL'], params = []
      const scope = a.scope || 'open'
      if (scope === 'open') where.push(`s.kind != 'done'`)
      if (scope === 'overdue') { params.push(todayISO()); where.push(`s.kind != 'done' AND t.due < $${params.length}`) }
      if (scope === 'mine') { params.push(user.id); where.push(`$${params.length} = ANY(t.assignees) AND s.kind != 'done'`) }
      if (scope === 'done_recent') where.push(`s.kind = 'done' AND t.completed_at > now() - interval '7 days'`)
      if (a.q) { params.push(`%${a.q}%`); where.push(`t.title ILIKE $${params.length}`) }
      return await rows(
        `SELECT t.id, t.title, t.due, t.priority, s.name AS status, p.name AS phase,
                (SELECT string_agg(u.name, ', ') FROM users u WHERE u.id = ANY(t.assignees)) AS assignees,
                (SELECT COUNT(*)::int FROM tasks c WHERE c.parent_id = t.id) AS subtasks,
                (SELECT COUNT(*)::int FROM tasks c JOIN task_statuses cs ON cs.id = c.status_id WHERE c.parent_id = t.id AND cs.kind = 'done') AS subtasks_done
         FROM tasks t LEFT JOIN task_statuses s ON s.id = t.status_id LEFT JOIN phases p ON p.id = t.phase_id
         WHERE ${where.join(' AND ')} ORDER BY t.due NULLS LAST, t.priority DESC LIMIT 60`, params)
    },
  },
  {
    name: 'create_task', title: 'Create task', flag: 'tasks', perm: 'tasks.edit', write: true,
    description: 'Add a task to the board (lands in the first open column). Assignee matches by name or email. parent_id makes it a sub-task.',
    schema: S({
      title: str('Task title'), notes: str('Details'), due: str('ISO due date'),
      assignee: str('Name or email'), priority: num('1–3'), parent_id: num('Parent task id (makes a sub-task)'),
    }, ['title']),
    run: async (a, user) => {
      const st = await one(`SELECT id FROM task_statuses WHERE kind = 'open' ORDER BY ord LIMIT 1`)
      const assignee = a.assignee ? await findUser(a.assignee) : null
      const t = await one(
        `INSERT INTO tasks (title, notes, status_id, priority, due, assignees, parent_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, due`,
        [a.title, a.notes || '', st?.id || null, a.priority || 1, a.due || null,
         assignee ? [assignee.id] : [], a.parent_id || null, user.id])
      if (assignee && assignee.id !== user.id) {
        notify(assignee.id, { icon: '🧱', title: `New task: ${a.title}`, body: a.due ? `Due ${a.due}` : '', link: `/tasks` })
      }
      await audit(user, 'ai.task.create', 'task', t.id, { title: a.title })
      return { created: t, assignee: assignee?.name || null }
    },
  },
  {
    name: 'complete_task', title: 'Complete task', flag: 'tasks', perm: 'tasks.edit', write: true,
    description: 'Mark a task done (moves it to the first done column).',
    schema: S({ id: num('Task id') }, ['id']),
    run: async (a, user) => {
      const done = await one(`SELECT id FROM task_statuses WHERE kind = 'done' ORDER BY ord LIMIT 1`)
      if (!done) throw new Error('No done column configured')
      const t = await one(`UPDATE tasks SET status_id = $2, completed_at = now(), updated_at = now() WHERE id = $1 RETURNING id, title`, [a.id, done.id])
      if (!t) throw new Error(`No task #${a.id}`)
      await audit(user, 'ai.task.complete', 'task', t.id, { title: t.title })
      return { completed: t }
    },
  },
  {
    name: 'update_task', title: 'Update task', flag: 'tasks', perm: 'tasks.edit', write: true,
    description: 'Change a task: retitle, reschedule, reassign, move between board columns (status by column name), set priority, append notes, add checklist items, or tick one off.',
    schema: S({
      id: num('Task id'), title: str('New title'), notes: str('Append to the notes'), due: str('New ISO due date'),
      priority: num('0 low … 3 urgent'), status: str('Board column name, e.g. "In progress" or "Done"'),
      assignee: str('Name or email — replaces the assignee list'),
      add_checklist: { type: 'array', description: 'Checklist items to append', items: str('Item text') },
      check_item: str('Mark the checklist item containing this text as done'),
    }, ['id']),
    run: async (a, user) => {
      const t = await one(`SELECT * FROM tasks WHERE id = $1`, [a.id])
      if (!t) throw new Error(`No task #${a.id}`)
      let statusId = null, completedAt
      if (a.status) {
        const s = await one(`SELECT id, name, kind FROM task_statuses WHERE name ILIKE $1 ORDER BY ord LIMIT 1`, [`%${a.status}%`])
        if (!s) throw new Error(`No board column matches “${a.status}”`)
        statusId = s.id
        if (s.id !== t.status_id) completedAt = s.kind === 'done' ? new Date() : null
      }
      const assignee = a.assignee ? await findUser(a.assignee) : null
      if (a.assignee && !assignee) throw new Error(`Nobody matches “${a.assignee}”`)
      let checklist = null
      if (a.add_checklist?.length || a.check_item) {
        checklist = Array.isArray(t.checklist) ? [...t.checklist] : []
        for (const [i, text] of (a.add_checklist || []).entries()) {
          checklist.push({ id: `ai${Date.now()}${i}`, text: String(text), done: false })
        }
        if (a.check_item) {
          const needle = String(a.check_item).toLowerCase()
          const hit = checklist.find(c => !c.done && String(c.text).toLowerCase().includes(needle))
          if (!hit) throw new Error(`No open checklist item contains “${a.check_item}”`)
          hit.done = true
        }
      }
      const notes = a.notes ? `${t.notes ? t.notes + '\n' : ''}${a.notes}` : null
      const out = await one(
        `UPDATE tasks SET
           title = COALESCE($2, title), notes = COALESCE($3, notes), due = COALESCE($4, due),
           priority = COALESCE($5, priority), status_id = COALESCE($6, status_id),
           assignees = COALESCE($7, assignees), checklist = COALESCE($8, checklist), updated_at = now(),
           completed_at = CASE WHEN $9 THEN $10 ELSE completed_at END
         WHERE id = $1
         RETURNING id, title, due, priority`,
        [t.id, a.title || null, notes, a.due || null,
         Number.isInteger(a.priority) ? Math.min(3, Math.max(0, a.priority)) : null,
         statusId, assignee ? [assignee.id] : null, checklist ? JSON.stringify(checklist) : null,
         completedAt !== undefined, completedAt ?? null])
      if (assignee && assignee.id !== user.id) {
        notify(assignee.id, { icon: '🧱', title: `Task assigned to you: ${out.title}`, body: out.due ? `Due ${out.due}` : '', link: '/tasks' })
      }
      await audit(user, completedAt ? 'ai.task.complete' : 'ai.task.update', 'task', t.id, { title: out.title })
      return { updated: out, status: a.status || undefined, assignee: assignee?.name || undefined,
        checklist_done: checklist ? `${checklist.filter(c => c.done).length}/${checklist.length}` : undefined }
    },
  },
  {
    name: 'list_task_templates', title: 'Task templates', flag: 'tasks', perm: 'tasks.templates',
    description: 'Reusable checklist templates (lodge turnover, waterfront opening, …) that can be stamped onto the board with apply_task_template.',
    schema: S({}),
    run: async () => (await rows(`SELECT id, name, descr, jsonb_array_length(items) AS tasks, items FROM task_templates ORDER BY name`)),
  },
  {
    name: 'apply_task_template', title: 'Apply task template', flag: 'tasks', perm: 'tasks.templates', write: true,
    description: 'Stamp a template onto the board. Each item’s offset_days counts from the start date you give.',
    schema: S({
      template: str('Template id or name'), start_date: str('ISO date the offsets count from'),
      phase: str('Seasonal phase name to file the tasks under'), location: str('Location to pin them to'),
    }, ['template']),
    run: async (a, user) => {
      const tpl = /^\d+$/.test(String(a.template))
        ? await one(`SELECT * FROM task_templates WHERE id = $1`, [Number(a.template)])
        : await one(`SELECT * FROM task_templates WHERE name ILIKE $1 LIMIT 1`, [`%${a.template}%`])
      if (!tpl) throw new Error(`No template matches “${a.template}”`)
      const phase = a.phase ? await one(`SELECT id, name FROM phases WHERE name ILIKE $1 LIMIT 1`, [`%${a.phase}%`]) : null
      const loc = await findLocation(a.location)
      const first = await one(`SELECT id FROM task_statuses ORDER BY ord LIMIT 1`)
      let ord = (await one(`SELECT COALESCE(MAX(ord),0)+1 AS o FROM tasks`)).o
      const made = []
      for (const it of tpl.items || []) {
        const due = a.start_date && Number.isFinite(Number(it.offset_days)) ? addDays(a.start_date, Number(it.offset_days)) : null
        made.push(await one(
          `INSERT INTO tasks (title, notes, status_id, priority, phase_id, location_id, due, tags, checklist, ord, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, title, due`,
          [it.title, it.notes || '', first?.id, Math.min(3, Math.max(0, Number(it.priority) || 1)),
           phase?.id || null, loc?.id || null, due, it.tags || [], JSON.stringify(it.checklist || []), ord++, user.id]))
      }
      await audit(user, 'ai.template.apply', 'task', tpl.id, { name: tpl.name, created: made.length })
      return { template: tpl.name, created: made.length, tasks: made, phase: phase?.name || null, location: loc?.name || null }
    },
  },

  // ============ sign-out / shopping ============
  {
    name: 'who_is_out', title: 'Who is off property', flag: 'signout', perm: 'signout.board',
    description: 'Everyone currently signed out: destination, when they left, when they are expected back, and whether they are overdue.',
    schema: S({}),
    run: async () => (await rows(
      `SELECT u.name, t.destination, t.signed_out_at, t.expected_return, t.companions,
              (t.expected_return < now()) AS overdue
       FROM trips t JOIN users u ON u.id = t.user_id WHERE t.signed_in_at IS NULL ORDER BY t.signed_out_at`)),
  },
  {
    name: 'sign_out', title: 'Sign off property', flag: 'signout', perm: 'signout.use', write: true,
    description: 'Sign the token holder off property (destination + expected return). Signing someone else out needs the Manage sign-out permission.',
    schema: S({
      destination: str('Where to — e.g. Rosseau, Bracebridge'), expected_return: str('ISO datetime expected back'),
      companions: str('Who’s along'), vehicle: str('Vehicle'), notes: str('Notes'),
      person: str('Sign out someone else (name or email — needs Manage sign-out)'),
    }, ['destination']),
    run: async (a, user) => {
      let target = user
      if (a.person) {
        const p = await findUser(a.person)
        if (!p) throw new Error(`Nobody matches “${a.person}”`)
        if (p.id !== user.id && !user.perms['signout.manage']) throw new Error('Signing someone else out needs the Manage sign-out permission')
        target = p
      }
      const open = await one(`SELECT id FROM trips WHERE user_id = $1 AND signed_in_at IS NULL`, [target.id])
      if (open) throw new Error(`${target.name} is already signed out — sign back in first`)
      const t = await one(
        `INSERT INTO trips (user_id, destination, expected_return, companions, vehicle, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, destination, expected_return`,
        [target.id, a.destination, a.expected_return || null, a.companions || '', a.vehicle || '', a.notes || ''])
      await audit(user, 'ai.trip.out', 'trip', t.id, { destination: a.destination, for: target.name })
      return { signed_out: target.name, trip_id: t.id, destination: t.destination, expected_return: t.expected_return }
    },
  },
  {
    name: 'sign_in', title: 'Sign back in', flag: 'signout', perm: 'signout.use', write: true,
    description: 'Close the token holder’s open trip (or someone else’s, with the Manage sign-out permission).',
    schema: S({ person: str('Name or email (default: the token holder)') }),
    run: async (a, user) => {
      let target = user
      if (a.person) {
        const p = await findUser(a.person)
        if (!p) throw new Error(`Nobody matches “${a.person}”`)
        if (p.id !== user.id && !user.perms['signout.manage']) throw new Error('Signing someone else in needs the Manage sign-out permission')
        target = p
      }
      const t = await one(
        `UPDATE trips SET signed_in_at = now() WHERE user_id = $1 AND signed_in_at IS NULL RETURNING id, destination, signed_out_at`,
        [target.id])
      if (!t) throw new Error(`${target.name} isn’t signed out right now`)
      await audit(user, 'ai.trip.in', 'trip', t.id, { for: target.name })
      return { signed_in: target.name, was_at: t.destination }
    },
  },
  {
    name: 'shopping_list', title: 'Shopping list', flag: 'shopping', perm: 'shopping.view',
    description: 'Open shopping items grouped by category, plus any town run in progress.',
    schema: S({}),
    run: async () => ({
      items: await rows(
        `SELECT s.id, s.text, s.qty, s.category, t.name AS town FROM shopping_items s
         LEFT JOIN towns t ON t.id = s.town_id WHERE NOT s.completed ORDER BY s.category, s.created_at`),
      active_run: await one(
        `SELECT r.started_at, t.name AS town, u.name AS runner FROM town_runs r
         LEFT JOIN towns t ON t.id = r.town_id LEFT JOIN users u ON u.id = r.user_id
         WHERE r.ended_at IS NULL ORDER BY r.started_at DESC LIMIT 1`),
    }),
  },
  {
    name: 'add_shopping_items', title: 'Add shopping items', flag: 'shopping', perm: 'shopping.edit', write: true,
    description: 'Add one or many items to the shared shopping list — perfect for writing a whole dataset at once (e.g. a meal plan’s grocery list).',
    schema: S({
      items: {
        type: 'array', description: 'Items to add',
        items: S({ text: str('Item'), qty: str('Quantity, free text'), category: str('Hardware | Grocery | Kitchen | Program | Office | Other') }, ['text']),
      },
    }, ['items']),
    run: async (a, user) => {
      if (!Array.isArray(a.items) || !a.items.length) throw new Error('Give me at least one item')
      if (a.items.length > 100) throw new Error('100 items max per call')
      const out = []
      for (const it of a.items) {
        out.push(await one(
          `INSERT INTO shopping_items (text, qty, category, added_by) VALUES ($1,$2,$3,$4) RETURNING id, text`,
          [String(it.text), it.qty || '', it.category || 'general', user.id]))
      }
      await audit(user, 'ai.shopping.add', 'shopping', '', { count: out.length })
      return { added: out.length, items: out }
    },
  },
  {
    name: 'complete_shopping_items', title: 'Check off shopping', flag: 'shopping', perm: 'shopping.edit', write: true,
    description: 'Mark shopping items as bought. Each entry can be an item id or a fragment of the item text (fuzzy matched among open items).',
    schema: S({
      items: { type: 'array', description: 'Item ids or text fragments', items: str('Id or text, e.g. "propane"') },
    }, ['items']),
    run: async (a, user) => {
      if (!Array.isArray(a.items) || !a.items.length) throw new Error('Which items?')
      const done = [], missed = []
      for (const ref of a.items.slice(0, 100)) {
        const item = /^\d+$/.test(String(ref))
          ? await one(`SELECT id, text FROM shopping_items WHERE id = $1 AND NOT completed`, [Number(ref)])
          : await one(`SELECT id, text FROM shopping_items WHERE NOT completed AND text ILIKE $1 ORDER BY created_at LIMIT 1`, [`%${ref}%`])
        if (!item) { missed.push(String(ref)); continue }
        await q(`UPDATE shopping_items SET completed = true, completed_at = now(), completed_by = $2 WHERE id = $1`, [item.id, user.id])
        done.push(item.text)
      }
      await audit(user, 'ai.shopping.complete', 'shopping', '', { count: done.length })
      return { checked_off: done, ...(missed.length ? { no_open_match: missed } : {}) }
    },
  },

  // ============ gear ============
  {
    name: 'gear_status', title: 'Gear availability', flag: 'gear', perm: 'gear.view',
    description: 'The equipment catalog with live availability (total, out, free) and who currently has what. Filter by category.',
    schema: S({ category: str('Waterfront | Program | AV & Tech | Outdoor Ed | Kitchen | General') }),
    run: async (a) => {
      const params = []
      if (a.category) params.push(a.category)
      const items = await rows(
        `SELECT g.id, g.name, g.category, g.qty_total, g.condition,
                COALESCE(SUM(l.qty) FILTER (WHERE l.returned_at IS NULL), 0)::int AS out
         FROM gear_items g LEFT JOIN gear_loans l ON l.item_id = g.id
         WHERE g.active ${a.category ? 'AND g.category = $1' : ''}
         GROUP BY g.id ORDER BY g.category, g.name`, params)
      const loans = await rows(
        `SELECT g.name AS item, l.qty, COALESCE(u.name, l.borrower_name) AS borrower, l.out_at, l.due_at,
                (l.due_at < now()) AS overdue
         FROM gear_loans l JOIN gear_items g ON g.id = l.item_id LEFT JOIN users u ON u.id = l.borrower_id
         WHERE l.returned_at IS NULL ORDER BY l.due_at`)
      return { items: items.map(i => ({ ...i, available: i.qty_total - i.out })), out_now: loans }
    },
  },
  {
    name: 'checkout_gear', title: 'Check out gear', flag: 'gear', perm: 'gear.checkout', write: true,
    description: 'Sign equipment out to a person or group. Item matches by name. Due defaults to tomorrow 17:00.',
    schema: S({
      item: str('Gear item name or id'), qty: num('How many (default 1)'),
      borrower: str('Staff name/email, or free text for a guest group'), due: str('ISO date or datetime it is due back'),
      notes: str('Condition notes or context'),
    }, ['item', 'borrower']),
    run: async (a, user) => {
      const g = /^\d+$/.test(String(a.item))
        ? await one(`SELECT * FROM gear_items WHERE id = $1`, [Number(a.item)])
        : await one(`SELECT * FROM gear_items WHERE active AND name ILIKE $1 ORDER BY length(name) LIMIT 1`, [`%${a.item}%`])
      if (!g) throw new Error(`No gear item matches “${a.item}”`)
      const qty = Math.max(1, a.qty || 1)
      const out = await one(`SELECT COALESCE(SUM(qty),0)::int AS n FROM gear_loans WHERE item_id = $1 AND returned_at IS NULL`, [g.id])
      if (out.n + qty > g.qty_total) throw new Error(`Only ${g.qty_total - out.n} of ${g.qty_total} ${g.name} available right now`)
      const person = await findUser(a.borrower)
      let due = a.due
      if (!due) { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0); due = d.toISOString() }
      else if (/^\d{4}-\d{2}-\d{2}$/.test(due)) due = `${due}T17:00:00`
      const loan = await one(
        `INSERT INTO gear_loans (item_id, qty, borrower_id, borrower_name, due_at, out_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, due_at`,
        [g.id, qty, person?.id || null, person ? '' : String(a.borrower), due, user.id, a.notes || ''])
      await audit(user, 'ai.gear.checkout', 'gear', g.id, { item: g.name, qty, borrower: person?.name || a.borrower })
      return { ok: true, loan_id: loan.id, item: g.name, qty, borrower: person?.name || a.borrower, due: loan.due_at }
    },
  },
  {
    name: 'return_gear', title: 'Return gear', flag: 'gear', perm: 'gear.checkout', write: true,
    description: 'Sign a loan back in, optionally recording the condition it came back in.',
    schema: S({ loan_id: num('The loan id (see gear_status)'), condition: str('good | worn | damaged'), notes: str('Anything to note') }, ['loan_id']),
    run: async (a, user) => {
      const l = await one(
        `UPDATE gear_loans SET returned_at = now(), in_by = $2, condition_in = COALESCE($3, condition_in),
           notes = CASE WHEN $4 != '' THEN trim(notes || ' · ' || $4, ' ·') ELSE notes END
         WHERE id = $1 AND returned_at IS NULL RETURNING id, item_id`,
        [a.loan_id, user.id, a.condition || null, a.notes || ''])
      if (!l) throw new Error(`No open loan #${a.loan_id}`)
      if (a.condition === 'damaged') await q(`UPDATE gear_items SET condition = 'damaged' WHERE id = $1`, [l.item_id])
      const g = await one(`SELECT name FROM gear_items WHERE id = $1`, [l.item_id])
      await audit(user, 'ai.gear.return', 'gear', l.item_id, { item: g?.name, loan: l.id })
      return { ok: true, returned: g?.name }
    },
  },
  {
    name: 'add_gear_item', title: 'Add gear item', flag: 'gear', perm: 'gear.manage', write: true,
    description: 'Add equipment to the catalog: name, category, how many units exist, and where it lives.',
    schema: S({
      name: str('Item name'), category: str('Waterfront | Program | AV & Tech | Outdoor Ed | Kitchen | General'),
      qty_total: num('Units owned (default 1)'), location: str('Home location'), condition: str('good | worn | damaged'),
      notes: str('Notes'),
    }, ['name']),
    run: async (a, user) => {
      const loc = await findLocation(a.location)
      const g = await one(
        `INSERT INTO gear_items (name, category, qty_total, location_id, condition, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, category, qty_total`,
        [a.name.trim(), a.category || 'General', Math.max(1, a.qty_total || 1), loc?.id || null,
         ['good', 'worn', 'damaged'].includes(a.condition) ? a.condition : 'good', a.notes || ''])
      await audit(user, 'ai.gear.item_create', 'gear', g.id, { name: g.name, qty: g.qty_total })
      return { created: g, home: loc?.name || null }
    },
  },

  // ============ budgets ============
  {
    name: 'budget_status', title: 'Budget status', flag: 'budgets', perm: 'budgets.view',
    description: 'Every active budget with amount, approved spend, pending spend, and remaining. The fastest way to answer “how are we doing on money”.',
    schema: S({}),
    run: async () => (await rows(
      `SELECT b.id, b.name, b.dept, b.period_start, b.period_end, b.amount::float,
              COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)::float AS spent,
              COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'pending'), 0)::float AS pending,
              (b.amount - COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0))::float AS remaining
       FROM budgets b LEFT JOIN expenses e ON e.budget_id = b.id
       WHERE b.active GROUP BY b.id ORDER BY b.name`)),
  },
  {
    name: 'add_expense', title: 'Log expense', flag: 'budgets', perm: 'budgets.submit', write: true,
    description: 'Submit an expense against a budget (lands as pending for approval). Budget matches by name.',
    schema: S({
      budget: str('Budget name or id'), amount: num('Dollar amount'), vendor: str('Where it was spent'),
      descr: str('What it was for'), date: str('ISO date (default today)'), category: str('Category, e.g. food, parts, fuel'),
    }, ['budget', 'amount']),
    run: async (a, user) => {
      const b = /^\d+$/.test(String(a.budget))
        ? await one(`SELECT * FROM budgets WHERE id = $1`, [Number(a.budget)])
        : await one(`SELECT * FROM budgets WHERE active AND name ILIKE $1 LIMIT 1`, [`%${a.budget}%`])
      if (!b) throw new Error(`No budget matches “${a.budget}”`)
      if (!(a.amount > 0)) throw new Error('Amount must be positive')
      const e = await one(
        `INSERT INTO expenses (budget_id, date, vendor, descr, amount, category, submitted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, amount::float`,
        [b.id, a.date || todayISO(), a.vendor || '', a.descr || '', a.amount, a.category || 'general', user.id])
      const { usersWithPerm } = await import('../lib.js')
      for (const uid of await usersWithPerm('budgets.approve')) {
        if (uid !== user.id) notify(uid, { icon: '💸', title: `Expense pending: $${a.amount} — ${b.name}`, body: a.vendor || '', link: `/budgets?focus=${b.id}` })
      }
      await audit(user, 'ai.expense.create', 'budget', b.id, { amount: a.amount, vendor: a.vendor })
      return { submitted: e, budget: b.name, status: 'pending approval' }
    },
  },
  {
    name: 'list_expenses', title: 'List expenses', flag: 'budgets', perm: 'budgets.view',
    description: 'Expense history with submitter and status. Filter by status (pending is the approval queue) or budget name.',
    schema: S({ status: str('pending | approved | rejected'), budget: str('Budget name'), limit: num('Rows (default 50, max 200)') }),
    run: async (a) => {
      const where = ['TRUE'], params = []
      if (a.status) { params.push(a.status); where.push(`e.status = $${params.length}`) }
      if (a.budget) { params.push(`%${a.budget}%`); where.push(`b.name ILIKE $${params.length}`) }
      params.push(Math.min(200, a.limit || 50))
      return await rows(
        `SELECT e.id, e.date, b.name AS budget, e.vendor, e.descr, e.amount::float, e.category, e.status,
                u.name AS submitted_by, d.name AS decided_by, e.note
         FROM expenses e JOIN budgets b ON b.id = e.budget_id
         LEFT JOIN users u ON u.id = e.submitted_by LEFT JOIN users d ON d.id = e.decided_by
         WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC LIMIT $${params.length}`, params)
    },
  },
  {
    name: 'decide_expense', title: 'Approve / reject expense', flag: 'budgets', perm: 'budgets.approve', write: true,
    description: 'Approve or reject a pending expense (see list_expenses with status=pending). The submitter is notified.',
    schema: S({ id: num('Expense id'), approve: bool('true approves, false rejects'), note: str('Note for the submitter') }, ['id', 'approve']),
    run: async (a, user) => {
      const e = await one(
        `UPDATE expenses SET status = $2, decided_by = $3, decided_at = now(), note = COALESCE($4, note)
         WHERE id = $1 AND status = 'pending' RETURNING id, budget_id, vendor, amount::float, submitted_by`,
        [a.id, a.approve ? 'approved' : 'rejected', user.id, a.note ? String(a.note).slice(0, 300) : null])
      if (!e) throw new Error(`No pending expense #${a.id}`)
      const b = await one(`SELECT name FROM budgets WHERE id = $1`, [e.budget_id])
      if (e.submitted_by && e.submitted_by !== user.id) {
        notify(e.submitted_by, {
          icon: a.approve ? '✅' : '↩️',
          title: `Expense ${a.approve ? 'approved' : 'rejected'}: $${e.amount} — ${b?.name}`,
          body: a.note || e.vendor, link: '/budgets',
        })
      }
      await audit(user, `ai.expense.${a.approve ? 'approve' : 'reject'}`, 'budget', e.budget_id, { amount: e.amount, vendor: e.vendor })
      return { ok: true, expense: e.id, decided: a.approve ? 'approved' : 'rejected', budget: b?.name }
    },
  },

  // ============ safety & lost+found ============
  {
    name: 'list_incidents', title: 'List incidents', flag: 'safety', perm: 'incidents.view',
    description: 'The incident log — type, severity 1–4, status, location. Confidential entries only appear with the Confidential-access permission.',
    schema: S({ status: str('open | review | closed'), type: str('medical | behavioral | safety | security | property | other') }),
    run: async (a, user) => {
      const where = [], params = []
      if (!user.perms['incidents.confidential']) where.push('NOT i.confidential')
      if (a.status) { params.push(a.status); where.push(`i.status = $${params.length}`) }
      if (a.type) { params.push(a.type); where.push(`i.type = $${params.length}`) }
      return await rows(
        `SELECT i.code, i.title, i.type, i.severity, i.status, i.occurred_at, i.confidential,
                l.name AS location, u.name AS reported_by
         FROM incidents i LEFT JOIN locations l ON l.id = i.location_id LEFT JOIN users u ON u.id = i.reported_by
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.occurred_at DESC LIMIT 50`, params)
    },
  },
  {
    name: 'report_incident', title: 'Report incident', flag: 'safety', perm: 'incidents.report', write: true,
    description: 'File an incident report: medical, behavioral, safety, security, or property. Severity 1 minor … 4 critical. The safety team is notified.',
    schema: S({
      title: str('One-line summary'), type: str('medical | behavioral | safety | security | property | other'),
      severity: num('1 minor … 4 critical'), description: str('What happened'),
      occurred_at: str('ISO datetime (default now)'), location: str('Location name'),
      actions_taken: str('Immediate response'), confidential: bool('Restrict to confidential-access holders'),
    }, ['title', 'type']),
    run: async (a, user) => {
      const loc = await findLocation(a.location)
      const n = await one(`SELECT COUNT(*)::int AS n FROM incidents`)
      const code = `INC-${String(1001 + n.n)}`
      const inc = await one(
        `INSERT INTO incidents (code, title, type, severity, occurred_at, location_id, description, actions_taken, confidential, reported_by)
         VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, now()),$6,$7,$8,$9,$10) RETURNING id, code, severity`,
        [code, a.title, a.type, Math.min(4, Math.max(1, a.severity || 2)), a.occurred_at || null,
         loc?.id || null, a.description || '', a.actions_taken || '', !!a.confidential, user.id])
      const { usersWithPerm } = await import('../lib.js')
      const watchKey = a.confidential ? 'incidents.confidential' : 'incidents.manage'
      for (const uid of await usersWithPerm(watchKey)) {
        if (uid !== user.id) notify(uid, { icon: '🚨', title: `Incident ${inc.code}: ${a.title}`, body: `Severity ${inc.severity} · ${a.type}`, link: `/safety?focus=${inc.id}` })
      }
      await audit(user, 'ai.incident.create', 'incident', inc.id, { code: inc.code, type: a.type, severity: inc.severity })
      return { filed: inc, note: 'Safety team notified.' }
    },
  },
  {
    name: 'get_incident', title: 'Incident detail', flag: 'safety', perm: 'incidents.view',
    description: 'One incident in full: description, people involved, actions taken, follow-up, and status. Accepts the INC- code or id.',
    schema: S({ id: str('Incident code or id, e.g. "INC-1004"') }, ['id']),
    run: async ({ id }, user) => {
      const i = await findIncident(id)
      if (!i) throw new Error(`No incident matches “${id}”`)
      if (i.confidential && !user.perms['incidents.confidential'] && i.reported_by !== user.id) {
        throw new Error('This incident is confidential')
      }
      const [loc, reporter] = await Promise.all([
        i.location_id ? one(`SELECT name FROM locations WHERE id = $1`, [i.location_id]) : null,
        i.reported_by ? one(`SELECT name FROM users WHERE id = $1`, [i.reported_by]) : null,
      ])
      return { ...i, location: loc?.name || null, reported_by: reporter?.name || null, location_id: undefined }
    },
  },
  {
    name: 'update_incident', title: 'Update incident', flag: 'safety', perm: 'incidents.manage', write: true,
    description: 'Work an incident: change status (open, review, closed), severity, or append follow-up notes and actions taken.',
    schema: S({
      id: str('Incident code or id'), status: str('open | review | closed'), severity: num('1 minor … 4 critical'),
      followup: str('Append to the follow-up log'), actions_taken: str('Append to actions taken'),
    }, ['id']),
    run: async (a, user) => {
      const i = await findIncident(a.id)
      if (!i) throw new Error(`No incident matches “${a.id}”`)
      if (i.confidential && !user.perms['incidents.confidential']) throw new Error('This incident is confidential')
      if (a.status && !['open', 'review', 'closed'].includes(a.status)) throw new Error('Status must be open, review, or closed')
      const followup = a.followup ? `${i.followup ? i.followup + '\n' : ''}${todayISO()} — ${a.followup}` : null
      const actions = a.actions_taken ? `${i.actions_taken ? i.actions_taken + '\n' : ''}${a.actions_taken}` : null
      const out = await one(
        `UPDATE incidents SET status = COALESCE($2, status),
           severity = COALESCE($3, severity), followup = COALESCE($4, followup),
           actions_taken = COALESCE($5, actions_taken),
           closed_at = CASE WHEN $2 = 'closed' THEN now() WHEN $2 IS NOT NULL THEN NULL ELSE closed_at END,
           updated_at = now()
         WHERE id = $1 RETURNING id, code, status, severity`,
        [i.id, a.status || null, a.severity ? Math.min(4, Math.max(1, a.severity)) : null, followup, actions])
      await audit(user, a.status ? `ai.incident.${a.status}` : 'ai.incident.update', 'incident', i.id, { code: i.code })
      return { updated: out, was_status: i.status }
    },
  },
  {
    name: 'list_lost_found', title: 'Lost & found', flag: 'lostfound', perm: 'lostfound.view',
    description: 'Found items in storage and open lost-item reports.',
    schema: S({ status: str('open | claimed | returned | donated | disposed (default open)') }),
    run: async (a) => (await rows(
      `SELECT i.id, i.kind, i.date, i.category, i.description, i.stored_at, i.status, l.name AS location
       FROM lf_items i LEFT JOIN locations l ON l.id = i.location_id
       WHERE i.status = $1 ORDER BY i.date DESC LIMIT 60`, [a.status || 'open'])),
  },
  {
    name: 'log_found_item', title: 'Log found item', flag: 'lostfound', perm: 'lostfound.manage', write: true,
    description: 'Record an item that was found on property and where it is stored.',
    schema: S({
      description: str('What was found'), location: str('Where it was found'),
      category: str('electronics | clothing | jewelry | documents | toys | other'), stored_at: str('Where it is being kept'),
      date: str('ISO date found (default today)'),
    }, ['description']),
    run: async (a, user) => {
      const loc = await findLocation(a.location)
      const item = await one(
        `INSERT INTO lf_items (kind, date, location_id, category, description, stored_at, created_by)
         VALUES ('found',$1,$2,$3,$4,$5,$6) RETURNING id`,
        [a.date || todayISO(), loc?.id || null, a.category || 'other', a.description, a.stored_at || 'Front Desk', user.id])
      await audit(user, 'ai.lostfound.log', 'lostfound', item.id, { description: a.description })
      return { logged: item.id, stored_at: a.stored_at || 'Front Desk' }
    },
  },
  {
    name: 'resolve_lost_found', title: 'Resolve lost & found', flag: 'lostfound', perm: 'lostfound.manage', write: true,
    description: 'Close out a lost & found item: claimed, returned (shipped/handed back), donated, or disposed — with a note about who/where.',
    schema: S({
      id: num('Item id (see list_lost_found)'), status: str('claimed | returned | donated | disposed'),
      note: str('Resolution note, e.g. "Picked up by parent, June 14"'),
    }, ['id', 'status']),
    run: async (a, user) => {
      if (!['claimed', 'returned', 'donated', 'disposed'].includes(a.status)) {
        throw new Error('Status must be claimed, returned, donated, or disposed')
      }
      const i = await one(
        `UPDATE lf_items SET status = $2, resolution_note = COALESCE($3, resolution_note), resolved_at = now()
         WHERE id = $1 RETURNING id, description, status`,
        [a.id, a.status, a.note ? String(a.note).slice(0, 300) : null])
      if (!i) throw new Error(`No lost & found item #${a.id}`)
      await audit(user, `ai.lostfound.${a.status}`, 'lostfound', i.id, { description: i.description.slice(0, 60) })
      return { resolved: i }
    },
  },

  // ============ people ============
  {
    name: 'list_people', title: 'Staff directory', flag: 'people', perm: 'people.view',
    description: 'The staff directory: names, departments, titles, and managers.',
    schema: S({ q: str('Filter by name or department') }),
    run: async (a) => (await rows(
      `SELECT u.name, u.dept, u.title, u.email, m.name AS manager FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
       WHERE u.active ${a.q ? `AND (u.name ILIKE $1 OR u.dept ILIKE $1)` : ''} ORDER BY u.dept, u.name`,
      a.q ? [`%${a.q}%`] : [])),
  },
  {
    name: 'get_person', title: 'Person profile', flag: 'people', perm: 'people.view',
    description: 'One staff member: role, department, manager, direct reports, whether they’re off property right now, open tasks, and certifications (with the Certifications permission).',
    schema: S({ person: str('Name or email') }, ['person']),
    run: async ({ person }, user) => {
      const p = await findUser(person)
      if (!p) throw new Error(`Nobody matches “${person}”`)
      const full = await one(
        `SELECT u.id, u.name, u.email, u.dept, u.title, u.phone, u.bio, u.start_date, m.name AS manager, r.label AS role
         FROM users u LEFT JOIN users m ON m.id = u.manager_id LEFT JOIN roles r ON r.key = u.role_key
         WHERE u.id = $1`, [p.id])
      const [reports, trip, tasks, kudos] = await Promise.all([
        rows(`SELECT name, title FROM users WHERE manager_id = $1 AND active ORDER BY name`, [p.id]),
        one(`SELECT destination, expected_return FROM trips WHERE user_id = $1 AND signed_in_at IS NULL`, [p.id]),
        rows(`SELECT t.title, t.due FROM tasks t LEFT JOIN task_statuses s ON s.id = t.status_id
              WHERE $1 = ANY(t.assignees) AND (s.kind IS NULL OR s.kind != 'done') ORDER BY t.due NULLS LAST LIMIT 8`, [p.id]),
        one(`SELECT COUNT(*)::int AS n FROM kudos WHERE to_id = $1`, [p.id]),
      ])
      const out = { ...full, direct_reports: reports, off_property: trip || null, open_tasks: tasks, kudos_received: kudos.n }
      if (user.perms['people.certs']) {
        out.certifications = await rows(
          `SELECT name, issuer, issued, expires, (expires - CURRENT_DATE)::int AS days_left
           FROM user_certs WHERE user_id = $1 ORDER BY expires NULLS LAST`, [p.id])
      }
      return out
    },
  },
  {
    name: 'list_certs', title: 'Certifications', flag: 'people', perm: 'people.certs',
    description: 'Staff certifications (lifeguard, first aid, food safe…) with days until expiry. Use within_days to see what needs renewing soon.',
    schema: S({ within_days: num('Only certs expiring within this many days'), person: str('Filter to one person') }),
    run: async (a) => {
      const where = ['u.active'], params = []
      if (a.within_days) { params.push(a.within_days); where.push(`c.expires IS NOT NULL AND c.expires <= CURRENT_DATE + ($${params.length} || ' days')::interval`) }
      if (a.person) { params.push(`%${a.person}%`); where.push(`u.name ILIKE $${params.length}`) }
      return await rows(
        `SELECT u.name AS person, u.dept, c.name AS cert, c.issuer, c.issued, c.expires,
                (c.expires - CURRENT_DATE)::int AS days_left
         FROM user_certs c JOIN users u ON u.id = c.user_id
         WHERE ${where.join(' AND ')} ORDER BY c.expires NULLS LAST, u.name LIMIT 200`, params)
    },
  },
  {
    name: 'add_cert', title: 'Add certification', flag: 'people', perm: 'people.certs', write: true,
    description: 'Record a certification for a staff member, with issue and expiry dates. Expiry warnings fire automatically at 30 days.',
    schema: S({
      person: str('Name or email'), name: str('Certification, e.g. "NLS Lifeguard"'),
      issuer: str('Issuing body'), issued: str('ISO date issued'), expires: str('ISO expiry date'), notes: str('Notes'),
    }, ['person', 'name']),
    run: async (a, user) => {
      const p = await findUser(a.person)
      if (!p) throw new Error(`Nobody matches “${a.person}”`)
      const c = await one(
        `INSERT INTO user_certs (user_id, name, issuer, issued, expires, notes) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, name, expires`,
        [p.id, a.name.trim(), a.issuer || '', a.issued || null, a.expires || null, a.notes || ''])
      await audit(user, 'ai.cert.add', 'user', p.id, { name: c.name, expires: a.expires })
      return { added: c, person: p.name }
    },
  },
  {
    name: 'list_kudos', title: 'Kudos wall', flag: 'people', perm: 'people.view',
    description: 'Recent public recognition and the 30-day leaderboard.',
    schema: S({}),
    run: async () => ({
      recent: await rows(
        `SELECT f.name AS from_person, t.name AS to_person, k.value_key AS value, k.message, k.created_at::date AS date
         FROM kudos k LEFT JOIN users f ON f.id = k.from_id JOIN users t ON t.id = k.to_id
         ORDER BY k.created_at DESC LIMIT 20`),
      leaders_30d: await rows(
        `SELECT u.name, COUNT(*)::int AS kudos FROM kudos k JOIN users u ON u.id = k.to_id
         WHERE k.created_at > now() - interval '30 days' GROUP BY u.name ORDER BY kudos DESC LIMIT 5`),
    }),
  },
  {
    name: 'give_kudos', title: 'Give kudos', flag: 'people', perm: 'kudos.give', write: true,
    description: 'Post public recognition for a teammate, optionally tied to an org value (lead, accept, protect, invite, challenge, celebrate).',
    schema: S({ to: str('Recipient name or email'), message: str('The shout-out'), value: str('Org value key') }, ['to', 'message']),
    run: async (a, user) => {
      const to = await findUser(a.to)
      if (!to) throw new Error(`Nobody matches “${a.to}”`)
      const k = await one(
        `INSERT INTO kudos (from_id, to_id, value_key, message) VALUES ($1,$2,$3,$4) RETURNING id`,
        [user.id, to.id, a.value || '', a.message])
      notify(to.id, { icon: '🎉', title: `${user.name} gave you kudos`, body: a.message.slice(0, 90), link: '/community' })
      await audit(user, 'ai.kudos.give', 'kudos', k.id, { to: to.name })
      return { posted: true, to: to.name }
    },
  },

  // ============ community & growth ============
  {
    name: 'list_community', title: 'Community board', flag: 'community', perm: 'community.view',
    description: 'The community pulse: recent posts and announcements, upcoming camp events, and birthdays in the next three weeks.',
    schema: S({}),
    run: async () => {
      const [posts, events, birthdays] = await Promise.all([
        rows(`SELECT p.kind, p.title, left(p.body, 240) AS body, p.pinned, p.created_at::date AS date,
                CASE WHEN p.anonymous THEN 'Someone at camp' ELSE u.name END AS author
              FROM posts p LEFT JOIN users u ON u.id = p.author_id
              ORDER BY p.pinned DESC, p.created_at DESC LIMIT 15`),
        rows(`SELECT title, date, end_date, location, emoji, descr FROM events WHERE COALESCE(end_date, date) >= $1 ORDER BY date LIMIT 12`, [todayISO()]),
        rows(`SELECT name, to_char(birthday, 'Mon DD') AS day FROM users
              WHERE active AND birthday IS NOT NULL
                AND to_char(birthday, 'MM-DD') BETWEEN to_char($1::date, 'MM-DD') AND to_char($1::date + 21, 'MM-DD')
              ORDER BY to_char(birthday, 'MM-DD') LIMIT 10`, [todayISO()]),
      ])
      return { posts, upcoming_events: events, birthdays_soon: birthdays }
    },
  },
  {
    name: 'create_post', title: 'Post to community', flag: 'community', perm: 'community.post', write: true,
    description: 'Share on the community board: a post, prayer, praise — or an announcement (needs the Announce permission).',
    schema: S({
      body: str('The post'), kind: str('post | prayer | praise | announcement (default post)'),
      title: str('Optional headline'), anonymous: bool('Post without a name (not for announcements)'),
    }, ['body']),
    run: async (a, user) => {
      const kind = ['post', 'announcement', 'prayer', 'praise'].includes(a.kind) ? a.kind : 'post'
      if (kind === 'announcement' && !user.perms['community.announce']) {
        throw new Error('Announcements need the Announce permission — post as a regular post instead')
      }
      const p = await one(
        `INSERT INTO posts (kind, author_id, anonymous, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING id, kind`,
        [kind, user.id, !!a.anonymous && kind !== 'announcement', a.title || '', String(a.body).trim()])
      await audit(user, 'ai.post.create', 'post', p.id, { kind })
      return { posted: p, as: a.anonymous && kind !== 'announcement' ? 'anonymous' : user.name }
    },
  },
  {
    name: 'create_event', title: 'Create camp event', flag: 'community', perm: 'community.announce', write: true,
    description: 'Put an event on the camp calendar (staff BBQ, training day, all-camp meeting). Shows on the Calendar page and the community board.',
    schema: S({
      title: str('Event name'), date: str('ISO date'), end_date: str('ISO end date for multi-day events'),
      location: str('Where'), emoji: str('One emoji for the chip (default 🌲)'), descr: str('Details'),
    }, ['title', 'date']),
    run: async (a, user) => {
      if (a.end_date && a.end_date < a.date) throw new Error('The end date is before the start')
      const e = await one(
        `INSERT INTO events (title, date, end_date, location, emoji, descr) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, title, date, end_date`,
        [a.title.trim().slice(0, 120), a.date, a.end_date || null, a.location || '', a.emoji || '🌲', a.descr || ''])
      await audit(user, 'ai.event.create', 'event', e.id, { title: e.title, date: a.date })
      return { created: e }
    },
  },
  {
    name: 'list_goals', title: 'List goals', flag: 'people', perm: 'goals.use',
    description: 'Org and team goals plus the caller’s own — progress, status, due dates, and check-in counts.',
    schema: S({}),
    run: async (a, user) => (await rows(
      `SELECT g.id, g.title, g.type, g.dept, g.due, g.status, g.progress, u.name AS owner,
              (SELECT COUNT(*)::int FROM goal_checkins c WHERE c.goal_id = g.id) AS checkins
       FROM goals g LEFT JOIN users u ON u.id = g.owner_id
       WHERE g.type IN ('org','team') OR g.owner_id = $1
       ORDER BY array_position(ARRAY['org','team','individual'], g.type), (g.status = 'done'), g.due NULLS LAST LIMIT 100`,
      [user.id])),
  },
  {
    name: 'create_goal', title: 'Create goal', flag: 'people', perm: 'goals.use', write: true,
    description: 'Set a goal owned by the token holder — individual by default, or team/org scoped.',
    schema: S({
      title: str('The goal'), descr: str('Details'), type: str('individual | team | org (default individual)'),
      dept: str('Department, for team goals'), due: str('ISO target date'),
    }, ['title']),
    run: async (a, user) => {
      const type = ['org', 'team', 'individual'].includes(a.type) ? a.type : 'individual'
      const g = await one(
        `INSERT INTO goals (title, descr, type, owner_id, dept, due) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, type, due`,
        [a.title, a.descr || '', type, user.id, a.dept || '', a.due || null])
      await audit(user, 'ai.goal.create', 'goal', g.id, { title: a.title, type })
      return { created: g }
    },
  },
  {
    name: 'checkin_goal', title: 'Goal check-in', flag: 'people', perm: 'goals.use', write: true,
    description: 'Log progress on a goal: percent complete, status (on, behind, risk, done), and a comment. The owner is notified.',
    schema: S({
      id: num('Goal id (see list_goals)'), progress: num('0–100'), status: str('on | behind | risk | done'),
      comment: str('What moved'),
    }, ['id', 'progress']),
    run: async (a, user) => {
      const g = await one(`SELECT id, title, owner_id, type FROM goals WHERE id = $1`, [a.id])
      if (!g) throw new Error(`No goal #${a.id}`)
      if (g.type === 'individual' && g.owner_id !== user.id) throw new Error('That’s someone else’s personal goal')
      const p = Math.min(100, Math.max(0, Number(a.progress) || 0))
      const st = ['on', 'behind', 'risk', 'done'].includes(a.status) ? a.status : 'on'
      await one(`INSERT INTO goal_checkins (goal_id, by_id, progress, status, comment) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [g.id, user.id, p, st, String(a.comment || '').slice(0, 600)])
      await q(`UPDATE goals SET progress = $2, status = $3, updated_at = now() WHERE id = $1`, [g.id, p, st])
      if (g.owner_id && g.owner_id !== user.id) {
        notify(g.owner_id, { icon: '🎯', title: `${user.name} checked in on “${g.title}”`, body: `${p}% · ${st}`, link: '/growth' })
      }
      await audit(user, 'ai.goal.checkin', 'goal', g.id, { progress: p, status: st })
      return { goal: g.title, progress: p, status: st }
    },
  },

  // ============ assets & locations ============
  {
    name: 'list_assets', title: 'Asset registry', flag: 'facilities', perm: 'assets.view',
    description: 'Tracked equipment (boilers, mowers, AV rigs) with status, location, and service due dates — overdue service flagged.',
    schema: S({ q: str('Filter by name'), due_for_service: bool('Only assets at or past their next-service date') }),
    run: async (a) => {
      const where = ['TRUE'], params = []
      if (a.q) { params.push(`%${a.q}%`); where.push(`a.name ILIKE $${params.length}`) }
      if (a.due_for_service) where.push(`a.next_service IS NOT NULL AND a.next_service <= CURRENT_DATE`)
      return await rows(
        `SELECT a.id, a.name, a.category, a.status, a.serial, a.next_service, a.purchase_date, a.value::float,
                l.name AS location, (a.next_service IS NOT NULL AND a.next_service <= CURRENT_DATE) AS service_due,
                (SELECT COUNT(*)::int FROM asset_logs g WHERE g.asset_id = a.id) AS service_logs
         FROM assets a LEFT JOIN locations l ON l.id = a.location_id
         WHERE ${where.join(' AND ')} ORDER BY a.next_service NULLS LAST, a.name LIMIT 200`, params)
    },
  },
  {
    name: 'log_asset_service', title: 'Log asset service', flag: 'facilities', perm: 'assets.edit', write: true,
    description: 'Record maintenance on an asset (service, repair, inspection) with cost, and optionally set the next service date.',
    schema: S({
      asset: str('Asset name or id'), kind: str('service | repair | inspection (default service)'),
      notes: str('What was done'), cost: num('Cost in dollars'), date: str('ISO date (default today)'),
      next_service: str('ISO date the next service is due'),
    }, ['asset']),
    run: async (a, user) => {
      const asset = /^\d+$/.test(String(a.asset))
        ? await one(`SELECT * FROM assets WHERE id = $1`, [Number(a.asset)])
        : await one(`SELECT * FROM assets WHERE name ILIKE $1 ORDER BY length(name) LIMIT 1`, [`%${a.asset}%`])
      if (!asset) throw new Error(`No asset matches “${a.asset}”`)
      const log = await one(
        `INSERT INTO asset_logs (asset_id, kind, notes, cost, date, by_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [asset.id, ['service', 'repair', 'inspection'].includes(a.kind) ? a.kind : 'service',
         a.notes || '', a.cost ?? null, a.date || todayISO(), user.id])
      if (a.next_service) await q(`UPDATE assets SET next_service = $2 WHERE id = $1`, [asset.id, a.next_service])
      await audit(user, 'ai.asset.service', 'asset', asset.id, { name: asset.name, cost: a.cost })
      return { logged: log.id, asset: asset.name, next_service: a.next_service || asset.next_service }
    },
  },
  {
    name: 'list_locations', title: 'Property registry', flag: 'locations', perm: 'locations.view',
    description: 'Every building and space on property: category, zone, beds/capacity, housekeeping condition, open tickets, and whether it’s occupied today.',
    schema: S({ category: str('lodge | venue | dining | sports | adventure | waterfront | grounds'), q: str('Filter by name') }),
    run: async (a) => {
      const where = ['l.active'], params = [todayISO()]
      if (a.category) { params.push(a.category); where.push(`l.category = $${params.length}`) }
      if (a.q) { params.push(`%${a.q}%`); where.push(`l.name ILIKE $${params.length}`) }
      return await rows(
        `SELECT l.id, l.name, l.category, l.zone, l.beds, l.capacity, l.condition, l.condition_note,
           (SELECT COUNT(*)::int FROM tickets t WHERE t.location_id = l.id AND t.status IN ('open','in_progress')) AS open_tickets,
           EXISTS (SELECT 1 FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
             WHERE br.location_id = l.id AND br.date_from <= $1 AND br.date_to >= $1
               AND b.status IN ('confirmed','in_progress')) AS occupied_today
         FROM locations l WHERE ${where.join(' AND ')} ORDER BY l.sort, l.name LIMIT 300`, params)
    },
  },
  {
    name: 'set_location_condition', title: 'Set room condition', flag: 'locations', perm: 'locations.edit', write: true,
    description: 'Update a location’s housekeeping condition: clean (ready), dirty (needs housekeeping), maintenance (hold), or closed — with an optional note. Drives the housekeeping board.',
    schema: S({
      location: str('Location name or id'), condition: str('clean | dirty | maintenance | closed'), note: str('Condition note'),
    }, ['location', 'condition']),
    run: async (a, user) => {
      if (!['clean', 'dirty', 'maintenance', 'closed'].includes(a.condition)) {
        throw new Error('Condition must be clean, dirty, maintenance, or closed')
      }
      const loc = await findLocation(a.location)
      if (!loc) throw new Error(`No location matches “${a.location}”`)
      const l = await one(
        `UPDATE locations SET condition = $2, condition_note = COALESCE($3, condition_note),
           condition_updated_at = now(), condition_updated_by = $4
         WHERE id = $1 RETURNING id, name, condition, condition_note`,
        [loc.id, a.condition, a.note ?? null, `${user.name} (via Claude)`])
      await audit(user, 'ai.location.condition', 'location', l.id, { name: l.name, condition: a.condition })
      return { updated: l }
    },
  },

  // ============ calendar, weather & platform ============
  {
    name: 'get_calendar', title: 'Camp calendar', flag: null, perm: null,
    description: 'The unified calendar for a date range, layered: bookings on property, meal services, tasks due, ticket deadlines, incidents, who’s off property, certification expiries, camp events, birthdays — each layer filtered to the caller’s permissions — plus the caller’s own connected external calendars (Google/Outlook overlays).',
    schema: S({ from: str('ISO start date (default today)'), to: str('ISO end date (default +14 days)') }),
    run: async (a, user, flags) => {
      const from = a.from || todayISO()
      const to = a.to || addDays(from, 14)
      if (to < from) throw new Error('to is before from')
      if ((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000 > 130) {
        throw new Error('Range is capped at ~4 months per call')
      }
      return await buildCalendar(user, from, to, flags, true)
    },
  },
  {
    name: 'get_weather', title: 'Property weather', flag: null, perm: null,
    description: 'Current conditions and the multi-day forecast for the property on Lake Rosseau (Open-Meteo).',
    schema: S({}),
    run: async () => {
      const screens = await getSetting('screens', {})
      const w = await getWeather(screens.lat, screens.lon)
      if (!w) throw new Error('Weather is unavailable right now')
      return w
    },
  },
  {
    name: 'list_notifications', title: 'My notifications', flag: null, perm: null,
    description: 'The token holder’s WoodsOS notification feed — assignments, mentions, approvals, overdue nags.',
    schema: S({ unread_only: bool('Only unread (default false)'), limit: num('Rows (default 20, max 50)') }),
    run: async (a, user) => (await rows(
      `SELECT icon, title, body, link, read, created_at FROM notifications
       WHERE user_id = $1 ${a.unread_only ? 'AND NOT read' : ''}
       ORDER BY created_at DESC LIMIT $2`, [user.id, Math.min(50, a.limit || 20)])),
  },
  {
    name: 'post_motd', title: 'Message of the day', flag: null, perm: 'motd.manage', write: true,
    description: 'Post a sign-in announcement every staff member sees once (dismissable). Use sparingly — it interrupts everyone.',
    schema: S({ title: str('Headline'), body: str('The message') }, ['title']),
    run: async (a, user) => {
      const m = await one(`INSERT INTO motd_messages (title, body, created_by) VALUES ($1,$2,$3) RETURNING id, title`,
        [a.title.trim().slice(0, 120), String(a.body || '').slice(0, 600), user.id])
      await audit(user, 'ai.motd.create', 'motd', m.id, { title: m.title })
      return { posted: m }
    },
  },
  {
    name: 'search_audit', title: 'Audit log', flag: null, perm: 'audit.view',
    description: 'Search the change history: who did what, when, to which record. Every MCP write lands here under ai.* actions.',
    schema: S({
      entity: str('booking | ticket | task | budget | incident | user | …'), action: str('Action fragment, e.g. "delete" or "ai."'),
      person: str('Actor name'), limit: num('Rows (default 40, max 100)'),
    }),
    run: async (a) => {
      const where = ['TRUE'], params = []
      if (a.entity) { params.push(a.entity); where.push(`entity = $${params.length}`) }
      if (a.action) { params.push(`%${a.action}%`); where.push(`action ILIKE $${params.length}`) }
      if (a.person) { params.push(`%${a.person}%`); where.push(`user_name ILIKE $${params.length}`) }
      params.push(Math.min(100, a.limit || 40))
      return await rows(
        `SELECT created_at, user_name, action, entity, entity_id, detail FROM audit_log
         WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`, params)
    },
  },
  {
    name: 'system_health', title: 'System health', flag: null, perm: 'system.health',
    description: 'Platform vitals: uptime, request rate, error and rate-limit counters, database latency and size, table counts.',
    schema: S({}),
    run: async () => {
      const t0 = process.hrtime.bigint()
      await one(`SELECT 1 AS ok`)
      const dbMs = Number(process.hrtime.bigint() - t0) / 1e6
      const [counts, dbSize] = await Promise.all([
        one(`SELECT
          (SELECT COUNT(*)::int FROM users WHERE active) AS users,
          (SELECT COUNT(*)::int FROM tickets) AS tickets,
          (SELECT COUNT(*)::int FROM bookings) AS bookings,
          (SELECT COUNT(*)::int FROM tasks) AS tasks,
          (SELECT COUNT(*)::int FROM pats WHERE NOT revoked) AS active_ai_tokens`),
        one(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`),
      ])
      return { ...statsSnapshot(), db_ping_ms: Math.round(dbMs * 10) / 10, db_size: dbSize.size, counts }
    },
  },

  // ============ metrics & datasets ============
  {
    name: 'get_metrics', title: 'Get metrics', flag: 'reports', perm: null, // checked per-area inside
    description: 'Key numbers for one area: bookings (occupancy, revenue), facilities (flow, response times, ratings), tasks (velocity, workload), people (pulse, kudos), signout, shopping, gear (utilization), budgets (burn), safety (incident trends). Each area needs its matching metrics permission.',
    schema: S({ area: str('bookings | facilities | tasks | people | signout | shopping | gear | budgets | safety') }, ['area']),
    run: async ({ area }, user) => {
      if (!user.perms[`metrics.${area}`]) throw new Error(`You need the metrics.${area} permission for that area`)
      const today = todayISO()
      switch (area) {
        case 'bookings': return {
          next_30d: await one(`SELECT COUNT(*)::int AS bookings, COALESCE(SUM(headcount),0)::int AS guests FROM bookings WHERE status IN ('confirmed','in_progress') AND start_date <= $1 AND end_date >= $2`, [addDays(today, 30), today]),
          by_status: await rows(`SELECT status, COUNT(*)::int AS n FROM bookings GROUP BY status`),
          revenue_collected_90d: await one(`SELECT COALESCE(SUM(p.amount),0)::float AS total FROM payments p WHERE p.date > $1`, [addDays(today, -90)]),
          lead_funnel: await rows(`SELECT stage, COUNT(*)::int AS n FROM leads GROUP BY stage`),
        }
        case 'facilities': return {
          open_now: await one(`SELECT COUNT(*)::int AS n FROM tickets WHERE status != 'closed'`),
          created_vs_closed_30d: await one(`SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS created, COUNT(*) FILTER (WHERE closed_at > now() - interval '30 days')::int AS closed FROM tickets`),
          avg_first_response_h: await one(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM first_response_at - created_at))/3600, 1)::float AS h FROM tickets WHERE first_response_at IS NOT NULL`),
          avg_rating: await one(`SELECT ROUND(AVG(rating), 2)::float AS stars, COUNT(rating)::int AS n FROM tickets WHERE rating IS NOT NULL`),
          by_category_open: await rows(`SELECT category, COUNT(*)::int AS n FROM tickets WHERE status != 'closed' GROUP BY category ORDER BY n DESC`),
        }
        case 'tasks': return {
          open: await one(`SELECT COUNT(*)::int AS n FROM tasks t JOIN task_statuses s ON s.id = t.status_id WHERE s.kind != 'done' AND t.parent_id IS NULL`),
          completed_7d: await one(`SELECT COUNT(*)::int AS n FROM tasks WHERE completed_at > now() - interval '7 days'`),
          overdue: await one(`SELECT COUNT(*)::int AS n FROM tasks t JOIN task_statuses s ON s.id = t.status_id WHERE s.kind != 'done' AND t.due < $1`, [today]),
          workload: await rows(`SELECT u.name, COUNT(*)::int AS open FROM tasks t JOIN task_statuses s ON s.id = t.status_id, unnest(t.assignees) AS a(uid) JOIN users u ON u.id = a.uid WHERE s.kind != 'done' GROUP BY u.name ORDER BY open DESC LIMIT 10`),
        }
        case 'people': return {
          pulse_recent: await rows(`SELECT week, ROUND(AVG(mood),2)::float AS mood, COUNT(*)::int AS n FROM pulse GROUP BY week HAVING COUNT(*) >= 3 ORDER BY week DESC LIMIT 6`),
          kudos_30d: await one(`SELECT COUNT(*)::int AS n FROM kudos WHERE created_at > now() - interval '30 days'`),
          feedback_30d: await one(`SELECT COUNT(*)::int AS n FROM feedback WHERE created_at > now() - interval '30 days'`),
        }
        case 'signout': return {
          out_now: await one(`SELECT COUNT(*)::int AS n FROM trips WHERE signed_in_at IS NULL`),
          trips_30d: await one(`SELECT COUNT(*)::int AS n FROM trips WHERE signed_out_at > now() - interval '30 days'`),
          top_destinations: await rows(`SELECT destination, COUNT(*)::int AS n FROM trips WHERE signed_out_at > now() - interval '90 days' GROUP BY destination ORDER BY n DESC LIMIT 6`),
        }
        case 'shopping': return {
          open_items: await one(`SELECT COUNT(*)::int AS n FROM shopping_items WHERE NOT completed`),
          bought_30d: await one(`SELECT COUNT(*)::int AS n FROM shopping_items WHERE completed_at > now() - interval '30 days'`),
          runs_30d: await one(`SELECT COUNT(*)::int AS n FROM town_runs WHERE started_at > now() - interval '30 days'`),
        }
        case 'gear': return {
          items: await one(`SELECT COUNT(*)::int AS catalog, COALESCE(SUM(qty_total),0)::int AS units FROM gear_items WHERE active`),
          out_now: await one(`SELECT COALESCE(SUM(qty),0)::int AS units, COUNT(*)::int AS loans FROM gear_loans WHERE returned_at IS NULL`),
          overdue: await one(`SELECT COUNT(*)::int AS n FROM gear_loans WHERE returned_at IS NULL AND due_at < now()`),
          loans_30d: await one(`SELECT COUNT(*)::int AS n FROM gear_loans WHERE out_at > now() - interval '30 days'`),
          by_category: await rows(`SELECT g.category, COUNT(l.id)::int AS loans FROM gear_loans l JOIN gear_items g ON g.id = l.item_id WHERE l.out_at > now() - interval '90 days' GROUP BY g.category ORDER BY loans DESC`),
        }
        case 'budgets': return {
          totals: await one(`SELECT COALESCE(SUM(b.amount),0)::float AS budgeted, (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status = 'approved')::float AS spent, (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status = 'pending')::float AS pending FROM budgets b WHERE b.active`),
          by_budget: await rows(`SELECT b.name, b.amount::float, COALESCE(SUM(e.amount) FILTER (WHERE e.status='approved'),0)::float AS spent FROM budgets b LEFT JOIN expenses e ON e.budget_id = b.id WHERE b.active GROUP BY b.id ORDER BY b.name`),
          by_category_90d: await rows(`SELECT category, SUM(amount)::float AS total FROM expenses WHERE status = 'approved' AND date > $1 GROUP BY category ORDER BY total DESC LIMIT 8`, [addDays(today, -90)]),
        }
        case 'safety': return {
          open: await one(`SELECT COUNT(*)::int AS n FROM incidents WHERE status != 'closed' ${user.perms['incidents.confidential'] ? '' : 'AND NOT confidential'}`),
          last_90d_by_type: await rows(`SELECT type, COUNT(*)::int AS n FROM incidents WHERE occurred_at > now() - interval '90 days' ${user.perms['incidents.confidential'] ? '' : 'AND NOT confidential'} GROUP BY type ORDER BY n DESC`),
          by_severity: await rows(`SELECT severity, COUNT(*)::int AS n FROM incidents ${user.perms['incidents.confidential'] ? '' : 'WHERE NOT confidential'} GROUP BY severity ORDER BY severity`),
        }
        default: throw new Error('Unknown area')
      }
    },
  },
  {
    name: 'export_dataset', title: 'Export dataset', flag: null, perm: null, // per-dataset below
    description: 'Pull a whole dataset as JSON rows (or CSV text) for analysis: bookings, leads, invoices, payments, meals, tickets, tasks, expenses, gear_loans, incidents, lost_found, shopping, people, certs, locations, assets, kudos, audit. Each dataset needs its matching permission. Capped at 2000 rows.',
    schema: S({ dataset: str('bookings | leads | invoices | payments | meals | tickets | tasks | expenses | gear_loans | incidents | lost_found | shopping | people | certs | locations | assets | kudos | audit'), format: str('json (default) | csv') }, ['dataset']),
    run: async ({ dataset, format }, user) => {
      const need = {
        bookings: 'bookings.view', leads: 'bookings.leads', invoices: 'bookings.billing', payments: 'bookings.billing',
        meals: 'bookings.catering', tickets: 'tickets.view', tasks: 'tasks.view', expenses: 'budgets.view',
        gear_loans: 'gear.view', incidents: 'incidents.view', lost_found: 'lostfound.view',
        shopping: 'shopping.view', people: 'people.view', certs: 'people.certs', locations: 'locations.view',
        assets: 'assets.view', kudos: 'people.view', audit: 'audit.view',
      }[dataset]
      if (!need) throw new Error('Unknown dataset')
      if (!user.perms[need]) throw new Error(`You need ${need} for that dataset`)
      const QUERIES = {
        bookings: `SELECT b.code, b.name, b.status, b.segment, b.start_date, b.end_date, b.headcount, b.value::float, c.name AS customer FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id ORDER BY b.start_date DESC LIMIT 2000`,
        leads: `SELECT ld.name, ld.organization, ld.contact_name, ld.email, ld.stage, ld.segment, ld.expected_headcount, ld.value_estimate::float, ld.created_at::date AS created, u.name AS owner FROM leads ld LEFT JOIN users u ON u.id = ld.owner_id ORDER BY ld.created_at DESC LIMIT 2000`,
        invoices: `SELECT i.number, c.name AS customer, b.code AS booking, i.status, i.issue_date, i.due_date, i.tax_rate::float, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id),0)::float AS paid FROM invoices i LEFT JOIN bookings b ON b.id = i.booking_id LEFT JOIN customers c ON c.id = i.customer_id ORDER BY i.created_at DESC LIMIT 2000`,
        payments: `SELECT p.date, i.number AS invoice, p.amount::float, p.method, p.reference FROM payments p JOIN invoices i ON i.id = p.invoice_id ORDER BY p.date DESC LIMIT 2000`,
        meals: `SELECT m.date, m.meal, m.time, m.headcount, m.menu, m.dietary, b.name AS booking, l.name AS location FROM meal_services m JOIN bookings b ON b.id = m.booking_id LEFT JOIN locations l ON l.id = m.location_id ORDER BY m.date DESC LIMIT 2000`,
        tickets: `SELECT t.code, t.title, t.status, t.priority, t.category, l.name AS location, u.name AS assignee, t.created_at::date AS created, t.closed_at::date AS closed, t.rating, t.due_date FROM tickets t LEFT JOIN locations l ON l.id = t.location_id LEFT JOIN users u ON u.id = t.assignee_id ORDER BY t.created_at DESC LIMIT 2000`,
        tasks: `SELECT t.title, s.name AS status, p.name AS phase, t.due, t.priority, t.completed_at::date AS completed FROM tasks t LEFT JOIN task_statuses s ON s.id = t.status_id LEFT JOIN phases p ON p.id = t.phase_id ORDER BY t.created_at DESC LIMIT 2000`,
        expenses: `SELECT e.date, b.name AS budget, e.vendor, e.descr, e.amount::float, e.category, e.status FROM expenses e JOIN budgets b ON b.id = e.budget_id ORDER BY e.date DESC LIMIT 2000`,
        gear_loans: `SELECT g.name AS item, l.qty, COALESCE(u.name, l.borrower_name) AS borrower, l.out_at, l.due_at, l.returned_at, l.condition_in FROM gear_loans l JOIN gear_items g ON g.id = l.item_id LEFT JOIN users u ON u.id = l.borrower_id ORDER BY l.out_at DESC LIMIT 2000`,
        incidents: `SELECT i.code, i.title, i.type, i.severity, i.status, i.occurred_at, l.name AS location FROM incidents i LEFT JOIN locations l ON l.id = i.location_id ${user.perms['incidents.confidential'] ? '' : 'WHERE NOT i.confidential'} ORDER BY i.occurred_at DESC LIMIT 2000`,
        lost_found: `SELECT kind, date, category, description, stored_at, status FROM lf_items ORDER BY date DESC LIMIT 2000`,
        shopping: `SELECT text, qty, category, completed, created_at::date AS added FROM shopping_items ORDER BY created_at DESC LIMIT 2000`,
        people: `SELECT name, dept, title, email FROM users WHERE active ORDER BY dept, name LIMIT 2000`,
        certs: `SELECT u.name AS person, u.dept, c.name AS cert, c.issuer, c.issued, c.expires, (c.expires - CURRENT_DATE)::int AS days_left FROM user_certs c JOIN users u ON u.id = c.user_id WHERE u.active ORDER BY c.expires NULLS LAST LIMIT 2000`,
        locations: `SELECT name, category, zone, beds, capacity, condition, condition_note FROM locations WHERE active ORDER BY sort, name LIMIT 2000`,
        assets: `SELECT a.name, a.category, a.status, a.serial, l.name AS location, a.next_service, a.purchase_date, a.value::float FROM assets a LEFT JOIN locations l ON l.id = a.location_id ORDER BY a.name LIMIT 2000`,
        kudos: `SELECT k.created_at::date AS date, f.name AS from_person, t.name AS to_person, k.value_key, k.message FROM kudos k LEFT JOIN users f ON f.id = k.from_id JOIN users t ON t.id = k.to_id ORDER BY k.created_at DESC LIMIT 2000`,
        audit: `SELECT created_at, user_name, action, entity, entity_id FROM audit_log ORDER BY created_at DESC LIMIT 2000`,
      }
      const data = await rows(QUERIES[dataset])
      if (format === 'csv') return { dataset, rows: data.length, csv: toCSV(data) }
      return { dataset, rows: data.length, data }
    },
  },
]

// Tools visible to this user right now (perm + module flag + write switch).
export function visibleTools(user, flags) {
  return TOOLS.filter(t => {
    if (t.flag) { const f = flags.get(t.flag); if (f && !f.enabled) return false }
    if (t.write && !user.perms['ai.write']) return false
    if (t.perm && !user.perms[t.perm]) return false
    return true
  })
}

// Session-side catalog for the Claude & AI page (full list with lock states).
export function toolCatalog(user, flags) {
  return TOOLS.map(t => {
    const flagOff = t.flag && flags.get(t.flag) && !flags.get(t.flag).enabled
    const allowed = !flagOff && (!t.perm || !!user.perms[t.perm]) && (!t.write || !!user.perms['ai.write'])
    return { name: t.name, title: t.title, description: t.description, write: !!t.write, perm: t.perm, allowed }
  })
}

// ---- JSON-RPC handling -----------------------------------------------------
async function handleMessage(msg, req) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid request' } }
  }
  const isNotification = !('id' in msg)
  try {
    let result
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion
        result = {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'woodsos', title: 'WoodsOS — Muskoka Woods', version: '3.1.0' },
          instructions:
            'WoodsOS is the operations platform for Muskoka Woods (bookings, billing, catering, accommodation, facilities tickets, ' +
            'tasks, gear, budgets, safety, lost & found, sign-out, shopping, people, growth, community). ' +
            'Start with whoami to see your permissions, daily_brief for today’s picture, and get_calendar for any date range. ' +
            'search finds records by keyword; export_dataset pulls whole tables. Tools mirror the signed-in person’s permissions — ' +
            'if a tool is missing, they don’t have that access. Write tools post as the person and every write is audited.',
        }
        break
      }
      case 'ping': result = {}; break
      case 'notifications/initialized':
      case 'notifications/cancelled': return null
      case 'tools/list':
        result = {
          tools: visibleTools(req.user, req.flags).map(t => ({
            name: t.name, title: t.title, description: t.description, inputSchema: t.schema,
          })),
        }
        break
      case 'tools/call': {
        const { name, arguments: args = {} } = msg.params || {}
        const tool = visibleTools(req.user, req.flags).find(t => t.name === name)
        if (!tool) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown or unauthorized tool: ${name}` } }
        try {
          const out = await tool.run(args, req.user, req.flags)
          result = { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
        } catch (e) {
          result = { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }
        }
        break
      }
      default:
        if (isNotification) return null
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } }
    }
    return isNotification ? null : { jsonrpc: '2.0', id: msg.id, result }
  } catch (e) {
    return isNotification ? null : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }
  }
}

router.post('/', patAuth, mcpLimiter, ah(async (req, res) => {
  const body = req.body
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handleMessage(m, req)))).filter(Boolean)
    if (!out.length) return res.status(202).end()
    return res.json(out)
  }
  const out = await handleMessage(body, req)
  if (!out) return res.status(202).end()
  res.json(out)
}))

router.get('/', (req, res) => res.status(405).json({
  error: 'This is the WoodsOS MCP endpoint. Connect with: claude mcp add --transport http woodsos <origin>/api/mcp --header "Authorization: Bearer wos_pat_…"',
}))
router.delete('/', (req, res) => res.status(405).end())
