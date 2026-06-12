import crypto from 'crypto'
import { q } from './db.js'

export const TZ = process.env.TZ || 'America/Toronto'

export const token = (bytes = 9) => crypto.randomBytes(bytes).toString('hex')

// Local-date helpers (server runs with TZ set, so Date math is camp-local)
export function todayISO(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return todayISO(d)
}
// Monday-of-week for an ISO date
export function weekStart(iso = todayISO()) {
  const d = new Date(`${iso}T12:00:00`)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return todayISO(d)
}
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function audit(user, action, entity, entityId, detail = {}) {
  try {
    await q(
      `INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user?.id || null, user?.name || 'system', action, entity, String(entityId ?? ''), JSON.stringify(detail)]
    )
  } catch (e) { console.error('audit failed', e.message) }
}

export async function notify(userId, { icon = '🔔', title, body = '', link = '' }) {
  try {
    await q(`INSERT INTO notifications (user_id, icon, title, body, link) VALUES ($1,$2,$3,$4,$5)`,
      [userId, icon, title, body, link])
    // Mirror to web push when the person has subscribed (fire-and-forget)
    import('./push.js').then(m => m.sendPush(userId, { icon, title, body, link })).catch(() => {})
  } catch (e) { console.error('notify failed', e.message) }
}

// Every active user holding a permission (role, override, or admin) — used to
// fan out notifications like “closure requested” or “expense pending”.
export async function usersWithPerm(permKey) {
  const { effectivePerms } = await import('./permissions.js')
  const us = await q(`SELECT u.*, r.permissions AS role_perms FROM users u
                      LEFT JOIN roles r ON r.key = u.role_key WHERE u.active`)
  return us.rows
    .filter(u => effectivePerms(u, { permissions: u.role_perms })[permKey])
    .map(u => u.id)
}

export async function getSetting(key, fallback = null) {
  const r = await q(`SELECT value FROM app_settings WHERE key = $1`, [key])
  return r.rows[0] ? r.rows[0].value : fallback
}
export async function setSetting(key, value) {
  await q(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  )
}

export function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

// Wrap async route handlers so thrown errors reach the error middleware
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
