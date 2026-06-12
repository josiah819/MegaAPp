import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, ChevronLeft, ChevronRight, Users, CalendarDays, Trash2, Tent } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Kicker, Btn, Badge, Sheet, Field, Select, PageLoader, EmptyState, Avatar, ConfirmBtn } from '../components/ui.jsx'
import { cx, money, fmtRange, ago, LEAD_STAGES, leadStage, SEGMENTS } from '../lib.js'
import { pageAnim, SPRING } from '../motion.js'

const PIPE = LEAD_STAGES.filter(s => !['won', 'lost'].includes(s.v))

const BLANK = { name: '', organization: '', contact_name: '', email: '', phone: '', segment: 'retreat', expected_headcount: '', preferred_start: '', preferred_end: '', value_estimate: '', message: '' }

export default function Leads() {
  const { toast, can } = useApp()
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)        // create sheet
  const [edit, setEdit] = useState(null)         // lead detail sheet
  const [form, setForm] = useState(BLANK)
  const [people, setPeople] = useState([])

  const load = () => api.get('/leads').then(setData).catch(e => toast(e.message, 'err'))
  useEffect(() => {
    load()
    if (can('people.view')) api.get('/people').then(setPeople).catch(() => {})
  }, []) // eslint-disable-line

  const byStage = useMemo(() => {
    const m = Object.fromEntries(LEAD_STAGES.map(s => [s.v, []]))
    for (const l of data?.leads || []) (m[l.stage] || m.new).push(l)
    return m
  }, [data])

  if (!data) return <PageLoader />

  const funnelOf = stage => data.funnel.find(f => f.stage === stage) || { n: 0, value: 0 }
  const openValue = PIPE.reduce((a, s) => a + Number(funnelOf(s.v).value), 0)
  const wonCount = funnelOf('won').n
  const lostCount = funnelOf('lost').n
  const closed = wonCount + lostCount
  const conversion = closed ? Math.round((wonCount / closed) * 100) : null

  async function move(lead, dir) {
    const i = PIPE.findIndex(s => s.v === lead.stage)
    const next = PIPE[i + dir]?.v
    if (!next) return
    try { await api.patch(`/leads/${lead.id}`, { stage: next }); load() } catch (e) { toast(e.message, 'err') }
  }
  async function setStage(lead, stage, lost_reason) {
    try { await api.patch(`/leads/${lead.id}`, { stage, ...(lost_reason !== undefined ? { lost_reason } : {}) }); setEdit(null); load() }
    catch (e) { toast(e.message, 'err') }
  }
  async function create() {
    try {
      await api.post('/leads', { ...form, expected_headcount: form.expected_headcount ? Number(form.expected_headcount) : null, value_estimate: form.value_estimate ? Number(form.value_estimate) : 0 })
      toast('Lead added to the funnel 🎯')
      setOpen(false); setForm(BLANK); load()
    } catch (e) { toast(e.message, 'err') }
  }
  async function convert(lead) {
    try {
      const r = await api.post(`/leads/${lead.id}/convert`, {})
      toast(`Converted — booking ${r.booking.code} created 🎉`)
      setEdit(null)
      nav(`/bookings/${r.booking.id}`)
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Operate" title="Leads"
        sub={`${openValue ? money(openValue) : '$0'} in the open pipeline${conversion !== null ? ` · ${conversion}% win rate` : ''}`}
        actions={<Btn onClick={() => setOpen(true)}><Plus size={15} /> New lead</Btn>} />

      {/* funnel strip */}
      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar scroll-x">
        {LEAD_STAGES.map(s => {
          const f = funnelOf(s.v)
          return (
            <div key={s.v} className="card px-3.5 py-2 flex items-center gap-2.5 shrink-0">
              <Badge className={s.cls}>{s.label}</Badge>
              <span className="disp text-[20px] text-ink tnum">{f.n}</span>
              {Number(f.value) > 0 && <span className="text-[11px] text-faint tnum">{money(f.value)}</span>}
            </div>
          )
        })}
      </div>

      {/* pipeline columns */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3.5 items-start">
        {PIPE.map(stage => (
          <div key={stage.v} className="min-w-0">
            <div className="flex items-center justify-between px-1 mb-2">
              <Kicker className="!text-dim">{stage.label}</Kicker>
              <span className="text-[11px] font-head font-bold text-faint tnum">{byStage[stage.v].length}</span>
            </div>
            <div className="space-y-2.5">
              <AnimatePresence>
                {byStage[stage.v].map(l => (
                  <motion.button key={l.id} layout transition={SPRING}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
                    onClick={() => setEdit({ ...l })}
                    className="card w-full text-left p-3.5 hover:shadow-lift transition-shadow group">
                    <div className="font-head font-bold text-[13.5px] text-ink leading-snug">{l.name}</div>
                    {l.organization && <div className="text-[12px] text-dim mt-0.5 truncate">{l.organization}</div>}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11.5px] text-faint">
                      {l.expected_headcount ? <span className="inline-flex items-center gap-1"><Users size={11} /> {l.expected_headcount}</span> : null}
                      {l.preferred_start && <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> {fmtRange(l.preferred_start, l.preferred_end || l.preferred_start)}</span>}
                      {Number(l.value_estimate) > 0 && <span className="tnum font-semibold text-summer">{money(l.value_estimate)}</span>}
                    </div>
                    <div className="flex items-center justify-between mt-2.5">
                      {l.owner_name
                        ? <span className="inline-flex items-center gap-1.5 text-[11px] text-dim"><Avatar name={l.owner_name} color={l.owner_color} size={18} /> {l.owner_name.split(' ')[0]}</span>
                        : <span className="text-[11px] text-faint">unowned</span>}
                      <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition" onClick={e => e.stopPropagation()}>
                        <button className="p-1 rounded-lg hover:bg-sunken text-dim disabled:opacity-30" disabled={stage.v === PIPE[0].v}
                          onClick={() => move(l, -1)} title="Move back"><ChevronLeft size={14} /></button>
                        <button className="p-1 rounded-lg hover:bg-sunken text-dim disabled:opacity-30" disabled={stage.v === PIPE[PIPE.length - 1].v}
                          onClick={() => move(l, +1)} title="Move forward"><ChevronRight size={14} /></button>
                      </span>
                    </div>
                  </motion.button>
                ))}
              </AnimatePresence>
              {byStage[stage.v].length === 0 && (
                <div className="rounded-xl border border-dashed border-line py-6 text-center text-[12px] text-faint">empty</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* won / lost shelf */}
      {(byStage.won.length > 0 || byStage.lost.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-3.5 mt-6">
          {['won', 'lost'].map(k => byStage[k].length > 0 && (
            <Card key={k} className="p-4">
              <Kicker className="!text-dim mb-2.5">{k === 'won' ? 'Won 🎉' : 'Lost'}</Kicker>
              <div className="space-y-2">
                {byStage[k].map(l => (
                  <button key={l.id} onClick={() => setEdit({ ...l })} className="w-full text-left flex items-center justify-between gap-3 text-[13px] hover:bg-sunken/60 rounded-lg px-2 py-1.5 transition">
                    <span className="min-w-0">
                      <span className="font-semibold text-ink block truncate">{l.name}</span>
                      {k === 'lost' && l.lost_reason && <span className="text-[11.5px] text-faint block truncate">{l.lost_reason}</span>}
                      {k === 'won' && l.booking_code && <span className="text-[11.5px] text-summer font-head font-bold">{l.booking_code}</span>}
                    </span>
                    <span className="text-[11.5px] text-faint tnum shrink-0">{money(l.value_estimate)}</span>
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {data.leads.length === 0 && (
        <EmptyState icon="🎯" title="No leads yet"
          body="Every booking starts as a conversation. Add the first inquiry and walk it down the funnel."
          action={<Btn onClick={() => setOpen(true)}><Plus size={14} /> New lead</Btn>} />
      )}

      {/* create sheet */}
      <Sheet open={open} onClose={() => setOpen(false)} kicker="Leads" title="New lead"
        footer={<><Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn onClick={create} disabled={!form.name.trim()}>Add to funnel</Btn></>}>
        <div className="space-y-4">
          <Field label="Event / group name"><input className="input" value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} placeholder="Northshore Youth Fall Retreat" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Organization"><input className="input" value={form.organization} onChange={e => setForm(s => ({ ...s, organization: e.target.value }))} /></Field>
            <Field label="Contact"><input className="input" value={form.contact_name} onChange={e => setForm(s => ({ ...s, contact_name: e.target.value }))} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email} onChange={e => setForm(s => ({ ...s, email: e.target.value }))} /></Field>
            <Field label="Phone"><input className="input" value={form.phone} onChange={e => setForm(s => ({ ...s, phone: e.target.value }))} /></Field>
            <Field label="Segment">
              <Select value={form.segment} onChange={v => setForm(s => ({ ...s, segment: v }))}>
                {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Headcount"><input className="input" type="number" value={form.expected_headcount} onChange={e => setForm(s => ({ ...s, expected_headcount: e.target.value }))} /></Field>
            <Field label="Preferred arrival"><input className="input" type="date" value={form.preferred_start} onChange={e => setForm(s => ({ ...s, preferred_start: e.target.value }))} /></Field>
            <Field label="Departure"><input className="input" type="date" value={form.preferred_end} onChange={e => setForm(s => ({ ...s, preferred_end: e.target.value }))} /></Field>
          </div>
          <Field label="Estimated value (CAD)"><input className="input" type="number" value={form.value_estimate} onChange={e => setForm(s => ({ ...s, value_estimate: e.target.value }))} /></Field>
          <Field label="Notes"><textarea className="input" rows={3} value={form.message} onChange={e => setForm(s => ({ ...s, message: e.target.value }))} placeholder="What are they dreaming about?" /></Field>
        </div>
      </Sheet>

      {/* detail / edit sheet */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} kicker={edit ? leadStage(edit.stage).label : ''} title={edit?.name}
        footer={edit && <>
          <ConfirmBtn label="Delete lead?" onConfirm={async () => { try { await api.del(`/leads/${edit.id}`); toast('Lead deleted'); setEdit(null); load() } catch (e) { toast(e.message, 'err') } }}>
            <Trash2 size={14} />
          </ConfirmBtn>
          <span className="flex-1" />
          {edit.stage !== 'lost' && !edit.booking_id && (
            <Btn variant="ghost" className="!text-danger" onClick={() => {
              const reason = window.prompt('Why did we lose it? (optional)') ?? ''
              setStage(edit, 'lost', reason)
            }}>Mark lost</Btn>
          )}
          {!edit.booking_id && (
            <Btn variant="accent" onClick={() => convert(edit)} disabled={!edit.preferred_start}>
              <Tent size={14} /> Convert to booking
            </Btn>
          )}
        </>}>
        {edit && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {LEAD_STAGES.map(s => (
                <button key={s.v} onClick={() => edit.stage !== s.v && setStage(edit, s.v)}
                  className={cx('px-2.5 py-1 rounded-full text-[11.5px] font-head font-bold transition',
                    edit.stage === s.v ? s.cls + ' ring-1 ring-current' : 'bg-sunken text-faint hover:text-ink')}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
              <div><span className="label">Organization</span><span className="text-ink">{edit.organization || '—'}</span></div>
              <div><span className="label">Contact</span><span className="text-ink">{edit.contact_name || '—'}{edit.email ? ` · ${edit.email}` : ''}</span></div>
              <div><span className="label">Dates</span><span className="text-ink">{edit.preferred_start ? fmtRange(edit.preferred_start, edit.preferred_end || edit.preferred_start) : 'TBD'}</span></div>
              <div><span className="label">Headcount</span><span className="text-ink tnum">{edit.expected_headcount || '—'}</span></div>
              <div><span className="label">Value</span><span className="text-ink tnum">{money(edit.value_estimate)}</span></div>
              <div><span className="label">Owner</span>
                <Select value={edit.owner_id || ''} onChange={async v => {
                  try { await api.patch(`/leads/${edit.id}`, { owner_id: v ? Number(v) : null }); setEdit(s => ({ ...s, owner_id: v ? Number(v) : null })); load() } catch (e) { toast(e.message, 'err') }
                }}>
                  <option value="">— unowned —</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
            </div>
            {edit.message && <div><span className="label">Notes</span><p className="text-[13px] text-ink whitespace-pre-wrap leading-relaxed">{edit.message}</p></div>}
            {edit.booking_code && <Badge className="bg-green/20 text-green-dark">Converted → {edit.booking_code}</Badge>}
            <div className="text-[11.5px] text-faint">Added {ago(edit.created_at)} · {edit.source === 'website' ? 'website inquiry' : 'added by staff'}</div>
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}
