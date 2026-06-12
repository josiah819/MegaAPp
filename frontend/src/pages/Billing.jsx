import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Printer, ReceiptText, CircleDollarSign, AlertTriangle, HandCoins } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Kicker, Btn, Badge, Sheet, Field, Select, PageLoader, EmptyState, SearchInput, StatTile, ConfirmBtn } from '../components/ui.jsx'
import { cx, money, fmtDate, todayISO, addDays, invoiceStatus, INVOICE_STATUSES } from '../lib.js'
import { pageAnim } from '../motion.js'

const sub = items => (items || []).reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0)

export default function Billing() {
  const { toast, settings } = useApp()
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('')
  const [status, setStatus] = useState('all')
  const [openId, setOpenId] = useState(null)     // invoice id | 'new'
  const [inv, setInv] = useState(null)           // working copy
  const [bookings, setBookings] = useState([])
  const [pay, setPay] = useState(null)           // payment form state

  const load = () => api.get('/billing').then(setData).catch(e => toast(e.message, 'err'))
  useEffect(() => {
    load()
    api.get('/bookings').then(setBookings).catch(() => {})
    const focus = new URLSearchParams(location.search).get('focus')
    if (focus) openInvoice(Number(focus))
  }, []) // eslint-disable-line

  async function openInvoice(id) {
    if (id === 'new') {
      setInv({
        id: null, number: '(assigned on save)', status: 'draft', booking_id: '',
        issue_date: todayISO(), due_date: addDays(todayISO(), 30),
        tax_rate: settings.billing?.tax_rate ?? 13,
        items: [{ description: '', qty: 1, unit_price: '' }], notes: '', payments: [], paid: 0,
      })
      setOpenId('new')
      return
    }
    try {
      const r = await api.get(`/billing/${id}`)
      setInv(r); setOpenId(id)
    } catch (e) { toast(e.message, 'err') }
  }

  async function save(extra = {}) {
    const body = {
      booking_id: inv.booking_id || null, items: inv.items.filter(i => i.description.trim()),
      issue_date: inv.issue_date, due_date: inv.due_date, tax_rate: Number(inv.tax_rate) || 0, notes: inv.notes, ...extra,
    }
    try {
      if (openId === 'new') {
        const r = await api.post('/billing', body)
        toast(`Invoice ${r.number} created`)
        setOpenId(r.id); openInvoice(r.id)
      } else {
        await api.patch(`/billing/${inv.id}`, body)
        toast(extra.status === 'sent' ? 'Marked as sent ✉️' : 'Invoice saved')
        openInvoice(inv.id)
      }
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function recordPayment() {
    try {
      await api.post(`/billing/${inv.id}/payments`, { ...pay, amount: Number(pay.amount) })
      toast('Payment recorded 💸')
      setPay(null); openInvoice(inv.id); load()
    } catch (e) { toast(e.message, 'err') }
  }

  const list = useMemo(() => (data?.invoices || []).filter(i => {
    if (status !== 'all' && i.derived !== status) return false
    if (filter && !`${i.number} ${i.customer_name || ''} ${i.booking_name || ''}`.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  }), [data, filter, status])

  if (!data) return <PageLoader />
  const taxLabel = settings.billing?.tax_label || 'HST'
  const subtotal = inv ? sub(inv.items) : 0
  const tax = inv ? subtotal * (Number(inv.tax_rate) || 0) / 100 : 0
  const total = subtotal + tax
  const balance = inv ? total - Number(inv.paid || 0) : 0
  const locked = inv && (inv.derived === 'paid' || inv.status === 'void')

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Operate" title="Billing" sub="Invoices, payments, and what's still on the table."
        actions={<Btn onClick={() => openInvoice('new')}><Plus size={15} /> New invoice</Btn>} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <StatTile label="Outstanding" value={Math.round(data.stats.outstanding)} icon={<CircleDollarSign size={19} />} sub="across sent invoices" />
        <StatTile label="Overdue" value={Math.round(data.stats.overdue)} icon={<AlertTriangle size={19} />} tone="text-danger" sub="past due date" />
        <StatTile label="Collected · 30d" value={Math.round(data.stats.collected30)} icon={<HandCoins size={19} />} tone="text-summer" sub="payments received" />
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <SearchInput value={filter} onChange={setFilter} placeholder="Invoice #, group, customer…" className="w-full sm:w-72" />
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {['all', ...INVOICE_STATUSES.map(s => s.v)].map(v => (
            <button key={v} onClick={() => setStatus(v)}
              className={cx('px-2.5 py-1 rounded-full text-[11.5px] font-head font-bold capitalize transition whitespace-nowrap',
                status === v ? 'bg-brand text-white' : 'bg-sunken text-dim hover:text-ink')}>
              {v === 'all' ? 'All' : invoiceStatus(v).label}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0
        ? <EmptyState icon="🧾" title="No invoices here" body="Create one from scratch or straight off a booking." />
        : (
          <Card className="overflow-x-auto scroll-x">
            <table className="tbl tbl-hover min-w-[680px]">
              <thead><tr><th>Invoice</th><th>Group / customer</th><th>Issued</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
              <tbody>
                {list.map(i => {
                  const bal = i.total - Number(i.paid)
                  return (
                    <tr key={i.id} onClick={() => openInvoice(i.id)}>
                      <td className="font-head font-bold text-ink whitespace-nowrap">{i.number}</td>
                      <td className="max-w-[260px]">
                        <span className="block truncate text-ink">{i.booking_name || '—'}</span>
                        <span className="block truncate text-[11.5px] text-faint">{i.customer_name || ''}</span>
                      </td>
                      <td className="text-dim whitespace-nowrap">{fmtDate(i.issue_date)}</td>
                      <td className={cx('whitespace-nowrap', i.derived === 'overdue' ? 'text-danger font-semibold' : 'text-dim')}>{fmtDate(i.due_date)}</td>
                      <td className="text-right tnum text-ink">{money(i.total)}</td>
                      <td className={cx('text-right tnum', bal > 0.005 ? 'text-ink font-semibold' : 'text-faint')}>{money(bal)}</td>
                      <td><Badge className={invoiceStatus(i.derived).cls}>{invoiceStatus(i.derived).label}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}

      {/* invoice sheet */}
      <Sheet open={!!openId} onClose={() => { setOpenId(null); setInv(null); setPay(null) }} wide
        kicker={inv ? invoiceStatus(inv.derived || inv.status).label : 'Billing'}
        title={inv ? (openId === 'new' ? 'New invoice' : inv.number) : ''}
        footer={inv && <>
          {openId !== 'new' && inv.status === 'draft' && (
            <ConfirmBtn label="Delete draft?" onConfirm={async () => {
              try { await api.del(`/billing/${inv.id}`); toast('Draft deleted'); setOpenId(null); load() } catch (e) { toast(e.message, 'err') }
            }}><Trash2 size={14} /></ConfirmBtn>
          )}
          {openId !== 'new' && <Btn variant="ghost" onClick={() => window.print()}><Printer size={14} /> Print</Btn>}
          <span className="flex-1" />
          {!locked && <Btn variant="soft" onClick={() => save()}>Save</Btn>}
          {!locked && inv.status === 'draft' && openId !== 'new' && (
            <Btn variant="accent" onClick={() => save({ status: 'sent' })}>Mark sent</Btn>
          )}
          {openId === 'new' && <Btn onClick={() => save()} disabled={!inv.items.some(i => i.description.trim())}>Create</Btn>}
        </>}>
        {inv && (
          <div className="space-y-5 print-invoice">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Booking">
                <Select value={inv.booking_id || ''} onChange={v => setInv(s => ({ ...s, booking_id: v ? Number(v) : '' }))} disabled={locked}>
                  <option value="">— none —</option>
                  {bookings.map(b => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issued"><input type="date" className="input" value={inv.issue_date?.slice(0, 10) || ''} onChange={e => setInv(s => ({ ...s, issue_date: e.target.value }))} disabled={locked} /></Field>
                <Field label="Due"><input type="date" className="input" value={inv.due_date?.slice(0, 10) || ''} onChange={e => setInv(s => ({ ...s, due_date: e.target.value }))} disabled={locked} /></Field>
              </div>
            </div>

            <div>
              <Kicker className="!text-dim mb-2">Line items</Kicker>
              <div className="space-y-2">
                {inv.items.map((it, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <input className="input flex-1 min-w-0" placeholder="Description" value={it.description} disabled={locked}
                      onChange={e => setInv(s => ({ ...s, items: s.items.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
                    <input className="input !w-[76px] shrink-0 text-right" type="number" placeholder="Qty" value={it.qty} disabled={locked}
                      onChange={e => setInv(s => ({ ...s, items: s.items.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) }))} />
                    <input className="input !w-[110px] shrink-0 text-right" type="number" placeholder="Unit $" value={it.unit_price} disabled={locked}
                      onChange={e => setInv(s => ({ ...s, items: s.items.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x) }))} />
                    <span className="input !w-[110px] shrink-0 text-right bg-sunken border-transparent tnum hidden sm:inline-block">{money((Number(it.qty) || 0) * (Number(it.unit_price) || 0))}</span>
                    {!locked && (
                      <button className="p-2 text-faint hover:text-danger transition" onClick={() => setInv(s => ({ ...s, items: s.items.filter((_, j) => j !== i) }))}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!locked && (
                <Btn size="sm" variant="ghost" className="mt-2" onClick={() => setInv(s => ({ ...s, items: [...s.items, { description: '', qty: 1, unit_price: '' }] }))}>
                  <Plus size={13} /> Add line
                </Btn>
              )}
            </div>

            <div className="flex justify-end">
              <div className="w-full sm:w-64 space-y-1.5 text-[13.5px]">
                <div className="flex justify-between text-dim"><span>Subtotal</span><span className="tnum">{money(subtotal)}</span></div>
                <div className="flex justify-between text-dim items-center gap-2">
                  <span className="flex items-center gap-1.5">{taxLabel}
                    <input className="input !w-[58px] !py-0.5 !px-1.5 text-right !text-[12px]" type="number" value={inv.tax_rate} disabled={locked}
                      onChange={e => setInv(s => ({ ...s, tax_rate: e.target.value }))} />%
                  </span>
                  <span className="tnum">{money(tax)}</span>
                </div>
                <div className="flex justify-between font-head font-bold text-ink text-[15px] pt-1.5 border-t border-line"><span>Total</span><span className="tnum">{money(total)}</span></div>
                {Number(inv.paid) > 0 && <div className="flex justify-between text-summer"><span>Paid</span><span className="tnum">−{money(inv.paid)}</span></div>}
                {Number(inv.paid) > 0 && <div className="flex justify-between font-head font-bold text-ink"><span>Balance</span><span className="tnum">{money(balance)}</span></div>}
              </div>
            </div>

            {openId !== 'new' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Kicker className="!text-dim">Payments</Kicker>
                  {!pay && inv.status !== 'void' && balance > 0.005 && (
                    <Btn size="sm" variant="soft" onClick={() => setPay({ amount: balance.toFixed(2), date: todayISO(), method: 'e-transfer', reference: '' })}>
                      <ReceiptText size={13} /> Record payment
                    </Btn>
                  )}
                </div>
                {inv.payments.length === 0 && !pay && <div className="text-[12.5px] text-faint">Nothing received yet.</div>}
                <div className="space-y-1.5">
                  {inv.payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between bg-sunken/60 rounded-xl px-3 py-2 text-[13px]">
                      <span className="text-ink">{fmtDate(p.date)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                      <span className="tnum font-semibold text-summer">{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
                {pay && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                    <Field label="Amount"><input className="input" type="number" value={pay.amount} onChange={e => setPay(s => ({ ...s, amount: e.target.value }))} /></Field>
                    <Field label="Date"><input className="input" type="date" value={pay.date} onChange={e => setPay(s => ({ ...s, date: e.target.value }))} /></Field>
                    <Field label="Method">
                      <Select value={pay.method} onChange={v => setPay(s => ({ ...s, method: v }))}>
                        {['e-transfer', 'cheque', 'card', 'cash'].map(m => <option key={m} value={m}>{m}</option>)}
                      </Select>
                    </Field>
                    <div className="flex gap-1.5">
                      <Btn size="sm" onClick={recordPayment} disabled={!Number(pay.amount)}>Save</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setPay(null)}>Cancel</Btn>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Field label="Notes (shows on the invoice)">
              <textarea className="input" rows={2} value={inv.notes || ''} disabled={locked}
                onChange={e => setInv(s => ({ ...s, notes: e.target.value }))}
                placeholder={settings.billing?.payment_instructions || ''} />
            </Field>
            {openId !== 'new' && inv.status !== 'void' && !locked && (
              <button className="text-[12px] font-head font-bold text-faint hover:text-danger transition" onClick={() => save({ status: 'void' })}>
                Void this invoice
              </button>
            )}
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}
