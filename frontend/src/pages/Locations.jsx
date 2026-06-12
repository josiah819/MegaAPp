import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Wrench, SquareCheckBig, BedDouble } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Btn, Badge, SearchInput, Sheet, Field, Select, EmptyState, PageLoader, Toggle } from '../components/ui.jsx'
import { cx, ago } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

const COND_CLS = {
  clean: 'bg-summer/12 text-summer', dirty: 'bg-ember/12 text-ember',
  maintenance: 'bg-danger/12 text-danger', closed: 'bg-sunken text-dim',
}

export default function Locations() {
  const { can, toast, settings } = useApp()
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [condEdit, setCondEdit] = useState(null)
  const [edit, setEdit] = useState(null)

  const meta = settings.locations_meta || {}
  const cats = meta.categories || []
  const conds = meta.conditions || []
  const catMeta = key => cats.find(c => c.key === key)

  const load = () => api.get('/locations').then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  useEffect(() => { load() }, []) // eslint-disable-line

  const filtered = useMemo(() => (list || []).filter(l =>
    (!cat || l.category === cat) &&
    (!q || l.name.toLowerCase().includes(q.toLowerCase()) || (l.zone || '').toLowerCase().includes(q.toLowerCase()))
  ), [list, q, cat])

  async function saveCondition() {
    try {
      await api.patch(`/locations/${condEdit.id}`, { condition: condEdit.condition, condition_note: condEdit.condition_note })
      toast('Condition updated')
      setCondEdit(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function saveLocation() {
    try {
      const body = { ...edit, capacity: edit.capacity ? Number(edit.capacity) : null, beds: edit.beds ? Number(edit.beds) : null }
      edit.id ? await api.patch(`/locations/${edit.id}`, body) : await api.post('/locations', body)
      toast('Location saved'); setEdit(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Property" title="Locations" sub="Every lodge, court, dock and trailhead — with live housekeeping status."
        actions={can('locations.manage') && (
          <Btn onClick={() => setEdit({ name: '', category: 'venue', zone: '', capacity: '', beds: '', notes: '', exclude_from_accom: true })}>
            <Plus size={15} /> Add location
          </Btn>
        )} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search the property…" className="w-full sm:w-64 sm:mr-2" />
        <button onClick={() => setCat('')}
          className={cx('px-3 py-1.5 rounded-full text-[12px] font-head font-bold border transition',
            !cat ? 'bg-brand text-white border-brand' : 'border-line text-dim hover:border-faint')}>All</button>
        {cats.map(c => (
          <button key={c.key} onClick={() => setCat(cat === c.key ? '' : c.key)}
            className={cx('px-3 py-1.5 rounded-full text-[12px] font-head font-bold border transition inline-flex items-center gap-1.5',
              cat === c.key ? 'bg-brand text-white border-brand' : 'border-line text-dim hover:border-faint')}>
            <span>{c.icon}</span>{c.label}
          </button>
        ))}
      </div>

      {list === null ? <PageLoader /> : filtered.length === 0 ? (
        <Card><EmptyState icon="🗺️" title="Nothing found" body="Try a different search or category." /></Card>
      ) : (
        <motion.div variants={stagger(0.02)} initial="initial" animate="animate"
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(l => {
            const cm = conds.find(c => c.key === l.condition)
            return (
              <motion.div variants={rise} key={l.id}>
                <Card className="p-4 h-full flex flex-col hover:shadow-lift transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[17px]">{catMeta(l.category)?.icon || '📍'}</span>
                        <span className="font-head font-bold text-[14px] text-ink truncate">{l.name}</span>
                      </div>
                      <div className="text-[11.5px] text-faint mt-0.5 ml-7">{l.zone || catMeta(l.category)?.label}</div>
                    </div>
                    <button disabled={!can('locations.edit')}
                      onClick={() => setCondEdit({ id: l.id, name: l.name, condition: l.condition, condition_note: l.condition_note || '' })}
                      className={cx(!can('locations.edit') && 'pointer-events-none')}>
                      <Badge className={cx(COND_CLS[l.condition] || COND_CLS.clean, can('locations.edit') && 'hover:ring-2 hover:ring-accent/40 transition cursor-pointer')}>
                        {cm?.label || l.condition}
                      </Badge>
                    </button>
                  </div>
                  {l.condition_note && (
                    <div className="mt-2.5 text-[12px] text-dim bg-sunken/70 rounded-lg px-2.5 py-1.5">
                      {l.condition_note}
                      {l.condition_updated_by && <span className="block text-[10.5px] text-faint mt-0.5">{l.condition_updated_by} · {ago(l.condition_updated_at)}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-3.5 mt-auto pt-3 text-[11.5px] text-dim font-head font-semibold">
                    {l.beds ? <span className="inline-flex items-center gap-1"><BedDouble size={12} className="text-faint" />{l.beds}</span> : null}
                    {l.occupied_today && <span className="text-lake">● occupied</span>}
                    {l.open_tickets > 0 && <span className="inline-flex items-center gap-1 text-ember"><Wrench size={11} />{l.open_tickets}</span>}
                    {l.open_tasks > 0 && <span className="inline-flex items-center gap-1"><SquareCheckBig size={11} className="text-faint" />{l.open_tasks}</span>}
                    <span className="flex-1" />
                    {can('locations.manage') && (
                      <button className="hover-reveal text-brand hover:underline"
                        onClick={() => setEdit({ ...l, capacity: l.capacity || '', beds: l.beds || '' })}>Edit</button>
                    )}
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      {/* condition sheet */}
      <Sheet open={!!condEdit} onClose={() => setCondEdit(null)} kicker={condEdit?.name} title="Housekeeping status"
        footer={<><Btn variant="ghost" onClick={() => setCondEdit(null)}>Cancel</Btn><Btn onClick={saveCondition}>Update</Btn></>}>
        {condEdit && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {conds.map(c => (
                <button key={c.key} onClick={() => setCondEdit(s => ({ ...s, condition: c.key }))}
                  className={cx('px-3 py-2.5 rounded-xl border-2 text-left font-head font-bold text-[13px] transition',
                    condEdit.condition === c.key ? 'border-accent bg-accent/10 text-ink' : 'border-line text-dim hover:border-faint')}>
                  {c.label}
                  {c.blocking && <span className="block text-[10px] font-semibold text-danger mt-0.5">blocks lodging</span>}
                </button>
              ))}
            </div>
            <Field label="Note">
              <textarea className="input" rows={2} value={condEdit.condition_note}
                onChange={e => setCondEdit(s => ({ ...s, condition_note: e.target.value }))}
                placeholder="What’s happening here?" />
            </Field>
          </div>
        )}
      </Sheet>

      {/* manage sheet */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} kicker="Locations" title={edit?.id ? `Edit ${edit.name}` : 'Add location'} wide
        footer={<><Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn><Btn onClick={saveLocation} disabled={!edit?.name}>Save</Btn></>}>
        {edit && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Name" className="sm:col-span-2"><input className="input" value={edit.name} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} /></Field>
            <Field label="Category">
              <Select value={edit.category} onChange={v => setEdit(s => ({ ...s, category: v }))}>
                {cats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Zone"><input className="input" value={edit.zone || ''} onChange={e => setEdit(s => ({ ...s, zone: e.target.value }))} placeholder="North Campus" /></Field>
            <Field label="Capacity"><input type="number" className="input" value={edit.capacity} onChange={e => setEdit(s => ({ ...s, capacity: e.target.value }))} /></Field>
            <Field label="Beds"><input type="number" className="input" value={edit.beds} onChange={e => setEdit(s => ({ ...s, beds: e.target.value }))} /></Field>
            <Field label="Notes" className="sm:col-span-2"><textarea className="input" rows={2} value={edit.notes || ''} onChange={e => setEdit(s => ({ ...s, notes: e.target.value }))} /></Field>
            <label className="flex items-center gap-2.5 sm:col-span-2 text-[13px] font-head font-semibold text-ink">
              <Toggle on={!edit.exclude_from_accom} onChange={v => setEdit(s => ({ ...s, exclude_from_accom: !v }))} label="On lodging grid" />
              Show on the accommodation grid
            </label>
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}
