import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, todayISO } from '../lib.js'

export const router = Router()
router.use(requirePerm('locations.view'))

router.get('/', ah(async (req, res) => {
  const today = todayISO()
  res.json(await rows(
    `SELECT l.*,
       (SELECT COUNT(*)::int FROM tickets t WHERE t.location_id = l.id AND t.status IN ('open','in_progress')) AS open_tickets,
       (SELECT COUNT(*)::int FROM tasks tk JOIN task_statuses s ON s.id = tk.status_id
         WHERE tk.location_id = l.id AND s.kind != 'done') AS open_tasks,
       EXISTS (SELECT 1 FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
         WHERE br.location_id = l.id AND br.date_from <= $1 AND br.date_to >= $1
           AND b.status IN ('confirmed','in_progress')) AS occupied_today
     FROM locations l WHERE l.active ORDER BY l.sort, l.name`, [today]))
}))

router.post('/', requirePerm('locations.manage'), ah(async (req, res) => {
  const { name, category = 'general', zone = '', capacity, beds, notes = '', exclude_from_accom = false, map_ref = '' } = req.body || {}
  if (!name) throw httpError(400, 'The location needs a name')
  const max = await one(`SELECT COALESCE(MAX(sort),0)+1 AS s FROM locations`)
  const l = await one(
    `INSERT INTO locations (name, category, zone, capacity, beds, notes, exclude_from_accom, map_ref, sort)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [name, category, zone, capacity || null, beds || null, notes, !!exclude_from_accom, map_ref, max.s])
  await audit(req.user, 'location.create', 'location', l.id, { name })
  res.status(201).json(l)
}))

router.patch('/:id', ah(async (req, res) => {
  const id = Number(req.params.id)
  const body = req.body || {}
  const conditionKeys = ['condition', 'condition_note', 'occupancy_override']
  const manageKeys = ['name', 'category', 'zone', 'capacity', 'beds', 'notes', 'exclude_from_accom', 'map_ref', 'active']
  const touchesManage = manageKeys.some(k => k in body)
  const touchesCondition = conditionKeys.some(k => k in body)
  if (touchesManage && !req.user.perms['locations.manage']) throw httpError(403, 'You can update conditions, not the registry')
  if (touchesCondition && !req.user.perms['locations.edit'] && !req.user.perms['locations.manage']) {
    throw httpError(403, 'You do not have permission for that')
  }
  const l = await one(
    `UPDATE locations SET
       name = COALESCE($2, name), category = COALESCE($3, category), zone = COALESCE($4, zone),
       capacity = COALESCE($5, capacity), beds = COALESCE($6, beds), notes = COALESCE($7, notes),
       exclude_from_accom = COALESCE($8, exclude_from_accom), map_ref = COALESCE($9, map_ref), active = COALESCE($10, active),
       condition = COALESCE($11, condition), condition_note = COALESCE($12, condition_note),
       occupancy_override = COALESCE($13, occupancy_override),
       condition_updated_at = CASE WHEN $11 IS NOT NULL OR $12 IS NOT NULL THEN now() ELSE condition_updated_at END,
       condition_updated_by = CASE WHEN $11 IS NOT NULL OR $12 IS NOT NULL THEN $14 ELSE condition_updated_by END
     WHERE id = $1 RETURNING *`,
    [id, body.name, body.category, body.zone, body.capacity, body.beds, body.notes,
      'exclude_from_accom' in body ? !!body.exclude_from_accom : null, body.map_ref,
      'active' in body ? !!body.active : null,
      body.condition, body.condition_note, body.occupancy_override, req.user.name])
  if (!l) throw httpError(404, 'Location not found')
  await audit(req.user, touchesCondition && !touchesManage ? 'location.condition' : 'location.update', 'location', id,
    { name: l.name, ...(body.condition ? { condition: body.condition } : {}) })
  res.json(l)
}))
