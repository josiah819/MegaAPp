import crypto from 'crypto'
import { Router } from 'express'
import { q, one } from '../db.js'
import { verify, getRoles } from '../auth.js'
import { effectivePerms } from '../permissions.js'
import { ah, audit, getSetting } from '../lib.js'
import { sha256 } from '../security.js'

/* OAuth 2.1 authorization for the MCP endpoint — the front door for Claude.ai
   chat and Cowork (which connect to remote MCP servers via the connector OAuth
   flow, not a pasted token). Public clients, PKCE S256, dynamic registration.
   The issued access token resolves to a WoodsOS user, so the existing
   "the token IS the person, scoped to their permissions" model carries over.

   Flow: client hits /api/mcp unauthenticated → 401 points here via
   WWW-Authenticate → client reads discovery → registers → /authorize (the
   person signs in + approves) → /token (PKCE) → retries MCP with the bearer. */

const rnd = (n = 24) => crypto.randomBytes(n).toString('hex')
const b64url = buf => buf.toString('base64url')

// Public base URL — respect the tunnel/proxy's forwarded proto+host so the
// discovery URLs and redirects are correct behind Cloudflare/Caddy/etc.
export function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
  const host = req.headers['x-forwarded-host'] || req.get('host')
  return `${proto}://${host}`
}

// ---------------------------------------------------------------- discovery
// Mounted at the domain root (nginx proxies /.well-known/ to the backend).
export const wellKnown = Router()

function protectedResource(req, res) {
  const base = baseUrl(req)
  res.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['woodsos'],
    resource_documentation: `${base}/llms.txt`,
  })
}
// RFC 9728 allows a resource-path-suffixed PRM URL, so serve both.
wellKnown.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*'], protectedResource)

function authServerMeta(req) {
  const base = baseUrl(req)
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['woodsos'],
  }
}
wellKnown.get('/.well-known/oauth-authorization-server', (req, res) => res.json(authServerMeta(req)))
// Some clients probe the OIDC well-known too — serve the same metadata.
wellKnown.get('/.well-known/openid-configuration', (req, res) => res.json(authServerMeta(req)))

// ---------------------------------------------------------------- main router
// Mounted at /api/oauth (unauthenticated — these endpoints do their own auth).
export const router = Router()

// Resolve an OAuth access token to a user id (used by the MCP endpoint).
export async function resolveOAuthToken(raw) {
  const row = await one(
    `SELECT id, user_id FROM oauth_tokens
     WHERE token_hash = $1 AND NOT revoked AND (expires_at IS NULL OR expires_at > now())`,
    [sha256(raw)])
  if (!row) return null
  q(`UPDATE oauth_tokens SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {})
  return row.user_id
}

// ---- Dynamic Client Registration (RFC 7591) ----
router.post('/register', ah(async (req, res) => {
  const b = req.body || {}
  const redirect_uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter(u => typeof u === 'string' && u) : []
  if (!redirect_uris.length) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'At least one redirect_uri is required' })
  }
  const client_id = `wos_client_${rnd(16)}`
  const grant_types = Array.isArray(b.grant_types) && b.grant_types.length ? b.grant_types : ['authorization_code', 'refresh_token']
  await q(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types) VALUES ($1,$2,$3,$4)`,
    [client_id, String(b.client_name || 'MCP Client').slice(0, 120), JSON.stringify(redirect_uris), JSON.stringify(grant_types)])
  res.status(201).json({
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: b.client_name || 'MCP Client',
    redirect_uris,
    grant_types,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  })
}))

// ---- the branded login + consent page ----
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const CARRY = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'resource']

function page(inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to WoodsOS</title>
<style>
  :root{--brand:#1E5A64;--deep:#10333A;--green:#A3CD42;--ink:#1b2b2b;--line:#dfe3df;--bg:#F7F3EA}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--deep);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);padding:20px}
  .card{background:var(--bg);width:100%;max-width:400px;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.4)}
  .top{background:var(--brand);color:#fff;padding:22px 26px}
  .top .k{font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.7}
  .top h1{margin:.2em 0 0;font-size:20px;font-weight:800}
  .body{padding:24px 26px}
  .who{font-size:13.5px;color:#516;line-height:1.5;color:#3c4a4a;margin:0 0 18px}
  .who b{color:var(--ink)}
  label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#5d6a6a;margin:14px 0 5px}
  input{width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink)}
  input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(30,90,100,.15)}
  button{width:100%;margin-top:20px;padding:12px;font-size:15px;font-weight:800;color:#13302a;background:var(--green);
    border:0;border-radius:12px;cursor:pointer}
  button:hover{filter:brightness(1.05)}
  .err{background:#fbe9e7;color:#b2402e;font-size:13px;border-radius:10px;padding:9px 12px;margin-bottom:6px}
  .scopes{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:12.5px;color:#3c4a4a;line-height:1.6}
  .scopes b{color:var(--ink)}
  .foot{font-size:11px;color:#8a9696;margin-top:16px;text-align:center;line-height:1.5}
</style></head><body><div class="card">${inner}</div></body></html>`
}

function consentPage({ client, params, error }) {
  const hidden = CARRY.map(f => `<input type="hidden" name="${f}" value="${esc(params[f] || '')}">`).join('')
  const appName = esc(client.client_name || 'an AI assistant')
  return page(`
    <div class="top"><div class="k">Muskoka Woods · WoodsOS</div><h1>Connect ${appName}</h1></div>
    <div class="body">
      <p class="who"><b>${appName}</b> wants to connect to WoodsOS on your behalf. Sign in to approve — it will act as <b>you</b>, limited to exactly your permissions, and every change it makes is recorded in the audit log under your name.</p>
      <form method="post" action="/api/oauth/authorize">
        ${hidden}
        ${error ? `<div class="err">${esc(error)}</div>` : ''}
        <label>Email</label>
        <input name="email" type="email" autocomplete="username" autofocus placeholder="you@muskokawoods.com">
        <label>Password</label>
        <input name="password" type="password" autocomplete="current-password" placeholder="••••••••">
        <button type="submit">Sign in &amp; approve</button>
      </form>
      <div class="foot">You can revoke this connection any time on the Claude &amp; AI page.</div>
    </div>`)
}

function errorPage(msg) {
  return page(`<div class="top"><div class="k">WoodsOS</div><h1>Can’t connect</h1></div>
    <div class="body"><div class="scopes">${esc(msg)}</div>
    <div class="foot">Try removing and re-adding the connector in Claude.</div></div>`)
}

async function loadClient(clientId) {
  return await one(`SELECT * FROM oauth_clients WHERE client_id = $1`, [String(clientId || '')])
}
const allows = (client, uri) => Array.isArray(client?.redirect_uris) && client.redirect_uris.includes(uri)

// ---- Authorization endpoint ----
router.get('/authorize', ah(async (req, res) => {
  const p = req.query
  const client = await loadClient(p.client_id)
  if (!client) return res.status(400).type('html').send(errorPage('Unknown client. Remove and re-add the connector so it can register again.'))
  if (!allows(client, p.redirect_uri)) return res.status(400).type('html').send(errorPage('This redirect address isn’t registered for the connector.'))
  if (p.response_type !== 'code') return res.status(400).type('html').send(errorPage('Unsupported response_type — only the authorization-code flow is supported.'))
  if (p.code_challenge_method && p.code_challenge_method !== 'S256') return res.status(400).type('html').send(errorPage('Only PKCE with S256 is supported.'))
  if (!p.code_challenge) return res.status(400).type('html').send(errorPage('This client must use PKCE (a code_challenge is required).'))
  res.type('html').send(consentPage({ client, params: p }))
}))

router.post('/authorize', ah(async (req, res) => {
  const p = req.body || {}
  const client = await loadClient(p.client_id)
  if (!client || !allows(client, p.redirect_uri)) {
    return res.status(400).type('html').send(errorPage('Invalid client or redirect address.'))
  }
  const email = String(p.email || '').trim().toLowerCase()
  const user = await one(`SELECT * FROM users WHERE lower(email) = $1 AND active`, [email])
  if (!user || !(await verify(String(p.password || ''), user.password_hash))) {
    return res.status(401).type('html').send(consentPage({ client, params: p, error: 'That email and password don’t match.' }))
  }
  // The MCP module + the person's ai.use permission must be live, else there's
  // nothing to connect to — fail early with a clear message.
  const perms = effectivePerms(user, (await getRoles()).get(user.role_key))
  const ai = await getSetting('ai', {})
  if (ai.enabled === false || !perms['ai.use']) {
    return res.status(403).type('html').send(errorPage('Your account doesn’t have the “Connect Claude” permission (ai.use), or AI access is switched off for the organization. Ask an admin to enable it.'))
  }
  const code = `wos_code_${rnd(24)}`
  const expires = new Date(Date.now() + 5 * 60 * 1000)
  await q(`INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [sha256(code), client.client_id, user.id, p.redirect_uri, String(p.code_challenge || ''),
      String(p.scope || ''), String(p.resource || ''), expires])
  await audit(user, 'ai.oauth.authorize', 'oauth', client.client_id, { client: client.client_name })
  const u = new URL(p.redirect_uri)
  u.searchParams.set('code', code)
  if (p.state) u.searchParams.set('state', String(p.state))
  res.redirect(302, u.toString())
}))

// ---- Token endpoint ----
async function issueTokens(userId, clientId, scope) {
  const access = `wos_at_${rnd(24)}`
  const refresh = `wos_rt_${rnd(24)}`
  const ttlSeconds = 30 * 86400
  await q(`INSERT INTO oauth_tokens (token_hash, refresh_hash, client_id, user_id, scope, expires_at)
           VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' seconds')::interval)`,
    [sha256(access), sha256(refresh), clientId, userId, scope || 'woodsos', ttlSeconds])
  return { access_token: access, token_type: 'Bearer', expires_in: ttlSeconds, refresh_token: refresh, scope: scope || 'woodsos' }
}

router.post('/token', ah(async (req, res) => {
  const p = req.body || {}
  res.set('Cache-Control', 'no-store')
  if (p.grant_type === 'authorization_code') {
    const row = await one(`SELECT * FROM oauth_codes WHERE code_hash = $1`, [sha256(String(p.code || ''))])
    if (!row) return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or used code' })
    await q(`DELETE FROM oauth_codes WHERE code_hash = $1`, [row.code_hash]) // single-use
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired' })
    if (row.client_id !== String(p.client_id || '')) return res.status(400).json({ error: 'invalid_grant', error_description: 'Client mismatch' })
    if (row.redirect_uri !== String(p.redirect_uri || '')) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
    if (row.code_challenge) {
      const challenge = b64url(crypto.createHash('sha256').update(String(p.code_verifier || '')).digest())
      if (challenge !== row.code_challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' })
    }
    return res.json(await issueTokens(row.user_id, row.client_id, row.scope))
  }
  if (p.grant_type === 'refresh_token') {
    const row = await one(`SELECT * FROM oauth_tokens WHERE refresh_hash = $1 AND NOT revoked`, [sha256(String(p.refresh_token || ''))])
    if (!row) return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or revoked refresh token' })
    await q(`UPDATE oauth_tokens SET revoked = true WHERE id = $1`, [row.id]) // rotate
    return res.json(await issueTokens(row.user_id, row.client_id, row.scope))
  }
  res.status(400).json({ error: 'unsupported_grant_type' })
}))
