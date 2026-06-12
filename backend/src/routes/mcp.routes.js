import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { getRoles, getFlags } from '../auth.js'
import { effectivePerms } from '../permissions.js'
import { ah, audit, notify, todayISO, addDays, getSetting } from '../lib.js'
import { sha256, mcpLimiter } from '../security.js'
import { nextTicketCode, logTicketEvent, chatWatchers } from './tickets.routes.js'

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

// ---- personal-access-token auth -------------------------------------------
async function patAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : null
    if (!raw || !raw.startsWith('wos_pat_')) {
      return res.status(401).json({ error: 'A WoodsOS personal access token is required (Authorization: Bearer wos_pat_…)' })
    }
    const pat = await one(
      `SELECT p.*, u.id AS uid FROM pats p JOIN users u ON u.id = p.user_id
       WHERE p.token_hash = $1 AND NOT p.revoked AND u.active
         AND (p.expires_at IS NULL OR p.expires_at > now())`, [sha256(raw)])
    if (!pat) return res.status(401).json({ error: 'This token is invalid, revoked, or expired' })
    const aiSetting = await getSetting('ai', {})
    if (aiSetting.enabled === false) return res.status(403).json({ error: 'AI access is switched off for this organization' })
    const flags = await getFlags()
    if (flags.get('ai') && !flags.get('ai').enabled) {
      return res.status(403).json({ error: 'The Claude & AI module is switched off' })
    }
    const user = await one(`SELECT * FROM users WHERE id = $1`, [pat.uid])
    user.perms = effectivePerms(user, (await getRoles()).get(user.role_key))
    if (!user.perms['ai.use']) return res.status(403).json({ error: 'Your account does not have the “Connect Claude” permission' })
    delete user.password_hash
    req.user = user
    req.patId = pat.id
    req.flags = flags
    q(`UPDATE pats SET last_used_at = now() WHERE id = $1`, [pat.id]).catch(() => {})
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
    description: 'Global search across bookings, tickets, tasks, people, gear, and locations (each respecting the caller’s permissions). Use when you have a name or keyword but not an id.',
    schema: S({ q: str('Search text — names, codes, keywords') }, ['q']),
    run: async ({ q: term }, user) => {
      const like = `%${term}%`
      const out = {}
      if (user.perms['bookings.view']) out.bookings = await rows(
        `SELECT id, code, name, status, start_date, end_date FROM bookings WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 6`, [like])
      if (user.perms['tickets.view']) out.tickets = await rows(
        `SELECT id, code, title, status FROM tickets WHERE title ILIKE $1 OR code ILIKE $1 LIMIT 6`, [like])
      if (user.perms['tasks.view']) out.tasks = await rows(`SELECT id, title FROM tasks WHERE title ILIKE $1 LIMIT 6`, [like])
      if (user.perms['people.view']) out.people = await rows(
        `SELECT id, name, dept, title FROM users WHERE active AND name ILIKE $1 LIMIT 6`, [like])
      if (user.perms['gear.view']) out.gear = await rows(
        `SELECT id, name, category, qty_total FROM gear_items WHERE active AND name ILIKE $1 LIMIT 6`, [like])
      if (user.perms['locations.view']) out.locations = await rows(
        `SELECT id, name, category FROM locations WHERE active AND name ILIKE $1 LIMIT 6`, [like])
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
    description: 'Pull a whole dataset as JSON rows (or CSV text) for analysis: bookings, tickets, tasks, expenses, gear_loans, incidents, lost_found, shopping, people. Each dataset needs its matching view permission. Capped at 2000 rows.',
    schema: S({ dataset: str('bookings | tickets | tasks | expenses | gear_loans | incidents | lost_found | shopping | people'), format: str('json (default) | csv') }, ['dataset']),
    run: async ({ dataset, format }, user) => {
      const need = {
        bookings: 'bookings.view', tickets: 'tickets.view', tasks: 'tasks.view', expenses: 'budgets.view',
        gear_loans: 'gear.view', incidents: 'incidents.view', lost_found: 'lostfound.view',
        shopping: 'shopping.view', people: 'people.view',
      }[dataset]
      if (!need) throw new Error('Unknown dataset')
      if (!user.perms[need]) throw new Error(`You need ${need} for that dataset`)
      const QUERIES = {
        bookings: `SELECT b.code, b.name, b.status, b.segment, b.start_date, b.end_date, b.headcount, b.value::float, c.name AS customer FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id ORDER BY b.start_date DESC LIMIT 2000`,
        tickets: `SELECT t.code, t.title, t.status, t.priority, t.category, l.name AS location, u.name AS assignee, t.created_at::date AS created, t.closed_at::date AS closed, t.rating, t.due_date FROM tickets t LEFT JOIN locations l ON l.id = t.location_id LEFT JOIN users u ON u.id = t.assignee_id ORDER BY t.created_at DESC LIMIT 2000`,
        tasks: `SELECT t.title, s.name AS status, p.name AS phase, t.due, t.priority, t.completed_at::date AS completed FROM tasks t LEFT JOIN task_statuses s ON s.id = t.status_id LEFT JOIN phases p ON p.id = t.phase_id ORDER BY t.created_at DESC LIMIT 2000`,
        expenses: `SELECT e.date, b.name AS budget, e.vendor, e.descr, e.amount::float, e.category, e.status FROM expenses e JOIN budgets b ON b.id = e.budget_id ORDER BY e.date DESC LIMIT 2000`,
        gear_loans: `SELECT g.name AS item, l.qty, COALESCE(u.name, l.borrower_name) AS borrower, l.out_at, l.due_at, l.returned_at, l.condition_in FROM gear_loans l JOIN gear_items g ON g.id = l.item_id LEFT JOIN users u ON u.id = l.borrower_id ORDER BY l.out_at DESC LIMIT 2000`,
        incidents: `SELECT i.code, i.title, i.type, i.severity, i.status, i.occurred_at, l.name AS location FROM incidents i LEFT JOIN locations l ON l.id = i.location_id ${user.perms['incidents.confidential'] ? '' : 'WHERE NOT i.confidential'} ORDER BY i.occurred_at DESC LIMIT 2000`,
        lost_found: `SELECT kind, date, category, description, stored_at, status FROM lf_items ORDER BY date DESC LIMIT 2000`,
        shopping: `SELECT text, qty, category, completed, created_at::date AS added FROM shopping_items ORDER BY created_at DESC LIMIT 2000`,
        people: `SELECT name, dept, title, email FROM users WHERE active ORDER BY dept, name LIMIT 2000`,
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
          serverInfo: { name: 'woodsos', title: 'WoodsOS — Muskoka Woods', version: '3.0.0' },
          instructions:
            'WoodsOS is the operations platform for Muskoka Woods (bookings, facilities tickets, tasks, gear, budgets, safety, people). ' +
            'Start with whoami to see your permissions, and daily_brief for today’s picture. Tools mirror the signed-in person’s ' +
            'permissions — if a tool is missing, they don’t have that access. Write tools post as the person (audited).',
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
