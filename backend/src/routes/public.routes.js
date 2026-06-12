import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { ah, httpError, getSetting, todayISO, notify, token } from '../lib.js'
import { getWeather } from '../weather.js'
import { buildWeek } from './accommodation.routes.js'
import { nextTicketCode, logTicketEvent, chatWatchers } from './tickets.routes.js'
import { keywordTriage, claudeTriage } from '../triage.js'
import { upload } from '../upload.js'

export const router = Router()

async function checkToken(kind, value) {
  const tokens = await getSetting('tokens', {})
  if (!value || tokens[kind] !== value) throw httpError(404, 'This link is not active')
}

// ---- Smart screen ----
router.get('/screen/:token', ah(async (req, res) => {
  await checkToken('screen', req.params.token)
  const [org, screens] = await Promise.all([getSetting('org', {}), getSetting('screens', {})])
  const today = todayISO()
  const panels = screens.panels || {}
  const out = { org: { name: org.name, tagline: org.tagline }, settings: { rotate_seconds: screens.rotate_seconds || 12, welcome: screens.welcome_message }, panels: {} }

  if (panels.schedule !== false) {
    out.panels.schedule = {
      groups: await rows(
        `SELECT code, name, status, headcount, start_date, end_date FROM bookings
         WHERE start_date <= $1 AND end_date >= $1 AND status IN ('confirmed','in_progress')
         ORDER BY headcount DESC LIMIT 8`, [today]),
      events: await rows(`SELECT title, emoji, location, date FROM events WHERE date = $1`, [today]),
      arriving: await rows(`SELECT code, name, headcount FROM bookings WHERE start_date = $1 AND status IN ('confirmed','tentative') LIMIT 5`, [today]),
      departing: await rows(`SELECT code, name, headcount FROM bookings WHERE end_date = $1 AND status IN ('confirmed','in_progress') LIMIT 5`, [today]),
    }
  }
  if (panels.weather !== false) out.panels.weather = await getWeather(screens.lat, screens.lon)
  if (panels.lodging !== false) {
    out.panels.lodging = await rows(
      `SELECT l.name, b.name AS group_name FROM booking_rooms br
       JOIN locations l ON l.id = br.location_id JOIN bookings b ON b.id = br.booking_id
       WHERE br.date_from <= $1 AND br.date_to >= $1 AND b.status IN ('confirmed','in_progress')
       ORDER BY l.sort LIMIT 14`, [today])
  }
  if (panels.whosout) {
    const c = await one(`SELECT COUNT(*)::int AS n FROM trips WHERE signed_in_at IS NULL`)
    out.panels.whosout = { off: c.n }
  }
  if (panels.announcements !== false) {
    out.panels.announcements = await rows(
      `SELECT p.title, p.body, p.created_at FROM posts p
       WHERE p.kind = 'announcement' AND p.created_at > now() - interval '7 days'
       ORDER BY p.pinned DESC, p.created_at DESC LIMIT 5`)
  }
  if (panels.kudos) {
    out.panels.kudos = await rows(
      `SELECT k.message, k.value_key, f.name AS from_name, t.name AS to_name FROM kudos k
       LEFT JOIN users f ON f.id = k.from_id JOIN users t ON t.id = k.to_id
       ORDER BY k.created_at DESC LIMIT 6`)
    const org = await getSetting('org', {})
    out.panels.kudos_values = org.values || []
  }
  res.json(out)
}))

// ---- Who's On board (weekly lodging) ----
router.get('/board/:token', ah(async (req, res) => {
  await checkToken('board', req.params.token)
  const org = await getSetting('org', {})
  const week = await buildWeek(req.query.start)
  const meta = await getSetting('locations_meta', {})
  const attention = week.rows
    .filter(r => (meta.conditions || []).find(c => c.key === r.condition && c.blocking))
    .map(r => ({ name: r.name, condition: r.condition, note: r.condition_note }))
  res.json({ org: { name: org.name }, ...week, attention })
}))

// ---- Guest report form ----
const guestHits = new Map()
function guestLimited(ip) {
  const now = Date.now()
  const a = guestHits.get(ip) || { n: 0, reset: now + 3600 * 1000 }
  if (now > a.reset) { a.n = 0; a.reset = now + 3600 * 1000 }
  a.n++
  guestHits.set(ip, a)
  return a.n > 10
}

router.get('/report/:token', ah(async (req, res) => {
  await checkToken('report', req.params.token)
  const [org, report] = await Promise.all([getSetting('org', {}), getSetting('report', {})])
  const locations = await rows(`SELECT id, name, zone FROM locations WHERE active ORDER BY sort, name`)
  res.json({ org: { name: org.name }, intro: report.intro, categories: report.categories || [], locations })
}))

router.post('/report/:token', ah(async (req, res) => {
  await checkToken('report', req.params.token)
  if (guestLimited(req.ip)) throw httpError(429, 'Too many reports from this device — please find a staff member')
  const { details = '', category = '', location_id, name = '', email = '' } = req.body || {}
  const text = String(details).trim()
  if (text.length < 5) throw httpError(400, 'Tell us a little more about the issue')

  const report = await getSetting('report', {})
  const catKeys = (report.categories || []).map(c => c.key)
  const guessed = keywordTriage(text)
  const chosen = catKeys.includes(category) ? category : guessed.category
  const title = text.length > 64 ? `${text.slice(0, 61).trim()}…` : text

  // Every guest report gets a private tracking link — the two-way channel.
  const ptoken = token(12)
  const t = await one(
    `INSERT INTO tickets (code, title, details, category, priority, location_id, submitter_name, submitter_email, source, triage, public_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'guest',$9,$10) RETURNING id, code`,
    [await nextTicketCode(), title, text, chosen, guessed.urgency, location_id || null,
      String(name).slice(0, 80), String(email).slice(0, 120), JSON.stringify({ ...guessed, guest_category: category || null }), ptoken])
  await logTicketEvent(t.id, 'created', { source: 'guest' })

  // Tell the people who close tickets
  const watchers = await rows(
    `SELECT u.id FROM users u JOIN roles r ON r.key = u.role_key
     WHERE u.active AND (u.role_key = 'admin' OR (r.permissions->>'tickets.close')::boolean IS TRUE)`)
  for (const w of watchers) {
    notify(w.id, { icon: '🎫', title: `New guest report: ${title}`, body: `${t.code}${guessed.urgency >= 3 ? ' · ⚠️ flagged safety' : ''}`, link: `/tickets/${t.id}` })
  }

  // Optional async Claude refinement — never blocks the guest
  claudeTriage(text, catKeys).then(async refined => {
    if (!refined) return
    await q(`UPDATE tickets SET triage = triage || $2::jsonb, priority = GREATEST(priority, $3),
             category = CASE WHEN $4 THEN category ELSE $5 END
             WHERE id = $1`,
      [t.id, JSON.stringify(refined), refined.urgency, catKeys.includes(category), refined.category])
  }).catch(() => {})

  res.status(201).json({ ok: true, code: t.code, track_path: `/track/${ptoken}` })
}))

// ---- Guest tracking page (two-way ticket chat, ported from FTF) ----
async function ticketByPtoken(pt) {
  if (!pt || String(pt).length < 8) throw httpError(404, 'This link is not active')
  const t = await one(
    `SELECT t.*, l.name AS location_name FROM tickets t
     LEFT JOIN locations l ON l.id = t.location_id WHERE t.public_token = $1`, [String(pt)])
  if (!t) throw httpError(404, 'This link is not active')
  return t
}

router.get('/track/:ptoken', ah(async (req, res) => {
  const t = await ticketByPtoken(req.params.ptoken)
  const org = await getSetting('org', {})
  const [messages, attachments] = await Promise.all([
    rows(`SELECT author_name, body, is_guest, created_at FROM ticket_responses
          WHERE ticket_id = $1 AND NOT is_internal ORDER BY created_at`, [t.id]),
    rows(`SELECT id, filename, original_name, mime, guest, created_at FROM ticket_attachments
          WHERE ticket_id = $1 ORDER BY created_at`, [t.id]),
  ])
  res.json({
    org: { name: org.name },
    ticket: {
      code: t.code, title: t.title, status: t.status, category: t.category,
      location_name: t.location_name, submitter_name: t.submitter_name,
      created_at: t.created_at, closed_at: t.closed_at, rating: t.rating,
    },
    messages, attachments,
  })
}))

const chatHits = new Map()
function chatLimited(ip) {
  const now = Date.now()
  const a = chatHits.get(ip) || { n: 0, reset: now + 3600 * 1000 }
  if (now > a.reset) { a.n = 0; a.reset = now + 3600 * 1000 }
  a.n++
  chatHits.set(ip, a)
  return a.n > 20
}

router.post('/track/:ptoken/messages', ah(async (req, res) => {
  if (chatLimited(req.ip)) throw httpError(429, 'Too many messages — give us a few minutes to catch up')
  const t = await ticketByPtoken(req.params.ptoken)
  if (t.status === 'closed') throw httpError(403, 'This ticket is closed — you can read updates but not send new messages')
  const body = String(req.body?.message || '').trim()
  if (!body) throw httpError(400, 'Write something first')
  const r = await one(
    `INSERT INTO ticket_responses (ticket_id, author_name, body, is_guest)
     VALUES ($1,$2,$3,true) RETURNING author_name, body, is_guest, created_at`,
    [t.id, t.submitter_name || 'Guest', body.slice(0, 2000)])
  await q(`UPDATE tickets SET guest_unread = true, updated_at = now() WHERE id = $1`, [t.id])
  await logTicketEvent(t.id, 'guest_message', {})
  for (const uid of await chatWatchers(t)) {
    notify(uid, { icon: '💬', title: `${t.submitter_name || 'Guest'} replied on ${t.code}`, body: body.slice(0, 90), link: `/tickets/${t.id}` })
  }
  res.status(201).json(r)
}))

router.post('/track/:ptoken/photos', upload.array('files', 2), ah(async (req, res) => {
  if (chatLimited(req.ip)) throw httpError(429, 'Too many uploads — give us a few minutes')
  const t = await ticketByPtoken(req.params.ptoken)
  if (t.status === 'closed') throw httpError(403, 'This ticket is closed')
  if (!req.files?.length) throw httpError(400, 'Photos up to 8 MB only')
  const out = []
  for (const f of req.files) {
    out.push(await one(
      `INSERT INTO ticket_attachments (ticket_id, filename, original_name, mime, size, guest)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id, filename, original_name, mime, guest, created_at`,
      [t.id, f.filename, f.originalname, f.mimetype, f.size]))
  }
  await q(`INSERT INTO ticket_responses (ticket_id, author_name, body, is_guest) VALUES ($1,$2,$3,true)`,
    [t.id, t.submitter_name || 'Guest', `📷 added ${out.length === 1 ? 'a photo' : `${out.length} photos`}`])
  await q(`UPDATE tickets SET guest_unread = true, updated_at = now() WHERE id = $1`, [t.id])
  await logTicketEvent(t.id, 'guest_photo', { count: out.length })
  for (const uid of await chatWatchers(t)) {
    notify(uid, { icon: '📷', title: `${t.submitter_name || 'Guest'} added a photo on ${t.code}`, body: '', link: `/tickets/${t.id}` })
  }
  res.status(201).json(out)
}))

router.post('/track/:ptoken/rating', ah(async (req, res) => {
  const t = await ticketByPtoken(req.params.ptoken)
  if (t.status !== 'closed') throw httpError(400, 'You can rate once the ticket is resolved')
  const rating = Math.min(5, Math.max(1, Number(req.body?.rating) || 0))
  if (!rating) throw httpError(400, 'Pick 1 to 5 stars')
  await q(`UPDATE tickets SET rating = $2, rating_comment = $3 WHERE id = $1`,
    [t.id, rating, String(req.body?.comment || '').slice(0, 500)])
  await logTicketEvent(t.id, 'rated', { rating })
  res.json({ ok: true })
}))

// ---- iCal feed — subscribe from Google/Outlook/Apple Calendar ----
router.get('/ical/:token', ah(async (req, res) => {
  await checkToken('ical', req.params.token)
  const org = await getSetting('org', {})
  const bks = await rows(
    `SELECT code, name, status, headcount, start_date, end_date FROM bookings
     WHERE status IN ('tentative','confirmed','in_progress')
       AND end_date >= (now() - interval '60 days')::date
     ORDER BY start_date LIMIT 500`)
  const dt = iso => String(iso).replaceAll('-', '')
  const nextDay = iso => {
    const d = new Date(`${iso}T12:00:00`)
    d.setDate(d.getDate() + 1)
    return todayISO(d)
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//WoodsOS//${org.name || 'Muskoka Woods'}//EN`,
    `X-WR-CALNAME:${org.name || 'Muskoka Woods'} bookings`, 'CALSCALE:GREGORIAN',
  ]
  for (const b of bks) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.code}@woodsos`,
      `DTSTART;VALUE=DATE:${dt(b.start_date)}`,
      `DTEND;VALUE=DATE:${dt(nextDay(b.end_date))}`,
      `SUMMARY:${String(b.name).replace(/[,;\\]/g, ' ')} (${b.headcount || 0})`,
      `DESCRIPTION:${b.code} · ${b.status}`,
      'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  res.set('Content-Type', 'text/calendar; charset=utf-8')
  res.send(lines.join('\r\n'))
}))
