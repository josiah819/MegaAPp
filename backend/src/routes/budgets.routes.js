import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, notify, usersWithPerm } from '../lib.js'
import { upload } from '../upload.js'
import { uploadLimiter } from '../security.js'

/* Budgets & expenses — department envelopes with an approval queue.
   Submit (with a receipt photo) → pending → approve/reject. Approved spend
   drives burn; the watcher pings owners at 90%. */

export const router = Router()
// Submitters can browse budgets to log spending; full expense history needs budgets.view.
router.use(requirePerm('budgets.view', 'budgets.submit'))

const BUDGET_LIST = `
  SELECT b.*, b.amount::float AS amount, u.name AS owner_name, u.color AS owner_color,
    COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)::float AS spent,
    COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'pending'), 0)::float AS pending,
    COUNT(e.id) FILTER (WHERE e.status = 'pending')::int AS pending_count
  FROM budgets b
  LEFT JOIN users u ON u.id = b.owner_id
  LEFT JOIN expenses e ON e.budget_id = b.id
  GROUP BY b.id, u.name, u.color`

router.get('/', ah(async (req, res) => {
  const budgets = await rows(`${BUDGET_LIST} ORDER BY b.active DESC, b.name`)
  const totals = budgets.filter(b => b.active).reduce((acc, b) => ({
    budgeted: acc.budgeted + b.amount, spent: acc.spent + b.spent, pending: acc.pending + b.pending,
  }), { budgeted: 0, spent: 0, pending: 0 })
  res.json({ budgets, totals })
}))

router.get('/:id', ah(async (req, res) => {
  const b = await one(`${BUDGET_LIST} HAVING b.id = $1`, [Number(req.params.id)])
  if (!b) throw httpError(404, 'Budget not found')
  const mineOnly = !req.user.perms['budgets.view']
  b.expenses = await rows(
    `SELECT e.*, e.amount::float AS amount, su.name AS submitted_by_name, du.name AS decided_by_name
     FROM expenses e LEFT JOIN users su ON su.id = e.submitted_by LEFT JOIN users du ON du.id = e.decided_by
     WHERE e.budget_id = $1 ${mineOnly ? 'AND e.submitted_by = $2' : ''}
     ORDER BY e.date DESC, e.id DESC LIMIT 200`, mineOnly ? [b.id, req.user.id] : [b.id])
  res.json(b)
}))

router.post('/', requirePerm('budgets.manage'), ah(async (req, res) => {
  const { name, dept = '', period_start, period_end, amount = 0, owner_id, notes = '' } = req.body || {}
  if (!name?.trim()) throw httpError(400, 'The budget needs a name')
  const b = await one(
    `INSERT INTO budgets (name, dept, period_start, period_end, amount, owner_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name.trim(), dept, period_start || null, period_end || null, Number(amount) || 0, owner_id || null, notes])
  await audit(req.user, 'budget.create', 'budget', b.id, { name: b.name, amount: b.amount })
  res.status(201).json(b)
}))

router.patch('/:id', requirePerm('budgets.manage'), ah(async (req, res) => {
  const { name, dept, period_start, period_end, amount, owner_id, notes, active } = req.body || {}
  const b = await one(
    `UPDATE budgets SET
       name = COALESCE($2,name), dept = COALESCE($3,dept), period_start = COALESCE($4,period_start),
       period_end = COALESCE($5,period_end), amount = COALESCE($6,amount), owner_id = COALESCE($7,owner_id),
       notes = COALESCE($8,notes), active = COALESCE($9,active),
       alert_sent = CASE WHEN $6 IS NOT NULL THEN false ELSE alert_sent END
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, dept, period_start, period_end, amount, owner_id, notes,
      'active' in (req.body || {}) ? !!active : null])
  if (!b) throw httpError(404, 'Budget not found')
  await audit(req.user, 'budget.update', 'budget', b.id, { name: b.name })
  res.json(b)
}))

// ---- expenses ----
router.post('/:id/expenses', requirePerm('budgets.submit'), uploadLimiter, upload.single('receipt'), ah(async (req, res) => {
  const budgetId = Number(req.params.id)
  const b = await one(`SELECT * FROM budgets WHERE id = $1 AND active`, [budgetId])
  if (!b) throw httpError(404, 'Budget not found (or retired)')
  const { date, vendor = '', descr = '', amount, category = 'general' } = req.body || {}
  const amt = Number(amount)
  if (!(amt > 0)) throw httpError(400, 'Amount must be a positive number')
  const e = await one(
    `INSERT INTO expenses (budget_id, date, vendor, descr, amount, category, receipt, submitted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *, amount::float AS amount`,
    [budgetId, date || null, vendor, descr, amt, category, req.file?.filename || '', req.user.id])
  for (const uid of await usersWithPerm('budgets.approve')) {
    if (uid !== req.user.id) {
      notify(uid, { icon: '💸', title: `Expense pending: $${amt.toFixed(2)} — ${b.name}`, body: vendor || descr, link: `/budgets?focus=${budgetId}` })
    }
  }
  await audit(req.user, 'expense.submit', 'budget', budgetId, { amount: amt, vendor })
  res.status(201).json(e)
}))

router.post('/expenses/:eid/decide', requirePerm('budgets.approve'), ah(async (req, res) => {
  const { approve, note = '' } = req.body || {}
  const e = await one(
    `UPDATE expenses SET status = $2, decided_by = $3, decided_at = now(), note = $4
     WHERE id = $1 AND status = 'pending' RETURNING *, amount::float AS amount`,
    [Number(req.params.eid), approve ? 'approved' : 'rejected', req.user.id, String(note).slice(0, 300)])
  if (!e) throw httpError(404, 'No pending expense with that id')
  const b = await one(`SELECT name FROM budgets WHERE id = $1`, [e.budget_id])
  if (e.submitted_by && e.submitted_by !== req.user.id) {
    notify(e.submitted_by, {
      icon: approve ? '✅' : '🚫',
      title: `Expense ${approve ? 'approved' : 'rejected'}: $${e.amount.toFixed(2)}`,
      body: note || b?.name || '', link: `/budgets?focus=${e.budget_id}`,
    })
  }
  await audit(req.user, approve ? 'expense.approve' : 'expense.reject', 'budget', e.budget_id, { amount: e.amount })
  res.json(e)
}))

router.delete('/expenses/:eid', ah(async (req, res) => {
  // Submitters can pull back their own pending expense; approvers can remove any pending one.
  const e = await one(`SELECT * FROM expenses WHERE id = $1`, [Number(req.params.eid)])
  if (!e) throw httpError(404, 'Expense not found')
  if (e.status !== 'pending') throw httpError(400, 'Only pending expenses can be deleted — the decided ones are the paper trail')
  if (e.submitted_by !== req.user.id && !req.user.perms['budgets.approve']) {
    throw httpError(403, 'That isn’t your expense')
  }
  await q(`DELETE FROM expenses WHERE id = $1`, [e.id])
  res.json({ ok: true })
}))

// 90% burn alert — owner + managers hear it once per budget (reset when the amount changes).
export async function watchBudgetBurn() {
  const hot = await rows(
    `SELECT b.*, COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0)::float AS spent
     FROM budgets b LEFT JOIN expenses e ON e.budget_id = b.id
     WHERE b.active AND NOT b.alert_sent AND b.amount > 0
     GROUP BY b.id HAVING COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0) >= b.amount * 0.9`)
  if (!hot.length) return
  const { usersWithPerm } = await import('../lib.js')
  const managers = await usersWithPerm('budgets.manage')
  for (const b of hot) {
    await q(`UPDATE budgets SET alert_sent = true WHERE id = $1`, [b.id])
    const pct = Math.round((b.spent / Number(b.amount)) * 100)
    const who = new Set(managers)
    if (b.owner_id) who.add(b.owner_id)
    for (const uid of who) {
      notify(uid, { icon: '🔥', title: `${b.name} is at ${pct}% of budget`, body: `$${b.spent.toFixed(0)} of $${Number(b.amount).toFixed(0)} spent`, link: `/budgets?focus=${b.id}` })
    }
    console.log(`Budget alert: ${b.name} at ${pct}%`)
  }
}
