import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Plus, Printer, Trash2, AlertTriangle } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Kicker, Btn, Sheet, Field, Select, PageLoader, EmptyState } from '../components/ui.jsx'
import { cx, todayISO, addDays, weekStart, fmtDow, fmtDate, fmtDateLong, MEALS, mealOf } from '../lib.js'
import { pageAnim, SPRING } from '../motion.js'

const BLANK = { booking_id: '', date: todayISO(), meal: 'dinner', time: '', headcount: '', menu: '', location_id: '', dietary: '', notes: '' }

export default function Catering() {
  const { toast, can } = useApp()
  const [start, setStart] = useState(weekStart())
  const [data, setData] = useState(null)
  const [day, setDay] = useState(todayISO())
  const [edit, setEdit] = useState(null)         // meal service form (new or existing)
  const [bookings, setBookings] = useState([])
  const [locations, setLocations] = useState([])

  const load = s => api.get(`/catering?start=${s}&end=${addDays(s, 6)}`).then(setData).catch(e => toast(e.message, 'err'))
  useEffect(() => { load(start) }, [start]) // eslint-disable-line
  useEffect(() => {
    api.get('/bookings?when=upcoming').then(setBookings).catch(() => {})
    if (can('locations.view')) api.get('/locations').then(setLocations).catch(() => {})
  }, []) // eslint-disable-line

  if (!data) return <PageLoader />

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  if (!days.includes(day)) setTimeout(() => setDay(days[0]), 0)
  const onDay = d => data.services.filter(s => String(s.date).slice(0, 10) === d)
  const dayServices = onDay(day)
  const covers = d => onDay(d).reduce((a, s) => a + (s.headcount || 0), 0)

  async function save() {
    const body = { ...edit, booking_id: Number(edit.booking_id), headcount: edit.headcount === '' ? null : Number(edit.headcount), location_id: edit.location_id ? Number(edit.location_id) : null }
    try {
      if (edit.id) await api.patch(`/catering/${edit.id}`, body)
      else await api.post('/catering', body)
      toast('Kitchen sheet updated 🍽️')
      setEdit(null); load(start)
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Operate" title="Catering" sub="The kitchen sheet — every service, headcount, and dietary flag."
        actions={<>
          <Btn variant="ghost" onClick={() => window.print()} className="no-print"><Printer size={14} /> Print day</Btn>
          <Btn onClick={() => setEdit({ ...BLANK, date: day })}><Plus size={15} /> Add service</Btn>
        </>} />

      {/* dietary rollup — the thing the kitchen actually needs front and centre */}
      {data.dietary.length > 0 && (
        <Card className="p-4 mb-5 border-l-4 !border-l-ember">
          <Kicker className="!text-ember mb-2 flex items-center gap-1.5"><AlertTriangle size={12} /> Dietary — groups on site this week</Kicker>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {data.dietary.map(d => (
              <div key={d.code} className="text-[13px]">
                <span className="font-head font-bold text-ink">{d.name}</span>
                <span className="text-faint text-[11.5px]"> · {d.headcount}</span>
                <span className="block text-dim">{d.dietary}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* week strip */}
      <div className="flex items-center gap-2 mb-4 no-print">
        <Btn size="sm" variant="soft" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={15} /></Btn>
        <div className="flex-1 grid grid-cols-7 gap-1.5">
          {days.map(d => (
            <button key={d} onClick={() => setDay(d)}
              className={cx('rounded-xl py-2 text-center transition relative',
                d === day ? 'bg-brand text-white shadow-soft' : 'bg-surface border border-line hover:border-brand/40')}>
              <span className={cx('block text-[10px] font-head font-bold uppercase', d === day ? 'text-white/70' : 'text-faint')}>{fmtDow(d)}</span>
              <span className="block text-[15px] font-head font-bold tnum leading-tight">{d.slice(8)}</span>
              {covers(d) > 0 && (
                <span className={cx('block text-[9.5px] font-head font-bold tnum', d === day ? 'text-green' : 'text-summer')}>{covers(d)}</span>
              )}
            </button>
          ))}
        </div>
        <Btn size="sm" variant="soft" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={15} /></Btn>
      </div>

      {/* day sheet */}
      <div className="print-area-keep">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="disp text-[24px] text-ink">{fmtDateLong(day)}</h2>
          <span className="text-[12.5px] text-dim tnum">{covers(day)} covers</span>
        </div>
        {dayServices.length === 0
          ? <EmptyState icon="🥣" title="Nothing on the sheet" body="No meal services scheduled this day." />
          : (
            <div className="space-y-4">
              {MEALS.map(m => {
                const list = dayServices.filter(s => s.meal === m.v)
                if (!list.length) return null
                return (
                  <div key={m.v}>
                    <Kicker className="!text-dim mb-2">{m.emoji} {m.label} · {list.reduce((a, s) => a + (s.headcount || 0), 0)} covers</Kicker>
                    <div className="grid md:grid-cols-2 gap-2.5">
                      <AnimatePresence>
                        {list.map(s => (
                          <motion.button key={s.id} layout transition={SPRING}
                            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            onClick={() => setEdit({ ...s, date: String(s.date).slice(0, 10), booking_id: s.booking_id, location_id: s.location_id || '', headcount: s.headcount ?? '' })}
                            className="card p-3.5 text-left hover:shadow-lift transition-shadow">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-head font-bold text-[13.5px] text-ink truncate">{s.booking_name}</span>
                              <span className="tnum text-[15px] font-head font-bold text-summer shrink-0">{s.headcount}</span>
                            </div>
                            <div className="text-[12.5px] text-dim mt-0.5">{s.menu || 'Menu TBD'}</div>
                            <div className="flex flex-wrap gap-x-3 mt-1.5 text-[11.5px] text-faint">
                              {s.time && <span>⏰ {s.time}</span>}
                              {s.location_name && <span>📍 {s.location_name}</span>}
                            </div>
                            {s.dietary && <div className="mt-2 text-[11.5px] text-ember bg-ember/[0.07] rounded-lg px-2 py-1">⚠ {s.dietary}</div>}
                          </motion.button>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {/* service sheet */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} kicker="Catering" title={edit?.id ? 'Edit service' : 'Add meal service'}
        footer={edit && <>
          {edit.id && (
            <Btn variant="ghost" className="!text-danger" onClick={async () => {
              try { await api.del(`/catering/${edit.id}`); toast('Service removed'); setEdit(null); load(start) } catch (e) { toast(e.message, 'err') }
            }}><Trash2 size={14} /></Btn>
          )}
          <span className="flex-1" />
          <Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn>
          <Btn onClick={save} disabled={!edit.booking_id || !edit.date}>Save</Btn>
        </>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Group">
              <Select value={edit.booking_id} onChange={v => {
                const b = bookings.find(x => x.id === Number(v))
                setEdit(s => ({ ...s, booking_id: v, headcount: s.headcount === '' && b ? b.headcount : s.headcount }))
              }}>
                <option value="">— pick the booking —</option>
                {bookings.map(b => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input type="date" className="input" value={edit.date} onChange={e => setEdit(s => ({ ...s, date: e.target.value }))} /></Field>
              <Field label="Meal">
                <Select value={edit.meal} onChange={v => setEdit(s => ({ ...s, meal: v }))}>
                  {MEALS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                </Select>
              </Field>
              <Field label="Time"><input className="input" placeholder="18:00" value={edit.time || ''} onChange={e => setEdit(s => ({ ...s, time: e.target.value }))} /></Field>
              <Field label="Covers"><input type="number" className="input" value={edit.headcount} onChange={e => setEdit(s => ({ ...s, headcount: e.target.value }))} /></Field>
            </div>
            <Field label="Menu"><input className="input" placeholder="Taco night" value={edit.menu || ''} onChange={e => setEdit(s => ({ ...s, menu: e.target.value }))} /></Field>
            <Field label="Where">
              <Select value={edit.location_id} onChange={v => setEdit(s => ({ ...s, location_id: v }))}>
                <option value="">Dining Hall (default)</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Service-specific dietary note" hint="Group-wide dietary lives on the booking — this is just for this sitting.">
              <input className="input" value={edit.dietary || ''} onChange={e => setEdit(s => ({ ...s, dietary: e.target.value }))} />
            </Field>
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}
