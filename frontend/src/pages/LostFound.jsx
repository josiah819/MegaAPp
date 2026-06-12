import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, PackageSearch, Camera } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import {
  PageHead, Card, Btn, Badge, Field, Select, Sheet, Seg, SearchInput, EmptyState, PageLoader, ConfirmBtn,
} from '../components/ui.jsx'
import { cx, fmtDate, lfStatus, LF_STATUSES, LF_CATEGORIES } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

/* Lost & Found — the front-desk drawer, digitized. Found items get a photo
   and a storage spot; lost reports wait to be matched. */

export default function LostFound() {
  const { can, toast } = useApp()
  const [list, setList] = useState(null)
  const [view, setView] = useState('open')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState(null)
  const [resolve, setResolve] = useState(null)
  const fileRef = useRef()

  const load = () => {
    const p = new URLSearchParams()
    p.set('status', view)
    if (kind) p.set('kind', kind)
    if (q) p.set('q', q)
    api.get(`/lostfound?${p}`).then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  }
  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t) }, [view, kind, q]) // eslint-disable-line

  const canManage = can('lostfound.manage')

  async function save() {
    try {
      const f = form
      const extra = { kind: f.kind, date: f.date, category: f.category, description: f.description, stored_at: f.stored_at, contact: f.contact }
      await api.upload('/lostfound', f.file ? [f.file] : [], extra, 'photo')
      toast(f.kind === 'lost' ? 'Lost report logged' : 'Item logged — into the drawer it goes 🧦')
      setForm(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function doResolve() {
    try {
      await api.patch(`/lostfound/${resolve.id}`, { status: resolve.next, resolution_note: resolve.note || '' })
      toast(`Marked ${resolve.next} ✅`)
      setResolve(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Crew" title="Lost & Found" sub="Every orphaned AirPod and beloved stuffed moose, tracked to a happy ending."
        actions={canManage && (
          <Btn onClick={() => setForm({ kind: 'found', date: new Date().toISOString().slice(0, 10), category: 'other', description: '', stored_at: 'Front Desk', contact: '', file: null })}>
            <Plus size={15} /> Log item
          </Btn>
        )} />

      <div className="flex flex-wrap gap-3 mb-4">
        <Seg value={view} onChange={setView} options={[
          { v: 'open', label: 'Open' }, { v: 'resolved', label: 'Resolved' }, { v: 'all', label: 'All' },
        ]} />
        <Seg value={kind} onChange={setKind} options={[
          { v: '', label: 'Everything' }, { v: 'found', label: '🫙 Found items' }, { v: 'lost', label: '🔎 Lost reports' },
        ]} />
        <SearchInput value={q} onChange={setQ} placeholder="Search descriptions…" className="w-full sm:w-56" />
      </div>

      {list === null ? <PageLoader /> : list.length === 0 ? (
        <Card><EmptyState icon="🧦" title="The drawer is empty" body="Nothing matches — either great news or someone hasn't checked the Hangar bleachers." /></Card>
      ) : (
        <motion.div variants={stagger(0.02)} initial="initial" animate="animate" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map(i => {
            const st = lfStatus(i.status)
            const cat = LF_CATEGORIES.find(([k]) => k === i.category)?.[1] || '🎒 Other'
            return (
              <motion.div variants={rise} key={i.id}>
                <Card className="p-4 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[12px] font-head font-bold text-faint">{cat}</span>
                    <Badge className={st.cls}>{i.kind === 'lost' && i.status === 'open' ? 'Being looked for' : st.label}</Badge>
                  </div>
                  {i.photo && (
                    <a href={`/api/files/${i.photo}`} target="_blank" rel="noreferrer" className="block mb-2">
                      <img src={`/api/files/${i.photo}`} alt="" className="w-full h-32 object-cover rounded-xl border border-line" />
                    </a>
                  )}
                  <p className="text-[13.5px] text-ink leading-snug flex-1">{i.description}</p>
                  <div className="text-[11.5px] text-dim mt-2">
                    {i.kind === 'lost' ? 'Reported lost' : 'Found'} {fmtDate(i.date)}
                    {i.location_name ? ` · ${i.location_name}` : ''}
                    {i.stored_at ? ` · kept at ${i.stored_at}` : ''}
                  </div>
                  {i.resolution_note && <div className="text-[11.5px] text-faint italic mt-1">“{i.resolution_note}”</div>}
                  {canManage && i.status === 'open' && (
                    <div className="flex gap-1.5 mt-3 pt-3 border-t border-line/60 flex-wrap">
                      {(i.kind === 'found' ? ['claimed', 'donated', 'disposed'] : ['returned']).map(nx => (
                        <Btn key={nx} size="sm" variant={nx === 'claimed' || nx === 'returned' ? 'accent' : 'ghost'}
                          onClick={() => setResolve({ id: i.id, next: nx, note: '' })} className="capitalize">{nx}</Btn>
                      ))}
                    </div>
                  )}
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      {/* log form */}
      <Sheet open={!!form} onClose={() => setForm(null)} kicker="Lost & Found" title={form?.kind === 'lost' ? 'Log a lost report' : 'Log a found item'}
        footer={<><Btn variant="ghost" onClick={() => setForm(null)}>Cancel</Btn><Btn onClick={save} disabled={!form?.description?.trim()}>Log it</Btn></>}>
        {form && (
          <div className="space-y-4">
            <Seg value={form.kind} onChange={v => setForm(s => ({ ...s, kind: v }))} options={[
              { v: 'found', label: '🫙 We found something' }, { v: 'lost', label: '🔎 A guest lost something' },
            ]} />
            <Field label="Describe it" hint="Brand, color, identifying marks — make it findable.">
              <textarea className="input" rows={2} value={form.description}
                placeholder={form.kind === 'lost' ? 'Garmin watch, black band, lost near The Park Tuesday' : 'AirPods Pro, blue case, initials “JT”'}
                onChange={e => setForm(s => ({ ...s, description: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={form.category} onChange={v => setForm(s => ({ ...s, category: v }))}>
                  {LF_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Date"><input type="date" className="input" value={form.date} onChange={e => setForm(s => ({ ...s, date: e.target.value }))} /></Field>
            </div>
            {form.kind === 'found' ? (
              <Field label="Where is it being kept?">
                <input className="input" value={form.stored_at} onChange={e => setForm(s => ({ ...s, stored_at: e.target.value }))} placeholder="Front Desk — drawer 2" />
              </Field>
            ) : (
              <Field label="Guest contact" hint="So we can reach them when it turns up.">
                <input className="input" value={form.contact} onChange={e => setForm(s => ({ ...s, contact: e.target.value }))} placeholder="parent@email.com / 705-…" />
              </Field>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => setForm(s => ({ ...s, file: e.target.files?.[0] || null }))} />
            <Btn size="sm" variant="soft" onClick={() => fileRef.current?.click()}>
              <Camera size={14} /> {form.file ? form.file.name : 'Add a photo'}
            </Btn>
          </div>
        )}
      </Sheet>

      {/* resolve */}
      <Sheet open={!!resolve} onClose={() => setResolve(null)} kicker="Lost & Found" title={`Mark ${resolve?.next || ''}`}
        footer={<><Btn variant="ghost" onClick={() => setResolve(null)}>Cancel</Btn><Btn onClick={doResolve}>Confirm</Btn></>}>
        {resolve && (
          <Field label="Note" hint="Who claimed it / how it got home — the future-you thanks you.">
            <input className="input" value={resolve.note} autoFocus
              placeholder="Matched to Ridgeview parent at checkout"
              onChange={e => setResolve(s => ({ ...s, note: e.target.value }))} />
          </Field>
        )}
      </Sheet>
    </motion.div>
  )
}
