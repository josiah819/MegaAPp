import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Pencil, Trash2, BedDouble, Users, CalendarDays, Banknote, Tent } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { Card, Btn, IconBtn, Badge, Kicker, PageLoader, ConfirmBtn, Sheet, Field, Select } from '../components/ui.jsx'
import { cx, fmtRange, fmtDate, money, bookingStatus, BOOKING_STATUSES } from '../lib.js'
import { pageAnim } from '../motion.js'
import { BookingForm } from './Bookings.jsx'

function AddRoomBlock({ open, onClose, booking, onSaved }) {
  const { toast } = useApp()
  const [lodges, setLodges] = useState([])
  const [f, setF] = useState({ location_id: '', date_from: booking.start_date, date_to: booking.end_date })
  useEffect(() => {
    if (!open) return
    setF({ location_id: '', date_from: booking.start_date?.slice(0, 10) || '', date_to: booking.end_date?.slice(0, 10) || '' })
    api.get('/accommodation').then(d => setLodges(d.rows)).catch(() => {})
  }, [open]) // eslint-disable-line

  async function save() {
    try {
      const r = await api.post('/accommodation/block', { booking_id: booking.id, ...f, location_id: Number(f.location_id) })
      toast(r.warning || 'Lodge blocked for the group')
      onSaved()
      onClose()
    } catch (e) { toast(e.message, 'err') }
  }
  return (
    <Sheet open={open} onClose={onClose} kicker={booking.code} title="Add lodging"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={!f.location_id}>Block it</Btn></>}>
      <div className="space-y-4">
        <Field label="Lodge / cabin">
          <Select value={f.location_id} onChange={v => setF(s => ({ ...s, location_id: v }))}>
            <option value="">Choose…</option>
            {lodges.map(l => <option key={l.id} value={l.id}>{l.name}{l.beds ? ` · ${l.beds} beds` : ''}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className="input" value={f.date_from} onChange={e => setF(s => ({ ...s, date_from: e.target.value }))} /></Field>
          <Field label="To"><input type="date" className="input" value={f.date_to} onChange={e => setF(s => ({ ...s, date_to: e.target.value }))} /></Field>
        </div>
      </div>
    </Sheet>
  )
}

export default function BookingDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { can, toast } = useApp()
  const [b, setB] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [roomOpen, setRoomOpen] = useState(false)
  const [meals, setMeals] = useState([])
  const [invoices, setInvoices] = useState([])

  const load = () => api.get(`/bookings/${id}`).then(setB).catch(e => { toast(e.message, 'err'); nav('/bookings') })
  useEffect(() => {
    load()
    if (can('bookings.catering')) api.get(`/catering/booking/${id}`).then(setMeals).catch(() => {})
    if (can('bookings.billing')) api.get('/billing').then(d => setInvoices(d.invoices.filter(i => i.booking_id === Number(id)))).catch(() => {})
  }, [id]) // eslint-disable-line

  if (!b) return <PageLoader />
  const s = bookingStatus(b.status)

  async function setStatus(v) {
    try {
      await api.patch(`/bookings/${b.id}`, { status: v })
      toast('Status updated')
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function removeBlock(blockId) {
    try { await api.del(`/accommodation/block/${blockId}`); load() } catch (e) { toast(e.message, 'err') }
  }

  return (
    <motion.div {...pageAnim}>
      <button onClick={() => nav('/bookings')} className="flex items-center gap-1.5 text-[12.5px] font-head font-bold text-dim hover:text-ink transition mb-4">
        <ArrowLeft size={14} /> Bookings
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <Kicker className="mb-1.5">{b.code}{b.customer_name ? ` · ${b.customer_name}` : ''}</Kicker>
          <h1 className="disp text-[36px] sm:text-[44px] text-ink leading-none">{b.name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-[13px] text-dim">
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} className="text-faint" />{fmtRange(b.start_date, b.end_date)}</span>
            <span className="inline-flex items-center gap-1.5"><Users size={14} className="text-faint" />{b.headcount} people</span>
            {b.value > 0 && <span className="inline-flex items-center gap-1.5"><Banknote size={14} className="text-faint" />{money(b.value)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {can('bookings.edit') ? (
            <Select value={b.status} onChange={setStatus} className="!w-auto">
              {BOOKING_STATUSES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </Select>
          ) : <Badge className={s.cls}>{s.label}</Badge>}
          {can('bookings.edit') && <IconBtn title="Edit" onClick={() => setEditOpen(true)}><Pencil size={16} /></IconBtn>}
          {can('bookings.manage') && (
            <ConfirmBtn label="Delete booking?" onConfirm={async () => {
              try { await api.del(`/bookings/${b.id}`); toast('Booking deleted'); nav('/bookings') } catch (e) { toast(e.message, 'err') }
            }}><Trash2 size={15} /></ConfirmBtn>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3.5">
              <Kicker className="!text-dim flex items-center gap-1.5"><BedDouble size={13} /> Lodging</Kicker>
              {can('accommodation.edit') && <Btn size="sm" variant="soft" onClick={() => setRoomOpen(true)}>Add lodge</Btn>}
            </div>
            {b.rooms.length === 0 ? (
              <div className="text-dim text-[13.5px]">No lodges blocked yet.</div>
            ) : (
              <div className="space-y-1.5">
                {b.rooms.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-sunken/60 group">
                    <span className="font-head font-bold text-[13.5px] text-ink flex-1 truncate">{r.location_name}</span>
                    <span className="text-[12px] text-dim tnum">{fmtRange(r.date_from, r.date_to)}</span>
                    {r.beds && <span className="text-[11.5px] text-faint tnum">{r.beds} beds</span>}
                    {can('accommodation.edit') && (
                      <button onClick={() => removeBlock(r.id)} className="hover-reveal text-faint hover:text-danger transition"><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {can('bookings.catering') && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <Kicker className="!text-dim">Meals</Kicker>
                <Btn size="sm" variant="soft" onClick={() => nav('/catering')}>Kitchen sheet →</Btn>
              </div>
              {b.dietary && (
                <div className="mb-3 text-[12.5px] text-ember bg-ember/[0.07] border border-ember/15 rounded-xl px-3 py-2">
                  ⚠ {b.dietary}
                </div>
              )}
              {meals.length === 0 ? <div className="text-dim text-[13px]">No meal services scheduled.</div> : (
                <div className="space-y-1.5">
                  {meals.map(m => (
                    <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-sunken/60 text-[13px]">
                      <span className="font-head font-bold text-ink capitalize w-20 shrink-0">{m.meal}</span>
                      <span className="text-dim tnum shrink-0">{fmtDate(m.date)}{m.time ? ` · ${m.time}` : ''}</span>
                      <span className="flex-1 truncate text-dim">{m.menu}</span>
                      <span className="tnum font-bold text-summer shrink-0">{m.headcount}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card className="p-5">
            <Kicker className="!text-dim mb-3">Notes</Kicker>
            <p className="text-[13.5px] text-ink whitespace-pre-wrap leading-relaxed">{b.notes || <span className="text-dim">Nothing yet.</span>}</p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <Kicker className="!text-dim mb-3">Linked tasks</Kicker>
            {b.tasks.length === 0 ? <div className="text-dim text-[13px]">No tasks tied to this group.</div> : (
              <div className="space-y-2">
                {b.tasks.map(t => (
                  <Link key={t.id} to="/tasks" className="flex items-center gap-2.5 group">
                    <span className={cx('w-2 h-2 rounded-full shrink-0', t.kind === 'done' ? 'bg-summer' : 'bg-ember')} />
                    <span className="text-[13px] text-ink truncate group-hover:text-brand flex-1">{t.title}</span>
                    {t.due && <span className="text-[11.5px] text-faint tnum">{fmtDate(t.due)}</span>}
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <Kicker className="!text-dim mb-3">Contact</Kicker>
            {b.customer_name ? (
              <div className="text-[13.5px] space-y-1">
                <div className="font-head font-bold text-ink">{b.customer_name}</div>
                {b.customer_email && <a className="block text-brand hover:underline" href={`mailto:${b.customer_email}`}>{b.customer_email}</a>}
                {b.customer_phone && <a className="block text-brand hover:underline" href={`tel:${b.customer_phone}`}>{b.customer_phone}</a>}
              </div>
            ) : <div className="text-dim text-[13px]">No customer linked.</div>}
          </Card>

          {can('bookings.billing') && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <Kicker className="!text-dim">Billing</Kicker>
                <Btn size="sm" variant="soft" onClick={async () => {
                  try {
                    const inv = await api.post('/billing', {
                      booking_id: b.id,
                      items: [{ description: `${b.name} — ${b.headcount} guests`, qty: 1, unit_price: Number(b.value) || 0 }],
                    })
                    toast(`Draft ${inv.number} created`)
                    nav(`/billing?focus=${inv.id}`)
                  } catch (e) { toast(e.message, 'err') }
                }}>New invoice</Btn>
              </div>
              {invoices.length === 0 ? <div className="text-dim text-[13px]">Nothing invoiced yet.</div> : (
                <div className="space-y-2">
                  {invoices.map(i => (
                    <button key={i.id} onClick={() => nav(`/billing?focus=${i.id}`)}
                      className="w-full flex items-center gap-2.5 text-[13px] hover:bg-sunken/60 rounded-lg px-2 py-1.5 transition text-left">
                      <span className="font-head font-bold text-ink">{i.number}</span>
                      <Badge className={
                        i.derived === 'paid' ? 'bg-green/20 text-green-dark' : i.derived === 'overdue' ? 'bg-danger/12 text-danger' : 'bg-lake/12 text-lake'
                      }>{i.derived}</Badge>
                      <span className="ml-auto tnum text-ink">{money(i.total)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <BookingForm open={editOpen} onClose={() => setEditOpen(false)} initial={{
        ...b, start_date: String(b.start_date).slice(0, 10), end_date: String(b.end_date).slice(0, 10), customer_id: b.customer_id || '',
      }} onSaved={load} />
      <AddRoomBlock open={roomOpen} onClose={() => setRoomOpen(false)} booking={b} onSaved={load} />
    </motion.div>
  )
}
