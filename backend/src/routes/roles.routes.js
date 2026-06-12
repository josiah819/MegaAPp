import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm, bustCaches } from '../auth.js'
import { ah, audit, httpError } from '../lib.js'
import { PERM_GROUPS, ALL_PERMS, MODULES } from '../permissions.js'

export const router = Router()

// The catalog + matrix. Readable by anyone who can manage roles OR users
// (the user-override editor needs the catalog too).
router.get('/', requirePerm('roles.manage', 'users.manage'), ah(async (req, res) => {
  const roles = await rows(
    `SELECT r.*, (SELECT COUNT(*)::int FROM users u WHERE u.role_key = r.key AND u.active) AS members
     FROM roles r ORDER BY r.rank DESC, r.label`)
  res.json({ roles, catalog: PERM_GROUPS, modules: MODULES })
}))

router.use(requirePerm('roles.manage'))

const cleanPerms = perms => {
  const out = {}
  for (const k of ALL_PERMS) if (perms?.[k] === true) out[k] = true
  return out
}

router.post('/', ah(async (req, res) => {
  const { label, description = '', rank = 30, clone_from } = req.body || {}
  if (!label || !String(label).trim()) throw httpError(400, 'The role needs a name')
  const key = String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40)
  if (!key) throw httpError(400, 'The role needs a name')
  const dup = await one(`SELECT key FROM roles WHERE key = $1`, [key])
  if (dup) throw httpError(409, 'A role with that name already exists')
  let permissions = {}
  if (clone_from) {
    const src = await one(`SELECT permissions FROM roles WHERE key = $1`, [clone_from])
    if (src) permissions = cleanPerms(src.permissions)
  }
  const r = await one(
    `INSERT INTO roles (key, label, description, rank, is_system, permissions)
     VALUES ($1,$2,$3,$4,false,$5) RETURNING *`,
    [key, String(label).trim(), description, Number(rank) || 30, JSON.stringify(permissions)])
  await audit(req.user, 'role.create', 'role', key, { clone_from })
  bustCaches()
  res.status(201).json(r)
}))

router.patch('/:key', ah(async (req, res) => {
  const { key } = req.params
  if (key === 'admin') throw httpError(400, 'The Administrator role is locked — that’s your way back in')
  const existing = await one(`SELECT * FROM roles WHERE key = $1`, [key])
  if (!existing) throw httpError(404, 'Role not found')
  const { label, description, rank, permissions } = req.body || {}
  const r = await one(
    `UPDATE roles SET
       label = COALESCE($2, label), description = COALESCE($3, description),
       rank = COALESCE($4, rank), permissions = COALESCE($5, permissions)
     WHERE key = $1 RETURNING *`,
    [key, label, description, rank, permissions ? JSON.stringify(cleanPerms(permissions)) : null])
  await audit(req.user, 'role.update', 'role', key, { changed: Object.keys(req.body || {}) })
  bustCaches()
  res.json(r)
}))

router.delete('/:key', ah(async (req, res) => {
  const { key } = req.params
  const role = await one(`SELECT * FROM roles WHERE key = $1`, [key])
  if (!role) throw httpError(404, 'Role not found')
  if (role.is_system) throw httpError(400, 'System roles can’t be deleted')
  const members = await one(`SELECT COUNT(*)::int AS n FROM users WHERE role_key = $1`, [key])
  if (members.n > 0) {
    await q(`UPDATE users SET role_key = 'staff' WHERE role_key = $1`, [key])
  }
  await q(`DELETE FROM roles WHERE key = $1`, [key])
  await audit(req.user, 'role.delete', 'role', key, { reassigned: members.n })
  bustCaches()
  res.json({ ok: true, reassigned: members.n })
}))
