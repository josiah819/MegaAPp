import { Router } from 'express'
import { rows, one } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, todayISO, addDays, weekStart } from '../lib.js'

export const router = Router()

/* Per-area analytics, each behind its own permission so a kitchen lead can see
   catering numbers without ever seeing revenue. Patterns ported from FTF's
   metrics hub, woods360 reports, and leadrMW insights (k-anonymity intact). */

// ---------------------------------------------------------------- bookings
router.get('/bookings', requirePerm('metrics.bookings'), ah(async (req, res) => {
  const today = todayISO()
  const [byMonth, occupancyByMonth, segments, funnel, revenueByMonth, topCustomers, leadAge] = await Promise.all([
    rows(`SELECT to_char(date_trunc('month', start_date), 'YYYY-MM') AS month,
            COUNT(*)::int AS bookings, COALESCE(SUM(headcount),0)::int AS guests, COALESCE(SUM(value),0)::numeric AS value
          FROM bookings
          WHERE start_date >= date_trunc('month', $1::date) - interval '6 months'
            AND start_date < date_trunc('month', $1::date) + interval '6 months'
            AND status != 'cancelled'
          GROUP BY 1 ORDER BY 1`, [today]),
    rows(`SELECT to_char(d.day, 'YYYY-MM') AS month,
            SUM(CASE WHEN b.id IS NOT NULL THEN COALESCE(l.beds,0) ELSE 0 END)::int AS blocked,
            (SELECT COALESCE(SUM(beds),0) FROM locations WHERE active AND NOT exclude_from_accom)::int * COUNT(DISTINCT d.day)::int AS capacity
          FROM generate_series(date_trunc('month', $1::date) - interval '2 months',
                               date_trunc('month', $1::date) + interval '3 months' - interval '1 day',
                               interval '1 day') AS d(day)
          LEFT JOIN booking_rooms br ON br.date_from <= d.day::date AND br.date_to >= d.day::date
          LEFT JOIN locations l ON l.id = br.location_id
          LEFT JOIN bookings b ON b.id = br.booking_id AND b.status IN ('confirmed','in_progress')
          GROUP BY 1 ORDER BY 1`, [today]),
    rows(`SELECT segment, COUNT(*)::int AS n, COALESCE(SUM(value),0)::numeric AS value
          FROM bookings WHERE status != 'cancelled' AND start_date > now() - interval '12 months'
          GROUP BY segment ORDER BY n DESC`),
    rows(`SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(value_estimate),0)::numeric AS value FROM leads GROUP BY stage`),
    rows(`SELECT m.month,
            COALESCE((SELECT SUM((it->>'qty')::numeric * (it->>'unit_price')::numeric * (1 + i.tax_rate/100))
              FROM invoices i, jsonb_array_elements(i.items) it
              WHERE to_char(date_trunc('month', i.issue_date), 'YYYY-MM') = m.month AND i.status != 'void'),0)::numeric AS invoiced,
            COALESCE((SELECT SUM(p.amount) FROM payments p
              WHERE to_char(date_trunc('month', p.date), 'YYYY-MM') = m.month),0)::numeric AS collected
          FROM (SELECT to_char(date_trunc('month', $1::date) - (i || ' months')::interval, 'YYYY-MM') AS month
                FROM generate_series(5, 0, -1) AS i) m ORDER BY m.month`, [today]),
    rows(`SELECT c.name, COALESCE(SUM(b.value),0)::numeric AS value, COUNT(b.id)::int AS bookings
          FROM customers c JOIN bookings b ON b.customer_id = c.id AND b.status != 'cancelled'
          GROUP BY c.id ORDER BY value DESC LIMIT 6`),
    one(`SELECT COUNT(*)::int AS open, COALESCE(AVG(EXTRACT(EPOCH FROM now() - created_at)/86400),0)::numeric(8,1) AS avg_age_days
         FROM leads WHERE stage NOT IN ('won','lost')`),
  ])
  res.json({ byMonth, occupancyByMonth, segments, funnel, revenueByMonth, topCustomers, leadAge })
}))

// ---------------------------------------------------------------- facilities
router.get('/facilities', requirePerm('metrics.facilities'), ah(async (req, res) => {
  const [flow, byCategory, byLocation, sources, timing, backlogAges, byWeekday, ratings, oldest] = await Promise.all([
    rows(`SELECT w.wk AS week,
            (SELECT COUNT(*)::int FROM tickets t WHERE date_trunc('week', t.created_at) = w.wk_start) AS created,
            (SELECT COUNT(*)::int FROM tickets t WHERE t.closed_at IS NOT NULL AND date_trunc('week', t.closed_at) = w.wk_start) AS closed
          FROM (SELECT to_char(date_trunc('week', now()) - (i || ' weeks')::interval, 'MM-DD') AS wk,
                       date_trunc('week', now()) - (i || ' weeks')::interval AS wk_start
                FROM generate_series(11, 0, -1) AS i) w`),
    rows(`SELECT category, COUNT(*)::int AS n FROM tickets WHERE created_at > now() - interval '90 days'
          GROUP BY category ORDER BY n DESC`),
    rows(`SELECT l.name, COUNT(*)::int AS n FROM tickets t JOIN locations l ON l.id = t.location_id
          WHERE t.created_at > now() - interval '90 days' GROUP BY l.name ORDER BY n DESC LIMIT 8`),
    rows(`SELECT source, COUNT(*)::int AS n FROM tickets WHERE created_at > now() - interval '90 days' GROUP BY source`),
    one(`SELECT
           COALESCE(AVG(EXTRACT(EPOCH FROM first_response_at - created_at)/3600) FILTER (WHERE first_response_at IS NOT NULL),0)::numeric(8,1) AS avg_first_response_h,
           COALESCE(AVG((EXTRACT(EPOCH FROM closed_at - created_at) - COALESCE(hold_seconds,0))/3600) FILTER (WHERE closed_at IS NOT NULL),0)::numeric(8,1) AS avg_resolution_h,
           COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::int AS resolved
         FROM tickets WHERE created_at > now() - interval '60 days'`),
    rows(`SELECT CASE
            WHEN created_at > now() - interval '2 days' THEN '<2d'
            WHEN created_at > now() - interval '7 days' THEN '2–7d'
            WHEN created_at > now() - interval '30 days' THEN '7–30d'
            ELSE '30d+' END AS bucket, COUNT(*)::int AS n
          FROM tickets WHERE status != 'closed'
          GROUP BY 1 ORDER BY array_position(ARRAY['<2d','2–7d','7–30d','30d+'], CASE
            WHEN created_at > now() - interval '2 days' THEN '<2d'
            WHEN created_at > now() - interval '7 days' THEN '2–7d'
            WHEN created_at > now() - interval '30 days' THEN '7–30d'
            ELSE '30d+' END)`),
    rows(`SELECT EXTRACT(ISODOW FROM created_at)::int AS dow, COUNT(*)::int AS n
          FROM tickets WHERE created_at > now() - interval '90 days' GROUP BY 1 ORDER BY 1`),
    one(`SELECT COALESCE(AVG(rating),0)::numeric(3,1) AS avg, COUNT(rating)::int AS n
         FROM tickets WHERE rating IS NOT NULL`),
    rows(`SELECT code, title, status, created_at FROM tickets
          WHERE status != 'closed' ORDER BY created_at LIMIT 5`),
  ])
  res.json({ flow, byCategory, byLocation, sources, timing, backlogAges, byWeekday, ratings, oldest })
}))

// ---------------------------------------------------------------- tasks
router.get('/tasks', requirePerm('metrics.tasks'), ah(async (req, res) => {
  const [velocity, byStatus, byPhase, workload, cycle, overdue] = await Promise.all([
    rows(`SELECT w.wk AS week,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.completed_at IS NOT NULL AND date_trunc('week', t.completed_at) = w.wk_start) AS done,
            (SELECT COUNT(*)::int FROM tasks t WHERE date_trunc('week', t.created_at) = w.wk_start) AS created
          FROM (SELECT to_char(date_trunc('week', now()) - (i || ' weeks')::interval, 'MM-DD') AS wk,
                       date_trunc('week', now()) - (i || ' weeks')::interval AS wk_start
                FROM generate_series(11, 0, -1) AS i) w`),
    rows(`SELECT s.name, s.color, s.kind, COUNT(t.id)::int AS n
          FROM task_statuses s LEFT JOIN tasks t ON t.status_id = s.id GROUP BY s.id ORDER BY s.ord`),
    rows(`SELECT p.name, p.color,
            COUNT(t.id)::int AS total,
            COUNT(t.id) FILTER (WHERE t.completed_at IS NOT NULL)::int AS done
          FROM phases p LEFT JOIN tasks t ON t.phase_id = p.id GROUP BY p.id ORDER BY p.ord`),
    rows(`SELECT u.id, u.name, u.color,
            COUNT(t.id) FILTER (WHERE t.completed_at IS NULL)::int AS open,
            COUNT(t.id) FILTER (WHERE t.completed_at IS NULL AND t.due IS NOT NULL AND t.due < $1)::int AS overdue,
            COUNT(t.id) FILTER (WHERE t.completed_at > now() - interval '14 days')::int AS done14
          FROM users u JOIN tasks t ON u.id = ANY(t.assignees)
          WHERE u.active GROUP BY u.id ORDER BY open DESC LIMIT 10`, [todayISO()]),
    one(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM completed_at - created_at)/86400),0)::numeric(8,1) AS avg_days
         FROM tasks WHERE completed_at > now() - interval '60 days'`),
    one(`SELECT COUNT(*)::int AS n FROM tasks t LEFT JOIN task_statuses s ON s.id = t.status_id
         WHERE COALESCE(s.kind,'open') != 'done' AND t.due IS NOT NULL AND t.due < $1`, [todayISO()]),
  ])
  res.json({ velocity, byStatus, byPhase, workload, cycle, overdue })
}))

// ---------------------------------------------------------------- people (k-anonymity ≥ 3 intact)
router.get('/people', requirePerm('metrics.people'), ah(async (req, res) => {
  const [pulseTrend, enps, kudosTop, kudosByValue, feedbackTrend, posts30, participation] = await Promise.all([
    rows(`SELECT week, COUNT(*)::int AS n,
            CASE WHEN COUNT(*) >= 3 THEN AVG(mood)::numeric(3,2) ELSE NULL END AS mood
          FROM pulse GROUP BY week ORDER BY week DESC LIMIT 12`),
    one(`SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE enps >= 9)::int AS promoters,
           COUNT(*) FILTER (WHERE enps <= 6)::int AS detractors
         FROM pulse WHERE enps IS NOT NULL AND created_at > now() - interval '90 days'`),
    rows(`SELECT u.name, u.color,
            (SELECT COUNT(*)::int FROM kudos k WHERE k.to_id = u.id AND k.created_at > now() - interval '30 days') AS received,
            (SELECT COUNT(*)::int FROM kudos k WHERE k.from_id = u.id AND k.created_at > now() - interval '30 days') AS given
          FROM users u WHERE u.active
          ORDER BY received DESC, given DESC LIMIT 6`),
    rows(`SELECT value_key, COUNT(*)::int AS n FROM kudos
          WHERE value_key != '' AND created_at > now() - interval '90 days' GROUP BY value_key ORDER BY n DESC`),
    rows(`SELECT w.wk AS week,
            (SELECT COUNT(*)::int FROM feedback f WHERE date_trunc('week', f.created_at) = w.wk_start) AS n
          FROM (SELECT to_char(date_trunc('week', now()) - (i || ' weeks')::interval, 'MM-DD') AS wk,
                       date_trunc('week', now()) - (i || ' weeks')::interval AS wk_start
                FROM generate_series(7, 0, -1) AS i) w`),
    one(`SELECT (SELECT COUNT(*)::int FROM posts WHERE created_at > now() - interval '30 days') AS posts,
                (SELECT COUNT(*)::int FROM post_comments WHERE created_at > now() - interval '30 days') AS comments,
                (SELECT COUNT(*)::int FROM kudos WHERE created_at > now() - interval '30 days') AS kudos`),
    one(`SELECT (SELECT COUNT(*)::int FROM pulse WHERE week = (SELECT MAX(week) FROM pulse)) AS responded,
                (SELECT COUNT(*)::int FROM users WHERE active) AS staff`),
  ])
  const e = enps.n >= 3 ? Math.round(((enps.promoters - enps.detractors) / enps.n) * 100) : null
  res.json({ pulseTrend: pulseTrend.reverse(), enps: { score: e, n: enps.n }, kudosTop, kudosByValue, feedbackTrend, posts30, participation })
}))

// ---------------------------------------------------------------- sign-out
router.get('/signout', requirePerm('metrics.signout'), ah(async (req, res) => {
  const [perDay, durations, topDestinations, byHour, incidents] = await Promise.all([
    rows(`SELECT to_char(signed_out_at AT TIME ZONE 'America/Toronto', 'MM-DD') AS day, COUNT(*)::int AS n
          FROM trips WHERE signed_out_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`),
    one(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM signed_in_at - signed_out_at)/3600),0)::numeric(6,1) AS avg_h,
           COUNT(*)::int AS completed
         FROM trips WHERE signed_in_at IS NOT NULL AND signed_out_at > now() - interval '30 days'`),
    rows(`SELECT destination, COUNT(*)::int AS n FROM trips
          WHERE destination != '' AND signed_out_at > now() - interval '90 days'
          GROUP BY destination ORDER BY n DESC LIMIT 6`),
    rows(`SELECT EXTRACT(HOUR FROM signed_out_at AT TIME ZONE 'America/Toronto')::int AS hour, COUNT(*)::int AS n
          FROM trips WHERE signed_out_at > now() - interval '90 days' GROUP BY 1 ORDER BY 1`),
    one(`SELECT COUNT(*)::int AS overdue FROM trips
         WHERE overdue_notified AND signed_out_at > now() - interval '30 days'`),
  ])
  res.json({ perDay, durations, topDestinations, byHour, incidents })
}))

// ---------------------------------------------------------------- shopping
router.get('/shopping', requirePerm('metrics.shopping'), ah(async (req, res) => {
  const [added, runs, perRun, byCategory, byTown] = await Promise.all([
    rows(`SELECT w.wk AS week,
            (SELECT COUNT(*)::int FROM shopping_items s WHERE date_trunc('week', s.created_at) = w.wk_start) AS added,
            (SELECT COUNT(*)::int FROM shopping_items s WHERE s.completed_at IS NOT NULL AND date_trunc('week', s.completed_at) = w.wk_start) AS bought
          FROM (SELECT to_char(date_trunc('week', now()) - (i || ' weeks')::interval, 'MM-DD') AS wk,
                       date_trunc('week', now()) - (i || ' weeks')::interval AS wk_start
                FROM generate_series(7, 0, -1) AS i) w`),
    rows(`SELECT t.name, COUNT(r.id)::int AS runs FROM town_runs r LEFT JOIN towns t ON t.id = r.town_id
          WHERE r.started_at > now() - interval '90 days' GROUP BY t.name ORDER BY runs DESC`),
    one(`SELECT COALESCE(AVG(items_purchased),0)::numeric(6,1) AS avg_items,
           COALESCE(AVG(EXTRACT(EPOCH FROM ended_at - started_at)/3600) FILTER (WHERE ended_at IS NOT NULL),0)::numeric(6,1) AS avg_h
         FROM town_runs WHERE started_at > now() - interval '90 days'`),
    rows(`SELECT category, COUNT(*)::int AS n FROM shopping_items
          WHERE created_at > now() - interval '90 days' GROUP BY category ORDER BY n DESC`),
    rows(`SELECT t.name, COUNT(s.id)::int AS n FROM shopping_items s JOIN towns t ON t.id = s.town_id
          WHERE s.created_at > now() - interval '90 days' GROUP BY t.name ORDER BY n DESC LIMIT 6`),
  ])
  res.json({ added, runs, perRun, byCategory, byTown })
}))

// ---------------------------------------------------------------- gear
router.get('/gear', requirePerm('metrics.gear'), ah(async (req, res) => {
  const [loansByWeek, byCategory, utilization, overdue, conditionMix, topBorrowers] = await Promise.all([
    rows(`SELECT w.wk AS week,
            (SELECT COUNT(*)::int FROM gear_loans l WHERE date_trunc('week', l.out_at) = w.wk_start) AS loans
          FROM (SELECT to_char(date_trunc('week', now()) - (i || ' weeks')::interval, 'MM-DD') AS wk,
                       date_trunc('week', now()) - (i || ' weeks')::interval AS wk_start
                FROM generate_series(11, 0, -1) AS i) w ORDER BY w.wk_start`),
    rows(`SELECT g.category, COUNT(l.id)::int AS loans FROM gear_loans l JOIN gear_items g ON g.id = l.item_id
          WHERE l.out_at > now() - interval '90 days' GROUP BY g.category ORDER BY loans DESC`),
    rows(`SELECT g.name, g.qty_total, COUNT(l.id)::int AS loans,
            COALESCE(SUM(l.qty) FILTER (WHERE l.returned_at IS NULL), 0)::int AS out_now
          FROM gear_items g LEFT JOIN gear_loans l ON l.item_id = g.id AND l.out_at > now() - interval '90 days'
          WHERE g.active GROUP BY g.id ORDER BY loans DESC LIMIT 10`),
    rows(`SELECT g.name AS item, l.qty, COALESCE(u.name, l.borrower_name) AS borrower, l.due_at
          FROM gear_loans l JOIN gear_items g ON g.id = l.item_id LEFT JOIN users u ON u.id = l.borrower_id
          WHERE l.returned_at IS NULL AND l.due_at < now() ORDER BY l.due_at LIMIT 10`),
    rows(`SELECT condition, COUNT(*)::int AS n, COALESCE(SUM(qty_total),0)::int AS units
          FROM gear_items WHERE active GROUP BY condition`),
    rows(`SELECT COALESCE(u.name, l.borrower_name) AS borrower, COUNT(*)::int AS loans
          FROM gear_loans l LEFT JOIN users u ON u.id = l.borrower_id
          WHERE l.out_at > now() - interval '90 days' GROUP BY 1 ORDER BY loans DESC LIMIT 8`),
  ])
  res.json({ loansByWeek, byCategory, utilization, overdue, conditionMix, topBorrowers })
}))

// ---------------------------------------------------------------- budgets
router.get('/budgets', requirePerm('metrics.budgets'), ah(async (req, res) => {
  const today = todayISO()
  const [spendByMonth, perBudget, byCategory, pendingQueue, approvalSpeed] = await Promise.all([
    rows(`SELECT m.month,
            COALESCE((SELECT SUM(e.amount) FROM expenses e
              WHERE e.status = 'approved' AND to_char(date_trunc('month', e.date), 'YYYY-MM') = m.month), 0)::numeric AS spent,
            COALESCE((SELECT SUM(e.amount) FROM expenses e
              WHERE e.status = 'pending' AND to_char(date_trunc('month', e.date), 'YYYY-MM') = m.month), 0)::numeric AS pending
          FROM (SELECT to_char(date_trunc('month', $1::date) - (i || ' months')::interval, 'YYYY-MM') AS month
                FROM generate_series(5, 0, -1) AS i) m ORDER BY m.month`, [today]),
    rows(`SELECT b.name, b.amount::numeric AS amount,
            COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)::numeric AS spent,
            COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'pending'), 0)::numeric AS pending
          FROM budgets b LEFT JOIN expenses e ON e.budget_id = b.id
          WHERE b.active GROUP BY b.id ORDER BY b.name`),
    rows(`SELECT category, SUM(amount)::numeric AS total, COUNT(*)::int AS n FROM expenses
          WHERE status = 'approved' AND date > now() - interval '90 days'
          GROUP BY category ORDER BY total DESC LIMIT 8`),
    rows(`SELECT e.id, e.date, e.vendor, e.descr, e.amount::numeric AS amount, b.name AS budget, u.name AS submitted_by
          FROM expenses e JOIN budgets b ON b.id = e.budget_id LEFT JOIN users u ON u.id = e.submitted_by
          WHERE e.status = 'pending' ORDER BY e.created_at LIMIT 12`),
    one(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM decided_at - created_at)/86400), 0)::numeric(8,1) AS avg_days,
            COUNT(*)::int AS decided_90d
         FROM expenses WHERE decided_at IS NOT NULL AND created_at > now() - interval '90 days'`),
  ])
  res.json({ spendByMonth, perBudget, byCategory, pendingQueue, approvalSpeed })
}))

// ---------------------------------------------------------------- safety
router.get('/safety', requirePerm('metrics.safety'), ah(async (req, res) => {
  const conf = req.user.perms['incidents.confidential'] ? '' : 'AND NOT confidential'
  const confW = req.user.perms['incidents.confidential'] ? '' : 'WHERE NOT confidential'
  const [byMonth, byType, bySeverity, byLocation, closure, recent] = await Promise.all([
    rows(`SELECT m.month,
            (SELECT COUNT(*)::int FROM incidents i WHERE to_char(date_trunc('month', i.occurred_at), 'YYYY-MM') = m.month ${conf}) AS n
          FROM (SELECT to_char(date_trunc('month', now()) - (i || ' months')::interval, 'YYYY-MM') AS month
                FROM generate_series(5, 0, -1) AS i) m ORDER BY m.month`),
    rows(`SELECT type, COUNT(*)::int AS n FROM incidents WHERE occurred_at > now() - interval '180 days' ${conf} GROUP BY type ORDER BY n DESC`),
    rows(`SELECT severity, COUNT(*)::int AS n FROM incidents ${confW} GROUP BY severity ORDER BY severity`),
    rows(`SELECT l.name, COUNT(*)::int AS n FROM incidents i JOIN locations l ON l.id = i.location_id
          WHERE i.occurred_at > now() - interval '180 days' ${conf} GROUP BY l.name ORDER BY n DESC LIMIT 6`),
    one(`SELECT COUNT(*) FILTER (WHERE status != 'closed')::int AS open,
            COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
            COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM closed_at - occurred_at)/86400)
              FILTER (WHERE closed_at IS NOT NULL), 0)::numeric(8,1) AS median_days_to_close
         FROM incidents ${confW}`),
    rows(`SELECT code, title, type, severity, status, occurred_at FROM incidents ${confW}
          ORDER BY occurred_at DESC LIMIT 8`),
  ])
  res.json({ byMonth, byType, bySeverity, byLocation, closure, recent })
}))

// ------------------------------------------------ personal dashboard widgets
// One round trip serves the My Dashboard tab: ?widgets=a,b,c returns each
// widget's data — silently skipping any the caller isn't permitted to see.
// Without ?widgets it returns the catalog with lock states (for the gallery).
const WIDGETS = {
  open_tickets:   { label: 'Open tickets',        perm: 'metrics.facilities', icon: '🎫' },
  ticket_flow:    { label: 'Ticket flow (8 wk)',  perm: 'metrics.facilities', icon: '📈' },
  guest_rating:   { label: 'Guest rating',        perm: 'metrics.facilities', icon: '⭐' },
  occupancy_week: { label: 'Beds this week',      perm: 'metrics.bookings',   icon: '🛏️' },
  arrivals:       { label: 'Next arrivals',       perm: 'metrics.bookings',   icon: '🚌' },
  revenue:        { label: 'Money in (30 d)',     perm: 'metrics.bookings',   icon: '💰' },
  tasks_due:      { label: 'Tasks due',           perm: 'metrics.tasks',      icon: '🧱' },
  whos_out:       { label: 'Off property',        perm: 'metrics.signout',    icon: '🚗' },
  gear_now:       { label: 'Gear out',            perm: 'metrics.gear',       icon: '🛶' },
  budget_health:  { label: 'Budget health',       perm: 'metrics.budgets',    icon: '📊' },
  incidents_open: { label: 'Incidents',           perm: 'metrics.safety',     icon: '🚨' },
  kudos_week:     { label: 'Kudos this week',     perm: 'metrics.people',     icon: '🎉' },
  pulse:          { label: 'Team pulse',          perm: 'metrics.people',     icon: '💚' },
  certs_expiring: { label: 'Certs expiring',      perm: 'metrics.people',     icon: '📜' },
  shopping_open:  { label: 'Shopping list',       perm: 'metrics.shopping',   icon: '🛒' },
}

async function widgetData(key, user) {
  const today = todayISO()
  switch (key) {
    case 'open_tickets': return await one(
      `SELECT COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open,
              COUNT(*) FILTER (WHERE guest_unread AND status != 'closed')::int AS waiting,
              COUNT(*) FILTER (WHERE status NOT IN ('closed') AND due_date < $1)::int AS overdue
       FROM tickets`, [today])
    case 'ticket_flow': return await rows(
      `SELECT w.wk AS week,
         (SELECT COUNT(*)::int FROM tickets t WHERE date_trunc('week', t.created_at) = w.wk_start) AS created,
         (SELECT COUNT(*)::int FROM tickets t WHERE t.closed_at IS NOT NULL AND date_trunc('week', t.closed_at) = w.wk_start) AS closed
       FROM (SELECT to_char(date_trunc('week', now()) - (i || ' weeks')::interval, 'MM-DD') AS wk,
                    date_trunc('week', now()) - (i || ' weeks')::interval AS wk_start
             FROM generate_series(7, 0, -1) AS i) w ORDER BY w.wk_start`)
    case 'guest_rating': return await one(
      `SELECT ROUND(AVG(rating), 2)::float AS stars, COUNT(rating)::int AS n
       FROM tickets WHERE rating IS NOT NULL AND closed_at > now() - interval '90 days'`)
    case 'occupancy_week': {
      const start = weekStart(today)
      return await one(
        `SELECT COALESCE(SUM(l.beds), 0)::int AS blocked,
           (SELECT COALESCE(SUM(beds),0)::int FROM locations WHERE active AND NOT exclude_from_accom) AS capacity
         FROM booking_rooms br JOIN locations l ON l.id = br.location_id
         JOIN bookings b ON b.id = br.booking_id AND b.status IN ('confirmed','in_progress')
         WHERE br.date_from <= $1 AND br.date_to >= $2`, [addDays(start, 6), start])
    }
    case 'arrivals': return await rows(
      `SELECT code, name, headcount, start_date FROM bookings
       WHERE status IN ('confirmed','tentative') AND start_date BETWEEN $1 AND $2
       ORDER BY start_date LIMIT 4`, [today, addDays(today, 7)])
    case 'revenue': return await one(
      `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE date > $1), 0)::numeric AS collected_30d,
              (SELECT COUNT(*)::int FROM invoices WHERE status = 'sent') AS open_invoices`,
      [addDays(today, -30)])
    case 'tasks_due': return await one(
      `SELECT COUNT(*) FILTER (WHERE t.due <= $1)::int AS due_this_week,
              COUNT(*) FILTER (WHERE t.due < $2)::int AS overdue
       FROM tasks t JOIN task_statuses s ON s.id = t.status_id
       WHERE s.kind != 'done' AND t.parent_id IS NULL AND t.due IS NOT NULL`, [addDays(today, 7), today])
    case 'whos_out': return await rows(
      `SELECT u.name, t.destination, (t.expected_return < now()) AS overdue
       FROM trips t JOIN users u ON u.id = t.user_id WHERE t.signed_in_at IS NULL LIMIT 5`)
    case 'gear_now': return await one(
      `SELECT COALESCE(SUM(qty) FILTER (WHERE returned_at IS NULL), 0)::int AS units_out,
              COUNT(*) FILTER (WHERE returned_at IS NULL AND due_at < now())::int AS overdue
       FROM gear_loans`)
    case 'budget_health': return await rows(
      `SELECT b.name, b.amount::numeric AS amount,
              COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)::numeric AS spent
       FROM budgets b LEFT JOIN expenses e ON e.budget_id = b.id WHERE b.active
       GROUP BY b.id ORDER BY (COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0) / NULLIF(b.amount, 0)) DESC NULLS LAST LIMIT 3`)
    case 'incidents_open': {
      const conf = user.perms['incidents.confidential'] ? '' : 'AND NOT confidential'
      return await one(
        `SELECT COUNT(*) FILTER (WHERE status != 'closed')::int AS open,
                COUNT(*) FILTER (WHERE occurred_at > now() - interval '30 days')::int AS last_30d
         FROM incidents WHERE TRUE ${conf}`)
    }
    case 'kudos_week': return await one(
      `SELECT COUNT(*)::int AS n,
         (SELECT u.name FROM kudos k JOIN users u ON u.id = k.to_id
          WHERE k.created_at > now() - interval '7 days' GROUP BY u.name ORDER BY COUNT(*) DESC LIMIT 1) AS top
       FROM kudos WHERE created_at > now() - interval '7 days'`)
    case 'pulse': return await one(
      `SELECT week, ROUND(AVG(mood),2)::float AS mood, COUNT(*)::int AS n FROM pulse
       GROUP BY week HAVING COUNT(*) >= 3 ORDER BY week DESC LIMIT 1`)
    case 'certs_expiring': return await one(
      `SELECT COUNT(*)::int AS n FROM user_certs c JOIN users u ON u.id = c.user_id
       WHERE u.active AND c.expires BETWEEN $1 AND $2`, [today, addDays(today, 60)])
    case 'shopping_open': return await one(
      `SELECT COUNT(*)::int AS open,
         (SELECT t.name FROM town_runs r LEFT JOIN towns t ON t.id = r.town_id
          WHERE r.ended_at IS NULL ORDER BY r.started_at DESC LIMIT 1) AS active_run
       FROM shopping_items WHERE NOT completed`)
    default: return null
  }
}

router.get('/dashboard', ah(async (req, res) => {
  const asked = String(req.query.widgets || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!asked.length) {
    return res.json({
      catalog: Object.entries(WIDGETS).map(([key, w]) => ({
        key, label: w.label, icon: w.icon, perm: w.perm, allowed: !!req.user.perms[w.perm],
      })),
    })
  }
  const out = {}
  await Promise.all(asked.map(async key => {
    const w = WIDGETS[key]
    if (!w || !req.user.perms[w.perm]) return
    try { out[key] = await widgetData(key, req.user) } catch (e) { console.error(`widget ${key} failed`, e.message) }
  }))
  res.json({ data: out })
}))
