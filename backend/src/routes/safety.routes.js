import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, notify, usersWithPerm } from '../lib.js'

/* Safety & incidents — the risk log every hotel and camp platform carries.
   Severity 1 minor → 4 critical. Confidential entries (medical/behavioral
   details) are visible only to confidential-access holders. */

export const router = Router()

const confidentialGuard = user => user.perms['incidents.confidential'] ? '' : 'AND NOT i.confidential'

router.get('/', requirePerm('incidents.view', 'incidents.report'), ah(async (req, res) => {
  const { status, type, q: qs } = req.query
  const where = ['TRUE'], params = []
  if (!req.user.perms['incidents.view']) {
    // Report-only folks see just their own filings
    params.push(req.user.id); where.push(`i.reported_by = $${params.length}`)
  }
  if (status) { params.push(status); where.push(`i.status = $${params.length}`) }
  if (type) { params.push(type); where.push(`i.type = $${params.length}`) }
  if (qs) { params.push(`%${qs}%`); where.push(`(i.title ILIKE $${params.length} OR i.code ILIKE $${params.length})`) }
  res.json(await rows(
    `SELECT i.*, l.name AS location_name, u.name AS reported_by_name
     FROM incidents i LEFT JOIN locations l ON l.id = i.location_id LEFT JOIN users u ON u.id = i.reported_by
     WHERE ${where.join(' AND ')} ${confidentialGuard(req.user)}
     ORDER BY (i.status = 'closed'), i.occurred_at DESC LIMIT 200`, params))
}))

router.get('/:id', requirePerm('incidents.view', 'incidents.report'), ah(async (req, res) => {
  const i = await one(
    `SELECT i.*, l.name AS location_name, u.name AS reported_by_name
     FROM incidents i LEFT JOIN locations l ON l.id = i.location_id LEFT JOIN users u ON u.id = i.reported_by
     WHERE i.id = $1`, [Number(req.params.id)])
  if (!i) throw httpError(404, 'Incident not found')
  if (i.confidential && !req.user.perms['incidents.confidential'] && i.reported_by !== req.user.id) {
    throw httpError(403, 'This incident is confidential')
  }
  if (!req.user.perms['incidents.view'] && i.reported_by !== req.user.id) {
    throw httpError(403, 'You can only open incidents you reported')
  }
  res.json(i)
}))

router.post('/', requirePerm('incidents.report'), ah(async (req, res) => {
  const { title, type = 'safety', severity = 2, occurred_at, location_id, description = '',
    people_involved = '', actions_taken = '', confidential = false } = req.body || {}
  if (!title?.trim()) throw httpError(400, 'Give the incident a one-line summary')
  const n = await one(`SELECT COUNT(*)::int AS n FROM incidents`)
  const code = `INC-${1001 + n.n}`
  const sev = Math.min(4, Math.max(1, Number(severity) || 2))
  const i = await one(
    `INSERT INTO incidents (code, title, type, severity, occurred_at, location_id, description, people_involved, actions_taken, confidential, reported_by)
     VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, now()),$6,$7,$8,$9,$10,$11) RETURNING *`,
    [code, title.trim(), type, sev, occurred_at || null, location_id || null,
      description, people_involved, actions_taken, !!confidential, req.user.id])
  const watchKey = confidential ? 'incidents.confidential' : 'incidents.manage'
  for (const uid of await usersWithPerm(watchKey)) {
    if (uid !== req.user.id) {
      notify(uid, { icon: '🚨', title: `Incident ${code}: ${i.title}`, body: `Severity ${sev} · ${type}`, link: `/safety?focus=${i.id}` })
    }
  }
  await audit(req.user, 'incident.create', 'incident', i.id, { code, type, severity: sev, confidential: !!confidential })
  res.status(201).json(i)
}))

router.patch('/:id', requirePerm('incidents.manage'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await one(`SELECT * FROM incidents WHERE id = $1`, [id])
  if (!existing) throw httpError(404, 'Incident not found')
  if (existing.confidential && !req.user.perms['incidents.confidential']) {
    throw httpError(403, 'This incident is confidential')
  }
  const { title, type, severity, occurred_at, location_id, description, people_involved,
    actions_taken, followup, status, confidential } = req.body || {}
  const i = await one(
    `UPDATE incidents SET
       title = COALESCE($2,title), type = COALESCE($3,type), severity = COALESCE($4,severity),
       occurred_at = COALESCE($5,occurred_at), location_id = COALESCE($6,location_id),
       description = COALESCE($7,description), people_involved = COALESCE($8,people_involved),
       actions_taken = COALESCE($9,actions_taken), followup = COALESCE($10,followup),
       status = COALESCE($11,status), confidential = COALESCE($12,confidential),
       closed_at = CASE WHEN $11 = 'closed' THEN now() WHEN $11 IS NOT NULL THEN NULL ELSE closed_at END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, title, type, severity ? Math.min(4, Math.max(1, Number(severity))) : null, occurred_at, location_id,
      description, people_involved, actions_taken, followup, status,
      'confidential' in (req.body || {}) ? !!confidential : null])
  await audit(req.user, status ? `incident.${status}` : 'incident.update', 'incident', id, { code: i.code })
  res.json(i)
}))
