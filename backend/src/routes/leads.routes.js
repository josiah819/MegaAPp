import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, notify } from '../lib.js'

export const router = Router()
router.use(requirePerm('bookings.leads'))

export const LEAD_STAGES = ['new', 'contacted', 'tour', 'proposal', 'won', 'lost']

router.get('/', ah(async (req, res) => {
  const leads = await rows(
    `SELECT ld.*, u.name AS owner_name, u.color AS owner_color, b.code AS booking_code
     FROM leads ld LEFT JOIN users u ON u.id = ld.owner_id LEFT JOIN bookings b ON b.id = ld.booking_id
     ORDER BY ld.ord, ld.created_at DESC LIMIT 400`)
  const funnel = await rows(`SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(value_estimate),0)::numeric AS value FROM leads GROUP BY stage`)
  res.json({ leads, funnel, stages: LEAD_STAGES })
}))

router.post('/', ah(async (req, res) => {
  const { name, organization = '', contact_name = '', email = '', phone = '', segment = 'retreat',
    expected_headcount, preferred_start, preferred_end, message = '', value_estimate = 0, owner_id } = req.body || {}
  if (!name) throw httpError(400, 'Give the lead a name')
  const ld = await one(
    `INSERT INTO leads (name, organization, contact_name, email, phone, segment, expected_headcount,
       preferred_start, preferred_end, message, value_estimate, owner_id, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual') RETURNING *`,
    [name, organization, contact_name, email, phone, segment, expected_headcount || null,
      preferred_start || null, preferred_end || null, message, value_estimate || 0, owner_id || req.user.id])
  if (owner_id && owner_id !== req.user.id) {
    notify(owner_id, { icon: '🎯', title: `Lead assigned to you: ${name}`, body: organization, link: '/leads' })
  }
  await audit(req.user, 'lead.create', 'lead', ld.id, { name })
  res.status(201).json(ld)
}))

router.patch('/:id', ah(async (req, res) => {
  const id = Number(req.params.id)
  const { name, organization, contact_name, email, phone, segment, stage, expected_headcount,
    preferred_start, preferred_end, message, value_estimate, owner_id, lost_reason, ord } = req.body || {}
  if (stage && !LEAD_STAGES.includes(stage)) throw httpError(400, 'Unknown stage')
  const before = await one(`SELECT stage, owner_id FROM leads WHERE id = $1`, [id])
  if (!before) throw httpError(404, 'Lead not found')
  const ld = await one(
    `UPDATE leads SET
       name = COALESCE($2,name), organization = COALESCE($3,organization), contact_name = COALESCE($4,contact_name),
       email = COALESCE($5,email), phone = COALESCE($6,phone), segment = COALESCE($7,segment),
       stage = COALESCE($8,stage), expected_headcount = COALESCE($9,expected_headcount),
       preferred_start = COALESCE($10,preferred_start), preferred_end = COALESCE($11,preferred_end),
       message = COALESCE($12,message), value_estimate = COALESCE($13,value_estimate),
       owner_id = COALESCE($14,owner_id), lost_reason = COALESCE($15,lost_reason),
       ord = COALESCE($16,ord), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name, organization, contact_name, email, phone, segment, stage, expected_headcount,
      preferred_start, preferred_end, message, value_estimate, owner_id, lost_reason, ord])
  if (stage && stage !== before.stage) await audit(req.user, `lead.${stage}`, 'lead', id, { from: before.stage })
  if (owner_id && owner_id !== before.owner_id && owner_id !== req.user.id) {
    notify(owner_id, { icon: '🎯', title: `Lead assigned to you: ${ld.name}`, body: ld.organization, link: '/leads' })
  }
  res.json(ld)
}))

// Win the lead: create the customer (if new) and a tentative booking in one move.
router.post('/:id/convert', ah(async (req, res) => {
  const id = Number(req.params.id)
  const ld = await one(`SELECT * FROM leads WHERE id = $1`, [id])
  if (!ld) throw httpError(404, 'Lead not found')
  if (ld.booking_id) throw httpError(400, 'Already converted')
  const { start_date, end_date } = req.body || {}
  const s = start_date || ld.preferred_start
  const e = end_date || ld.preferred_end || s
  if (!s) throw httpError(400, 'Pick the booking dates first')

  let customerId = ld.customer_id
  if (!customerId) {
    const c = await one(
      `INSERT INTO customers (name, type, email, phone, notes) VALUES ($1,'organization',$2,$3,$4) RETURNING id`,
      [ld.organization || ld.name, ld.email, ld.phone, ld.contact_name ? `Contact: ${ld.contact_name}` : ''])
    customerId = c.id
  }
  const code = await (async () => {
    const r = await one(`SELECT code FROM bookings WHERE code LIKE 'BK-%' ORDER BY id DESC LIMIT 1`)
    const n = r ? parseInt(r.code.slice(3), 10) + 1 : 1001
    return `BK-${isNaN(n) ? Date.now() % 10000 : n}`
  })()
  const b = await one(
    `INSERT INTO bookings (code, name, customer_id, status, segment, start_date, end_date, headcount, value, notes, created_by)
     VALUES ($1,$2,$3,'tentative',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [code, ld.name, customerId, ld.segment, s, e, ld.expected_headcount || 0, ld.value_estimate || 0,
      ld.message ? `From lead: ${ld.message}` : '', req.user.id])
  await q(`UPDATE leads SET stage = 'won', customer_id = $2, booking_id = $3, updated_at = now() WHERE id = $1`,
    [id, customerId, b.id])
  await audit(req.user, 'lead.convert', 'lead', id, { booking: b.code })
  res.status(201).json({ booking: b })
}))

router.delete('/:id', ah(async (req, res) => {
  const ld = await one(`DELETE FROM leads WHERE id = $1 RETURNING name`, [Number(req.params.id)])
  if (!ld) throw httpError(404, 'Lead not found')
  await audit(req.user, 'lead.delete', 'lead', req.params.id, ld)
  res.json({ ok: true })
}))
