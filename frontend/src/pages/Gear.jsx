import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Backpack, Undo2, AlertTriangle } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import {
  PageHead, Card, Btn, Badge, Kicker, Field, Select, Sheet, Avatar, SearchInput,
  EmptyState, PageLoader, StatTile, ConfirmBtn, Toggle,
} from '../components/ui.jsx'
import { cx, ago, fmtTime, fmtDate, gearCondition, GEAR_CONDITIONS } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

/* Gear & Equipment — the checkout desk. Kayaks to GoPros: who has what,
   when it's due back, and what condition it came home in. */

const fmtDue = v => {
  if (!v) return 'no due date'
  const d = new Date(v)
  return `${fmtDate(d)} ${fmtTime(d)}`
}

function AvailBar({ total, out }) {
  const free = Math.max(0, total - out)
  const pct = total ? (free / total) * 100 : 0
  return (
    <div>
      <div className="flex justify-between text-[11px] font-head font-bold mb-1">
        <span className={free === 0 ? 'text-danger' : 'text-summer'}>{free} free</span>
        <span className="text-faint">{out} out of {total}</span>
      </div>
      <div className="h-[6px] rounded-full bg-sunken overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }}
          className={cx('h-full rounded-full', free === 0 ? 'bg-danger' : 'bg-summer')} />
      </div>
    </div>
  )
}

export default function Gear() {
  const { can, toast, settings, user, reload } = useApp()
  const [data, setData] = useState(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [people, setPeople] = useState([])
  const [checkout, setCheckout] = useState(null)   // { item }
  const [edit, setEdit] = useState(null)            // gear item form
  const [history, setHistory] = useState(null)      // item w/ history
  const [returning, setReturning] = useState(null)  // loan

  const load = () => api.get('/gear').then(setData).catch(e => { toast(e.message, 'err'); setData({ items: [], loans: [] }) })
  useEffect(() => {
    load()
    if (can('people.view')) api.get('/people').then(setPeople).catch(() => {})
  }, []) // eslint-disable-line

  if (!data) return <PageLoader />
  const cats = settings.gear_categories?.length ? settings.gear_categories : [...new Set(data.items.map(i => i.category))]
  const items = data.items.filter(i =>
    (!cat || i.category === cat) && (!q || i.name.toLowerCase().includes(q.toLowerCase())) && i.active)
  const overdueLoans = data.loans.filter(l => l.overdue)
  const unitsOut = data.loans.reduce((a, l) => a + l.qty, 0)

  async function doCheckout(f) {
    try {
      await api.post('/gear/checkout', {
        item_id: checkout.item.id, qty: Number(f.qty) || 1,
        borrower_id: f.who === '__other' ? null : Number(f.who),
        borrower_name: f.who === '__other' ? f.borrower_name : '',
        due_at: f.due_at || null, notes: f.notes || '',
      })
      toast(`${checkout.item.name} signed out 🛶`)
      setCheckout(null); load(); reload()
    } catch (e) { toast(e.message, 'err') }
  }

  async function doReturn() {
    try {
      await api.post(`/gear/loans/${returning.id}/return`, { condition_in: returning.condition_in || 'good', notes: returning.return_notes || '' })
      toast(`${returning.item_name} back on the shelf ✅`)
      setReturning(null); load(); reload()
    } catch (e) { toast(e.message, 'err') }
  }

  async function saveItem() {
    try {
      const body = { ...edit, qty_total: Number(edit.qty_total) || 1, location_id: edit.location_id ? Number(edit.location_id) : null }
      edit.id ? await api.patch(`/gear/items/${edit.id}`, body) : await api.post('/gear/items', body)
      toast('Gear saved'); setEdit(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function openHistory(item) {
    try { setHistory(await api.get(`/gear/items/${item.id}`)) } catch (e) { toast(e.message, 'err') }
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Property" title="Gear" sub="Sign equipment out, sign it back in, never lose another GoPro."
        actions={can('gear.manage') && (
          <Btn onClick={() => setEdit({ name: '', category: cats[0] || 'General', qty_total: 1, condition: 'good', requires_training: false, notes: '', location_id: '', active: true })}>
            <Plus size={15} /> Add gear
          </Btn>
        )} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatTile label="Units out now" value={unitsOut} icon={<Backpack size={18} />} />
        <StatTile label="Overdue" value={overdueLoans.length} icon={<AlertTriangle size={18} />} tone={overdueLoans.length ? 'text-danger' : 'text-accent'} />
        <div className="col-span-2 sm:col-span-1">
          <StatTile label="Catalog items" value={data.items.filter(i => i.active).length} icon={<Backpack size={18} />} />
        </div>
      </div>

      {overdueLoans.length > 0 && (
        <Card className="border-l-4 border-l-danger p-4 mb-5">
          <Kicker className="!text-danger mb-2">Overdue</Kicker>
          <div className="space-y-1.5">
            {overdueLoans.map(l => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-head font-bold text-ink">{l.item_name} ×{l.qty}</span>
                <span className="text-dim">— {l.borrower}</span>
                <span className="text-danger text-[12px] font-head font-bold">due {fmtDue(l.due_at)}</span>
                {can('gear.checkout') && (
                  <Btn size="sm" variant="soft" className="ml-auto" onClick={() => setReturning({ ...l, condition_in: 'good' })}>
                    <Undo2 size={13} /> Return
                  </Btn>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search gear…" className="w-full sm:w-56" />
        <Select value={cat} onChange={setCat} className="!w-auto min-w-[140px]">
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      {items.length === 0 ? (
        <Card><EmptyState icon="🎒" title="No gear here" body={can('gear.manage') ? 'Add the first item — kayaks, radios, harnesses, urns.' : 'Nothing matches your filter.'} /></Card>
      ) : (
        <motion.div variants={stagger(0.02)} initial="initial" animate="animate"
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
          {items.map(i => {
            const cond = gearCondition(i.condition)
            return (
              <motion.div variants={rise} key={i.id}>
                <Card className="p-4 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="font-head font-bold text-[14px] text-ink leading-snug">{i.name}</span>
                    <Badge className={cond.cls}>{cond.label}</Badge>
                  </div>
                  <div className="text-[11.5px] text-dim mb-3">
                    {i.category}{i.location_name ? ` · lives at ${i.location_name}` : ''}
                    {i.requires_training && <span className="text-ember font-head font-bold"> · training required</span>}
                  </div>
                  <AvailBar total={i.qty_total} out={i.out} />
                  <div className="flex gap-2 mt-3.5 pt-3 border-t border-line/60">
                    {can('gear.checkout') && (
                      <Btn size="sm" className="flex-1" disabled={i.out >= i.qty_total}
                        onClick={() => setCheckout({ item: i })}>
                        Check out
                      </Btn>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => openHistory(i)}>History</Btn>
                    {can('gear.manage') && (
                      <Btn size="sm" variant="ghost" onClick={() => setEdit({ ...i, location_id: i.location_id || '' })}>Edit</Btn>
                    )}
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      {data.loans.length > 0 && (
        <>
          <Kicker className="!text-dim mb-3">Out right now</Kicker>
          <div className="space-y-2">
            {data.loans.map(l => (
              <Card key={l.id} className={cx('p-3.5 flex flex-wrap items-center gap-3', l.overdue && 'border-l-4 border-l-danger')}>
                <span className="font-head font-bold text-[13.5px] text-ink">{l.item_name} ×{l.qty}</span>
                <span className="flex items-center gap-1.5 text-[12.5px] text-dim">
                  {l.borrower_color && <Avatar name={l.borrower} color={l.borrower_color} size={20} />}
                  {l.borrower}{l.booking_name ? ` · ${l.booking_name}` : ''}
                </span>
                <span className={cx('text-[12px] font-head font-bold ml-auto', l.overdue ? 'text-danger' : 'text-faint')}>
                  {l.overdue ? '⏰ ' : ''}due {fmtDue(l.due_at)}
                </span>
                {can('gear.checkout') && (
                  <Btn size="sm" variant="soft" onClick={() => setReturning({ ...l, condition_in: 'good' })}>
                    <Undo2 size={13} /> Return
                  </Btn>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      {/* checkout sheet */}
      <CheckoutSheet open={!!checkout} item={checkout?.item} people={people} me={user} onClose={() => setCheckout(null)} onGo={doCheckout} />

      {/* return sheet */}
      <Sheet open={!!returning} onClose={() => setReturning(null)} kicker="Gear" title={`Return ${returning?.item_name || ''}`}
        footer={<><Btn variant="ghost" onClick={() => setReturning(null)}>Cancel</Btn><Btn onClick={doReturn}>Sign back in</Btn></>}>
        {returning && (
          <div className="space-y-4">
            <div className="text-[13px] text-dim">
              ×{returning.qty} out to <span className="font-head font-bold text-ink">{returning.borrower}</span> since {ago(returning.out_at)}.
            </div>
            <Field label="Condition coming back">
              <Select value={returning.condition_in} onChange={v => setReturning(s => ({ ...s, condition_in: v }))}>
                {GEAR_CONDITIONS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Notes">
              <input className="input" value={returning.return_notes || ''} placeholder="Anything to flag?"
                onChange={e => setReturning(s => ({ ...s, return_notes: e.target.value }))} />
            </Field>
          </div>
        )}
      </Sheet>

      {/* item editor */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} kicker="Gear" title={edit?.id ? edit.name : 'Add gear'}
        footer={<>
          {edit?.id && <ConfirmBtn label="Delete item?" onConfirm={async () => {
            try { await api.del(`/gear/items/${edit.id}`); setEdit(null); load() } catch (e) { toast(e.message, 'err') }
          }}>Delete</ConfirmBtn>}
          <span className="flex-1" />
          <Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn>
          <Btn onClick={saveItem} disabled={!edit?.name?.trim()}>Save</Btn>
        </>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} placeholder="Kayak — single" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={edit.category} onChange={v => setEdit(s => ({ ...s, category: v }))}>
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Quantity"><input type="number" min="1" className="input" value={edit.qty_total} onChange={e => setEdit(s => ({ ...s, qty_total: e.target.value }))} /></Field>
            </div>
            <Field label="Condition">
              <Select value={edit.condition} onChange={v => setEdit(s => ({ ...s, condition: v }))}>
                {GEAR_CONDITIONS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Notes"><input className="input" value={edit.notes || ''} onChange={e => setEdit(s => ({ ...s, notes: e.target.value }))} /></Field>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-head font-semibold text-ink">Requires training to borrow</span>
              <Toggle on={!!edit.requires_training} onChange={v => setEdit(s => ({ ...s, requires_training: v }))} label="Training" />
            </div>
            {edit.id && (
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-head font-semibold text-ink">Active in the catalog</span>
                <Toggle on={!!edit.active} onChange={v => setEdit(s => ({ ...s, active: v }))} label="Active" />
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* history sheet */}
      <Sheet open={!!history} onClose={() => setHistory(null)} kicker="Gear" title={history?.name || ''} wide
        footer={<Btn variant="ghost" onClick={() => setHistory(null)}>Close</Btn>}>
        {history && (
          <div className="space-y-2">
            {(history.history || []).length === 0 && <EmptyState icon="🧾" title="No loans yet" body="This item hasn’t left the shelf." />}
            {(history.history || []).map(l => (
              <div key={l.id} className={cx('flex flex-wrap items-center gap-2 text-[12.5px] rounded-xl px-3 py-2.5 bg-sunken/60', l.overdue && '!bg-danger/8')}>
                <span className="font-head font-bold text-ink">×{l.qty} — {l.borrower}</span>
                <span className="text-dim">{ago(l.out_at)}</span>
                <span className="ml-auto text-faint">
                  {l.returned_at
                    ? `returned ${ago(l.returned_at)}${l.condition_in ? ` · ${l.condition_in}` : ''}`
                    : l.overdue ? `⏰ due ${fmtDue(l.due_at)}` : `due ${fmtDue(l.due_at)}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}

function CheckoutSheet({ open, item, people, me, onClose, onGo }) {
  const [f, setF] = useState(null)
  useEffect(() => {
    if (!open) return setF(null)
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0)
    const pad = n => String(n).padStart(2, '0')
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    setF({ who: String(me?.id || '__other'), borrower_name: '', qty: 1, due_at: local, notes: '' })
  }, [open]) // eslint-disable-line
  if (!f || !item) return null
  const free = item.qty_total - item.out
  return (
    <Sheet open={open} onClose={onClose} kicker="Gear" title={`Check out ${item.name}`}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onGo(f)} disabled={f.who === '__other' && !f.borrower_name.trim()}>Sign out</Btn>
      </>}>
      <div className="space-y-4">
        {item.requires_training && (
          <div className="text-[12.5px] text-ember bg-ember/8 border border-ember/20 rounded-xl px-3 py-2.5 font-head font-semibold">
            ⚠ Training required — confirm the borrower is signed off.
          </div>
        )}
        <Field label="Who's taking it?">
          <Select value={f.who} onChange={v => setF(s => ({ ...s, who: v }))}>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__other">Guest / group (type a name)</option>
          </Select>
        </Field>
        {f.who === '__other' && (
          <Field label="Name">
            <input className="input" value={f.borrower_name} placeholder="Ridgeview — Mr. Patterson"
              onChange={e => setF(s => ({ ...s, borrower_name: e.target.value }))} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={`How many (${free} free)`}>
            <input type="number" min="1" max={free} className="input" value={f.qty}
              onChange={e => setF(s => ({ ...s, qty: e.target.value }))} />
          </Field>
          <Field label="Due back">
            <input type="datetime-local" className="input" value={f.due_at}
              onChange={e => setF(s => ({ ...s, due_at: e.target.value }))} />
          </Field>
        </div>
        <Field label="Notes">
          <input className="input" value={f.notes} placeholder="What's it for?"
            onChange={e => setF(s => ({ ...s, notes: e.target.value }))} />
        </Field>
      </div>
    </Sheet>
  )
}
