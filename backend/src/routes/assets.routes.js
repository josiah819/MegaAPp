import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError } from '../lib.js'

export const router = Router()
router.use(requirePerm('assets.view'))

router.get('/', ah(async (req, res) => {
  res.json(await rows(
    `SELECT a.*, l.name AS location_name,
       (SELECT COUNT(*)::int FROM tickets t WHERE t.asset_id = a.id AND t.status != 'closed') AS open_tickets,
       (SELECT MAX(date) FROM asset_logs g WHERE g.asset_id = a.id) AS last_service
     FROM assets a LEFT JOIN locations l ON l.id = a.location_id ORDER BY a.name`))
}))

router.get('/:id', ah(async (req, res) => {
  const a = await one(
    `SELECT a.*, l.name AS location_name FROM assets a
     LEFT JOIN locations l ON l.id = a.location_id WHERE a.id = $1`, [Number(req.params.id)])
  if (!a) throw httpError(404, 'Asset not found')
  a.logs = await rows(
    `SELECT g.*, u.name AS by_name FROM asset_logs g LEFT JOIN users u ON u.id = g.by_id
     WHERE g.asset_id = $1 ORDER BY g.date DESC, g.created_at DESC LIMIT 50`, [a.id])
  a.tickets = await rows(
    `SELECT id, code, title, status, created_at FROM tickets WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 10`, [a.id])
  res.json(a)
}))

router.post('/', requirePerm('assets.edit'), ah(async (req, res) => {
  const { name, category = 'equipment', location_id, status = 'operational', serial = '', notes = '', next_service, purchase_date, value } = req.body || {}
  if (!name) throw httpError(400, 'The asset needs a name')
  const a = await one(
    `INSERT INTO assets (name, category, location_id, status, serial, notes, next_service, purchase_date, value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [name, category, location_id || null, status, serial, notes, next_service || null, purchase_date || null, value || null])
  await audit(req.user, 'asset.create', 'asset', a.id, { name })
  res.status(201).json(a)
}))

router.patch('/:id', requirePerm('assets.edit'), ah(async (req, res) => {
  const { name, category, location_id, status, serial, notes, next_service, purchase_date, value } = req.body || {}
  const a = await one(
    `UPDATE assets SET name = COALESCE($2,name), category = COALESCE($3,category),
       location_id = COALESCE($4,location_id), status = COALESCE($5,status),
       serial = COALESCE($6,serial), notes = COALESCE($7,notes),
       next_service = COALESCE($8,next_service), purchase_date = COALESCE($9,purchase_date), value = COALESCE($10,value)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, category, location_id, status, serial, notes, next_service, purchase_date, value])
  if (!a) throw httpError(404, 'Asset not found')
  await audit(req.user, 'asset.update', 'asset', a.id, { name: a.name, status: a.status })
  res.json(a)
}))

// Service history — every repair, inspection, and winterization on record.
router.post('/:id/logs', requirePerm('assets.edit'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const a = await one(`SELECT id, name FROM assets WHERE id = $1`, [id])
  if (!a) throw httpError(404, 'Asset not found')
  const { kind = 'service', notes = '', cost, date, next_service } = req.body || {}
  const g = await one(
    `INSERT INTO asset_logs (asset_id, kind, notes, cost, date, by_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [id, kind, notes, cost || null, date || new Date().toISOString().slice(0, 10), req.user.id])
  if (next_service) await q(`UPDATE assets SET next_service = $2 WHERE id = $1`, [id, next_service])
  await audit(req.user, 'asset.log', 'asset', id, { name: a.name, kind })
  res.status(201).json(g)
}))

router.delete('/logs/:lid', requirePerm('assets.edit'), ah(async (req, res) => {
  await q(`DELETE FROM asset_logs WHERE id = $1`, [Number(req.params.lid)])
  res.json({ ok: true })
}))

router.delete('/:id', requirePerm('assets.edit'), ah(async (req, res) => {
  const a = await one(`DELETE FROM assets WHERE id = $1 RETURNING name`, [Number(req.params.id)])
  if (!a) throw httpError(404, 'Asset not found')
  await audit(req.user, 'asset.delete', 'asset', req.params.id, a)
  res.json({ ok: true })
}))
