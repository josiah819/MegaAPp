import webpush from 'web-push'
import { q, one, rows } from './db.js'
import { getSetting } from './lib.js'

/* Web push delivery — VAPID keys are minted on first boot (migrate.js) and the
   browser push services need nothing else. Subscriptions are pruned when the
   push service says they're gone (404/410). */

let configured = false
async function ensureConfig() {
  if (configured) return true
  const p = await getSetting('push', null)
  if (!p?.vapid_public || !p?.vapid_private) return false
  webpush.setVapidDetails(p.subject || 'mailto:admin@muskokawoods.com', p.vapid_public, p.vapid_private)
  configured = true
  return true
}

export async function sendPush(userId, { title, body = '', link = '/', icon = '🔔' }) {
  try {
    if (!(await ensureConfig())) return
    const u = await one(`SELECT prefs FROM users WHERE id = $1`, [userId])
    if (u?.prefs?.push === false) return
    const subs = await rows(`SELECT * FROM push_subs WHERE user_id = $1`, [userId])
    if (!subs.length) return
    const payload = JSON.stringify({ title: `${icon} ${title}`, body, link })
    await Promise.allSettled(subs.map(async s => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload, { TTL: 3600 })
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await q(`DELETE FROM push_subs WHERE id = $1`, [s.id])
        }
      }
    }))
  } catch (e) { console.error('push failed', e.message) }
}
