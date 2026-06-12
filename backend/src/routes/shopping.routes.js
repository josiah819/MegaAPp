import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError } from '../lib.js'

export const router = Router()
router.use(requirePerm('shopping.view'))

router.get('/', ah(async (req, res) => {
  const [items, towns, run, lastRun] = await Promise.all([
    rows(`SELECT s.*, t.name AS town_name, u.name AS added_by_name
          FROM shopping_items s LEFT JOIN towns t ON t.id = s.town_id LEFT JOIN users u ON u.id = s.added_by
          WHERE s.completed = false OR s.completed_at > now() - interval '48 hours'
          ORDER BY s.completed, s.created_at DESC`),
    rows(`SELECT * FROM towns ORDER BY name`),
    one(`SELECT r.*, t.name AS town_name, u.name AS runner FROM town_runs r
         LEFT JOIN towns t ON t.id = r.town_id LEFT JOIN users u ON u.id = r.user_id
         WHERE r.ended_at IS NULL ORDER BY r.started_at DESC LIMIT 1`),
    one(`SELECT r.*, t.name AS town_name, u.name AS runner FROM town_runs r
         LEFT JOIN towns t ON t.id = r.town_id LEFT JOIN users u ON u.id = r.user_id
         WHERE r.ended_at IS NOT NULL ORDER BY r.ended_at DESC LIMIT 1`),
  ])
  res.json({ items, towns, active_run: run, last_run: lastRun })
}))

router.post('/items', requirePerm('shopping.edit'), ah(async (req, res) => {
  const { text, category = 'Other', town_id, qty = '', notes = '' } = req.body || {}
  if (!text) throw httpError(400, 'What do you need?')
  const item = await one(
    `INSERT INTO shopping_items (text, category, town_id, qty, notes, added_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [text, category, town_id || null, qty, notes, req.user.id])
  res.status(201).json(item)
}))

router.patch('/items/:id', requirePerm('shopping.edit'), ah(async (req, res) => {
  const { completed, text, category, town_id, qty, notes } = req.body || {}
  const item = await one(
    `UPDATE shopping_items SET
       text = COALESCE($2,text), category = COALESCE($3,category),
       town_id = COALESCE($4,town_id), qty = COALESCE($5,qty), notes = COALESCE($6,notes),
       completed = COALESCE($7,completed),
       completed_at = CASE WHEN $7 = true THEN now() WHEN $7 = false THEN NULL ELSE completed_at END,
       completed_by = CASE WHEN $7 = true THEN $8 WHEN $7 = false THEN NULL ELSE completed_by END
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), text, category, town_id, qty, notes,
      typeof completed === 'boolean' ? completed : null, req.user.id])
  if (!item) throw httpError(404, 'Item not found')
  res.json(item)
}))

router.delete('/items/:id', requirePerm('shopping.edit'), ah(async (req, res) => {
  await q(`DELETE FROM shopping_items WHERE id = $1`, [Number(req.params.id)])
  res.json({ ok: true })
}))

router.post('/towns', requirePerm('shopping.edit'), ah(async (req, res) => {
  const { name } = req.body || {}
  if (!name) throw httpError(400, 'Town needs a name')
  const t = await one(
    `INSERT INTO towns (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING *`, [name])
  res.status(201).json(t)
}))

router.post('/runs', requirePerm('shopping.run'), ah(async (req, res) => {
  const open = await one(`SELECT id FROM town_runs WHERE ended_at IS NULL`)
  if (open) throw httpError(409, 'A town run is already underway')
  const { town_id } = req.body || {}
  const r = await one(`INSERT INTO town_runs (town_id, user_id) VALUES ($1,$2) RETURNING *`,
    [town_id || null, req.user.id])
  await audit(req.user, 'townrun.start', 'shopping', r.id)
  res.status(201).json(r)
}))

router.post('/runs/:id/end', requirePerm('shopping.run'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const run = await one(`SELECT * FROM town_runs WHERE id = $1 AND ended_at IS NULL`, [id])
  if (!run) throw httpError(404, 'No active run found')
  if (run.user_id !== req.user.id && !req.user.perms['signout.manage']) throw httpError(403, 'Only the runner can end this run')
  const bought = await one(
    `SELECT COUNT(*)::int AS n FROM shopping_items WHERE completed AND completed_at >= $1`, [run.started_at])
  const r = await one(`UPDATE town_runs SET ended_at = now(), items_purchased = $2 WHERE id = $1 RETURNING *`, [id, bought.n])
  await audit(req.user, 'townrun.end', 'shopping', id, { items: bought.n })
  res.json(r)
}))
