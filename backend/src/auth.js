import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { one, rows } from './db.js'
import { effectivePerms } from './permissions.js'
import { httpError } from './lib.js'

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('⚠ JWT_SECRET is not set — using the dev default. Set it in .env before exposing this to a network.')
}
const TOKEN_HOURS = 12

export const hash = pwd => bcrypt.hash(pwd, 12)
export const verify = (pwd, h) => bcrypt.compare(pwd, h || '')

// `v` is the user's token_version — bumping it (password change, forced
// sign-out) invalidates every JWT minted before the bump.
export function signToken(user) {
  return jwt.sign({ uid: user.id, v: user.token_version || 0 }, SECRET, { expiresIn: `${TOKEN_HOURS}h` })
}

// Small in-memory caches; both invalidated by version bumps from admin routes.
let roleCache = { at: 0, map: new Map() }
let flagCache = { at: 0, map: new Map() }
export function bustCaches() { roleCache.at = 0; flagCache.at = 0 }

export async function getRoles() {
  if (Date.now() - roleCache.at > 15000) {
    const list = await rows(`SELECT * FROM roles ORDER BY rank DESC`)
    roleCache = { at: Date.now(), map: new Map(list.map(r => [r.key, r])) }
  }
  return roleCache.map
}
export async function getFlags() {
  if (Date.now() - flagCache.at > 15000) {
    const list = await rows(`SELECT * FROM module_flags`)
    flagCache = { at: Date.now(), map: new Map(list.map(f => [f.key, f])) }
  }
  return flagCache.map
}

// Attaches req.user (with .perms) when a valid token is present; 401 if not.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) throw httpError(401, 'Sign in required')
    let payload
    try { payload = jwt.verify(token, SECRET) } catch { throw httpError(401, 'Session expired') }
    const user = await one(`SELECT * FROM users WHERE id = $1 AND active = true`, [payload.uid])
    if (!user) throw httpError(401, 'Account not found')
    if ((payload.v || 0) !== (user.token_version || 0)) throw httpError(401, 'Session expired — sign in again')
    const roles = await getRoles()
    user.perms = effectivePerms(user, roles.get(user.role_key))
    delete user.password_hash
    req.user = user
    next()
  } catch (e) { next(e) }
}

export const requirePerm = (...keys) => (req, res, next) => {
  const ok = keys.some(k => req.user?.perms?.[k])
  if (!ok) return next(httpError(403, 'You do not have permission for that'))
  next()
}

export const requireFlag = key => async (req, res, next) => {
  const flags = await getFlags()
  const f = flags.get(key)
  if (f && !f.enabled) return next(httpError(403, 'This module is turned off'))
  next()
}
