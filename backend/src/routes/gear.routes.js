import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, notify } from '../lib.js'

/* Gear & Equipment — the camp checkout desk. Kayaks, GoPros, radios, harnesses:
   every item has a quantity, every loan has a due-back, and the overdue watcher
   nags. (The hospitality-stack “asset/rental tracking” feature, camp-shaped.) */

export const router = Router()
router.use(requirePerm('gear.view'))

const ITEM_LIST = `
  SELECT g.*, l.name AS location_name,
    COALESCE(SUM(ln.qty) FILTER (WHERE ln.returned_at IS NULL), 0)::int AS out
  FROM gear_items g
  LEFT JOIN locations l ON l.id = g.location_id
  LEFT JOIN gear_loans ln ON ln.item_id = g.id
  GROUP BY g.id, l.name`

router.get('/', ah(async (req, res) => {
  const [items, loans] = await Promise.all([
    rows(`${ITEM_LIST} ORDER BY g.active DESC, g.category, g.name`),
    rows(
      `SELECT ln.*, g.name AS item_name, g.category, COALESCE(u.name, ln.borrower_name) AS borrower,
              u.color AS borrower_color, ob.name AS out_by_name, b.name AS booking_name,
              (ln.due_at < now() AND ln.returned_at IS NULL) AS overdue
       FROM gear_loans ln
       JOIN gear_items g ON g.id = ln.item_id
       LEFT JOIN users u ON u.id = ln.borrower_id
       LEFT JOIN users ob ON ob.id = ln.out_by
       LEFT JOIN bookings b ON b.id = ln.booking_id
       WHERE ln.returned_at IS NULL ORDER BY ln.due_at`),
  ])
  res.json({ items, loans })
}))

router.get('/items/:id', ah(async (req, res) => {
  const item = await one(`${ITEM_LIST} HAVING g.id = $1`, [Number(req.params.id)])
  if (!item) throw httpError(404, 'Gear item not found')
  item.history = await rows(
    `SELECT ln.*, COALESCE(u.name, ln.borrower_name) AS borrower, ib.name AS in_by_name,
            (ln.due_at < now() AND ln.returned_at IS NULL) AS overdue
     FROM gear_loans ln LEFT JOIN users u ON u.id = ln.borrower_id LEFT JOIN users ib ON ib.id = ln.in_by
     WHERE ln.item_id = $1 ORDER BY ln.out_at DESC LIMIT 30`, [item.id])
  res.json(item)
}))

router.post('/items', requirePerm('gear.manage'), ah(async (req, res) => {
  const { name, category = 'General', qty_total = 1, location_id, condition = 'good', requires_training = false, notes = '' } = req.body || {}
  if (!name?.trim()) throw httpError(400, 'The item needs a name')
  const g = await one(
    `INSERT INTO gear_items (name, category, qty_total, location_id, condition, requires_training, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name.trim(), category, Math.max(1, Number(qty_total) || 1), location_id || null, condition, !!requires_training, notes])
  await audit(req.user, 'gear.item_create', 'gear', g.id, { name: g.name, qty: g.qty_total })
  res.status(201).json(g)
}))

router.patch('/items/:id', requirePerm('gear.manage'), ah(async (req, res) => {
  const { name, category, qty_total, location_id, condition, requires_training, notes, active } = req.body || {}
  const g = await one(
    `UPDATE gear_items SET
       name = COALESCE($2,name), category = COALESCE($3,category), qty_total = COALESCE($4,qty_total),
       location_id = COALESCE($5,location_id), condition = COALESCE($6,condition),
       requires_training = COALESCE($7,requires_training), notes = COALESCE($8,notes), active = COALESCE($9,active)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, category, qty_total, location_id, condition,
      'requires_training' in (req.body || {}) ? !!requires_training : null, notes,
      'active' in (req.body || {}) ? !!active : null])
  if (!g) throw httpError(404, 'Gear item not found')
  await audit(req.user, 'gear.item_update', 'gear', g.id, { name: g.name })
  res.json(g)
}))

router.delete('/items/:id', requirePerm('gear.manage'), ah(async (req, res) => {
  const open = await one(`SELECT COUNT(*)::int AS n FROM gear_loans WHERE item_id = $1 AND returned_at IS NULL`, [Number(req.params.id)])
  if (open.n) throw httpError(400, 'Items with open loans can’t be deleted — return them first')
  await q(`DELETE FROM gear_items WHERE id = $1`, [Number(req.params.id)])
  await audit(req.user, 'gear.item_delete', 'gear', req.params.id)
  res.json({ ok: true })
}))

// ---- checkout / return ----
router.post('/checkout', requirePerm('gear.checkout'), ah(async (req, res) => {
  const { item_id, qty = 1, borrower_id, borrower_name = '', booking_id, due_at, notes = '' } = req.body || {}
  const g = await one(`SELECT * FROM gear_items WHERE id = $1 AND active`, [Number(item_id)])
  if (!g) throw httpError(404, 'Gear item not found')
  if (!borrower_id && !borrower_name.trim()) throw httpError(400, 'Who is taking it?')
  const n = Math.max(1, Number(qty) || 1)
  const out = await one(`SELECT COALESCE(SUM(qty),0)::int AS n FROM gear_loans WHERE item_id = $1 AND returned_at IS NULL`, [g.id])
  if (out.n + n > g.qty_total) throw httpError(400, `Only ${g.qty_total - out.n} of ${g.qty_total} available right now`)
  const loan = await one(
    `INSERT INTO gear_loans (item_id, qty, borrower_id, borrower_name, booking_id, due_at, out_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [g.id, n, borrower_id || null, borrower_id ? '' : borrower_name.trim(), booking_id || null,
      due_at || null, req.user.id, notes])
  if (borrower_id && borrower_id !== req.user.id) {
    notify(borrower_id, { icon: '🛶', title: `Gear signed out to you: ${g.name} ×${n}`, body: due_at ? `Due back ${new Date(due_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}` : '', link: '/gear' })
  }
  await audit(req.user, 'gear.checkout', 'gear', g.id, { item: g.name, qty: n })
  res.status(201).json(loan)
}))

router.post('/loans/:id/return', requirePerm('gear.checkout'), ah(async (req, res) => {
  const { condition_in = '', notes = '' } = req.body || {}
  const loan = await one(
    `UPDATE gear_loans SET returned_at = now(), in_by = $2, condition_in = $3,
       notes = CASE WHEN $4 != '' THEN trim(BOTH ' ·' FROM notes || ' · ' || $4) ELSE notes END
     WHERE id = $1 AND returned_at IS NULL RETURNING *`,
    [Number(req.params.id), req.user.id, condition_in, notes])
  if (!loan) throw httpError(404, 'No open loan with that id')
  if (condition_in === 'damaged') {
    await q(`UPDATE gear_items SET condition = 'damaged' WHERE id = $1`, [loan.item_id])
  }
  const g = await one(`SELECT name FROM gear_items WHERE id = $1`, [loan.item_id])
  await audit(req.user, 'gear.return', 'gear', loan.item_id, { item: g?.name, condition: condition_in })
  res.json(loan)
}))

// Overdue sweep — called by the scheduler. One nag per loan: the borrower
// (when they're staff) plus everyone who manages gear.
export async function watchOverdueGear() {
  const { usersWithPerm } = await import('../lib.js')
  const late = await rows(
    `SELECT ln.*, g.name AS item_name FROM gear_loans ln JOIN gear_items g ON g.id = ln.item_id
     WHERE ln.returned_at IS NULL AND ln.due_at < now() AND NOT ln.overdue_notified`)
  if (!late.length) return
  const managers = await usersWithPerm('gear.manage')
  for (const ln of late) {
    await q(`UPDATE gear_loans SET overdue_notified = true WHERE id = $1`, [ln.id])
    const who = new Set(managers)
    if (ln.borrower_id) who.add(ln.borrower_id)
    for (const uid of who) {
      notify(uid, {
        icon: '⏰', title: `Gear overdue: ${ln.item_name} ×${ln.qty}`,
        body: ln.borrower_name || 'Signed out to staff', link: '/gear',
      })
    }
    console.log(`Gear overdue: ${ln.item_name} loan #${ln.id}`)
  }
}
