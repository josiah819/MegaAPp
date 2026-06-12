import { Router } from 'express'
import { rows } from '../db.js'
import { ah } from '../lib.js'

export const router = Router()

router.get('/', ah(async (req, res) => {
  const qstr = String(req.query.q || '').trim()
  if (qstr.length < 2) return res.json({ results: [] })
  const like = `%${qstr}%`
  const can = k => req.user.perms[k]
  const out = []

  if (can('bookings.view')) {
    const b = await rows(
      `SELECT id, code, name, status, start_date FROM bookings
       WHERE name ILIKE $1 OR code ILIKE $1 ORDER BY start_date DESC LIMIT 6`, [like])
    out.push(...b.map(x => ({ type: 'booking', icon: '🗓️', title: x.name, sub: `${x.code} · ${x.status}`, link: `/bookings/${x.id}` })))
  }
  if (can('tickets.view')) {
    const t = await rows(
      `SELECT id, code, title, status FROM tickets WHERE title ILIKE $1 OR code ILIKE $1 ORDER BY created_at DESC LIMIT 6`, [like])
    out.push(...t.map(x => ({ type: 'ticket', icon: '🎫', title: x.title, sub: `${x.code} · ${x.status.replace('_', ' ')}`, link: `/tickets/${x.id}` })))
  }
  if (can('tasks.view')) {
    const t = await rows(`SELECT id, title FROM tasks WHERE title ILIKE $1 ORDER BY updated_at DESC LIMIT 6`, [like])
    out.push(...t.map(x => ({ type: 'task', icon: '✅', title: x.title, sub: 'Task', link: `/tasks?focus=${x.id}` })))
  }
  if (can('locations.view')) {
    const l = await rows(`SELECT id, name, zone, category FROM locations WHERE name ILIKE $1 AND active LIMIT 6`, [like])
    out.push(...l.map(x => ({ type: 'location', icon: '📍', title: x.name, sub: x.zone || x.category, link: `/locations?focus=${x.id}` })))
  }
  if (can('people.view')) {
    const p = await rows(`SELECT id, name, title, dept FROM users WHERE active AND (name ILIKE $1 OR title ILIKE $1) LIMIT 6`, [like])
    out.push(...p.map(x => ({ type: 'person', icon: '👤', title: x.name, sub: x.title || x.dept, link: `/people/${x.id}` })))
  }
  if (can('bookings.leads')) {
    const l = await rows(
      `SELECT id, name, organization, stage FROM leads
       WHERE name ILIKE $1 OR organization ILIKE $1 OR contact_name ILIKE $1 ORDER BY updated_at DESC LIMIT 5`, [like])
    out.push(...l.map(x => ({ type: 'lead', icon: '🎯', title: x.name, sub: `${x.organization || 'Lead'} · ${x.stage}`, link: '/leads' })))
  }
  if (can('bookings.billing')) {
    const i = await rows(
      `SELECT i.id, i.number, i.status, c.name AS customer FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.number ILIKE $1 OR c.name ILIKE $1 ORDER BY i.created_at DESC LIMIT 5`, [like])
    out.push(...i.map(x => ({ type: 'invoice', icon: '🧾', title: x.number, sub: `${x.customer || 'Invoice'} · ${x.status}`, link: `/billing?focus=${x.id}` })))
  }
  if (can('gear.view')) {
    const g = await rows(`SELECT id, name, category FROM gear_items WHERE active AND name ILIKE $1 LIMIT 5`, [like])
    out.push(...g.map(x => ({ type: 'gear', icon: '🛶', title: x.name, sub: `Gear · ${x.category}`, link: `/gear?focus=${x.id}` })))
  }
  if (can('lostfound.view')) {
    const l = await rows(`SELECT id, description, status, kind FROM lf_items WHERE description ILIKE $1 ORDER BY date DESC LIMIT 5`, [like])
    out.push(...l.map(x => ({ type: 'lostfound', icon: '🧦', title: x.description.slice(0, 60), sub: `${x.kind === 'lost' ? 'Lost report' : 'Found item'} · ${x.status}`, link: `/lostfound?focus=${x.id}` })))
  }
  if (can('incidents.view')) {
    const i = await rows(`SELECT id, code, title, severity FROM incidents WHERE NOT confidential AND (title ILIKE $1 OR code ILIKE $1) ORDER BY occurred_at DESC LIMIT 5`, [like])
    out.push(...i.map(x => ({ type: 'incident', icon: '🚨', title: x.title, sub: `${x.code} · severity ${x.severity}`, link: `/safety?focus=${x.id}` })))
  }
  res.json({ results: out.slice(0, 26) })
}))
