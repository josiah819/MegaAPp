import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, isoWeek, getSetting, notify } from '../lib.js'

export const router = Router()

router.get('/', requirePerm('people.view'), ah(async (req, res) => {
  res.json(await rows(
    `SELECT u.id, u.name, u.dept, u.title, u.color, u.birthday, u.start_date, u.manager_id, r.label AS role_label,
       EXISTS (SELECT 1 FROM trips t WHERE t.user_id = u.id AND t.signed_in_at IS NULL) AS off_property,
       (SELECT COUNT(*)::int FROM kudos k WHERE k.to_id = u.id) AS kudos_count
     FROM users u LEFT JOIN roles r ON r.key = u.role_key
     WHERE u.active ORDER BY u.name`))
}))

// Birthdays + work anniversaries in the next 35 days — for Community.
router.get('/celebrations', requirePerm('people.view'), ah(async (req, res) => {
  const ppl = await rows(`SELECT id, name, color, birthday, start_date FROM users WHERE active`)
  const today = new Date()
  const out = []
  const nextDate = (month, day) => {
    let d = new Date(today.getFullYear(), month - 1, day, 12)
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d = new Date(today.getFullYear() + 1, month - 1, day, 12)
    return d
  }
  for (const p of ppl) {
    if (p.birthday) {
      const [, m, d] = String(p.birthday).split('-').map(Number)
      const at = nextDate(m, d)
      const days = Math.round((at - today) / 86400000)
      if (days <= 35) out.push({ kind: 'birthday', id: p.id, name: p.name, color: p.color, date: at.toISOString().slice(0, 10), days })
    }
    if (p.start_date) {
      const [y, m, d] = String(p.start_date).split('-').map(Number)
      const at = nextDate(m, d)
      const days = Math.round((at - today) / 86400000)
      const years = at.getFullYear() - y
      if (days <= 35 && years > 0) out.push({ kind: 'anniversary', id: p.id, name: p.name, color: p.color, date: at.toISOString().slice(0, 10), days, years })
    }
  }
  out.sort((a, b) => a.days - b.days)
  res.json(out.slice(0, 12))
}))

// ---- certifications (lifeguard, first aid, food safe — with expiry warnings) ----
router.get('/certs/all', requirePerm('people.certs'), ah(async (req, res) => {
  res.json(await rows(
    `SELECT c.*, u.name AS user_name, u.color, u.dept,
       (c.expires - CURRENT_DATE)::int AS days_left
     FROM user_certs c JOIN users u ON u.id = c.user_id
     WHERE u.active ORDER BY c.expires NULLS LAST, u.name`))
}))

router.post('/certs', requirePerm('people.certs'), ah(async (req, res) => {
  const { user_id, name, issuer = '', issued, expires, notes = '' } = req.body || {}
  if (!user_id || !name?.trim()) throw httpError(400, 'Pick a person and name the certification')
  const c = await one(
    `INSERT INTO user_certs (user_id, name, issuer, issued, expires, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [Number(user_id), name.trim(), issuer, issued || null, expires || null, notes])
  await audit(req.user, 'cert.add', 'user', user_id, { name: c.name, expires })
  res.status(201).json(c)
}))

router.delete('/certs/:cid', requirePerm('people.certs'), ah(async (req, res) => {
  await q(`DELETE FROM user_certs WHERE id = $1`, [Number(req.params.cid)])
  res.json({ ok: true })
}))

// Update your own card — the directory stays staff-owned.
// prefs are personal app preferences (dashboard layout, push opt-out, …).
router.patch('/me', ah(async (req, res) => {
  const { phone, bio, color, prefs } = req.body || {}
  const u = await one(
    `UPDATE users SET phone = COALESCE($2, phone), bio = COALESCE($3, bio), color = COALESCE($4, color),
       prefs = CASE WHEN $5::jsonb IS NOT NULL THEN COALESCE(prefs, '{}'::jsonb) || $5::jsonb ELSE prefs END
     WHERE id = $1 RETURNING id, phone, bio, color, prefs`,
    [req.user.id, phone, typeof bio === 'string' ? bio.slice(0, 600) : null, color,
      prefs && typeof prefs === 'object' ? JSON.stringify(prefs) : null])
  res.json(u)
}))

router.get('/:id', requirePerm('people.view'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const person = await one(
    `SELECT u.id, u.name, u.email, u.dept, u.title, u.phone, u.color, u.birthday, u.start_date, u.bio,
       u.manager_id, m.name AS manager_name, r.label AS role_label
     FROM users u LEFT JOIN roles r ON r.key = u.role_key LEFT JOIN users m ON m.id = u.manager_id
     WHERE u.id = $1 AND u.active`, [id])
  if (!person) throw httpError(404, 'Person not found')
  const [kudosReceived, openTasks, trip, reports, certs] = await Promise.all([
    rows(`SELECT k.*, f.name AS from_name, f.color AS from_color FROM kudos k
          LEFT JOIN users f ON f.id = k.from_id WHERE k.to_id = $1 ORDER BY k.created_at DESC LIMIT 12`, [id]),
    rows(`SELECT t.id, t.title, t.due, s.name AS status_name, s.kind FROM tasks t
          LEFT JOIN task_statuses s ON s.id = t.status_id
          WHERE $1 = ANY(t.assignees) AND (s.kind IS NULL OR s.kind != 'done') ORDER BY t.due NULLS LAST LIMIT 10`, [id]),
    one(`SELECT * FROM trips WHERE user_id = $1 AND signed_in_at IS NULL`, [id]),
    rows(`SELECT id, name, color, title FROM users WHERE manager_id = $1 AND active ORDER BY name`, [id]),
    rows(`SELECT *, (expires - CURRENT_DATE)::int AS days_left FROM user_certs WHERE user_id = $1 ORDER BY expires NULLS LAST`, [id]),
  ])
  res.json({ ...person, kudos: kudosReceived, open_tasks: openTasks, trip, reports, certs })
}))

// ---- Kudos wall ----
router.get('/kudos/wall', requirePerm('people.view'), ah(async (req, res) => {
  const [list, leaders] = await Promise.all([
    rows(`SELECT k.*, f.name AS from_name, f.color AS from_color, t.name AS to_name, t.color AS to_color
          FROM kudos k LEFT JOIN users f ON f.id = k.from_id JOIN users t ON t.id = k.to_id
          ORDER BY k.created_at DESC LIMIT 60`),
    rows(`SELECT u.id, u.name, u.color, COUNT(*)::int AS n FROM kudos k JOIN users u ON u.id = k.to_id
          WHERE k.created_at > now() - interval '30 days' GROUP BY u.id, u.name, u.color ORDER BY n DESC LIMIT 5`),
  ])
  const org = await getSetting('org', {})
  res.json({ kudos: list, leaders, values: org.values || [] })
}))

router.post('/kudos', requirePerm('kudos.give'), ah(async (req, res) => {
  const { to_id, value_key = '', message } = req.body || {}
  if (!to_id || !message) throw httpError(400, 'Pick a person and write the kudos')
  if (Number(to_id) === req.user.id) throw httpError(400, 'Self-kudos is bold, but no')
  const k = await one(
    `INSERT INTO kudos (from_id, to_id, value_key, message) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, Number(to_id), value_key, String(message).trim()])
  notify(Number(to_id), { icon: '🎉', title: `${req.user.name} gave you kudos`, body: String(message).slice(0, 90), link: '/kudos' })
  await audit(req.user, 'kudos.give', 'kudos', k.id, { to_id })
  res.status(201).json(k)
}))

router.post('/kudos/:id/react', requirePerm('people.view'), ah(async (req, res) => {
  const { emoji } = req.body || {}
  if (!emoji) throw httpError(400, 'Pick an emoji')
  const k = await one(`SELECT reactions FROM kudos WHERE id = $1`, [Number(req.params.id)])
  if (!k) throw httpError(404, 'Kudos not found')
  const reactions = k.reactions || {}
  const list = new Set(reactions[emoji] || [])
  list.has(req.user.id) ? list.delete(req.user.id) : list.add(req.user.id)
  reactions[emoji] = [...list]
  if (!reactions[emoji].length) delete reactions[emoji]
  const updated = await one(`UPDATE kudos SET reactions = $2 WHERE id = $1 RETURNING reactions`,
    [Number(req.params.id), JSON.stringify(reactions)])
  res.json(updated)
}))

// ---- Pulse ----
router.get('/pulse/mine', ah(async (req, res) => {
  const week = isoWeek()
  res.json({ week, response: await one(`SELECT * FROM pulse WHERE week = $1 AND user_id = $2`, [week, req.user.id]) })
}))

router.post('/pulse', ah(async (req, res) => {
  const { mood, enps, comment = '' } = req.body || {}
  const m = Number(mood)
  if (!(m >= 1 && m <= 5)) throw httpError(400, 'Mood is 1–5')
  const week = isoWeek()
  const r = await one(
    `INSERT INTO pulse (week, user_id, mood, enps, comment) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (week, user_id) DO UPDATE SET mood = EXCLUDED.mood, enps = EXCLUDED.enps, comment = EXCLUDED.comment
     RETURNING *`,
    [week, req.user.id, m, enps == null ? null : Number(enps), String(comment).slice(0, 500)])
  res.status(201).json(r)
}))

// Cert-expiry sweep (scheduler): 30-day warning, once per cert, to the holder
// and everyone who tracks certifications.
export async function watchCertExpiry() {
  const { usersWithPerm } = await import('../lib.js')
  const soon = await rows(
    `SELECT c.*, u.name AS user_name FROM user_certs c JOIN users u ON u.id = c.user_id
     WHERE u.active AND NOT c.expiry_notified AND c.expires IS NOT NULL
       AND c.expires <= CURRENT_DATE + INTERVAL '30 days'`)
  if (!soon.length) return
  const trackers = await usersWithPerm('people.certs')
  for (const c of soon) {
    await q(`UPDATE user_certs SET expiry_notified = true WHERE id = $1`, [c.id])
    const expired = new Date(c.expires) < new Date()
    const who = new Set(trackers)
    who.add(c.user_id)
    for (const uid of who) {
      notify(uid, {
        icon: '📜',
        title: expired ? `Certification expired: ${c.user_name} — ${c.name}` : `Expiring soon: ${c.user_name} — ${c.name}`,
        body: `Expires ${c.expires}`, link: `/people/${c.user_id}`,
      })
    }
    console.log(`Cert expiry notice: ${c.user_name} — ${c.name} (${c.expires})`)
  }
}

router.get('/pulse/summary', requirePerm('pulse.results'), ah(async (req, res) => {
  // k-anonymity: weeks with fewer than 3 responses report participation only
  const weeks = await rows(
    `SELECT week, COUNT(*)::int AS n, AVG(mood)::numeric(4,2) AS mood, AVG(enps)::numeric(4,1) AS enps
     FROM pulse GROUP BY week ORDER BY week DESC LIMIT 12`)
  const safe = weeks.map(w => w.n >= 3 ? w : { week: w.week, n: w.n, mood: null, enps: null })
  const comments = await rows(
    `SELECT p.week, p.comment FROM pulse p
     WHERE p.comment != '' AND p.week IN (SELECT week FROM pulse GROUP BY week HAVING COUNT(*) >= 3)
     ORDER BY p.created_at DESC LIMIT 10`)
  res.json({ weeks: safe.reverse(), comments: comments.map(c => ({ week: c.week, comment: c.comment })) })
}))
