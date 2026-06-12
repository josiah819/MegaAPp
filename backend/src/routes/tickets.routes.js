import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, notify, addDays, todayISO, token, getSetting, usersWithPerm } from '../lib.js'
import { upload, removeFile } from '../upload.js'
import { uploadLimiter } from '../security.js'

export const router = Router()
router.use(requirePerm('tickets.view'))

export async function nextTicketCode() {
  const r = await one(`SELECT code FROM tickets WHERE code LIKE 'MW-%' ORDER BY id DESC LIMIT 1`)
  const n = r ? parseInt(r.code.slice(3), 10) + 1 : 10001
  return `MW-${isNaN(n) ? Date.now() % 100000 : n}`
}

// Lifecycle history — feeds the detail timeline and the time-in-status metrics.
export async function logTicketEvent(ticketId, kind, detail = {}, user = null) {
  try {
    await q(`INSERT INTO ticket_events (ticket_id, kind, detail, user_id, user_name) VALUES ($1,$2,$3,$4,$5)`,
      [ticketId, kind, JSON.stringify(detail), user?.id || null, user?.name || ''])
  } catch (e) { console.error('ticket event failed', e.message) }
}

// Everyone who should hear about guest activity: the assignee, or chat-perm holders.
export async function chatWatchers(ticket) {
  if (ticket.assignee_id) return [ticket.assignee_id]
  const w = await rows(
    `SELECT u.id FROM users u JOIN roles r ON r.key = u.role_key
     WHERE u.active AND (u.role_key = 'admin' OR (r.permissions->>'tickets.chat')::boolean IS TRUE
       OR (u.overrides->>'tickets.chat')::boolean IS TRUE)`)
  return w.map(x => x.id)
}

// People following a ticket (the FTF watcher pattern) — notified on every event.
async function notifyTicketWatchers(ticketId, exceptUserId, payload) {
  const w = await rows(`SELECT user_id FROM ticket_watchers WHERE ticket_id = $1`, [ticketId])
  for (const { user_id } of w) {
    if (user_id !== exceptUserId) notify(user_id, payload)
  }
}

// Default due date from the SLA hours configured per priority (4=ASAP … 1=low).
// Same-day for anything within 12 hours, otherwise rounded up to whole days.
async function slaDue(priority) {
  const sla = await getSetting('sla', {})
  const h = (sla.hours || {})[priority]
  if (!h) return null
  return addDays(todayISO(), h <= 12 ? 0 : Math.ceil(h / 24))
}

// ---- scheduled (recurring) tickets — registered before /:id ----
router.get('/scheduled', requirePerm('tickets.schedule'), ah(async (req, res) => {
  res.json(await rows(
    `SELECT s.*, l.name AS location_name FROM scheduled_tickets s
     LEFT JOIN locations l ON l.id = s.location_id ORDER BY s.active DESC, s.next_run`))
}))

router.post('/scheduled', requirePerm('tickets.schedule'), ah(async (req, res) => {
  const { title, details = '', category = 'maintenance', priority = 1, location_id, frequency = 'weekly', next_run } = req.body || {}
  if (!title || !next_run) throw httpError(400, 'Title and first run date are required')
  const s = await one(
    `INSERT INTO scheduled_tickets (title, details, category, priority, location_id, frequency, next_run)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [title, details, category, priority, location_id || null, frequency, next_run])
  await audit(req.user, 'scheduled_ticket.create', 'ticket', s.id, { title })
  res.status(201).json(s)
}))

router.patch('/scheduled/:id', requirePerm('tickets.schedule'), ah(async (req, res) => {
  const { title, details, category, priority, location_id, frequency, next_run, active } = req.body || {}
  const s = await one(
    `UPDATE scheduled_tickets SET
       title = COALESCE($2,title), details = COALESCE($3,details), category = COALESCE($4,category),
       priority = COALESCE($5,priority), location_id = COALESCE($6,location_id),
       frequency = COALESCE($7,frequency), next_run = COALESCE($8,next_run), active = COALESCE($9,active)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), title, details, category, priority, location_id, frequency, next_run,
      'active' in (req.body || {}) ? !!active : null])
  if (!s) throw httpError(404, 'Schedule not found')
  await audit(req.user, 'scheduled_ticket.update', 'ticket', s.id)
  res.json(s)
}))

router.delete('/scheduled/:id', requirePerm('tickets.schedule'), ah(async (req, res) => {
  await q(`DELETE FROM scheduled_tickets WHERE id = $1`, [Number(req.params.id)])
  await audit(req.user, 'scheduled_ticket.delete', 'ticket', req.params.id)
  res.json({ ok: true })
}))

// ---- tag catalog (the FTF tags feature) ----
router.get('/tags', ah(async (req, res) => {
  res.json(await rows(
    `SELECT t.*, (SELECT COUNT(*)::int FROM ticket_tags tt WHERE tt.tag_id = t.id) AS used
     FROM tags t ORDER BY t.active DESC, t.name`))
}))

router.post('/tags', requirePerm('tickets.tags_manage'), ah(async (req, res) => {
  const { name, color = '#5B8A92' } = req.body || {}
  if (!name?.trim()) throw httpError(400, 'The tag needs a name')
  const t = await one(`INSERT INTO tags (name, color) VALUES ($1,$2)
                       ON CONFLICT (name) DO UPDATE SET active = true, color = EXCLUDED.color RETURNING *`,
    [name.trim(), color])
  await audit(req.user, 'tag.create', 'tag', t.id, { name: t.name })
  res.status(201).json(t)
}))

router.patch('/tags/:id', requirePerm('tickets.tags_manage'), ah(async (req, res) => {
  const { name, color, active } = req.body || {}
  const t = await one(
    `UPDATE tags SET name = COALESCE($2,name), color = COALESCE($3,color), active = COALESCE($4,active)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, color, 'active' in (req.body || {}) ? !!active : null])
  if (!t) throw httpError(404, 'Tag not found')
  res.json(t)
}))

router.delete('/tags/:id', requirePerm('tickets.tags_manage'), ah(async (req, res) => {
  await q(`DELETE FROM tags WHERE id = $1`, [Number(req.params.id)])
  await audit(req.user, 'tag.delete', 'tag', req.params.id)
  res.json({ ok: true })
}))

// ---- canned responses (saved replies) ----
router.get('/canned', ah(async (req, res) => {
  res.json(await rows(`SELECT * FROM canned_responses WHERE active ORDER BY title`))
}))

router.post('/canned', requirePerm('tickets.canned'), ah(async (req, res) => {
  const { title, body } = req.body || {}
  if (!title?.trim() || !body?.trim()) throw httpError(400, 'A saved reply needs a title and a body')
  const c = await one(`INSERT INTO canned_responses (title, body, created_by) VALUES ($1,$2,$3) RETURNING *`,
    [title.trim(), body.trim(), req.user.id])
  await audit(req.user, 'canned.create', 'ticket', c.id, { title })
  res.status(201).json(c)
}))

router.patch('/canned/:id', requirePerm('tickets.canned'), ah(async (req, res) => {
  const { title, body, active } = req.body || {}
  const c = await one(
    `UPDATE canned_responses SET title = COALESCE($2,title), body = COALESCE($3,body), active = COALESCE($4,active)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), title, body, 'active' in (req.body || {}) ? !!active : null])
  if (!c) throw httpError(404, 'Saved reply not found')
  res.json(c)
}))

router.delete('/canned/:id', requirePerm('tickets.canned'), ah(async (req, res) => {
  await q(`DELETE FROM canned_responses WHERE id = $1`, [Number(req.params.id)])
  res.json({ ok: true })
}))

// ---- saved views (per-person filter presets) ----
router.get('/views', ah(async (req, res) => {
  res.json(await rows(`SELECT * FROM saved_views WHERE user_id = $1 AND page = 'tickets' ORDER BY name`, [req.user.id]))
}))

router.post('/views', ah(async (req, res) => {
  const { name, params = {} } = req.body || {}
  if (!name?.trim()) throw httpError(400, 'Give the view a name')
  const v = await one(
    `INSERT INTO saved_views (user_id, page, name, params) VALUES ($1,'tickets',$2,$3)
     ON CONFLICT (user_id, page, name) DO UPDATE SET params = EXCLUDED.params RETURNING *`,
    [req.user.id, name.trim().slice(0, 40), JSON.stringify(params)])
  res.status(201).json(v)
}))

router.delete('/views/:id', ah(async (req, res) => {
  await q(`DELETE FROM saved_views WHERE id = $1 AND user_id = $2`, [Number(req.params.id), req.user.id])
  res.json({ ok: true })
}))

// ---- CSV export ----
router.get('/export.csv', requirePerm('tickets.export'), ah(async (req, res) => {
  const list = await rows(
    `SELECT t.code, t.title, t.status, t.priority, t.category, l.name AS location, u.name AS assignee,
            t.source, t.created_at, t.first_response_at, t.closed_at, t.due_date, t.rating, t.damage_note,
            (SELECT string_agg(g.name, '; ') FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = t.id) AS tags
     FROM tickets t LEFT JOIN locations l ON l.id = t.location_id LEFT JOIN users u ON u.id = t.assignee_id
     ORDER BY t.created_at DESC LIMIT 5000`)
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [Object.keys(list[0] || { empty: '' }).join(','), ...list.map(r => Object.values(r).map(esc).join(','))].join('\n')
  await audit(req.user, 'ticket.export', 'ticket', '', { rows: list.length })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="woodsos-tickets-${todayISO()}.csv"`)
  res.send(csv)
}))

// ---- tickets ----
router.get('/', ah(async (req, res) => {
  const { status, category, q: qs, mine, source, waiting, priority: prio, tag, overdue, unread, watching } = req.query
  const where = []
  const params = [req.user.id] // $1 reserved for read-state joins
  if (status === 'active') where.push(`t.status IN ('open','in_progress','on_hold','pending_close')`)
  else if (status) { params.push(status); where.push(`t.status = $${params.length}`) }
  if (category) { params.push(category); where.push(`t.category = $${params.length}`) }
  if (source) { params.push(source); where.push(`t.source = $${params.length}`) }
  if (prio) { params.push(Number(prio)); where.push(`t.priority = $${params.length}`) }
  if (waiting === 'true') where.push(`t.guest_unread = true`)
  if (overdue === 'true') { params.push(todayISO()); where.push(`t.due_date < $${params.length} AND t.status NOT IN ('closed')`) }
  if (unread === 'true') where.push(`t.updated_at > COALESCE(rd.last_read_at, 'epoch')`)
  if (watching === 'true') where.push(`w.user_id IS NOT NULL`)
  if (mine === 'true') where.push(`t.assignee_id = $1`)
  if (tag) { params.push(Number(tag)); where.push(`EXISTS (SELECT 1 FROM ticket_tags tt WHERE tt.ticket_id = t.id AND tt.tag_id = $${params.length})`) }
  if (qs) { params.push(`%${qs}%`); where.push(`(t.title ILIKE $${params.length} OR t.code ILIKE $${params.length})`) }
  res.json(await rows(
    `SELECT t.*, l.name AS location_name, u.name AS assignee_name, u.color AS assignee_color,
       (SELECT COUNT(*)::int FROM ticket_responses r WHERE r.ticket_id = t.id) AS responses,
       (SELECT COUNT(*)::int FROM ticket_attachments a WHERE a.ticket_id = t.id) AS attachments,
       (SELECT json_agg(json_build_object('id', g.id, 'name', g.name, 'color', g.color))
          FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = t.id) AS tags,
       (t.updated_at > COALESCE(rd.last_read_at, 'epoch')) AS unread,
       (w.user_id IS NOT NULL) AS watching
     FROM tickets t
     LEFT JOIN locations l ON l.id = t.location_id
     LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN ticket_reads rd ON rd.ticket_id = t.id AND rd.user_id = $1
     LEFT JOIN ticket_watchers w ON w.ticket_id = t.id AND w.user_id = $1
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (t.status = 'closed'), t.guest_unread DESC, t.priority DESC, t.created_at DESC LIMIT 400`, params))
}))

router.get('/:id', ah(async (req, res) => {
  const t = await one(
    `SELECT t.*, l.name AS location_name, u.name AS assignee_name, cu.name AS created_by_name
     FROM tickets t LEFT JOIN locations l ON l.id = t.location_id
     LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cu ON cu.id = t.created_by
     WHERE t.id = $1`, [Number(req.params.id)])
  if (!t) throw httpError(404, 'Ticket not found')
  const [thread, events, attachments, tags, watchers, closure] = await Promise.all([
    rows(`SELECT r.*, u.color FROM ticket_responses r LEFT JOIN users u ON u.id = r.user_id
          WHERE r.ticket_id = $1 ORDER BY r.created_at`, [t.id]),
    rows(`SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at`, [t.id]),
    rows(`SELECT id, filename, original_name, mime, size, guest, created_at FROM ticket_attachments
          WHERE ticket_id = $1 ORDER BY created_at`, [t.id]),
    rows(`SELECT g.id, g.name, g.color FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = $1 ORDER BY g.name`, [t.id]),
    rows(`SELECT w.user_id, u.name, u.color FROM ticket_watchers w JOIN users u ON u.id = w.user_id WHERE w.ticket_id = $1`, [t.id]),
    one(`SELECT cr.*, u.name AS requested_by_name FROM closure_requests cr LEFT JOIN users u ON u.id = cr.requested_by
         WHERE cr.ticket_id = $1 AND cr.status = 'pending' ORDER BY cr.created_at DESC LIMIT 1`, [t.id]),
  ])
  t.thread = thread
  t.events = events
  t.attachments = attachments
  t.tags = tags
  t.watchers = watchers
  t.watching = watchers.some(w => w.user_id === req.user.id)
  t.pending_closure = closure
  if (!req.user.perms['tickets.chat']) t.public_token = null
  // Opening the ticket clears the “guest is waiting” flag for people who can act on it
  if (t.guest_unread && req.user.perms['tickets.edit']) {
    await q(`UPDATE tickets SET guest_unread = false WHERE id = $1`, [t.id])
    t.guest_unread = false
  }
  // …and stamps this person's read marker (drives the unread dots in the list)
  await q(`INSERT INTO ticket_reads (ticket_id, user_id, last_read_at) VALUES ($1,$2,now())
           ON CONFLICT (ticket_id, user_id) DO UPDATE SET last_read_at = now()`, [t.id, req.user.id])
  res.json(t)
}))

router.post('/', requirePerm('tickets.edit'), ah(async (req, res) => {
  const { title, details = '', category = 'maintenance', location_id, assignee_id, due_date, damage_note = '' } = req.body || {}
  if (!title) throw httpError(400, 'The ticket needs a title')
  // Priority is its own permission (the FTF staff-priority rule). 0 low … 4 ASAP.
  const asked = Number(req.body?.priority)
  const priority = req.user.perms['tickets.priority'] && Number.isInteger(asked)
    ? Math.min(4, Math.max(0, asked)) : 1
  const due = due_date || await slaDue(priority)
  const t = await one(
    `INSERT INTO tickets (code, title, details, category, priority, location_id, assignee_id, due_date, damage_note, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staff',$10) RETURNING *`,
    [await nextTicketCode(), title, details, category, priority, location_id || null, assignee_id || null, due, damage_note, req.user.id])
  await logTicketEvent(t.id, 'created', { source: 'staff' }, req.user)
  if (assignee_id) await logTicketEvent(t.id, 'assigned', { to: assignee_id }, req.user)
  if (assignee_id && assignee_id !== req.user.id) {
    notify(assignee_id, { icon: '🎫', title: `Assigned to you: ${title}`, body: t.code, link: `/tickets/${t.id}` })
  }
  // Creator watches their own ticket by default (FTF behavior)
  await q(`INSERT INTO ticket_watchers (ticket_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.id, req.user.id])
  await audit(req.user, 'ticket.create', 'ticket', t.id, { code: t.code, title })
  res.status(201).json(t)
}))

router.patch('/:id', requirePerm('tickets.edit'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const body = req.body || {}
  const { title, details, category, location_id, assignee_id, due_date, status, damage_note } = body
  const existing = await one(`SELECT * FROM tickets WHERE id = $1`, [id])
  if (!existing) throw httpError(404, 'Ticket not found')
  if (status === 'closed' && !req.user.perms['tickets.close']) {
    throw httpError(403, 'Closing tickets needs the “Close tickets” permission — request a closure instead')
  }
  if (status === 'pending_close') throw httpError(400, 'Use the closure-request flow for that')
  let priority = null
  if ('priority' in body && body.priority !== existing.priority) {
    if (!req.user.perms['tickets.priority']) throw httpError(403, 'Changing priority needs the “Set priority” permission')
    priority = Math.min(4, Math.max(0, Number(body.priority) || 0))
  }

  // Hold-time bookkeeping: entering on_hold starts the clock, leaving banks it.
  let holdSql = ''
  if (status && status !== existing.status) {
    if (status === 'on_hold') holdSql = `, on_hold_at = now()`
    else if (existing.status === 'on_hold') {
      holdSql = `, hold_seconds = hold_seconds + COALESCE(EXTRACT(EPOCH FROM now() - on_hold_at), 0)::int, on_hold_at = NULL`
    }
  }

  const t = await one(
    `UPDATE tickets SET
       title = COALESCE($2,title), details = COALESCE($3,details), category = COALESCE($4,category),
       priority = COALESCE($5,priority), location_id = COALESCE($6,location_id),
       assignee_id = COALESCE($7,assignee_id), due_date = COALESCE($8,due_date),
       status = COALESCE($9,status), damage_note = COALESCE($10,damage_note), updated_at = now(),
       closed_at = CASE WHEN $9 = 'closed' THEN now() WHEN $9 IS NOT NULL THEN NULL ELSE closed_at END
       ${holdSql}
     WHERE id = $1 RETURNING *`,
    [id, title, details, category, priority, location_id, assignee_id, due_date, status, damage_note])

  if (status && status !== existing.status) {
    await logTicketEvent(id, 'status', { from: existing.status, to: status }, req.user)
    notifyTicketWatchers(id, req.user.id, {
      icon: status === 'closed' ? '✅' : '🔁', title: `${t.code} → ${status.replace('_', ' ')}`,
      body: t.title, link: `/tickets/${id}`,
    })
  }
  if (priority !== null) {
    await logTicketEvent(id, 'priority', { from: existing.priority, to: priority }, req.user)
  }
  if (assignee_id && assignee_id !== existing.assignee_id) {
    const a = await one(`SELECT name FROM users WHERE id = $1`, [assignee_id])
    await logTicketEvent(id, 'assigned', { to: assignee_id, to_name: a?.name }, req.user)
    if (assignee_id !== req.user.id) {
      notify(assignee_id, { icon: '🎫', title: `Assigned to you: ${t.title}`, body: t.code, link: `/tickets/${t.id}` })
    }
  }
  await audit(req.user, status ? `ticket.${status}` : 'ticket.update', 'ticket', id, { code: t.code })
  res.json(t)
}))

// ---- closure approval (FTF: staff without close-perm request, approvers decide) ----
router.post('/:id/request-close', requirePerm('tickets.edit'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const { reason = '' } = req.body || {}
  const t = await one(`SELECT * FROM tickets WHERE id = $1`, [id])
  if (!t) throw httpError(404, 'Ticket not found')
  if (t.status === 'closed') throw httpError(400, 'Already closed')
  if (t.status === 'pending_close') throw httpError(400, 'A closure request is already pending')
  const cr = await one(
    `INSERT INTO closure_requests (ticket_id, requested_by, reason, previous_status) VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, req.user.id, String(reason).slice(0, 400), t.status])
  await q(`UPDATE tickets SET status = 'pending_close', pending_close_by = $2, updated_at = now() WHERE id = $1`, [id, req.user.id])
  await logTicketEvent(id, 'close_requested', { reason: cr.reason }, req.user)
  for (const uid of await usersWithPerm('tickets.approve_close')) {
    if (uid !== req.user.id) {
      notify(uid, { icon: '🙋', title: `${req.user.name} wants to close ${t.code}`, body: reason || t.title, link: `/tickets/${id}` })
    }
  }
  await audit(req.user, 'ticket.close_request', 'ticket', id, { code: t.code })
  res.status(201).json(cr)
}))

router.post('/:id/closure/:rid', requirePerm('tickets.approve_close', 'tickets.close'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const { approve, note = '' } = req.body || {}
  const cr = await one(`SELECT * FROM closure_requests WHERE id = $1 AND ticket_id = $2 AND status = 'pending'`,
    [Number(req.params.rid), id])
  if (!cr) throw httpError(404, 'No pending closure request here')
  const decided = approve ? 'approved' : 'denied'
  await q(`UPDATE closure_requests SET status = $2, decided_by = $3, decision_note = $4, decided_at = now() WHERE id = $1`,
    [cr.id, decided, req.user.id, String(note).slice(0, 400)])
  if (approve) {
    await q(`UPDATE tickets SET status = 'closed', closed_at = now(), pending_close_by = NULL, updated_at = now() WHERE id = $1`, [id])
  } else {
    await q(`UPDATE tickets SET status = $2, pending_close_by = NULL, updated_at = now() WHERE id = $1`, [id, cr.previous_status])
  }
  await logTicketEvent(id, approve ? 'close_approved' : 'close_denied', { note }, req.user)
  const t = await one(`SELECT code, title FROM tickets WHERE id = $1`, [id])
  notify(cr.requested_by, {
    icon: approve ? '✅' : '↩️',
    title: `Closure ${decided}: ${t.code}`,
    body: note || t.title, link: `/tickets/${id}`,
  })
  await audit(req.user, `ticket.close_${decided}`, 'ticket', id, { code: t.code })
  res.json({ ok: true, decided })
}))

// ---- watchers ----
router.post('/:id/watch', ah(async (req, res) => {
  await q(`INSERT INTO ticket_watchers (ticket_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [Number(req.params.id), req.user.id])
  res.json({ watching: true })
}))
router.delete('/:id/watch', ah(async (req, res) => {
  await q(`DELETE FROM ticket_watchers WHERE ticket_id = $1 AND user_id = $2`, [Number(req.params.id), req.user.id])
  res.json({ watching: false })
}))

// ---- ticket tagging ----
router.post('/:id/tags', requirePerm('tickets.tag'), ah(async (req, res) => {
  const { tag_id } = req.body || {}
  if (!tag_id) throw httpError(400, 'tag_id required')
  await q(`INSERT INTO ticket_tags (ticket_id, tag_id, by_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [Number(req.params.id), Number(tag_id), req.user.id])
  res.json({ ok: true })
}))
router.delete('/:id/tags/:tagId', requirePerm('tickets.tag'), ah(async (req, res) => {
  await q(`DELETE FROM ticket_tags WHERE ticket_id = $1 AND tag_id = $2`, [Number(req.params.id), Number(req.params.tagId)])
  res.json({ ok: true })
}))

router.post('/:id/responses', requirePerm('tickets.edit'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const { body, is_internal = false } = req.body || {}
  if (!body || !String(body).trim()) throw httpError(400, 'Write something first')
  const t = await one(`SELECT id, code, title, created_by, assignee_id, first_response_at, public_token FROM tickets WHERE id = $1`, [id])
  if (!t) throw httpError(404, 'Ticket not found')
  if (!is_internal && t.public_token && !req.user.perms['tickets.chat']) {
    throw httpError(403, 'Messaging the submitter needs the “Guest chat” permission — or post an internal note')
  }
  const r = await one(
    `INSERT INTO ticket_responses (ticket_id, user_id, author_name, body, is_internal)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, req.user.id, req.user.name, String(body).trim(), !!is_internal])
  await q(`UPDATE tickets SET updated_at = now(),
           first_response_at = CASE WHEN first_response_at IS NULL AND NOT $2 THEN now() ELSE first_response_at END
           WHERE id = $1`, [id, !!is_internal])
  // The author's own read marker moves too, so their reply doesn't flag unread
  await q(`INSERT INTO ticket_reads (ticket_id, user_id, last_read_at) VALUES ($1,$2,now())
           ON CONFLICT (ticket_id, user_id) DO UPDATE SET last_read_at = now()`, [id, req.user.id])
  for (const uid of new Set([t.created_by, t.assignee_id].filter(u => u && u !== req.user.id))) {
    notify(uid, { icon: '💬', title: `${req.user.name} replied on ${t.code}`, body: String(body).slice(0, 90), link: `/tickets/${id}` })
  }
  notifyTicketWatchers(id, req.user.id, {
    icon: is_internal ? '🔒' : '💬', title: `${req.user.name} on ${t.code}`,
    body: String(body).slice(0, 90), link: `/tickets/${id}`,
  })
  res.status(201).json(r)
}))

// ---- two-way guest chat link (the FTF flow) ----
router.post('/:id/chat-link', requirePerm('tickets.chat'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const t = await one(`SELECT id, public_token FROM tickets WHERE id = $1`, [id])
  if (!t) throw httpError(404, 'Ticket not found')
  let pt = t.public_token
  if (!pt) {
    pt = token(12)
    await q(`UPDATE tickets SET public_token = $2 WHERE id = $1`, [id, pt])
    await logTicketEvent(id, 'chat_link', { action: 'created' }, req.user)
    await audit(req.user, 'ticket.chat_link', 'ticket', id)
  }
  res.json({ public_token: pt, track_path: `/track/${pt}` })
}))

router.delete('/:id/chat-link', requirePerm('tickets.chat'), ah(async (req, res) => {
  const id = Number(req.params.id)
  await q(`UPDATE tickets SET public_token = NULL WHERE id = $1`, [id])
  await logTicketEvent(id, 'chat_link', { action: 'revoked' }, req.user)
  await audit(req.user, 'ticket.chat_revoke', 'ticket', id)
  res.json({ ok: true })
}))

// ---- attachments ----
router.post('/:id/attachments', requirePerm('tickets.edit'), uploadLimiter, upload.array('files', 4), ah(async (req, res) => {
  const id = Number(req.params.id)
  const t = await one(`SELECT id FROM tickets WHERE id = $1`, [id])
  if (!t) throw httpError(404, 'Ticket not found')
  if (!req.files?.length) throw httpError(400, 'No files made it through — photos and PDFs up to 8 MB')
  const out = []
  for (const f of req.files) {
    out.push(await one(
      `INSERT INTO ticket_attachments (ticket_id, filename, original_name, mime, size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, filename, original_name, mime, size, guest, created_at`,
      [id, f.filename, f.originalname, f.mimetype, f.size, req.user.id]))
  }
  await logTicketEvent(id, 'attachment', { count: out.length, names: out.map(a => a.original_name) }, req.user)
  await q(`UPDATE tickets SET updated_at = now() WHERE id = $1`, [id])
  res.status(201).json(out)
}))

router.delete('/attachments/:aid', requirePerm('tickets.edit'), ah(async (req, res) => {
  const a = await one(`DELETE FROM ticket_attachments WHERE id = $1 RETURNING filename, ticket_id`, [Number(req.params.aid)])
  if (!a) throw httpError(404, 'Attachment not found')
  removeFile(a.filename)
  res.json({ ok: true })
}))

router.delete('/:id', requirePerm('tickets.delete'), ah(async (req, res) => {
  const files = await rows(`SELECT filename FROM ticket_attachments WHERE ticket_id = $1`, [Number(req.params.id)])
  const t = await one(`DELETE FROM tickets WHERE id = $1 RETURNING code, title`, [Number(req.params.id)])
  if (!t) throw httpError(404, 'Ticket not found')
  for (const f of files) removeFile(f.filename)
  await audit(req.user, 'ticket.delete', 'ticket', req.params.id, t)
  res.json({ ok: true })
}))

// Called by the scheduler in index.js — spawns tickets whose run date arrived.
export async function runScheduledTickets() {
  const due = await rows(`SELECT * FROM scheduled_tickets WHERE active AND next_run IS NOT NULL AND next_run <= $1`, [todayISO()])
  for (const s of due) {
    const code = await nextTicketCode()
    const t = await one(
      `INSERT INTO tickets (code, title, details, category, priority, location_id, source, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7) RETURNING id`,
      [code, s.title, s.details, s.category, s.priority, s.location_id, addDays(todayISO(), 2)])
    await logTicketEvent(t.id, 'created', { source: 'scheduled' })
    const step = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 }[s.frequency] || 7
    await q(`UPDATE scheduled_tickets SET last_run = $2, next_run = $3 WHERE id = $1`,
      [s.id, todayISO(), addDays(s.next_run, step)])
    console.log(`Scheduled ticket spawned: ${code} — ${s.title}`)
  }
}

// SLA escalation sweep — past-due unresolved tickets escalate exactly once:
// event in the timeline + a nudge to the assignee (or every closure approver).
export async function runTicketSla() {
  const sla = await getSetting('sla', {})
  if (sla.escalate === false) return
  const late = await rows(
    `SELECT * FROM tickets WHERE status IN ('open','in_progress','on_hold') AND due_date < $1 AND escalated_at IS NULL`,
    [todayISO()])
  for (const t of late) {
    await q(`UPDATE tickets SET escalated_at = now() WHERE id = $1`, [t.id])
    await logTicketEvent(t.id, 'escalated', { due: t.due_date })
    const targets = t.assignee_id ? [t.assignee_id] : await usersWithPerm('tickets.approve_close')
    for (const uid of targets) {
      notify(uid, { icon: '⏰', title: `Past due: ${t.code}`, body: t.title, link: `/tickets/${t.id}` })
    }
    console.log(`SLA escalation: ${t.code} (due ${t.due_date})`)
  }
}
