import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, notify } from '../lib.js'

export const router = Router()

/* ============================== 1:1 meetings ==============================
   Hard privacy rule: a 1:1 belongs to its two participants. No role — not
   even admin — can read someone else's agenda through the API. */

const oo = requirePerm('oneonones.use')

async function myMeeting(id, userId) {
  const m = await one(
    `SELECT m.*, a.name AS a_name, a.color AS a_color, b.name AS b_name, b.color AS b_color
     FROM one_on_ones m JOIN users a ON a.id = m.a_id JOIN users b ON b.id = m.b_id
     WHERE m.id = $1`, [Number(id)])
  if (!m || (m.a_id !== userId && m.b_id !== userId)) throw httpError(404, '1:1 not found')
  return m
}

router.get('/oneonones', oo, ah(async (req, res) => {
  const ms = await rows(
    `SELECT m.*, a.name AS a_name, a.color AS a_color, b.name AS b_name, b.color AS b_color,
       (SELECT COUNT(*)::int FROM oo_items i WHERE i.meeting_id = m.id AND NOT i.done) AS open_items
     FROM one_on_ones m JOIN users a ON a.id = m.a_id JOIN users b ON b.id = m.b_id
     WHERE m.a_id = $1 OR m.b_id = $1
     ORDER BY (m.status = 'done'), m.date NULLS LAST, m.created_at DESC`, [req.user.id])
  res.json(ms)
}))

router.post('/oneonones', oo, ah(async (req, res) => {
  const { with_id, date, recurrence = 'biweekly' } = req.body || {}
  const other = await one(`SELECT id, name FROM users WHERE id = $1 AND active`, [Number(with_id)])
  if (!other || other.id === req.user.id) throw httpError(400, 'Pick who the 1:1 is with')
  const m = await one(
    `INSERT INTO one_on_ones (a_id, b_id, date, recurrence, created_by) VALUES ($1,$2,$3,$4,$1) RETURNING *`,
    [req.user.id, other.id, date || null, recurrence])
  notify(other.id, { icon: '🤝', title: `${req.user.name} set up a 1:1 with you`, body: '', link: '/growth' })
  await audit(req.user, 'oneonone.create', 'oneonone', m.id)
  res.status(201).json(m)
}))

router.get('/oneonones/:id', oo, ah(async (req, res) => {
  const m = await myMeeting(req.params.id, req.user.id)
  m.items = await rows(`SELECT * FROM oo_items WHERE meeting_id = $1 ORDER BY kind DESC, ord, id`, [m.id])
  res.json(m)
}))

router.patch('/oneonones/:id', oo, ah(async (req, res) => {
  const m = await myMeeting(req.params.id, req.user.id)
  const { date, recurrence, shared_notes, summary, status } = req.body || {}
  const out = await one(
    `UPDATE one_on_ones SET
       date = COALESCE($2,date), recurrence = COALESCE($3,recurrence),
       shared_notes = COALESCE($4,shared_notes), summary = COALESCE($5,summary),
       status = COALESCE($6,status), ended_at = CASE WHEN $6 = 'done' THEN now() ELSE ended_at END
     WHERE id = $1 RETURNING *`,
    [m.id, date, recurrence, shared_notes, summary, status])
  res.json(out)
}))

// Wrap up and roll forward: close this meeting, open the next one with the
// unfinished talking points and action items carried over.
router.post('/oneonones/:id/next', oo, ah(async (req, res) => {
  const m = await myMeeting(req.params.id, req.user.id)
  await q(`UPDATE one_on_ones SET status = 'done', ended_at = now() WHERE id = $1`, [m.id])
  const stepDays = { weekly: 7, biweekly: 14, monthly: 30 }[m.recurrence] || 14
  const next = await one(
    `INSERT INTO one_on_ones (a_id, b_id, date, recurrence, created_by)
     VALUES ($1,$2, COALESCE($3::timestamptz, now()) + ($4 || ' days')::interval, $5, $6) RETURNING *`,
    [m.a_id, m.b_id, m.date, String(stepDays), m.recurrence, req.user.id])
  await q(
    `INSERT INTO oo_items (meeting_id, author_id, text, kind, ord)
     SELECT $2, author_id, text, kind, ord FROM oo_items WHERE meeting_id = $1 AND NOT done`,
    [m.id, next.id])
  const otherId = m.a_id === req.user.id ? m.b_id : m.a_id
  notify(otherId, { icon: '🤝', title: `${req.user.name} wrapped up your 1:1`, body: 'Open points rolled into the next one', link: '/growth' })
  res.status(201).json(next)
}))

router.post('/oneonones/:id/items', oo, ah(async (req, res) => {
  const m = await myMeeting(req.params.id, req.user.id)
  const { text, kind = 'talking' } = req.body || {}
  if (!text || !String(text).trim()) throw httpError(400, 'Write the point first')
  const it = await one(
    `INSERT INTO oo_items (meeting_id, author_id, text, kind, ord)
     VALUES ($1,$2,$3,$4, COALESCE((SELECT MAX(ord) FROM oo_items WHERE meeting_id = $1),0) + 1) RETURNING *`,
    [m.id, req.user.id, String(text).trim(), kind === 'action' ? 'action' : 'talking'])
  res.status(201).json(it)
}))

router.patch('/oo-items/:id', oo, ah(async (req, res) => {
  const it = await one(`SELECT i.*, m.a_id, m.b_id FROM oo_items i JOIN one_on_ones m ON m.id = i.meeting_id WHERE i.id = $1`,
    [Number(req.params.id)])
  if (!it || (it.a_id !== req.user.id && it.b_id !== req.user.id)) throw httpError(404, 'Item not found')
  const { text, done } = req.body || {}
  const out = await one(
    `UPDATE oo_items SET text = COALESCE($2,text), done = COALESCE($3,done) WHERE id = $1 RETURNING *`,
    [it.id, text, typeof done === 'boolean' ? done : null])
  res.json(out)
}))

router.delete('/oo-items/:id', oo, ah(async (req, res) => {
  const it = await one(`SELECT i.id, m.a_id, m.b_id FROM oo_items i JOIN one_on_ones m ON m.id = i.meeting_id WHERE i.id = $1`,
    [Number(req.params.id)])
  if (!it || (it.a_id !== req.user.id && it.b_id !== req.user.id)) throw httpError(404, 'Item not found')
  await q(`DELETE FROM oo_items WHERE id = $1`, [it.id])
  res.json({ ok: true })
}))

/* ============================== goals ==============================
   Org and team goals are visible to everyone with the permission; you can
   always see and check in on your own. */

const goals = requirePerm('goals.use')

router.get('/goals', goals, ah(async (req, res) => {
  const gs = await rows(
    `SELECT g.*, u.name AS owner_name, u.color AS owner_color,
       (SELECT COUNT(*)::int FROM goal_checkins c WHERE c.goal_id = g.id) AS checkins
     FROM goals g LEFT JOIN users u ON u.id = g.owner_id
     WHERE g.type IN ('org','team') OR g.owner_id = $1
     ORDER BY array_position(ARRAY['org','team','individual'], g.type), (g.status = 'done'), g.due NULLS LAST`,
    [req.user.id])
  res.json(gs)
}))

router.post('/goals', goals, ah(async (req, res) => {
  const { title, descr = '', type = 'individual', dept = '', parent_id, due, krs = [] } = req.body || {}
  if (!title) throw httpError(400, 'Give the goal a title')
  const t = ['org', 'team', 'individual'].includes(type) ? type : 'individual'
  const g = await one(
    `INSERT INTO goals (title, descr, type, owner_id, dept, parent_id, due, krs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title, descr, t, req.user.id, dept, parent_id || null, due || null, JSON.stringify(krs)])
  await audit(req.user, 'goal.create', 'goal', g.id, { title, type: t })
  res.status(201).json(g)
}))

async function myGoal(id, userId) {
  const g = await one(`SELECT * FROM goals WHERE id = $1`, [Number(id)])
  if (!g) throw httpError(404, 'Goal not found')
  if (g.owner_id !== userId && g.type === 'individual') throw httpError(403, 'Only the owner can change this goal')
  return g
}

router.patch('/goals/:id', goals, ah(async (req, res) => {
  await myGoal(req.params.id, req.user.id)
  const { title, descr, dept, due, status, progress, krs } = req.body || {}
  const g = await one(
    `UPDATE goals SET
       title = COALESCE($2,title), descr = COALESCE($3,descr), dept = COALESCE($4,dept),
       due = COALESCE($5,due), status = COALESCE($6,status), progress = COALESCE($7,progress),
       krs = COALESCE($8,krs), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), title, descr, dept, due, status,
      typeof progress === 'number' ? Math.min(100, Math.max(0, progress)) : null,
      krs ? JSON.stringify(krs) : null])
  res.json(g)
}))

router.post('/goals/:id/checkin', goals, ah(async (req, res) => {
  const g = await one(`SELECT id, title, owner_id FROM goals WHERE id = $1`, [Number(req.params.id)])
  if (!g) throw httpError(404, 'Goal not found')
  const { progress, status, comment = '' } = req.body || {}
  const p = Math.min(100, Math.max(0, Number(progress) || 0))
  const st = ['on', 'behind', 'risk', 'done'].includes(status) ? status : 'on'
  const c = await one(
    `INSERT INTO goal_checkins (goal_id, by_id, progress, status, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [g.id, req.user.id, p, st, String(comment).slice(0, 600)])
  await q(`UPDATE goals SET progress = $2, status = $3, updated_at = now() WHERE id = $1`, [g.id, p, st])
  if (g.owner_id && g.owner_id !== req.user.id) {
    notify(g.owner_id, { icon: '🎯', title: `${req.user.name} checked in on “${g.title}”`, body: `${p}% · ${st}`, link: '/growth' })
  }
  res.status(201).json(c)
}))

router.get('/goals/:id/checkins', goals, ah(async (req, res) => {
  res.json(await rows(
    `SELECT c.*, u.name AS by_name, u.color AS by_color FROM goal_checkins c
     LEFT JOIN users u ON u.id = c.by_id WHERE c.goal_id = $1 ORDER BY c.created_at DESC LIMIT 30`,
    [Number(req.params.id)]))
}))

router.delete('/goals/:id', goals, ah(async (req, res) => {
  const g = await myGoal(req.params.id, req.user.id)
  if (g.type !== 'individual' && g.owner_id !== req.user.id) throw httpError(403, 'Only the creator can delete an org or team goal')
  await q(`DELETE FROM goals WHERE id = $1`, [g.id])
  await audit(req.user, 'goal.delete', 'goal', g.id, { title: g.title })
  res.json({ ok: true })
}))

/* ============================== feedback ==============================
   Requests: I ask someone for feedback on a prompt; they answer or decline.
   Given: praise or growth notes sent directly, private to the recipient. */

const fb = requirePerm('feedback.use')

router.get('/feedback', fb, ah(async (req, res) => {
  const [inbox, requested, received] = await Promise.all([
    rows(`SELECT f.*, u.name AS requester_name, u.color AS requester_color FROM feedback f
          JOIN users u ON u.id = f.requester_id
          WHERE f.kind = 'request' AND f.responder_id = $1 ORDER BY (f.status != 'pending'), f.created_at DESC LIMIT 60`,
      [req.user.id]),
    rows(`SELECT f.*, u.name AS responder_name, u.color AS responder_color FROM feedback f
          JOIN users u ON u.id = f.responder_id
          WHERE f.kind = 'request' AND f.requester_id = $1 ORDER BY f.created_at DESC LIMIT 60`,
      [req.user.id]),
    rows(`SELECT f.*, u.name AS from_name, u.color AS from_color FROM feedback f
          JOIN users u ON u.id = f.from_id
          WHERE f.kind = 'given' AND f.to_id = $1 ORDER BY f.created_at DESC LIMIT 60`,
      [req.user.id]),
  ])
  res.json({ inbox, requested, received })
}))

router.post('/feedback/request', fb, ah(async (req, res) => {
  const { responder_id, prompt } = req.body || {}
  const other = await one(`SELECT id, name FROM users WHERE id = $1 AND active`, [Number(responder_id)])
  if (!other || other.id === req.user.id) throw httpError(400, 'Pick who you want feedback from')
  if (!prompt || !String(prompt).trim()) throw httpError(400, 'What do you want feedback on?')
  const f = await one(
    `INSERT INTO feedback (kind, requester_id, responder_id, prompt) VALUES ('request',$1,$2,$3) RETURNING *`,
    [req.user.id, other.id, String(prompt).trim().slice(0, 400)])
  notify(other.id, { icon: '🪞', title: `${req.user.name} asked for your feedback`, body: f.prompt.slice(0, 90), link: '/growth' })
  res.status(201).json(f)
}))

router.post('/feedback/give', fb, ah(async (req, res) => {
  const { to_id, fb_type = 'praise', message } = req.body || {}
  const other = await one(`SELECT id, name FROM users WHERE id = $1 AND active`, [Number(to_id)])
  if (!other || other.id === req.user.id) throw httpError(400, 'Pick who this is for')
  if (!message || !String(message).trim()) throw httpError(400, 'Write the feedback first')
  const f = await one(
    `INSERT INTO feedback (kind, from_id, to_id, fb_type, message, status)
     VALUES ('given',$1,$2,$3,$4,'answered') RETURNING *`,
    [req.user.id, other.id, fb_type === 'growth' ? 'growth' : 'praise', String(message).trim().slice(0, 1200)])
  notify(other.id, { icon: fb_type === 'growth' ? '🌱' : '⭐', title: `${req.user.name} left you ${fb_type === 'growth' ? 'growth feedback' : 'praise'}`, body: '', link: '/growth' })
  res.status(201).json(f)
}))

router.post('/feedback/:id/respond', fb, ah(async (req, res) => {
  const f = await one(`SELECT * FROM feedback WHERE id = $1 AND kind = 'request' AND responder_id = $2`,
    [Number(req.params.id), req.user.id])
  if (!f) throw httpError(404, 'Request not found')
  const { response, decline } = req.body || {}
  if (decline) {
    const out = await one(`UPDATE feedback SET status = 'declined', responded_at = now() WHERE id = $1 RETURNING *`, [f.id])
    notify(f.requester_id, { icon: '🪞', title: `${req.user.name} passed on your feedback request`, body: '', link: '/growth' })
    return res.json(out)
  }
  if (!response || !String(response).trim()) throw httpError(400, 'Write your feedback first')
  const out = await one(
    `UPDATE feedback SET status = 'answered', response = $2, responded_at = now() WHERE id = $1 RETURNING *`,
    [f.id, String(response).trim().slice(0, 1200)])
  notify(f.requester_id, { icon: '🪞', title: `${req.user.name} answered your feedback request`, body: '', link: '/growth' })
  res.json(out)
}))
