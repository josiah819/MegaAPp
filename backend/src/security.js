import crypto from 'crypto'
import { audit } from './lib.js'

/* WoodsOS security layer — hand-rolled, zero-dependency.
   - Tiered sliding-window rate limiting (per IP / user / token)
   - Login brute-force lockout per account
   - Security response headers
   - Lightweight request stats (feeds Admin → System health) */

// ---- rate limiting -------------------------------------------------------
// Sliding window counter per key. Buckets live in memory — fine for a
// single-node deploy; the goal is abuse resistance, not strict quotas.
const buckets = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k)
}, 60 * 1000).unref?.()

export function rateLimit({ windowMs, max, name, keyFn }) {
  return (req, res, next) => {
    const id = keyFn ? keyFn(req) : req.ip
    if (!id) return next()
    const key = `${name}:${id}`
    const now = Date.now()
    let b = buckets.get(key)
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b) }
    b.n++
    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - b.n))
    if (b.n > max) {
      res.setHeader('Retry-After', Math.ceil((b.reset - now) / 1000))
      stats.limited++
      return res.status(429).json({ error: 'Slow down a little — too many requests. Try again shortly.' })
    }
    next()
  }
}

// Pre-tuned tiers
export const authLimiter   = rateLimit({ name: 'auth',   windowMs: 15 * 60 * 1000, max: 30 })
export const publicLimiter = rateLimit({ name: 'public', windowMs: 10 * 60 * 1000, max: 150 })
export const mcpLimiter    = rateLimit({ name: 'mcp',    windowMs: 10 * 60 * 1000, max: 300, keyFn: r => r.patId || r.ip })
export const apiLimiter    = rateLimit({ name: 'api',    windowMs: 5 * 60 * 1000,  max: 1500, keyFn: r => r.user?.id || r.ip })
export const uploadLimiter = rateLimit({ name: 'upload', windowMs: 60 * 60 * 1000, max: 80,  keyFn: r => r.user?.id || r.ip })

// ---- login lockout -------------------------------------------------------
// 5 wrong passwords on one account → 15-minute lock. Counter resets on success.
const failures = new Map() // email -> { n, lockUntil }
const LOCK_AFTER = 5
const LOCK_MS = 15 * 60 * 1000

export function loginLocked(email) {
  const f = failures.get(email)
  if (!f) return 0
  if (f.lockUntil && f.lockUntil > Date.now()) return Math.ceil((f.lockUntil - Date.now()) / 60000)
  return 0
}
export async function loginFailed(email, ip) {
  const f = failures.get(email) || { n: 0, lockUntil: 0 }
  f.n++
  if (f.n >= LOCK_AFTER) {
    f.lockUntil = Date.now() + LOCK_MS
    f.n = 0
    await audit(null, 'auth.lockout', 'user', email, { ip })
  }
  failures.set(email, f)
}
export function loginSucceeded(email) { failures.delete(email) }

// ---- response headers ----------------------------------------------------
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
}

// ---- request stats (System health) ----------------------------------------
export const stats = {
  bootedAt: Date.now(),
  total: 0,
  errors: 0,
  limited: 0,
  totalMs: 0,
  byMinute: new Map(), // minute-epoch -> { n, err }
}

export function requestStats(req, res, next) {
  const t0 = process.hrtime.bigint()
  stats.total++
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    stats.totalMs += ms
    if (res.statusCode >= 500) stats.errors++
    const minute = Math.floor(Date.now() / 60000)
    let m = stats.byMinute.get(minute)
    if (!m) {
      m = { n: 0, err: 0 }
      stats.byMinute.set(minute, m)
      for (const k of stats.byMinute.keys()) if (k < minute - 60) stats.byMinute.delete(k)
    }
    m.n++
    if (res.statusCode >= 500) m.err++
  })
  next()
}

export function statsSnapshot() {
  const minute = Math.floor(Date.now() / 60000)
  const series = []
  for (let i = 29; i >= 0; i--) {
    const m = stats.byMinute.get(minute - i)
    series.push(m ? m.n : 0)
  }
  return {
    uptime_s: Math.floor((Date.now() - stats.bootedAt) / 1000),
    requests: stats.total,
    errors_5xx: stats.errors,
    rate_limited: stats.limited,
    avg_ms: stats.total ? Math.round(stats.totalMs / stats.total * 10) / 10 : 0,
    per_minute: series,
    rss_mb: Math.round(process.memoryUsage().rss / 1048576),
    heap_mb: Math.round(process.memoryUsage().heapUsed / 1048576),
    node: process.version,
  }
}

export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex')
