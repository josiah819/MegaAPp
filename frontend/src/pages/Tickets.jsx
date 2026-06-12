import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, QrCode, MessageSquare, RefreshCcw, Wrench, Download, BookmarkPlus, Tag, Printer } from 'lucide-react'
import { api, getToken } from '../api.js'
import { useApp } from '../store.jsx'
import {
  PageHead, Card, Btn, Badge, Seg, Tabs, SearchInput, Sheet, Field, Select, Avatar,
  EmptyState, PageLoader, Toggle, ConfirmBtn,
} from '../components/ui.jsx'
import { cx, ago, fmtDate, todayISO, priority, ticketStatus } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

const SOURCE_ICON = { guest: '🧳', scheduled: '🔁', staff: '' }

export function TicketForm({ open, onClose, onSaved }) {
  const { toast, settings, can } = useApp()
  const [f, setF] = useState(null)
  const [locations, setLocations] = useState([])
  const [people, setPeople] = useState([])
  useEffect(() => {
    if (!open) return
    setF({ title: '', details: '', category: 'maintenance', priority: 1, location_id: '', assignee_id: '', due_date: '' })
    if (can('locations.view')) api.get('/locations').then(setLocations).catch(() => {})
    if (can('people.view')) api.get('/people').then(setPeople).catch(() => {})
  }, [open]) // eslint-disable-line
  if (!f) return null
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const cats = settings.report_categories?.length ? settings.report_categories : [{ key: 'maintenance', label: 'Maintenance' }]

  async function save() {
    try {
      const t = await api.post('/tickets', {
        ...f, location_id: f.location_id ? Number(f.location_id) : null,
        assignee_id: f.assignee_id ? Number(f.assignee_id) : null, due_date: f.due_date || null,
      })
      toast(`Ticket ${t.code} opened`)
      onSaved?.(t); onClose()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker="Facilities" title="New ticket" wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={!f.title}>Open ticket</Btn></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="What needs attention?" className="sm:col-span-2">
          <input className="input" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Hot water out in Cedarwood" />
        </Field>
        <Field label="Details" className="sm:col-span-2">
          <textarea className="input" rows={3} value={f.details} onChange={e => set('details', e.target.value)} placeholder="What, where exactly, how urgent…" />
        </Field>
        <Field label="Category">
          <Select value={f.category} onChange={v => set('category', v)}>
            {cats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Priority" hint={can('tickets.priority') ? undefined : 'Set by leads — lands as Normal'}>
          <Select value={f.priority} onChange={v => set('priority', Number(v))} disabled={!can('tickets.priority')}>
            {[0, 1, 2, 3, 4].map(p => <option key={p} value={p}>{priority(p).label}</option>)}
          </Select>
        </Field>
        <Field label="Location">
          <Select value={f.location_id} onChange={v => set('location_id', v)}>
            <option value="">— anywhere —</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Assign to">
          <Select value={f.assignee_id} onChange={v => set('assignee_id', v)}>
            <option value="">— unassigned —</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Due date">
          <input type="date" className="input" value={f.due_date} onChange={e => set('due_date', e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

function ScheduledTab() {
  const { toast, settings } = useApp()
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', details: '', category: 'maintenance', frequency: 'weekly', next_run: '', location_id: '' })
  const [locations, setLocations] = useState([])

  const load = () => api.get('/tickets/scheduled').then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  useEffect(() => { load(); api.get('/locations').then(setLocations).catch(() => {}) }, []) // eslint-disable-line

  async function save() {
    try {
      await api.post('/tickets/scheduled', { ...f, location_id: f.location_id ? Number(f.location_id) : null })
      toast('Recurring ticket scheduled 🔁'); setOpen(false); load()
    } catch (e) { toast(e.message, 'err') }
  }

  if (!list) return <PageLoader />
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-[13px] text-dim">These spawn real tickets automatically on their run date.</p>
        <Btn size="sm" onClick={() => { setF({ title: '', details: '', category: 'maintenance', frequency: 'weekly', next_run: '', location_id: '' }); setOpen(true) }}>
          <Plus size={14} /> New schedule
        </Btn>
      </div>
      {list.length === 0 ? <Card><EmptyState icon="🔁" title="No recurring tickets" body="Weekly inspections, monthly services — set them once." /></Card> : (
        <div className="space-y-2.5">
          {list.map(s => (
            <Card key={s.id} className={cx('p-4 flex items-center gap-4', !s.active && 'opacity-55')}>
              <RefreshCcw size={17} className="text-ember shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-head font-bold text-[13.5px] text-ink truncate">{s.title}</div>
                <div className="text-[12px] text-dim capitalize">{s.frequency} · next {fmtDate(s.next_run)}{s.location_name ? ` · ${s.location_name}` : ''}</div>
              </div>
              <Toggle on={s.active} label="Active" onChange={async v => {
                try { await api.patch(`/tickets/scheduled/${s.id}`, { active: v }); load() } catch (e) { toast(e.message, 'err') }
              }} />
              <ConfirmBtn label="Remove?" onConfirm={async () => {
                try { await api.del(`/tickets/scheduled/${s.id}`); load() } catch (e) { toast(e.message, 'err') }
              }}>Remove</ConfirmBtn>
            </Card>
          ))}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} kicker="Facilities" title="Recurring ticket"
        footer={<><Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn><Btn onClick={save} disabled={!f.title || !f.next_run}>Schedule</Btn></>}>
        <div className="space-y-4">
          <Field label="Title"><input className="input" value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} placeholder="Fire extinguisher walk-through" /></Field>
          <Field label="Details"><textarea className="input" rows={2} value={f.details} onChange={e => setF(s => ({ ...s, details: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frequency">
              <Select value={f.frequency} onChange={v => setF(s => ({ ...s, frequency: v }))}>
                {['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'].map(x => <option key={x} value={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label="First run"><input type="date" className="input" value={f.next_run} onChange={e => setF(s => ({ ...s, next_run: e.target.value }))} /></Field>
          </div>
          <Field label="Location">
            <Select value={f.location_id} onChange={v => setF(s => ({ ...s, location_id: v }))}>
              <option value="">— anywhere —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        </div>
      </Sheet>
    </div>
  )
}

const ASSET_STATUS = {
  operational: ['Operational', 'bg-summer/12 text-summer'],
  needs_service: ['Needs service', 'bg-ember/12 text-ember'],
  out_of_service: ['Out of service', 'bg-danger/12 text-danger'],
  retired: ['Retired', 'bg-sunken text-dim'],
}

function AssetsTab() {
  const { toast, can } = useApp()
  const [list, setList] = useState(null)
  const [edit, setEdit] = useState(null)
  const [logForm, setLogForm] = useState(null)
  const [locations, setLocations] = useState([])
  const load = () => api.get('/assets').then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  useEffect(() => { load(); api.get('/locations').then(setLocations).catch(() => {}) }, []) // eslint-disable-line

  async function openAsset(a) {
    if (!a.id) return setEdit(a)
    try {
      const full = await api.get(`/assets/${a.id}`)
      setEdit({ ...full, location_id: full.location_id || '' })
    } catch (e) { toast(e.message, 'err') }
  }

  async function save() {
    try {
      const body = {
        name: edit.name, category: edit.category, status: edit.status, serial: edit.serial, notes: edit.notes,
        location_id: edit.location_id ? Number(edit.location_id) : null,
        next_service: edit.next_service ? String(edit.next_service).slice(0, 10) : null,
      }
      edit.id ? await api.patch(`/assets/${edit.id}`, body) : await api.post('/assets', body)
      toast('Asset saved'); setEdit(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function addLog() {
    try {
      await api.post(`/assets/${edit.id}/logs`, logForm)
      toast('Service logged 🔧'); setLogForm(null); openAsset(edit); load()
    } catch (e) { toast(e.message, 'err') }
  }

  if (!list) return <PageLoader />
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-[13px] text-dim">Boats, vehicles, AV and the gear that keeps camp moving — with full service history.</p>
        {can('assets.edit') && <Btn size="sm" onClick={() => setEdit({ name: '', category: 'equipment', status: 'operational', serial: '', notes: '', location_id: '', logs: [], tickets: [] })}><Plus size={14} /> Add asset</Btn>}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map(a => {
          const [label, cls] = ASSET_STATUS[a.status] || ASSET_STATUS.operational
          const serviceDue = a.next_service && String(a.next_service).slice(0, 10) <= today
          return (
            <Card key={a.id} className="p-4 hover:shadow-lift transition cursor-pointer" onClick={() => openAsset(a)}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><Wrench size={16} /></span>
                <Badge className={cls}>{label}</Badge>
              </div>
              <div className="font-head font-bold text-[13.5px] text-ink leading-snug">{a.name}</div>
              <div className="text-[12px] text-dim mt-1">{a.location_name || 'No home base'}{a.serial ? ` · ${a.serial}` : ''}</div>
              <div className="flex flex-wrap gap-x-3 mt-1.5 text-[11.5px] font-head font-bold">
                {a.open_tickets > 0 && <span className="text-ember">{a.open_tickets} open ticket{a.open_tickets > 1 ? 's' : ''}</span>}
                {a.next_service && (
                  <span className={serviceDue ? 'text-danger' : 'text-faint'}>
                    {serviceDue ? '⚠ service due' : `service ${fmtDate(a.next_service)}`}
                  </span>
                )}
              </div>
            </Card>
          )
        })}
      </div>
      <Sheet open={!!edit} onClose={() => { setEdit(null); setLogForm(null) }} kicker="Assets" title={edit?.id ? edit.name : 'Add asset'} wide
        footer={<>
          {edit?.id && can('assets.edit') && <ConfirmBtn label="Delete asset?" onConfirm={async () => { await api.del(`/assets/${edit.id}`); setEdit(null); load() }}>Delete</ConfirmBtn>}
          <span className="flex-1" />
          <Btn variant="ghost" onClick={() => { setEdit(null); setLogForm(null) }}>Cancel</Btn>
          {can('assets.edit') && <Btn onClick={save} disabled={!edit?.name}>Save</Btn>}
        </>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={edit.category} onChange={v => setEdit(s => ({ ...s, category: v }))}>
                  {['equipment', 'vehicle', 'waterfront', 'av', 'building', 'kitchen'].map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={edit.status} onChange={v => setEdit(s => ({ ...s, status: v }))}>
                  {Object.entries(ASSET_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Home location">
                <Select value={edit.location_id} onChange={v => setEdit(s => ({ ...s, location_id: v }))}>
                  <option value="">— none —</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
              <Field label="Next service">
                <input type="date" className="input" value={edit.next_service ? String(edit.next_service).slice(0, 10) : ''}
                  onChange={e => setEdit(s => ({ ...s, next_service: e.target.value }))} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Serial"><input className="input" value={edit.serial || ''} onChange={e => setEdit(s => ({ ...s, serial: e.target.value }))} /></Field>
              <Field label="Notes"><input className="input" value={edit.notes || ''} onChange={e => setEdit(s => ({ ...s, notes: e.target.value }))} /></Field>
            </div>

            {edit.id && (
              <div className="pt-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="kicker text-dim">Service history</span>
                  {can('assets.edit') && !logForm && (
                    <Btn size="sm" variant="soft" onClick={() => setLogForm({ kind: 'service', notes: '', cost: '', date: today, next_service: '' })}>
                      <Plus size={13} /> Log service
                    </Btn>
                  )}
                </div>
                {logForm && (
                  <div className="bg-sunken/60 rounded-xl p-3 mb-3 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      <Field label="Type">
                        <Select value={logForm.kind} onChange={v => setLogForm(s => ({ ...s, kind: v }))}>
                          {['service', 'repair', 'inspection', 'winterize'].map(k => <option key={k} value={k}>{k}</option>)}
                        </Select>
                      </Field>
                      <Field label="Date"><input type="date" className="input" value={logForm.date} onChange={e => setLogForm(s => ({ ...s, date: e.target.value }))} /></Field>
                      <Field label="Cost (optional)"><input type="number" className="input" value={logForm.cost} onChange={e => setLogForm(s => ({ ...s, cost: e.target.value }))} /></Field>
                      <Field label="Next service due"><input type="date" className="input" value={logForm.next_service} onChange={e => setLogForm(s => ({ ...s, next_service: e.target.value }))} /></Field>
                    </div>
                    <Field label="What was done"><input className="input" value={logForm.notes} onChange={e => setLogForm(s => ({ ...s, notes: e.target.value }))} /></Field>
                    <div className="flex gap-2 justify-end">
                      <Btn size="sm" variant="ghost" onClick={() => setLogForm(null)}>Cancel</Btn>
                      <Btn size="sm" onClick={addLog} disabled={!logForm.notes.trim()}>Save log</Btn>
                    </div>
                  </div>
                )}
                {(edit.logs || []).length === 0 && !logForm && <div className="text-[12.5px] text-faint">No service on record yet.</div>}
                <div className="space-y-1.5">
                  {(edit.logs || []).map(g => (
                    <div key={g.id} className="flex items-start gap-3 text-[12.5px] bg-sunken/50 rounded-xl px-3 py-2">
                      <span className="font-head font-bold text-ink capitalize shrink-0">{g.kind}</span>
                      <span className="flex-1 text-dim">{g.notes}</span>
                      <span className="text-faint shrink-0">{fmtDate(g.date)}{g.cost ? ` · $${Number(g.cost).toFixed(0)}` : ''}</span>
                    </div>
                  ))}
                </div>
                {(edit.tickets || []).length > 0 && (
                  <div className="mt-3">
                    <span className="kicker text-dim block mb-1.5">Linked tickets</span>
                    {edit.tickets.map(t => (
                      <div key={t.id} className="text-[12.5px] text-dim py-0.5">{t.code} · {t.title} <Badge className={ticketStatus(t.status).cls}>{ticketStatus(t.status).label}</Badge></div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

export default function Tickets() {
  const { can, toast, badges } = useApp()
  const nav = useNavigate()
  const [tab, setTab] = useState('tickets')
  const [list, setList] = useState(null)
  const [status, setStatus] = useState('active')
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [tags, setTags] = useState([])
  const [views, setViews] = useState([])
  const [formOpen, setFormOpen] = useState(false)

  const load = () => {
    const params = new URLSearchParams()
    if (status === 'waiting') params.set('waiting', 'true')
    else if (status === 'overdue') params.set('overdue', 'true')
    else if (status === 'unread') params.set('unread', 'true')
    else if (status !== 'all') params.set('status', status)
    if (q) params.set('q', q)
    if (mine) params.set('mine', 'true')
    if (tagFilter) params.set('tag', tagFilter)
    api.get(`/tickets?${params}`).then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  }
  useEffect(() => { if (tab === 'tickets') { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t) } }, [q, status, mine, tagFilter, tab]) // eslint-disable-line
  useEffect(() => {
    api.get('/tickets/tags').then(setTags).catch(() => {})
    api.get('/tickets/views').then(setViews).catch(() => {})
  }, [])

  async function saveView() {
    const name = window.prompt('Name this view (e.g. “My overdue plumbing”):')
    if (!name?.trim()) return
    try {
      await api.post('/tickets/views', { name: name.trim(), params: { status, q, mine, tag: tagFilter } })
      toast('View saved 📌')
      setViews(await api.get('/tickets/views'))
    } catch (e) { toast(e.message, 'err') }
  }
  function applyView(v) {
    if (!v) return
    setStatus(v.params.status || 'active'); setQ(v.params.q || '')
    setMine(!!v.params.mine); setTagFilter(v.params.tag || '')
  }

  const today = todayISO()
  const tabs = [{ v: 'tickets', label: 'Tickets' }]
  if (can('tickets.schedule')) tabs.push({ v: 'scheduled', label: 'Recurring' })
  if (can('assets.view')) tabs.push({ v: 'assets', label: 'Assets' })

  const segOptions = [
    { v: 'active', label: 'Active' }, { v: 'open', label: 'Open' },
    { v: 'waiting', label: '💬 Guest waiting' },
    { v: 'unread', label: '● Unread' },
    { v: 'overdue', label: '⏰ Overdue' },
  ]
  if (can('tickets.approve_close') || can('tickets.close')) {
    segOptions.push({ v: 'pending_close', label: `🙋 Approvals${badges.closure_pending ? ` ${badges.closure_pending}` : ''}` })
  }
  segOptions.push({ v: 'closed', label: 'Closed' }, { v: 'all', label: 'All' })

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Property" title="Facilities" sub="Tickets from staff, guests, and the schedule — one queue."
        actions={
          <div className="flex gap-2 flex-wrap">
            <Btn variant="outline" size="sm" onClick={() => nav('/tickets/qr-posters')}>
              <Printer size={14} /> QR posters
            </Btn>
            {can('tickets.export') && (
              <Btn variant="outline" size="sm" onClick={async () => {
                try {
                  const res = await fetch('/api/tickets/export.csv', { headers: { Authorization: `Bearer ${getToken()}` } })
                  if (!res.ok) throw new Error('Export failed')
                  const blob = await res.blob()
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `woodsos-tickets-${today}.csv`
                  a.click()
                  URL.revokeObjectURL(a.href)
                } catch (e) { toast(e.message, 'err') }
              }}><Download size={14} /> CSV</Btn>
            )}
            {can('tickets.edit') && <Btn onClick={() => setFormOpen(true)}><Plus size={15} /> New ticket</Btn>}
          </div>
        } />

      {tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs} className="mb-5" />}

      {tab === 'scheduled' ? <ScheduledTab /> : tab === 'assets' ? <AssetsTab /> : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Seg value={status} onChange={setStatus} options={segOptions} />
            <SearchInput value={q} onChange={setQ} placeholder="Search tickets…" className="w-full sm:w-56" />
            <label className="flex items-center gap-2 text-[12.5px] font-head font-semibold text-dim cursor-pointer">
              <Toggle on={mine} onChange={setMine} label="Only mine" /> Mine
            </label>
            {tags.filter(t => t.active && t.used > 0).length > 0 && (
              <Select value={tagFilter} onChange={setTagFilter} className="!w-auto min-w-[130px]">
                <option value="">All tags</option>
                {tags.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name} ({t.used})</option>)}
              </Select>
            )}
            <span className="flex items-center gap-1 ml-auto">
              {views.length > 0 && (
                <Select value="" onChange={id => applyView(views.find(v => v.id === Number(id)))} className="!w-auto min-w-[120px]">
                  <option value="">My views…</option>
                  {views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              )}
              <Btn variant="ghost" size="sm" onClick={saveView} title="Save current filters as a view">
                <BookmarkPlus size={15} />
              </Btn>
            </span>
          </div>

          {list === null ? <PageLoader /> : list.length === 0 ? (
            <Card><EmptyState icon="🎉" title="Queue is clear" body="No tickets match. The property thanks you." /></Card>
          ) : (
            <motion.div variants={stagger(0.025)} initial="initial" animate="animate" className="space-y-2">
              {list.map(t => {
                const s = ticketStatus(t.status)
                const p = priority(t.priority)
                const overdue = t.due_date && String(t.due_date).slice(0, 10) < today && t.status !== 'closed'
                return (
                  <motion.button variants={rise} key={t.id} onClick={() => nav(`/tickets/${t.id}`)}
                    className="card w-full p-3.5 sm:px-4 text-left flex items-center gap-3 hover:shadow-lift transition group">
                    <span className="w-2 shrink-0 flex justify-center">
                      {t.unread && t.status !== 'closed' && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} title="Updated since you last opened it"
                          className="w-2 h-2 rounded-full bg-brand" />
                      )}
                    </span>
                    <span className={cx('px-1.5 py-0.5 rounded-md text-[10.5px] font-head font-bold shrink-0', p.cls)}>{p.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {SOURCE_ICON[t.source] && <span className="text-[13px]" title={t.source}>{SOURCE_ICON[t.source]}</span>}
                        <span className={cx('font-head text-[13.5px] truncate group-hover:text-brand transition-colors',
                          t.unread && t.status !== 'closed' ? 'font-bold text-ink' : 'font-semibold text-ink/85')}>{t.title}</span>
                        {(t.tags || []).slice(0, 3).map(g => (
                          <span key={g.id} className="hidden sm:inline-flex px-1.5 py-px rounded-md text-[10px] font-head font-bold text-white shrink-0"
                            style={{ background: g.color }}>{g.name}</span>
                        ))}
                      </span>
                      <span className="block text-[11.5px] text-dim mt-0.5 truncate">
                        {t.code} · {t.location_name || 'No location'} · {ago(t.created_at)}
                        {t.due_date && (
                          <span className={cx('ml-1.5 font-head font-bold', overdue ? 'text-danger' : 'text-faint')}>
                            {overdue ? `⏰ due ${fmtDate(t.due_date)}` : `due ${fmtDate(t.due_date)}`}
                          </span>
                        )}
                        {t.responses > 0 && <span className="inline-flex items-center gap-0.5 ml-1.5"><MessageSquare size={11} />{t.responses}</span>}
                        {t.attachments > 0 && <span className="ml-1.5">📎{t.attachments}</span>}
                        {t.watching && <span className="ml-1.5" title="You’re watching this ticket">👁</span>}
                      </span>
                    </span>
                    {t.guest_unread && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                        className="px-2 py-0.5 rounded-full bg-lake text-white text-[10px] font-head font-bold shrink-0 whitespace-nowrap">
                        💬 guest
                      </motion.span>
                    )}
                    {t.assignee_name && <Avatar name={t.assignee_name} color={t.assignee_color} size={26} className="hidden xs:inline-flex" />}
                    <Badge className={cx(s.cls, 'shrink-0')}>{s.label}</Badge>
                  </motion.button>
                )
              })}
            </motion.div>
          )}
        </>
      )}

      <TicketForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={t => nav(`/tickets/${t.id}`)} />
    </motion.div>
  )
}
