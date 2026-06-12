import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError } from '../lib.js'

/* Message of the Day (ported from FTF) — sign-in announcements that follow
   each person until they dismiss them. Great for "the water is off in
   Maplewood until 2pm" mornings. */

export const router = Router()

// Active messages this person hasn't dismissed — the Shell shows these as a popup.
router.get('/', ah(async (req, res) => {
  res.json(await rows(
    `SELECT m.id, m.title, m.body, m.created_at, u.name AS author
     FROM motd_messages m LEFT JOIN users u ON u.id = m.created_by
     WHERE m.active AND NOT EXISTS (
       SELECT 1 FROM motd_dismissals d WHERE d.message_id = m.id AND d.user_id = $1)
     ORDER BY m.created_at DESC`, [req.user.id]))
}))

router.post('/:id/dismiss', ah(async (req, res) => {
  await q(`INSERT INTO motd_dismissals (message_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [Number(req.params.id), req.user.id])
  res.json({ ok: true })
}))

// ---- management ----
router.get('/all', requirePerm('motd.manage'), ah(async (req, res) => {
  res.json(await rows(
    `SELECT m.*, u.name AS author,
       (SELECT COUNT(*)::int FROM motd_dismissals d WHERE d.message_id = m.id) AS seen_by
     FROM motd_messages m LEFT JOIN users u ON u.id = m.created_by ORDER BY m.created_at DESC LIMIT 50`))
}))

router.post('/', requirePerm('motd.manage'), ah(async (req, res) => {
  const { title, body = '' } = req.body || {}
  if (!title?.trim()) throw httpError(400, 'The message needs a title')
  const m = await one(`INSERT INTO motd_messages (title, body, created_by) VALUES ($1,$2,$3) RETURNING *`,
    [title.trim().slice(0, 140), String(body).slice(0, 2000), req.user.id])
  await audit(req.user, 'motd.create', 'motd', m.id, { title: m.title })
  res.status(201).json(m)
}))

router.patch('/:id', requirePerm('motd.manage'), ah(async (req, res) => {
  const { title, body, active } = req.body || {}
  const m = await one(
    `UPDATE motd_messages SET title = COALESCE($2,title), body = COALESCE($3,body), active = COALESCE($4,active)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), title, body, 'active' in (req.body || {}) ? !!active : null])
  if (!m) throw httpError(404, 'Message not found')
  res.json(m)
}))

router.delete('/:id', requirePerm('motd.manage'), ah(async (req, res) => {
  await q(`DELETE FROM motd_messages WHERE id = $1`, [Number(req.params.id)])
  await audit(req.user, 'motd.delete', 'motd', req.params.id)
  res.json({ ok: true })
}))
