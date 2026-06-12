import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, todayISO, addDays, weekStart } from '../lib.js'

export const router = Router()

// Weekly grid: lodging locations × 7 days, with booking blocks laid in.
export async function buildWeek(startParam) {
  const start = weekStart(startParam || todayISO())
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const end = days[6]
  const lodging = await rows(
    `SELECT id, name, zone, beds, capacity, condition, condition_note FROM locations
     WHERE active AND NOT exclude_from_accom ORDER BY sort, name`)
  const blocks = await rows(
    `SELECT br.id, br.location_id, br.date_from, br.date_to, b.id AS booking_id, b.code, b.name, b.status, b.headcount
     FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
     WHERE br.date_from <= $2 AND br.date_to >= $1 AND b.status != 'cancelled'`, [start, end])
  const byLoc = new Map()
  for (const bl of blocks) {
    if (!byLoc.has(bl.location_id)) byLoc.set(bl.location_id, [])
    byLoc.get(bl.location_id).push(bl)
  }
  return {
    start, days,
    rows: lodging.map(l => ({ ...l, blocks: byLoc.get(l.id) || [] })),
    totals: {
      beds: lodging.reduce((a, l) => a + (l.beds || 0), 0),
      groups: new Set(blocks.map(b => b.booking_id)).size,
    },
  }
}

router.get('/', requirePerm('accommodation.view'), ah(async (req, res) => {
  res.json(await buildWeek(req.query.start))
}))

// The housekeeping turnover board (the ALICE/Quore room-status pattern):
// for one day — who leaves, who arrives, what needs flipping, what's not ready.
router.get('/housekeeping', requirePerm('housekeeping.board'), ah(async (req, res) => {
  const date = req.query.date || todayISO()
  const lodging = await rows(
    `SELECT id, name, zone, beds, condition, condition_note, condition_updated_at, condition_updated_by
     FROM locations WHERE active AND NOT exclude_from_accom ORDER BY sort, name`)
  const [leaving, arriving, staying] = await Promise.all([
    rows(`SELECT br.location_id, b.name, b.code, b.headcount FROM booking_rooms br
          JOIN bookings b ON b.id = br.booking_id WHERE br.date_to = $1 AND b.status != 'cancelled'`, [date]),
    rows(`SELECT br.location_id, b.name, b.code, b.headcount FROM booking_rooms br
          JOIN bookings b ON b.id = br.booking_id WHERE br.date_from = $1 AND b.status != 'cancelled'`, [date]),
    rows(`SELECT br.location_id, b.name, b.code FROM booking_rooms br
          JOIN bookings b ON b.id = br.booking_id
          WHERE br.date_from < $1 AND br.date_to > $1 AND b.status != 'cancelled'`, [date]),
  ])
  const idx = kind => { const m = new Map(); for (const r of kind) m.set(r.location_id, r); return m }
  const out = idx(leaving), inn = idx(arriving), stay = idx(staying)
  const units = lodging.map(l => ({
    ...l,
    leaving: out.get(l.id) || null,
    arriving: inn.get(l.id) || null,
    staying: stay.get(l.id) || null,
    needs_turnover: !!out.get(l.id),
    same_day_flip: !!out.get(l.id) && !!inn.get(l.id),
  }))
  res.json({
    date,
    units,
    summary: {
      turnovers: units.filter(u => u.needs_turnover).length,
      same_day: units.filter(u => u.same_day_flip).length,
      arrivals: units.filter(u => u.arriving).length,
      not_ready: units.filter(u => u.condition !== 'clean').length,
    },
  })
}))

router.post('/block', requirePerm('accommodation.edit'), ah(async (req, res) => {
  const { booking_id, location_id, date_from, date_to } = req.body || {}
  if (!booking_id || !location_id || !date_from || !date_to) throw httpError(400, 'Booking, location and dates are required')
  if (date_to < date_from) throw httpError(400, 'Dates are reversed')
  const clash = await one(
    `SELECT br.id, b.name FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
     WHERE br.location_id = $1 AND br.booking_id != $2 AND br.date_from < $4 AND br.date_to > $3
       AND b.status IN ('confirmed','in_progress')`,
    [location_id, booking_id, date_from, date_to])
  const bl = await one(
    `INSERT INTO booking_rooms (booking_id, location_id, date_from, date_to) VALUES ($1,$2,$3,$4) RETURNING *`,
    [booking_id, location_id, date_from, date_to])
  await audit(req.user, 'accommodation.block', 'booking', booking_id, { location_id, date_from, date_to })
  res.status(201).json({ ...bl, warning: clash ? `Heads up — overlaps “${clash.name}”` : null })
}))

router.delete('/block/:id', requirePerm('accommodation.edit'), ah(async (req, res) => {
  const bl = await one(`DELETE FROM booking_rooms WHERE id = $1 RETURNING booking_id, location_id`, [Number(req.params.id)])
  if (!bl) throw httpError(404, 'Block not found')
  await audit(req.user, 'accommodation.unblock', 'booking', bl.booking_id, bl)
  res.json({ ok: true })
}))
