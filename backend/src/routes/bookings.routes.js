import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, todayISO, addDays } from '../lib.js'

export const router = Router()
router.use(requirePerm('bookings.view'))

router.get('/', ah(async (req, res) => {
  const { status, q: qs, when } = req.query
  const where = []
  const params = []
  if (status) { params.push(status); where.push(`b.status = $${params.length}`) }
  if (qs) { params.push(`%${qs}%`); where.push(`(b.name ILIKE $${params.length} OR b.code ILIKE $${params.length})`) }
  if (when === 'upcoming') { params.push(todayISO()); where.push(`b.end_date >= $${params.length}`) }
  if (when === 'past') { params.push(todayISO()); where.push(`b.end_date < $${params.length}`) }
  res.json(await rows(
    `SELECT b.*, c.name AS customer_name,
            (SELECT COUNT(*)::int FROM booking_rooms br WHERE br.booking_id = b.id) AS rooms
     FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY b.start_date ${when === 'past' ? 'DESC' : 'ASC'} LIMIT 300`, params))
}))

router.get('/calendar', ah(async (req, res) => {
  const start = req.query.start || addDays(todayISO(), -7)
  const end = req.query.end || addDays(todayISO(), 35)
  res.json(await rows(
    `SELECT b.id, b.code, b.name, b.status, b.segment, b.start_date, b.end_date, b.headcount, c.name AS customer_name
     FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.start_date <= $2 AND b.end_date >= $1 AND b.status != 'cancelled'
     ORDER BY b.start_date`, [start, end]))
}))

router.get('/customers', ah(async (req, res) => {
  res.json(await rows(`SELECT * FROM customers ORDER BY name`))
}))

router.post('/customers', requirePerm('bookings.edit'), ah(async (req, res) => {
  const { name, type = 'organization', email = '', phone = '' } = req.body || {}
  if (!name) throw httpError(400, 'Customer needs a name')
  const c = await one(`INSERT INTO customers (name, type, email, phone) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, type, email, phone])
  await audit(req.user, 'customer.create', 'customer', c.id, { name })
  res.status(201).json(c)
}))

router.get('/:id', ah(async (req, res) => {
  const id = Number(req.params.id)
  const booking = await one(
    `SELECT b.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id WHERE b.id = $1`, [id])
  if (!booking) throw httpError(404, 'Booking not found')
  const [roomsList, tasks] = await Promise.all([
    rows(`SELECT br.*, l.name AS location_name, l.beds FROM booking_rooms br
          JOIN locations l ON l.id = br.location_id WHERE br.booking_id = $1 ORDER BY l.sort`, [id]),
    rows(`SELECT t.id, t.title, t.due, s.name AS status_name, s.kind FROM tasks t
          LEFT JOIN task_statuses s ON s.id = t.status_id WHERE t.booking_id = $1 ORDER BY t.due NULLS LAST`, [id]),
  ])
  res.json({ ...booking, rooms: roomsList, tasks })
}))

async function nextCode() {
  const r = await one(`SELECT code FROM bookings WHERE code LIKE 'BK-%' ORDER BY id DESC LIMIT 1`)
  const n = r ? parseInt(r.code.slice(3), 10) + 1 : 1001
  return `BK-${isNaN(n) ? Date.now() % 100000 : n}`
}

router.post('/', requirePerm('bookings.edit'), ah(async (req, res) => {
  const { name, customer_id, status = 'tentative', segment = 'retreat', start_date, end_date, headcount = 0, value = 0, notes = '', dietary = '' } = req.body || {}
  if (!name || !start_date || !end_date) throw httpError(400, 'Name and dates are required')
  if (end_date < start_date) throw httpError(400, 'The end date is before the start date')
  const b = await one(
    `INSERT INTO bookings (code, name, customer_id, status, segment, start_date, end_date, headcount, value, notes, dietary, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [await nextCode(), name, customer_id || null, status, segment, start_date, end_date, headcount, value, notes, dietary, req.user.id])
  await audit(req.user, 'booking.create', 'booking', b.id, { code: b.code, name })
  res.status(201).json(b)
}))

router.patch('/:id', requirePerm('bookings.edit'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const { name, customer_id, status, segment, start_date, end_date, headcount, value, notes, dietary } = req.body || {}
  const b = await one(
    `UPDATE bookings SET
       name = COALESCE($2, name), customer_id = COALESCE($3, customer_id), status = COALESCE($4, status),
       segment = COALESCE($5, segment), start_date = COALESCE($6, start_date), end_date = COALESCE($7, end_date),
       headcount = COALESCE($8, headcount), value = COALESCE($9, value), notes = COALESCE($10, notes),
       dietary = COALESCE($11, dietary), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name, customer_id, status, segment, start_date, end_date, headcount, value, notes, dietary])
  if (!b) throw httpError(404, 'Booking not found')
  await audit(req.user, 'booking.update', 'booking', id, { changed: Object.keys(req.body || {}) })
  res.json(b)
}))

router.delete('/:id', requirePerm('bookings.manage'), ah(async (req, res) => {
  const b = await one(`DELETE FROM bookings WHERE id = $1 RETURNING code, name`, [Number(req.params.id)])
  if (!b) throw httpError(404, 'Booking not found')
  await audit(req.user, 'booking.delete', 'booking', req.params.id, b)
  res.json({ ok: true })
}))
