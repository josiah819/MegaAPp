import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm, getFlags } from '../auth.js'
import { ah, audit, httpError, todayISO, addDays } from '../lib.js'
import { normalizeFeedUrl, fetchICS, expandICS } from '../ics.js'

/* The unified calendar — every module that owns a date, on one grid, plus
   each person's own external calendars (Google/Outlook/Apple secret iCal
   links) overlaid privately. Layers are permission-filtered server-side;
   feeds belong to the requesting user only. */

export const router = Router()

const MS_DAY = 86400000
const FEED_TTL_MS = 15 * 60 * 1000
const MAX_FEEDS = 6
const FEED_COLS = `id, user_id, name, url, color, enabled, fetched_at, fetch_status, created_at,
                   jsonb_array_length(COALESCE(cache, '[]'::jsonb)) AS cached_events`

// Re-fetch a feed when its cache is older than the TTL (or on demand).
// Failures keep the last good cache and record the error on the row.
async function refreshFeed(feed, force = false) {
  const fresh = feed.fetched_at && Date.now() - new Date(feed.fetched_at).getTime() < FEED_TTL_MS
  if (fresh && !force) return feed
  try {
    const text = await fetchICS(feed.url)
    const today = todayISO()
    const { events } = expandICS(text, addDays(today, -60), addDays(today, 400))
    return await one(
      `UPDATE user_calendar_feeds SET cache = $2, fetched_at = now(), fetch_status = 'ok'
       WHERE id = $1 RETURNING *`,
      [feed.id, JSON.stringify(events)])
  } catch (e) {
    const msg = String(e.message || 'fetch failed').slice(0, 200)
    await q(`UPDATE user_calendar_feeds SET fetched_at = now(), fetch_status = $2 WHERE id = $1`, [feed.id, msg])
    return { ...feed, fetch_status: msg }
  }
}

// Project birthdays / work anniversaries into [from, to] (range ≤ ~4 months,
// so at most two year boundaries to consider).
function celebrationsInRange(people, from, to) {
  const out = []
  const years = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y)
  for (const p of people) {
    for (const [field, kind] of [['birthday', 'birthday'], ['start_date', 'anniversary']]) {
      if (!p[field]) continue
      const [oy, m, d] = String(p[field]).split('-')
      for (const y of years) {
        const iso = `${y}-${m}-${d}`
        if (iso < from || iso > to) continue
        const years_n = y - Number(oy)
        if (kind === 'anniversary' && years_n < 1) continue
        out.push({
          id: `${kind}-${p.id}-${y}`, kind, date: iso, person_id: p.id, color: p.color,
          title: kind === 'birthday' ? `🎂 ${p.name}` : `🎉 ${p.name} — ${years_n} yr${years_n > 1 ? 's' : ''}`,
          link: `/people/${p.id}`,
        })
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// The aggregation core — shared with the MCP `get_calendar` tool.
// Every layer double-checks its module flag and the caller's permission.
export async function buildCalendar(user, from, to, flags, includeFeeds = true) {
  const p = user.perms
  const on = key => { const f = flags.get(key); return !f || f.enabled }
  const layers = {}

  if (p['bookings.view'] && on('bookings')) {
    layers.bookings = (await rows(
      `SELECT b.id, b.code, b.name AS title, b.status, b.headcount, b.segment,
              b.start_date AS date, b.end_date, c.name AS customer
       FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
       WHERE b.start_date <= $2 AND b.end_date >= $1 AND b.status != 'cancelled'
       ORDER BY b.start_date LIMIT 400`, [from, to]))
      .map(b => ({ ...b, link: `/bookings/${b.id}` }))
  }

  if (p['bookings.catering'] && on('bookings')) {
    layers.meals = (await rows(
      `SELECT m.id, m.date, m.meal, m.time, m.headcount, m.menu, m.dietary,
              b.name AS booking, b.code, l.name AS location
       FROM meal_services m JOIN bookings b ON b.id = m.booking_id
       LEFT JOIN locations l ON l.id = m.location_id
       WHERE m.date >= $1 AND m.date <= $2 AND b.status != 'cancelled'
       ORDER BY m.date, array_position(ARRAY['breakfast','lunch','dinner','snack'], m.meal) LIMIT 500`,
      [from, to]))
      .map(m => ({ ...m, title: `${m.meal[0].toUpperCase()}${m.meal.slice(1)} · ${m.booking}`, link: '/catering' }))
  }

  if (p['tasks.view'] && on('tasks')) {
    layers.tasks = (await rows(
      `SELECT t.id, t.title, t.due AS date, t.priority, s.name AS status, (s.kind = 'done') AS done,
              (SELECT string_agg(u.name, ', ') FROM users u WHERE u.id = ANY(t.assignees)) AS assignees
       FROM tasks t LEFT JOIN task_statuses s ON s.id = t.status_id
       WHERE t.due >= $1 AND t.due <= $2 AND t.parent_id IS NULL
       ORDER BY t.due LIMIT 500`, [from, to]))
      .map(t => ({ ...t, link: '/tasks' }))
  }

  if (p['tickets.view'] && on('facilities')) {
    layers.tickets = (await rows(
      `SELECT t.id, t.code, t.title, t.status, t.priority, t.due_date AS date,
              l.name AS location, u.name AS assignee
       FROM tickets t LEFT JOIN locations l ON l.id = t.location_id LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.due_date >= $1 AND t.due_date <= $2 AND t.status != 'closed'
       ORDER BY t.due_date, t.priority DESC LIMIT 500`, [from, to]))
      .map(t => ({ ...t, link: `/tickets/${t.id}` }))
  }

  if (p['incidents.view'] && on('safety')) {
    layers.incidents = (await rows(
      `SELECT i.id, i.code, i.title, i.type, i.severity, i.status, i.occurred_at::date AS date
       FROM incidents i
       WHERE i.occurred_at::date >= $1 AND i.occurred_at::date <= $2
         ${user.perms['incidents.confidential'] ? '' : 'AND NOT i.confidential'}
       ORDER BY i.occurred_at LIMIT 300`, [from, to]))
      .map(i => ({ ...i, link: `/safety?focus=${i.id}` }))
  }

  if (p['signout.board'] && on('signout')) {
    layers.signout = (await rows(
      `SELECT t.id, u.name AS title, t.destination, t.signed_out_at, t.expected_return,
              COALESCE(t.expected_return, t.signed_out_at)::date AS date,
              (t.expected_return IS NOT NULL AND t.expected_return < now()) AS overdue
       FROM trips t JOIN users u ON u.id = t.user_id
       WHERE t.signed_in_at IS NULL
         AND COALESCE(t.expected_return, t.signed_out_at)::date >= $1
         AND COALESCE(t.expected_return, t.signed_out_at)::date <= $2
       ORDER BY t.expected_return NULLS LAST LIMIT 200`, [from, to]))
      .map(t => ({ ...t, link: '/signout' }))
  }

  if (p['people.certs'] && on('people')) {
    layers.certs = (await rows(
      `SELECT c.id, c.name AS cert, u.name AS person, u.id AS person_id, c.expires AS date,
              (c.expires < CURRENT_DATE) AS expired
       FROM user_certs c JOIN users u ON u.id = c.user_id
       WHERE u.active AND c.expires >= $1 AND c.expires <= $2
       ORDER BY c.expires LIMIT 300`, [from, to]))
      .map(c => ({ ...c, title: `${c.person} — ${c.cert}`, link: `/people/${c.person_id}` }))
  }

  if (p['community.view'] && on('community')) {
    layers.events = (await rows(
      `SELECT id, title, date, end_date, location, emoji, descr FROM events
       WHERE date <= $2 AND COALESCE(end_date, date) >= $1
       ORDER BY date LIMIT 300`, [from, to]))
      .map(e => ({ ...e, link: '/community' }))
  }

  if (p['people.view'] && on('people')) {
    const people = await rows(
      `SELECT id, name, color, birthday, start_date FROM users
       WHERE active AND (birthday IS NOT NULL OR start_date IS NOT NULL)`)
    layers.birthdays = celebrationsInRange(people, from, to)
  }

  if (includeFeeds) {
    const mine = await rows(
      `SELECT * FROM user_calendar_feeds WHERE user_id = $1 AND enabled ORDER BY id`, [user.id])
    const refreshed = await Promise.all(mine.map(f => refreshFeed(f)))
    layers.feeds = refreshed.map(f => ({
      id: f.id, name: f.name, color: f.color, status: f.fetch_status, fetched_at: f.fetched_at,
      events: (f.cache || []).filter(e => e.date <= to && (e.end_date || e.date) >= from),
    }))
  }

  return { from, to, layers }
}

// ---- the aggregate ---------------------------------------------------------
router.get('/', ah(async (req, res) => {
  const from = req.query.from || addDays(todayISO(), -7)
  const to = req.query.to || addDays(todayISO(), 35)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    throw httpError(400, 'Give me from/to as ISO dates')
  }
  if ((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / MS_DAY > 130) {
    throw httpError(400, 'Range is capped at ~4 months per request')
  }
  res.json(await buildCalendar(req.user, from, to, await getFlags(), req.query.feeds !== 'false'))
}))

// ---- personal external feeds (Google/Outlook/Apple iCal URLs) --------------
router.get('/feeds', ah(async (req, res) => {
  res.json(await rows(
    `SELECT ${FEED_COLS} FROM user_calendar_feeds WHERE user_id = $1 ORDER BY id`, [req.user.id]))
}))

router.post('/feeds', ah(async (req, res) => {
  const { name, url, color = '#7D5BA6' } = req.body || {}
  if (!name?.trim()) throw httpError(400, 'Give the calendar a name (e.g. “My Google Calendar”)')
  const count = await one(`SELECT COUNT(*)::int AS n FROM user_calendar_feeds WHERE user_id = $1`, [req.user.id])
  if (count.n >= MAX_FEEDS) throw httpError(400, `That’s the lot — ${MAX_FEEDS} calendars max per person`)

  let clean
  try { clean = normalizeFeedUrl(url) } catch (e) { throw httpError(400, e.message) }

  // Fetch before saving so a bad link fails loudly with a fixable message.
  let events
  try {
    const text = await fetchICS(clean)
    const today = todayISO()
    events = expandICS(text, addDays(today, -60), addDays(today, 400)).events
  } catch (e) {
    throw httpError(400, e.message)
  }

  const f = await one(
    `INSERT INTO user_calendar_feeds (user_id, name, url, color, cache, fetched_at, fetch_status)
     VALUES ($1,$2,$3,$4,$5, now(), 'ok')
     RETURNING ${FEED_COLS}`,
    [req.user.id, name.trim().slice(0, 60), clean, String(color).slice(0, 20), JSON.stringify(events)])
  // The URL is a capability secret (Google's “secret address”) — audit the host only.
  await audit(req.user, 'calendar.feed_add', 'calendar', f.id, { name: f.name, host: new URL(clean).hostname })
  res.status(201).json(f)
}))

router.patch('/feeds/:id', ah(async (req, res) => {
  const { name, color, enabled } = req.body || {}
  const f = await one(
    `UPDATE user_calendar_feeds SET
       name = COALESCE($3, name), color = COALESCE($4, color), enabled = COALESCE($5, enabled)
     WHERE id = $1 AND user_id = $2
     RETURNING ${FEED_COLS}`,
    [Number(req.params.id), req.user.id, name ? String(name).slice(0, 60) : null,
      color ? String(color).slice(0, 20) : null,
      'enabled' in (req.body || {}) ? !!enabled : null])
  if (!f) throw httpError(404, 'Calendar not found')
  res.json(f)
}))

router.delete('/feeds/:id', ah(async (req, res) => {
  const f = await one(`DELETE FROM user_calendar_feeds WHERE id = $1 AND user_id = $2 RETURNING id, name`,
    [Number(req.params.id), req.user.id])
  if (!f) throw httpError(404, 'Calendar not found')
  await audit(req.user, 'calendar.feed_remove', 'calendar', f.id, { name: f.name })
  res.json({ ok: true })
}))

router.post('/feeds/:id/refresh', ah(async (req, res) => {
  const f = await one(`SELECT * FROM user_calendar_feeds WHERE id = $1 AND user_id = $2`,
    [Number(req.params.id), req.user.id])
  if (!f) throw httpError(404, 'Calendar not found')
  const updated = await refreshFeed(f, true)
  res.json({
    id: updated.id, fetch_status: updated.fetch_status, fetched_at: updated.fetched_at,
    cached_events: (updated.cache || []).length,
  })
}))

// ---- camp events (the Community events table, creatable from the calendar) --
router.post('/events', requirePerm('community.announce'), ah(async (req, res) => {
  const flags = await getFlags()
  const f = flags.get('community')
  if (f && !f.enabled) throw httpError(403, 'The Community module is turned off')
  const { title, date, end_date, location = '', emoji = '🌲', descr = '' } = req.body || {}
  if (!title?.trim() || !date) throw httpError(400, 'Title and date are required')
  if (end_date && end_date < date) throw httpError(400, 'The end date is before the start')
  const e = await one(
    `INSERT INTO events (title, date, end_date, location, emoji, descr) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title.trim().slice(0, 120), date, end_date || null, String(location).slice(0, 120),
      String(emoji).slice(0, 8), String(descr).slice(0, 400)])
  await audit(req.user, 'event.create', 'event', e.id, { title: e.title, date })
  res.status(201).json(e)
}))

router.delete('/events/:id', requirePerm('community.announce'), ah(async (req, res) => {
  const e = await one(`DELETE FROM events WHERE id = $1 RETURNING title`, [Number(req.params.id)])
  if (!e) throw httpError(404, 'Event not found')
  await audit(req.user, 'event.delete', 'event', req.params.id, e)
  res.json({ ok: true })
}))
