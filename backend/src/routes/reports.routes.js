import { Router } from 'express'
import { rows, one } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, todayISO, addDays, weekStart } from '../lib.js'

export const router = Router()
router.use(requirePerm('reports.view'))

router.get('/summary', ah(async (req, res) => {
  const today = todayISO()
  const [bookingsByMonth, ticketsByStatus, ticketsByCategory, tasksByStatus, signouts14, kudosByValue, occupancy, topLocations] = await Promise.all([
    rows(`SELECT to_char(date_trunc('month', start_date), 'YYYY-MM') AS month,
            COUNT(*)::int AS bookings, COALESCE(SUM(headcount),0)::int AS guests, COALESCE(SUM(value),0)::numeric AS value
          FROM bookings
          WHERE start_date >= date_trunc('month', $1::date) - interval '2 months'
            AND start_date < date_trunc('month', $1::date) + interval '5 months'
            AND status != 'cancelled'
          GROUP BY 1 ORDER BY 1`, [today]),
    rows(`SELECT status, COUNT(*)::int AS n FROM tickets GROUP BY status`),
    rows(`SELECT category, COUNT(*)::int AS n FROM tickets WHERE created_at > now() - interval '90 days' GROUP BY category ORDER BY n DESC`),
    rows(`SELECT s.name, s.color, s.kind, COUNT(t.id)::int AS n
          FROM task_statuses s LEFT JOIN tasks t ON t.status_id = s.id GROUP BY s.id ORDER BY s.ord`),
    rows(`SELECT to_char(signed_out_at AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
          FROM trips WHERE signed_out_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`),
    rows(`SELECT value_key, COUNT(*)::int AS n FROM kudos WHERE value_key != '' GROUP BY value_key ORDER BY n DESC`),
    (async () => {
      const start = weekStart(today)
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
      const total = await one(`SELECT COALESCE(SUM(beds),0)::int AS beds FROM locations WHERE active AND NOT exclude_from_accom`)
      const out = []
      for (const d of days) {
        const r = await one(
          `SELECT COALESCE(SUM(l.beds),0)::int AS beds FROM booking_rooms br
           JOIN locations l ON l.id = br.location_id JOIN bookings b ON b.id = br.booking_id
           WHERE br.date_from <= $1 AND br.date_to >= $1 AND b.status IN ('confirmed','in_progress')`, [d])
        out.push({ day: d, blocked: r.beds, total: total.beds })
      }
      return out
    })(),
    rows(`SELECT l.name, COUNT(*)::int AS n FROM tickets t JOIN locations l ON l.id = t.location_id
          WHERE t.created_at > now() - interval '90 days' GROUP BY l.name ORDER BY n DESC LIMIT 6`),
  ])
  res.json({ bookingsByMonth, ticketsByStatus, ticketsByCategory, tasksByStatus, signouts14, kudosByValue, occupancy, topLocations })
}))
