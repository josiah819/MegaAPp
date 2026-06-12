import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, todayISO, addDays } from '../lib.js'

export const router = Router()
router.use(requirePerm('bookings.catering'))

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

// The kitchen sheet: services for a date range plus the dietary rollup the
// kitchen actually cooks from.
router.get('/', ah(async (req, res) => {
  const start = req.query.start || todayISO()
  const end = req.query.end || addDays(start, 6)
  const services = await rows(
    `SELECT m.*, b.name AS booking_name, b.code AS booking_code, b.headcount AS booking_headcount,
       l.name AS location_name
     FROM meal_services m JOIN bookings b ON b.id = m.booking_id
     LEFT JOIN locations l ON l.id = m.location_id
     WHERE m.date >= $1 AND m.date <= $2 AND b.status != 'cancelled'
     ORDER BY m.date, array_position(ARRAY['breakfast','lunch','dinner','snack'], m.meal), m.time`,
    [start, end])
  const dietary = await rows(
    `SELECT b.name, b.code, b.headcount, b.dietary FROM bookings b
     WHERE b.dietary != '' AND b.status IN ('confirmed','in_progress')
       AND b.start_date <= $2 AND b.end_date >= $1
     ORDER BY b.start_date`, [start, end])
  res.json({ start, end, services, dietary, meals: MEALS })
}))

router.get('/booking/:id', ah(async (req, res) => {
  res.json(await rows(
    `SELECT m.*, l.name AS location_name FROM meal_services m
     LEFT JOIN locations l ON l.id = m.location_id
     WHERE m.booking_id = $1 ORDER BY m.date, array_position(ARRAY['breakfast','lunch','dinner','snack'], m.meal)`,
    [Number(req.params.id)]))
}))

router.post('/', ah(async (req, res) => {
  const { booking_id, date, meal = 'dinner', time = '', headcount, menu = '', location_id, dietary = '', notes = '' } = req.body || {}
  if (!booking_id || !date) throw httpError(400, 'Pick the group and the date')
  if (!MEALS.includes(meal)) throw httpError(400, 'Unknown meal')
  const b = await one(`SELECT id, headcount FROM bookings WHERE id = $1`, [booking_id])
  if (!b) throw httpError(404, 'Booking not found')
  const m = await one(
    `INSERT INTO meal_services (booking_id, date, meal, time, headcount, menu, location_id, dietary, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [booking_id, date, meal, time, headcount ?? b.headcount ?? 0, menu, location_id || null, dietary, notes])
  await audit(req.user, 'meal.create', 'booking', booking_id, { date, meal })
  res.status(201).json(m)
}))

router.patch('/:id', ah(async (req, res) => {
  const { date, meal, time, headcount, menu, location_id, dietary, notes } = req.body || {}
  if (meal && !MEALS.includes(meal)) throw httpError(400, 'Unknown meal')
  const m = await one(
    `UPDATE meal_services SET
       date = COALESCE($2,date), meal = COALESCE($3,meal), time = COALESCE($4,time),
       headcount = COALESCE($5,headcount), menu = COALESCE($6,menu),
       location_id = COALESCE($7,location_id), dietary = COALESCE($8,dietary), notes = COALESCE($9,notes)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), date, meal, time, headcount, menu, location_id, dietary, notes])
  if (!m) throw httpError(404, 'Meal service not found')
  res.json(m)
}))

router.delete('/:id', ah(async (req, res) => {
  await q(`DELETE FROM meal_services WHERE id = $1`, [Number(req.params.id)])
  res.json({ ok: true })
}))
