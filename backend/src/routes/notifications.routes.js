import { Router } from 'express'
import { q, rows } from '../db.js'
import { ah } from '../lib.js'

export const router = Router()

router.get('/', ah(async (req, res) => {
  res.json(await rows(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40`, [req.user.id]))
}))

router.post('/:id/read', ah(async (req, res) => {
  await q(`UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`, [Number(req.params.id), req.user.id])
  res.json({ ok: true })
}))

router.post('/read-all', ah(async (req, res) => {
  await q(`UPDATE notifications SET read = true WHERE user_id = $1`, [req.user.id])
  res.json({ ok: true })
}))
