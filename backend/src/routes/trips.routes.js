import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, getSetting, notify } from '../lib.js'

export const router = Router()

const OVERDUE_SQL = `(t.signed_in_at IS NULL AND t.expected_return IS NOT NULL AND t.expected_return < now())`

router.get('/board', requirePerm('signout.board'), ah(async (req, res) => {
  const out = await rows(
    `SELECT t.*, u.name, u.dept, u.color, u.phone, ${OVERDUE_SQL} AS overdue
     FROM trips t JOIN users u ON u.id = t.user_id
     WHERE t.signed_in_at IS NULL
     ORDER BY ${OVERDUE_SQL} DESC, t.expected_return NULLS LAST`)
  const counts = await one(
    `SELECT
       (SELECT COUNT(*)::int FROM trips WHERE signed_in_at IS NULL) AS off,
       (SELECT COUNT(*)::int FROM users WHERE active) AS total`)
  const settings = await getSetting('signout', {})
  res.json({ trips: out, counts: { off: counts.off, on: counts.total - counts.off }, emergency: await getSetting('org', {}) , curfew: settings.curfew })
}))

router.get('/mine', ah(async (req, res) => {
  res.json(await one(
    `SELECT * FROM trips WHERE user_id = $1 AND signed_in_at IS NULL`, [req.user.id]))
}))

router.get('/history', requirePerm('signout.manage'), ah(async (req, res) => {
  const limit = Math.min(300, Number(req.query.limit) || 120)
  res.json(await rows(
    `SELECT t.*, u.name, u.dept, u.color FROM trips t JOIN users u ON u.id = t.user_id
     ORDER BY t.signed_out_at DESC LIMIT $1`, [limit]))
}))

router.post('/out', requirePerm('signout.use'), ah(async (req, res) => {
  const { destination = '', expected_return, companions = '', vehicle = '', notes = '', user_id } = req.body || {}
  let target = req.user.id
  if (user_id && user_id !== req.user.id) {
    if (!req.user.perms['signout.manage']) throw httpError(403, 'Signing someone else out needs the “Manage sign-out” permission')
    target = Number(user_id)
  }
  const open = await one(`SELECT id FROM trips WHERE user_id = $1 AND signed_in_at IS NULL`, [target])
  if (open) throw httpError(409, 'Already signed out — sign back in first')
  const t = await one(
    `INSERT INTO trips (user_id, destination, expected_return, companions, vehicle, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [target, destination, expected_return || null, companions, vehicle, notes])
  await audit(req.user, 'trip.out', 'trip', t.id, { destination, for: target })
  res.status(201).json(t)
}))

router.post('/:id/in', requirePerm('signout.use'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const trip = await one(`SELECT * FROM trips WHERE id = $1 AND signed_in_at IS NULL`, [id])
  if (!trip) throw httpError(404, 'No open trip found')
  if (trip.user_id !== req.user.id && !req.user.perms['signout.manage']) {
    throw httpError(403, 'Signing someone else in needs the “Manage sign-out” permission')
  }
  const t = await one(`UPDATE trips SET signed_in_at = now() WHERE id = $1 RETURNING *`, [id])
  await audit(req.user, 'trip.in', 'trip', id)
  res.json(t)
}))

router.patch('/:id', requirePerm('signout.manage'), ah(async (req, res) => {
  const { destination, expected_return, companions, vehicle, notes } = req.body || {}
  const t = await one(
    `UPDATE trips SET destination = COALESCE($2,destination), expected_return = COALESCE($3,expected_return),
       companions = COALESCE($4,companions), vehicle = COALESCE($5,vehicle), notes = COALESCE($6,notes)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), destination, expected_return, companions, vehicle, notes])
  if (!t) throw httpError(404, 'Trip not found')
  res.json(t)
}))

// Scheduler hook: flags overdue trips, notifies managers, optional webhook.
export async function watchOverdueTrips() {
  const overdue = await rows(
    `SELECT t.id, t.destination, t.expected_return, u.name, u.id AS uid
     FROM trips t JOIN users u ON u.id = t.user_id
     WHERE t.signed_in_at IS NULL AND t.overdue_notified = false
       AND t.expected_return IS NOT NULL AND t.expected_return < now() - interval '10 minutes'`)
  if (!overdue.length) return
  const managers = await rows(
    `SELECT u.id FROM users u JOIN roles r ON r.key = u.role_key
     WHERE u.active AND (u.role_key = 'admin' OR (r.permissions->>'signout.manage')::boolean IS TRUE)`)
  const settings = await getSetting('signout', {})
  for (const t of overdue) {
    for (const m of managers) {
      notify(m.id, { icon: '🛟', title: `${t.name} is overdue`, body: `Expected back ${new Date(t.expected_return).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })} — ${t.destination || 'no destination given'}`, link: '/signout' })
    }
    if (settings.webhook_url) {
      fetch(settings.webhook_url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `🛟 Overdue: ${t.name} — expected back ${t.expected_return}, destination ${t.destination || 'unknown'}` }),
      }).catch(() => {})
    }
    await q(`UPDATE trips SET overdue_notified = true WHERE id = $1`, [t.id])
  }
}
