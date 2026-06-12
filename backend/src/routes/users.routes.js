import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm, hash, bustCaches } from '../auth.js'
import { ah, audit, httpError } from '../lib.js'
import { ALL_PERMS } from '../permissions.js'

export const router = Router()
router.use(requirePerm('users.manage'))

router.get('/', ah(async (req, res) => {
  res.json(await rows(
    `SELECT u.id, u.email, u.name, u.role_key, u.dept, u.title, u.phone, u.color, u.birthday, u.start_date,
            u.overrides, u.active, u.last_login, u.created_at, r.label AS role_label
     FROM users u LEFT JOIN roles r ON r.key = u.role_key
     ORDER BY u.active DESC, u.name`))
}))

router.post('/', ah(async (req, res) => {
  const { email, name, role_key = 'staff', dept = 'General', title = '', password } = req.body || {}
  if (!email || !name || !password) throw httpError(400, 'Email, name and a starting password are required')
  if (String(password).length < 8) throw httpError(400, 'Password must be at least 8 characters')
  const role = await one(`SELECT key FROM roles WHERE key = $1`, [role_key])
  if (!role) throw httpError(400, 'Unknown role')
  const dup = await one(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email])
  if (dup) throw httpError(409, 'That email already has an account')
  const colors = ['#1E5A64', '#1F6331', '#30A059', '#C26628', '#1B5470', '#1087A3']
  const u = await one(
    `INSERT INTO users (email, name, password_hash, role_key, dept, title, color)
     VALUES (lower($1),$2,$3,$4,$5,$6,$7) RETURNING id, email, name, role_key`,
    [email, name, await hash(String(password)), role_key, dept, title, colors[Math.floor(Math.random() * colors.length)]])
  await audit(req.user, 'user.create', 'user', u.id, { email, role_key })
  res.status(201).json(u)
}))

async function guardLastAdmin(targetId, nextRole, nextActive) {
  const t = await one(`SELECT id, role_key, active FROM users WHERE id = $1`, [targetId])
  if (!t) throw httpError(404, 'User not found')
  const losingAdmin = t.role_key === 'admin' && ((nextRole && nextRole !== 'admin') || nextActive === false)
  if (losingAdmin) {
    const n = await one(`SELECT COUNT(*)::int AS n FROM users WHERE role_key = 'admin' AND active = true AND id != $1`, [targetId])
    if (n.n === 0) throw httpError(400, 'That would leave WoodsOS with no administrator')
  }
  return t
}

router.patch('/:id', ah(async (req, res) => {
  const id = Number(req.params.id)
  const { name, email, role_key, dept, title, phone, color, birthday, start_date, active, overrides, manager_id } = req.body || {}
  await guardLastAdmin(id, role_key, active)
  if (role_key) {
    const role = await one(`SELECT key FROM roles WHERE key = $1`, [role_key])
    if (!role) throw httpError(400, 'Unknown role')
  }
  if (overrides) {
    for (const k of Object.keys(overrides)) {
      if (!ALL_PERMS.includes(k) || typeof overrides[k] !== 'boolean') throw httpError(400, `Bad override: ${k}`)
    }
  }
  const u = await one(
    `UPDATE users SET
       name = COALESCE($2, name), email = COALESCE(lower($3), email), role_key = COALESCE($4, role_key),
       dept = COALESCE($5, dept), title = COALESCE($6, title), phone = COALESCE($7, phone),
       color = COALESCE($8, color), birthday = COALESCE($9, birthday), start_date = COALESCE($10, start_date),
       active = COALESCE($11, active), overrides = COALESCE($12, overrides),
       manager_id = CASE WHEN $13 THEN $14 ELSE manager_id END
     WHERE id = $1 RETURNING id, email, name, role_key, overrides, active, manager_id`,
    [id, name, email, role_key, dept, title, phone, color, birthday, start_date, active,
      overrides ? JSON.stringify(overrides) : null,
      'manager_id' in (req.body || {}), manager_id === id ? null : (manager_id || null)])
  await audit(req.user, 'user.update', 'user', id, req.body)
  bustCaches()
  res.json(u)
}))

router.post('/:id/reset-password', ah(async (req, res) => {
  const { password } = req.body || {}
  if (!password || String(password).length < 8) throw httpError(400, 'Password must be at least 8 characters')
  const u = await one(`UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, name`,
    [Number(req.params.id), await hash(String(password))])
  if (!u) throw httpError(404, 'User not found')
  await audit(req.user, 'user.reset_password', 'user', u.id)
  res.json({ ok: true })
}))
