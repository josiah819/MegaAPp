import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm, bustCaches } from '../auth.js'
import { ah, audit, httpError, getSetting, setSetting, token } from '../lib.js'
import { statsSnapshot } from '../security.js'

export const router = Router()

const EDITABLE = ['org', 'signout', 'screens', 'report', 'locations_meta', 'shopping', 'billing', 'sla', 'ai', 'gear_meta']

router.get('/settings', requirePerm('settings.admin'), ah(async (req, res) => {
  const out = {}
  for (const k of [...EDITABLE, 'tokens']) out[k] = await getSetting(k, {})
  res.json(out)
}))

router.put('/settings/:key', requirePerm('settings.admin'), ah(async (req, res) => {
  const { key } = req.params
  if (!EDITABLE.includes(key)) throw httpError(400, 'That setting can’t be edited')
  await setSetting(key, req.body)
  await audit(req.user, 'settings.update', 'settings', key)
  res.json({ ok: true })
}))

router.post('/tokens/rotate', requirePerm('settings.admin'), ah(async (req, res) => {
  const { which } = req.body || {}
  if (!['screen', 'board', 'report', 'ical'].includes(which)) throw httpError(400, 'Unknown link')
  const tokens = await getSetting('tokens', {})
  tokens[which] = token()
  await setSetting('tokens', tokens)
  await audit(req.user, 'tokens.rotate', 'settings', which)
  res.json({ tokens })
}))

router.put('/flags/:key', requirePerm('settings.admin'), ah(async (req, res) => {
  const f = await one(`UPDATE module_flags SET enabled = $2 WHERE key = $1 RETURNING *`,
    [req.params.key, !!req.body?.enabled])
  if (!f) throw httpError(404, 'Unknown module')
  await audit(req.user, 'module.toggle', 'module', f.key, { enabled: f.enabled })
  bustCaches()
  res.json(f)
}))

router.get('/audit', requirePerm('audit.view'), ah(async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 80)
  const offset = Number(req.query.offset) || 0
  const entity = req.query.entity
  const params = entity ? [entity, limit, offset] : [limit, offset]
  res.json(await rows(
    `SELECT * FROM audit_log ${entity ? 'WHERE entity = $1' : ''}
     ORDER BY created_at DESC LIMIT $${entity ? 2 : 1} OFFSET $${entity ? 3 : 2}`, params))
}))

// System health — uptime, traffic, errors, rate-limit hits, DB latency (FTF's
// system-health panel, grantable to IT without the rest of admin).
router.get('/system-health', requirePerm('system.health'), ah(async (req, res) => {
  const t0 = process.hrtime.bigint()
  await one(`SELECT 1 AS ok`)
  const dbMs = Number(process.hrtime.bigint() - t0) / 1e6
  const [counts, dbSize] = await Promise.all([
    one(`SELECT
      (SELECT COUNT(*)::int FROM users WHERE active) AS users,
      (SELECT COUNT(*)::int FROM tickets) AS tickets,
      (SELECT COUNT(*)::int FROM bookings) AS bookings,
      (SELECT COUNT(*)::int FROM tasks) AS tasks,
      (SELECT COUNT(*)::int FROM notifications) AS notifications,
      (SELECT COUNT(*)::int FROM audit_log) AS audit_rows,
      (SELECT COUNT(*)::int FROM pats WHERE NOT revoked) AS active_ai_tokens,
      (SELECT COUNT(*)::int FROM push_subs) AS push_subscriptions`),
    one(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`),
  ])
  res.json({ ...statsSnapshot(), db_ping_ms: Math.round(dbMs * 10) / 10, db_size: dbSize.size, counts })
}))

// Share links, gated per feature so the right people can find them.
router.get('/links', ah(async (req, res) => {
  const tokens = await getSetting('tokens', {})
  const out = {}
  if (req.user.perms['screens.manage']) out.screen = `/screen/${tokens.screen}`
  if (req.user.perms['accommodation.view']) out.board = `/board/${tokens.board}`
  if (req.user.perms['tickets.view']) out.report = `/report/${tokens.report}`
  if (req.user.perms['bookings.manage']) out.ical = `/api/public/ical/${tokens.ical}`
  res.json(out)
}))
