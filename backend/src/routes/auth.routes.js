import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { verify, hash, signToken, requireAuth, getFlags } from '../auth.js'
import { ah, audit, httpError, getSetting, todayISO } from '../lib.js'
import { authLimiter, loginLocked, loginFailed, loginSucceeded } from '../security.js'

export const router = Router()

router.post('/login', authLimiter, ah(async (req, res) => {
  const { email = '', password = '' } = req.body || {}
  const addr = String(email).trim().toLowerCase()
  const lockedMin = loginLocked(addr)
  if (lockedMin) throw httpError(429, `Account locked after repeated attempts — try again in ${lockedMin} min`)
  const user = await one(`SELECT * FROM users WHERE lower(email) = $1`, [addr])
  if (!user || !user.active || !(await verify(String(password), user.password_hash))) {
    await loginFailed(addr, req.ip)
    await audit(null, 'auth.fail', 'user', addr, { ip: req.ip })
    throw httpError(401, 'That email and password don’t match')
  }
  loginSucceeded(addr)
  await q(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id])
  res.json({ token: signToken(user) })
}))

router.post('/change-password', requireAuth, ah(async (req, res) => {
  const { current = '', next = '' } = req.body || {}
  if (String(next).length < 8) throw httpError(400, 'New password must be at least 8 characters')
  const me = await one(`SELECT * FROM users WHERE id = $1`, [req.user.id])
  if (!(await verify(String(current), me.password_hash))) throw httpError(400, 'Current password is incorrect')
  // token_version bump signs out every other session on this account
  await q(`UPDATE users SET password_hash = $1, token_version = COALESCE(token_version,0) + 1 WHERE id = $2`,
    [await hash(String(next)), req.user.id])
  const fresh = await one(`SELECT * FROM users WHERE id = $1`, [req.user.id])
  await audit(req.user, 'password.change', 'user', req.user.id)
  res.json({ ok: true, token: signToken(fresh) })
}))

// ---- web push subscriptions ----
router.post('/push/subscribe', requireAuth, ah(async (req, res) => {
  const { endpoint, keys } = req.body || {}
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw httpError(400, 'Invalid push subscription')
  await q(
    `INSERT INTO push_subs (user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.user.id, endpoint, keys.p256dh, keys.auth])
  res.json({ ok: true })
}))

router.post('/push/unsubscribe', requireAuth, ah(async (req, res) => {
  const { endpoint } = req.body || {}
  if (endpoint) await q(`DELETE FROM push_subs WHERE user_id = $1 AND endpoint = $2`, [req.user.id, endpoint])
  else await q(`DELETE FROM push_subs WHERE user_id = $1`, [req.user.id])
  res.json({ ok: true })
}))

// Everything the shell needs in one round trip.
router.get('/bootstrap', requireAuth, ah(async (req, res) => {
  const flags = [...(await getFlags()).values()].sort((a, b) => a.sort - b.sort)
  const [org, locationsMeta, signout, shopping, report, billing, push, gearMeta] = await Promise.all([
    getSetting('org', {}), getSetting('locations_meta', {}), getSetting('signout', {}),
    getSetting('shopping', {}), getSetting('report', {}), getSetting('billing', {}),
    getSetting('push', {}), getSetting('gear_meta', {}),
  ])
  const today = todayISO()
  const perms = req.user.perms
  const [tickets, tasks, out, unread, kudosNew, guestWaiting, growthInbox, closures, gearOver, expPending] = await Promise.all([
    one(`SELECT COUNT(*)::int AS n FROM tickets WHERE status IN ('open','in_progress')`),
    one(`SELECT COUNT(*)::int AS n FROM tasks t JOIN task_statuses s ON s.id = t.status_id
         WHERE s.kind != 'done' AND t.due IS NOT NULL AND t.due <= $1 AND $2 = ANY(t.assignees)`, [today, req.user.id]),
    one(`SELECT COUNT(*)::int AS n FROM trips WHERE signed_in_at IS NULL`),
    one(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = false`, [req.user.id]),
    one(`SELECT COUNT(*)::int AS n FROM kudos WHERE created_at > now() - interval '48 hours'`),
    one(`SELECT COUNT(*)::int AS n FROM tickets WHERE guest_unread AND status != 'closed'`),
    one(`SELECT
           (SELECT COUNT(*)::int FROM feedback f WHERE f.kind = 'request' AND f.responder_id = $1 AND f.status = 'pending') +
           (SELECT COUNT(*)::int FROM oo_items i JOIN one_on_ones m ON m.id = i.meeting_id
            WHERE NOT i.done AND i.kind = 'action' AND m.status != 'done' AND (m.a_id = $1 OR m.b_id = $1)) AS n`,
      [req.user.id]),
    perms['tickets.approve_close'] || perms['tickets.close']
      ? one(`SELECT COUNT(*)::int AS n FROM closure_requests WHERE status = 'pending'`) : { n: 0 },
    perms['gear.view']
      ? one(`SELECT COUNT(*)::int AS n FROM gear_loans WHERE returned_at IS NULL AND due_at < now()`) : { n: 0 },
    perms['budgets.approve']
      ? one(`SELECT COUNT(*)::int AS n FROM expenses WHERE status = 'pending'`) : { n: 0 },
  ])
  const myTrip = await one(
    `SELECT id, destination, signed_out_at, expected_return FROM trips WHERE user_id = $1 AND signed_in_at IS NULL`,
    [req.user.id])
  res.json({
    user: req.user,
    flags,
    settings: {
      org, locations_meta: locationsMeta,
      signout: { destinations: signout.destinations, durations: signout.durations },
      shopping, report_categories: report.categories || [],
      billing: { tax_rate: billing.tax_rate, tax_label: billing.tax_label, currency: billing.currency, payment_instructions: billing.payment_instructions },
      gear_categories: gearMeta.categories || [],
      vapid_public: push.vapid_public || '',
    },
    badges: {
      tickets_open: tickets.n, my_tasks_due: tasks.n, whos_out: out.n,
      notifications: unread.n, kudos_recent: kudosNew.n,
      guest_waiting: guestWaiting.n, growth_inbox: growthInbox.n,
      closure_pending: closures.n, gear_overdue: gearOver.n, expense_pending: expPending.n,
    },
    my_trip: myTrip,
  })
}))
