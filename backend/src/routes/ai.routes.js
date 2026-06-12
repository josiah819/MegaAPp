import crypto from 'crypto'
import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm, getFlags } from '../auth.js'
import { ah, audit, httpError } from '../lib.js'
import { sha256 } from '../security.js'
import { toolCatalog } from './mcp.routes.js'

/* Claude & AI — personal access tokens for the MCP endpoint.
   The token is shown exactly once at mint time; only its SHA-256 lands in the
   database. Scope = the holder's live permissions, re-resolved on every call. */

export const router = Router()
router.use(requirePerm('ai.use'))

const present = p => ({
  id: p.id, name: p.name, prefix: p.prefix, created_at: p.created_at,
  last_used_at: p.last_used_at, expires_at: p.expires_at, revoked: p.revoked,
  user_name: p.user_name, user_id: p.user_id,
})

router.get('/tokens', ah(async (req, res) => {
  res.json((await rows(`SELECT * FROM pats WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.id])).map(present))
}))

router.post('/tokens', ah(async (req, res) => {
  const { name = 'Claude', days } = req.body || {}
  const mine = await one(`SELECT COUNT(*)::int AS n FROM pats WHERE user_id = $1 AND NOT revoked`, [req.user.id])
  if (mine.n >= 5) throw httpError(400, 'Five active tokens is plenty — revoke one first')
  const raw = `wos_pat_${crypto.randomBytes(24).toString('hex')}`
  const expires = days ? new Date(Date.now() + Number(days) * 86400000) : null
  const row = await one(
    `INSERT INTO pats (user_id, name, token_hash, prefix, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, String(name).slice(0, 60) || 'Claude', sha256(raw), raw.slice(0, 16) + '…', expires])
  await audit(req.user, 'ai.token.create', 'pat', row.id, { name: row.name, expires: expires?.toISOString() || 'never' })
  res.status(201).json({ token: raw, row: present(row) })
}))

router.delete('/tokens/:id', ah(async (req, res) => {
  const id = Number(req.params.id)
  const pat = await one(`SELECT * FROM pats WHERE id = $1`, [id])
  if (!pat) throw httpError(404, 'Token not found')
  if (pat.user_id !== req.user.id && !req.user.perms['ai.manage']) {
    throw httpError(403, 'Only the owner (or an AI manager) can revoke this token')
  }
  await q(`UPDATE pats SET revoked = true WHERE id = $1`, [id])
  await audit(req.user, 'ai.token.revoke', 'pat', id, { owner: pat.user_id })
  res.json({ ok: true })
}))

// The full tool catalog with this person's lock states — powers the AI page.
router.get('/tools', ah(async (req, res) => {
  res.json(toolCatalog(req.user, await getFlags()))
}))

// ---- org-wide management (ai.manage) ----
router.get('/all-tokens', requirePerm('ai.manage'), ah(async (req, res) => {
  res.json((await rows(
    `SELECT p.*, u.name AS user_name FROM pats p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 100`)).map(present))
}))

router.get('/activity', requirePerm('ai.manage'), ah(async (req, res) => {
  res.json(await rows(
    `SELECT user_name, action, entity, entity_id, detail, created_at FROM audit_log
     WHERE action LIKE 'ai.%' ORDER BY created_at DESC LIMIT 60`))
}))
