import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Users } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Btn, Badge, Seg, SearchInput, Sheet, Field, Select, EmptyState, PageLoader } from '../components/ui.jsx'
import { cx, fmtRange, money, bookingStatus, BOOKING_STATUSES, SEGMENTS, todayISO, addDays } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

export function BookingForm({ open, onClose, onSaved, initial }) {
  const { toast } = useApp()
  const [customers, setCustomers] = useState([])
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    api.get('/bookings/customers').then(setCustomers).catch(() => {})
    setF(initial ? { ...initial } : {
      name: '', customer_id: '', status: 'tentative', segment: 'retreat',
      start_date: todayISO(), end_date: addDays(todayISO(), 2), headcount: 40, value: 0, notes: '', dietary: '',
    })
  }, [open, initial])

  if (!f) return null
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  async function save() {
    setBusy(true)
    try {
      const body = { ...f, customer_id: f.customer_id || null, headcount: Number(f.headcount) || 0, value: Number(f.value) || 0 }
      const saved = initial?.id ? await api.patch(`/bookings/${initial.id}`, body) : await api.post('/bookings', body)
      toast(initial?.id ? 'Booking updated' : `Booking ${saved.code} created 🎉`)
      onSaved?.(saved)
      onClose()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker="Bookings" title={initial?.id ? `Edit ${initial.code}` : 'New booking'} wide
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy || !f.name}>{initial?.id ? 'Save changes' : 'Create booking'}</Btn>
      </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Group name" className="sm:col-span-2">
          <input className="input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="Ridgeview Collegiate — Grade 8 Trip" />
        </Field>
        <Field label="Customer">
          <Select value={f.customer_id || ''} onChange={v => set('customer_id', v)}>
            <option value="">— none —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Segment">
          <Select value={f.segment} onChange={v => set('segment', v)}>
            {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Arrive">
          <input type="date" className="input" value={f.start_date} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="Depart">
          <input type="date" className="input" value={f.end_date} onChange={e => set('end_date', e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={v => set('status', v)}>
            {BOOKING_STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Headcount">
          <input type="number" min="0" className="input" value={f.headcount} onChange={e => set('headcount', e.target.value)} />
        </Field>
        <Field label="Value (CAD)">
          <input type="number" min="0" className="input" value={f.value} onChange={e => set('value', e.target.value)} />
        </Field>
        <Field label="Dietary — whole group" hint="Rolls up to the kitchen sheet so the chefs never miss it." className="sm:col-span-2">
          <input className="input" value={f.dietary || ''} onChange={e => set('dietary', e.target.value)}
            placeholder="14 vegetarian · 3 gluten-free · 1 severe peanut allergy" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea className="input" rows={3} value={f.notes || ''} onChange={e => set('notes', e.target.value)}
            placeholder="AV needs, arrival details, special requests…" />
        </Field>
      </div>
    </Sheet>
  )
}

export default function Bookings() {
  const { can, toast } = useApp()
  const nav = useNavigate()
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [when, setWhen] = useState('upcoming')
  const [formOpen, setFormOpen] = useState(false)

  const load = () => api.get(`/bookings?when=${when}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t) }, [q, when]) // eslint-disable-line

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Operate" title="Bookings" sub="Guest groups, school trips, retreats and rentals."
        actions={can('bookings.edit') && (
          <Btn onClick={() => setFormOpen(true)}><Plus size={15} /> New booking</Btn>
        )} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Seg value={when} onChange={setWhen} options={[{ v: 'upcoming', label: 'Upcoming' }, { v: 'past', label: 'Past' }, { v: 'all', label: 'All' }]} />
        <SearchInput value={q} onChange={setQ} placeholder="Search groups…" className="w-full sm:w-64" />
      </div>

      {list === null ? <PageLoader /> : list.length === 0 ? (
        <Card><EmptyState icon="🏕️" title="No bookings here"
          body={q ? 'Nothing matches that search.' : 'When groups book the property, they show up here.'}
          action={can('bookings.edit') && <Btn onClick={() => setFormOpen(true)}><Plus size={15} /> New booking</Btn>} /></Card>
      ) : (
        <>
          {/* desktop table */}
          <Card className="hidden md:block overflow-hidden">
            <table className="tbl tbl-hover">
              <thead><tr>
                <th>Group</th><th>Dates</th><th>People</th><th>Segment</th><th>Value</th><th>Status</th>
              </tr></thead>
              <tbody>
                {list.map(b => {
                  const s = bookingStatus(b.status)
                  return (
                    <tr key={b.id} onClick={() => nav(`/bookings/${b.id}`)}>
                      <td>
                        <div className="font-head font-bold text-[13.5px] text-ink">{b.name}</div>
                        <div className="text-[11.5px] text-faint">{b.code}{b.customer_name ? ` · ${b.customer_name}` : ''}</div>
                      </td>
                      <td className="tnum whitespace-nowrap">{fmtRange(b.start_date, b.end_date)}</td>
                      <td className="tnum"><span className="inline-flex items-center gap-1"><Users size={12} className="text-faint" />{b.headcount}</span></td>
                      <td className="capitalize text-dim">{(b.segment || '').replace('_', ' ')}</td>
                      <td className="tnum">{b.value > 0 ? money(b.value) : '—'}</td>
                      <td><Badge className={s.cls}>{s.label}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>

          {/* mobile cards */}
          <motion.div variants={stagger(0.04)} initial="initial" animate="animate" className="md:hidden space-y-2.5">
            {list.map(b => {
              const s = bookingStatus(b.status)
              return (
                <motion.button variants={rise} key={b.id} onClick={() => nav(`/bookings/${b.id}`)}
                  className="card w-full p-4 text-left active:scale-[0.99] transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-head font-bold text-[14px] text-ink leading-snug">{b.name}</div>
                      <div className="text-[12px] text-dim mt-0.5">{b.code} · {fmtRange(b.start_date, b.end_date)}</div>
                      <div className="text-[12px] text-faint mt-0.5">{b.headcount} people{b.value > 0 ? ` · ${money(b.value)}` : ''}</div>
                    </div>
                    <Badge className={s.cls}>{s.label}</Badge>
                  </div>
                </motion.button>
              )
            })}
          </motion.div>
        </>
      )}

      <BookingForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={b => nav(`/bookings/${b.id}`)} />
    </motion.div>
  )
}
