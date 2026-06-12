import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError } from '../lib.js'
import { upload } from '../upload.js'
import { uploadLimiter } from '../security.js'

/* Lost & Found — the front-desk drawer, digitized (a HotSOS/Quore staple).
   Found items get a photo + storage spot; lost reports wait to be matched.
   Resolution states: claimed, returned, donated, disposed. */

export const router = Router()
router.use(requirePerm('lostfound.view'))

router.get('/', ah(async (req, res) => {
  const { status, kind, q: qs } = req.query
  const where = ['TRUE'], params = []
  if (status === 'open') where.push(`i.status = 'open'`)
  else if (status === 'resolved') where.push(`i.status != 'open'`)
  else if (status) { params.push(status); where.push(`i.status = $${params.length}`) }
  if (kind) { params.push(kind); where.push(`i.kind = $${params.length}`) }
  if (qs) { params.push(`%${qs}%`); where.push(`i.description ILIKE $${params.length}`) }
  res.json(await rows(
    `SELECT i.*, l.name AS location_name, u.name AS logged_by
     FROM lf_items i LEFT JOIN locations l ON l.id = i.location_id LEFT JOIN users u ON u.id = i.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY (i.status != 'open'), i.date DESC, i.id DESC LIMIT 300`, params))
}))

router.post('/', requirePerm('lostfound.manage'), uploadLimiter, upload.single('photo'), ah(async (req, res) => {
  const { kind = 'found', date, location_id, category = 'other', description, stored_at = '', contact = '' } = req.body || {}
  if (!description?.trim()) throw httpError(400, 'Describe the item')
  const i = await one(
    `INSERT INTO lf_items (kind, date, location_id, category, description, photo, stored_at, contact, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [kind === 'lost' ? 'lost' : 'found', date || null, location_id || null, category,
      description.trim(), req.file?.filename || '', stored_at, contact, req.user.id])
  await audit(req.user, 'lostfound.log', 'lostfound', i.id, { kind: i.kind, description: i.description.slice(0, 60) })
  res.status(201).json(i)
}))

router.patch('/:id', requirePerm('lostfound.manage'), ah(async (req, res) => {
  const { description, category, stored_at, contact, status, resolution_note, location_id, date } = req.body || {}
  const i = await one(
    `UPDATE lf_items SET
       description = COALESCE($2,description), category = COALESCE($3,category), stored_at = COALESCE($4,stored_at),
       contact = COALESCE($5,contact), status = COALESCE($6,status), resolution_note = COALESCE($7,resolution_note),
       location_id = COALESCE($8,location_id), date = COALESCE($9,date),
       resolved_at = CASE WHEN $6 IS NOT NULL AND $6 != 'open' THEN now() WHEN $6 = 'open' THEN NULL ELSE resolved_at END
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), description, category, stored_at, contact, status, resolution_note, location_id, date])
  if (!i) throw httpError(404, 'Item not found')
  if (status) await audit(req.user, `lostfound.${status}`, 'lostfound', i.id)
  res.json(i)
}))

router.delete('/:id', requirePerm('lostfound.manage'), ah(async (req, res) => {
  await q(`DELETE FROM lf_items WHERE id = $1`, [Number(req.params.id)])
  res.json({ ok: true })
}))
