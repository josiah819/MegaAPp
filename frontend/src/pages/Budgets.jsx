import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Wallet, Receipt, Paperclip, Check, X } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import {
  PageHead, Card, Btn, Badge, Kicker, Field, Select, Sheet, EmptyState, PageLoader, ConfirmBtn,
} from '../components/ui.jsx'
import { Ring } from '../components/charts.jsx'
import { cx, fmtDate, money, money2, expenseStatus } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

/* Budgets — department envelopes with an approval queue. Submit with a
   receipt photo, approvers decide, burn tracks itself. */

const ringColor = pct => pct >= 95 ? '#B2402E' : pct >= 80 ? '#C75B26' : 'rgb(var(--c-accent))'

export default function Budgets() {
  const { can, toast, user, reload, settings } = useApp()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [detail, setDetail] = useState(null)
  const [expForm, setExpForm] = useState(null)
  const [budgetForm, setBudgetForm] = useState(null)
  const [people, setPeople] = useState([])
  const fileRef = useRef()

  const load = () => api.get('/budgets').then(setData).catch(e => { toast(e.message, 'err'); setData({ budgets: [], totals: {} }) })
  const openBudget = id => api.get(`/budgets/${id}`).then(setDetail).catch(e => toast(e.message, 'err'))

  useEffect(() => {
    load()
    if (can('people.view')) api.get('/people').then(setPeople).catch(() => {})
  }, []) // eslint-disable-line
  useEffect(() => {
    const focus = params.get('focus')
    if (focus && data) { openBudget(Number(focus)); setParams({}, { replace: true }) }
  }, [params, data]) // eslint-disable-line

  if (!data) return <PageLoader />
  const { budgets, totals } = data
  const active = budgets.filter(b => b.active)
  const canApprove = can('budgets.approve')
  const canSubmit = can('budgets.submit')

  async function submitExpense() {
    try {
      const f = expForm
      const extra = { date: f.date, vendor: f.vendor, descr: f.descr, amount: f.amount, category: f.category }
      if (f.file) await api.upload(`/budgets/${detail.id}/expenses`, [f.file], extra, 'receipt')
      else await api.upload(`/budgets/${detail.id}/expenses`, [], extra, 'receipt')
      toast('Expense submitted — pending approval 💸')
      setExpForm(null); openBudget(detail.id); load(); reload()
    } catch (e) { toast(e.message, 'err') }
  }

  async function decide(e, approve) {
    try {
      await api.post(`/budgets/expenses/${e.id}/decide`, { approve })
      toast(approve ? 'Approved ✅' : 'Rejected')
      openBudget(detail.id); load(); reload()
    } catch (e2) { toast(e2.message, 'err') }
  }

  async function saveBudget() {
    try {
      const f = budgetForm
      const body = { ...f, amount: Number(f.amount) || 0, owner_id: f.owner_id ? Number(f.owner_id) : null }
      f.id ? await api.patch(`/budgets/${f.id}`, body) : await api.post('/budgets', body)
      toast('Budget saved'); setBudgetForm(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Operate" title="Budgets" sub="Every envelope, its burn, and the receipts behind it."
        actions={can('budgets.manage') && (
          <Btn onClick={() => setBudgetForm({ name: '', dept: settings.org?.departments?.[0] || '', period_start: '', period_end: '', amount: '', owner_id: '', notes: '' })}>
            <Plus size={15} /> New budget
          </Btn>
        )} />

      {can('budgets.view') && (
        <Card className="p-4 mb-6 flex flex-wrap gap-x-8 gap-y-2">
          {[['Budgeted', totals.budgeted], ['Approved spend', totals.spent], ['Pending', totals.pending],
            ['Remaining', (totals.budgeted || 0) - (totals.spent || 0)]].map(([label, v]) => (
            <div key={label}>
              <div className="kicker text-dim">{label}</div>
              <div className="disp text-[24px] text-ink">{money(v)}</div>
            </div>
          ))}
        </Card>
      )}

      {active.length === 0 ? (
        <Card><EmptyState icon="💰" title="No budgets yet" body="Create the first envelope — Kitchen, Facilities, Program…" /></Card>
      ) : (
        <motion.div variants={stagger(0.03)} initial="initial" animate="animate" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {active.map(b => {
            const pct = b.amount ? Math.min(100, (b.spent / b.amount) * 100) : 0
            return (
              <motion.div variants={rise} key={b.id}>
                <Card className="p-4 cursor-pointer hover:shadow-lift transition h-full" onClick={() => openBudget(b.id)}>
                  <div className="flex items-center gap-3.5">
                    <Ring pct={pct} size={56} stroke={6} color={ringColor(pct)} />
                    <div className="min-w-0 flex-1">
                      <div className="font-head font-bold text-[14px] text-ink leading-snug">{b.name}</div>
                      <div className="text-[11.5px] text-dim">{b.dept}{b.owner_name ? ` · ${b.owner_name}` : ''}</div>
                    </div>
                    {b.pending_count > 0 && canApprove && (
                      <Badge className="bg-gold/15 text-gold shrink-0">{b.pending_count} to review</Badge>
                    )}
                  </div>
                  <div className="flex justify-between text-[12px] mt-3 font-head font-semibold">
                    <span className="text-dim">{money(b.spent)} spent</span>
                    <span className={pct >= 95 ? 'text-danger font-bold' : 'text-faint'}>{money(b.amount - b.spent)} left</span>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      {/* budget detail sheet */}
      <Sheet open={!!detail} onClose={() => { setDetail(null); setExpForm(null) }} kicker={detail?.dept || 'Budget'} title={detail?.name || ''} wide
        footer={<>
          {can('budgets.manage') && detail && (
            <Btn variant="ghost" onClick={() => { setBudgetForm({ ...detail, owner_id: detail.owner_id || '' }); setDetail(null) }}>Edit budget</Btn>
          )}
          <span className="flex-1" />
          <Btn variant="ghost" onClick={() => { setDetail(null); setExpForm(null) }}>Close</Btn>
        </>}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 bg-sunken/60 rounded-xl p-3.5">
              <Ring pct={detail.amount ? Math.min(100, (detail.spent / detail.amount) * 100) : 0} size={64} stroke={7}
                color={ringColor(detail.amount ? (detail.spent / detail.amount) * 100 : 0)} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 flex-1 text-[12.5px]">
                <div><span className="text-faint block">Budget</span><span className="font-head font-bold text-ink">{money(detail.amount)}</span></div>
                <div><span className="text-faint block">Approved</span><span className="font-head font-bold text-ink">{money(detail.spent)}</span></div>
                <div><span className="text-faint block">Pending</span><span className="font-head font-bold text-gold">{money(detail.pending)}</span></div>
                <div><span className="text-faint block">Remaining</span><span className={cx('font-head font-bold', detail.amount - detail.spent < 0 ? 'text-danger' : 'text-summer')}>{money(detail.amount - detail.spent)}</span></div>
              </div>
            </div>
            {detail.period_start && (
              <div className="text-[12px] text-faint">{fmtDate(detail.period_start)} – {fmtDate(detail.period_end)}{detail.notes ? ` · ${detail.notes}` : ''}</div>
            )}

            {canSubmit && !expForm && (
              <Btn size="sm" variant="soft" onClick={() => setExpForm({ date: new Date().toISOString().slice(0, 10), vendor: '', descr: '', amount: '', category: 'general', file: null })}>
                <Plus size={13} /> Log an expense
              </Btn>
            )}
            {expForm && (
              <div className="bg-sunken/60 rounded-xl p-3.5 space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Amount"><input type="number" step="0.01" min="0" className="input" value={expForm.amount} onChange={e => setExpForm(s => ({ ...s, amount: e.target.value }))} /></Field>
                  <Field label="Date"><input type="date" className="input" value={expForm.date} onChange={e => setExpForm(s => ({ ...s, date: e.target.value }))} /></Field>
                  <Field label="Vendor"><input className="input" value={expForm.vendor} placeholder="Home Hardware" onChange={e => setExpForm(s => ({ ...s, vendor: e.target.value }))} /></Field>
                  <Field label="Category"><input className="input" value={expForm.category} placeholder="parts, food, fuel…" onChange={e => setExpForm(s => ({ ...s, category: e.target.value }))} /></Field>
                </div>
                <Field label="What was it for?"><input className="input" value={expForm.descr} onChange={e => setExpForm(s => ({ ...s, descr: e.target.value }))} /></Field>
                <div className="flex items-center justify-between gap-2">
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden
                    onChange={e => setExpForm(s => ({ ...s, file: e.target.files?.[0] || null }))} />
                  <button onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 text-[12px] font-head font-bold text-brand hover:underline">
                    <Paperclip size={13} /> {expForm.file ? expForm.file.name : 'Attach receipt'}
                  </button>
                  <span className="flex gap-2">
                    <Btn size="sm" variant="ghost" onClick={() => setExpForm(null)}>Cancel</Btn>
                    <Btn size="sm" onClick={submitExpense} disabled={!(Number(expForm.amount) > 0)}>Submit</Btn>
                  </span>
                </div>
              </div>
            )}

            <div>
              <Kicker className="!text-dim mb-2">Expenses</Kicker>
              {(detail.expenses || []).length === 0 && <div className="text-[12.5px] text-faint">Nothing logged yet.</div>}
              <div className="space-y-1.5">
                {(detail.expenses || []).map(e => {
                  const st = expenseStatus(e.status)
                  return (
                    <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 bg-sunken/50">
                      <span className="font-head font-bold text-[13px] text-ink tnum">{money2(e.amount)}</span>
                      <span className="text-[12.5px] text-dim min-w-0 flex-1 truncate">
                        {e.vendor || e.descr || 'Expense'}{e.vendor && e.descr ? ` — ${e.descr}` : ''}
                        <span className="text-faint"> · {fmtDate(e.date)} · {e.submitted_by_name || 'staff'}</span>
                      </span>
                      {e.receipt && (
                        <a href={`/api/files/${e.receipt}`} target="_blank" rel="noreferrer" title="Receipt"
                          className="text-brand hover:underline"><Receipt size={14} /></a>
                      )}
                      <Badge className={st.cls}>{st.label}</Badge>
                      {e.status === 'pending' && canApprove && (
                        <span className="flex gap-1">
                          <Btn size="sm" variant="accent" onClick={() => decide(e, true)}><Check size={13} /></Btn>
                          <Btn size="sm" variant="soft" onClick={() => decide(e, false)}><X size={13} /></Btn>
                        </span>
                      )}
                      {e.status === 'pending' && e.submitted_by === user.id && !canApprove && (
                        <ConfirmBtn label="Withdraw?" onConfirm={async () => {
                          await api.del(`/budgets/expenses/${e.id}`); openBudget(detail.id); load()
                        }}>Withdraw</ConfirmBtn>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </Sheet>

      {/* budget editor */}
      <Sheet open={!!budgetForm} onClose={() => setBudgetForm(null)} kicker="Budgets" title={budgetForm?.id ? budgetForm.name : 'New budget'}
        footer={<><Btn variant="ghost" onClick={() => setBudgetForm(null)}>Cancel</Btn><Btn onClick={saveBudget} disabled={!budgetForm?.name?.trim()}>Save</Btn></>}>
        {budgetForm && (
          <div className="space-y-4">
            <Field label="Name"><input className="input" value={budgetForm.name} onChange={e => setBudgetForm(s => ({ ...s, name: e.target.value }))} placeholder="Kitchen — Q3" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Department">
                <Select value={budgetForm.dept} onChange={v => setBudgetForm(s => ({ ...s, dept: v }))}>
                  {(settings.org?.departments || ['General']).map(d => <option key={d} value={d}>{d}</option>)}
                </Select>
              </Field>
              <Field label="Amount"><input type="number" min="0" className="input" value={budgetForm.amount} onChange={e => setBudgetForm(s => ({ ...s, amount: e.target.value }))} /></Field>
              <Field label="From"><input type="date" className="input" value={budgetForm.period_start ? String(budgetForm.period_start).slice(0, 10) : ''} onChange={e => setBudgetForm(s => ({ ...s, period_start: e.target.value }))} /></Field>
              <Field label="To"><input type="date" className="input" value={budgetForm.period_end ? String(budgetForm.period_end).slice(0, 10) : ''} onChange={e => setBudgetForm(s => ({ ...s, period_end: e.target.value }))} /></Field>
            </div>
            <Field label="Owner">
              <Select value={budgetForm.owner_id || ''} onChange={v => setBudgetForm(s => ({ ...s, owner_id: v }))}>
                <option value="">— none —</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Notes"><input className="input" value={budgetForm.notes || ''} onChange={e => setBudgetForm(s => ({ ...s, notes: e.target.value }))} /></Field>
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}
