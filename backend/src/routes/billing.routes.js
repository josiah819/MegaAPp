import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, getSetting, todayISO } from '../lib.js'

export const router = Router()
router.use(requirePerm('bookings.billing'))

const subtotal = items => (items || []).reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0)

// Status is derived live: a stored 'sent' becomes partial / paid / overdue from payments + due date.
function derive(inv, paid) {
  const total = subtotal(inv.items) * (1 + Number(inv.tax_rate || 0) / 100)
  if (inv.status === 'draft' || inv.status === 'void') return inv.status
  if (paid >= total - 0.005 && total > 0) return 'paid'
  if (inv.due_date && String(inv.due_date) < todayISO()) return 'overdue'
  if (paid > 0) return 'partial'
  return 'sent'
}

async function nextNumber() {
  const billing = await getSetting('billing', {})
  const prefix = billing.invoice_prefix || 'INV-'
  const r = await one(`SELECT number FROM invoices ORDER BY id DESC LIMIT 1`)
  const n = r ? parseInt(String(r.number).replace(/^\D+/, ''), 10) + 1 : 1001
  return `${prefix}${isNaN(n) ? Date.now() % 100000 : n}`
}

router.get('/', ah(async (req, res) => {
  const list = await rows(
    `SELECT i.*, b.name AS booking_name, b.code AS booking_code, c.name AS customer_name,
       COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id),0)::numeric AS paid
     FROM invoices i LEFT JOIN bookings b ON b.id = i.booking_id LEFT JOIN customers c ON c.id = i.customer_id
     ORDER BY i.created_at DESC LIMIT 400`)
  for (const i of list) {
    i.subtotal = subtotal(i.items)
    i.total = i.subtotal * (1 + Number(i.tax_rate || 0) / 100)
    i.derived = derive(i, Number(i.paid))
  }
  const collected30 = await one(
    `SELECT COALESCE(SUM(amount),0)::numeric AS v FROM payments WHERE created_at > now() - interval '30 days'`)
  res.json({
    invoices: list,
    stats: {
      outstanding: list.filter(i => ['sent', 'partial', 'overdue'].includes(i.derived)).reduce((a, i) => a + i.total - Number(i.paid), 0),
      overdue: list.filter(i => i.derived === 'overdue').reduce((a, i) => a + i.total - Number(i.paid), 0),
      collected30: Number(collected30.v),
    },
  })
}))

router.get('/:id', ah(async (req, res) => {
  const i = await one(
    `SELECT i.*, b.name AS booking_name, b.code AS booking_code, b.start_date, b.end_date,
       c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM invoices i LEFT JOIN bookings b ON b.id = i.booking_id LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1`, [Number(req.params.id)])
  if (!i) throw httpError(404, 'Invoice not found')
  i.payments = await rows(
    `SELECT p.*, u.name AS by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by
     WHERE p.invoice_id = $1 ORDER BY p.date, p.created_at`, [i.id])
  i.paid = i.payments.reduce((a, p) => a + Number(p.amount), 0)
  i.subtotal = subtotal(i.items)
  i.total = i.subtotal * (1 + Number(i.tax_rate || 0) / 100)
  i.derived = derive(i, i.paid)
  res.json(i)
}))

router.post('/', ah(async (req, res) => {
  const { booking_id, customer_id, items = [], issue_date, due_date, tax_rate, notes = '' } = req.body || {}
  const billing = await getSetting('billing', {})
  let custId = customer_id || null
  if (booking_id && !custId) {
    const b = await one(`SELECT customer_id FROM bookings WHERE id = $1`, [booking_id])
    custId = b?.customer_id || null
  }
  const inv = await one(
    `INSERT INTO invoices (number, booking_id, customer_id, status, issue_date, due_date, tax_rate, items, notes, created_by)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9) RETURNING *`,
    [await nextNumber(), booking_id || null, custId, issue_date || todayISO(),
      due_date || null, tax_rate ?? billing.tax_rate ?? 13, JSON.stringify(items), notes, req.user.id])
  await audit(req.user, 'invoice.create', 'invoice', inv.id, { number: inv.number })
  res.status(201).json(inv)
}))

router.patch('/:id', ah(async (req, res) => {
  const id = Number(req.params.id)
  const { items, issue_date, due_date, tax_rate, notes, status, booking_id, customer_id } = req.body || {}
  if (status && !['draft', 'sent', 'void'].includes(status)) throw httpError(400, 'Status can be draft, sent, or void — the rest is derived from payments')
  const inv = await one(
    `UPDATE invoices SET
       items = COALESCE($2, items), issue_date = COALESCE($3, issue_date), due_date = COALESCE($4, due_date),
       tax_rate = COALESCE($5, tax_rate), notes = COALESCE($6, notes), status = COALESCE($7, status),
       booking_id = COALESCE($8, booking_id), customer_id = COALESCE($9, customer_id), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, items ? JSON.stringify(items) : null, issue_date, due_date, tax_rate, notes, status, booking_id, customer_id])
  if (!inv) throw httpError(404, 'Invoice not found')
  if (status) await audit(req.user, `invoice.${status}`, 'invoice', id, { number: inv.number })
  res.json(inv)
}))

router.post('/:id/payments', ah(async (req, res) => {
  const id = Number(req.params.id)
  const inv = await one(`SELECT id, number FROM invoices WHERE id = $1`, [id])
  if (!inv) throw httpError(404, 'Invoice not found')
  const amount = Number(req.body?.amount)
  if (!amount || amount <= 0) throw httpError(400, 'Enter the amount received')
  const p = await one(
    `INSERT INTO payments (invoice_id, date, amount, method, reference, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, req.body?.date || todayISO(), amount, req.body?.method || 'e-transfer',
      req.body?.reference || '', req.body?.notes || '', req.user.id])
  await q(`UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, updated_at = now() WHERE id = $1`, [id])
  await audit(req.user, 'payment.record', 'invoice', id, { number: inv.number, amount })
  res.status(201).json(p)
}))

router.delete('/payments/:pid', ah(async (req, res) => {
  const p = await one(`DELETE FROM payments WHERE id = $1 RETURNING invoice_id, amount`, [Number(req.params.pid)])
  if (!p) throw httpError(404, 'Payment not found')
  await audit(req.user, 'payment.delete', 'invoice', p.invoice_id, { amount: p.amount })
  res.json({ ok: true })
}))

router.delete('/:id', ah(async (req, res) => {
  const inv = await one(`SELECT status, number FROM invoices WHERE id = $1`, [Number(req.params.id)])
  if (!inv) throw httpError(404, 'Invoice not found')
  if (inv.status !== 'draft') throw httpError(400, 'Only drafts can be deleted — void it instead so the books stay honest')
  await q(`DELETE FROM invoices WHERE id = $1`, [Number(req.params.id)])
  await audit(req.user, 'invoice.delete', 'invoice', req.params.id, inv)
  res.json({ ok: true })
}))
