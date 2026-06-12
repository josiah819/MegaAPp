import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Siren, Lock } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import {
  PageHead, Card, Btn, Badge, Kicker, Field, Select, Sheet, Seg, EmptyState, PageLoader, Toggle,
} from '../components/ui.jsx'
import { cx, ago, fmtDateLong, severity, incidentType, incidentStatus, INCIDENT_TYPES } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

/* Safety & incidents — the risk log. Severity 1 minor → 4 critical;
   confidential entries stay with confidential-access holders. */

export default function Safety() {
  const { can, toast, user } = useApp()
  const [params, setParams] = useSearchParams()
  const [list, setList] = useState(null)
  const [filter, setFilter] = useState('open')
  const [type, setType] = useState('')
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState(null)
  const [locations, setLocations] = useState([])

  const load = () => {
    const p = new URLSearchParams()
    if (filter !== 'all') p.set('status', filter)
    if (type) p.set('type', type)
    api.get(`/safety?${p}`).then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  }
  useEffect(load, [filter, type]) // eslint-disable-line
  useEffect(() => { if (can('locations.view')) api.get('/locations').then(setLocations).catch(() => {}) }, []) // eslint-disable-line
  useEffect(() => {
    const focus = params.get('focus')
    if (focus && list) {
      api.get(`/safety/${focus}`).then(setDetail).catch(() => {})
      setParams({}, { replace: true })
    }
  }, [params, list]) // eslint-disable-line

  const canManage = can('incidents.manage')

  async function save() {
    try {
      const i = await api.post('/safety', { ...form, location_id: form.location_id ? Number(form.location_id) : null, severity: Number(form.severity) })
      toast(`${i.code} filed — the safety team has been notified 🚨`)
      setForm(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function patch(body, msg) {
    try {
      const i = await api.patch(`/safety/${detail.id}`, body)
      setDetail(i); if (msg) toast(msg); load()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Crew" title="Safety" sub="Incidents logged, followed up, and learned from — the paper trail that protects people."
        actions={can('incidents.report') && (
          <Btn onClick={() => setForm({ title: '', type: 'safety', severity: 2, description: '', people_involved: '', actions_taken: '', location_id: '', confidential: false })}>
            <Plus size={15} /> Report incident
          </Btn>
        )} />

      <div className="flex flex-wrap gap-3 mb-4">
        <Seg value={filter} onChange={setFilter} options={[
          { v: 'open', label: 'Open' }, { v: 'review', label: 'In review' },
          { v: 'closed', label: 'Closed' }, { v: 'all', label: 'All' },
        ]} />
        <Select value={type} onChange={setType} className="!w-auto min-w-[140px]">
          <option value="">All types</option>
          {INCIDENT_TYPES.map(t => <option key={t.v} value={t.v}>{t.emoji} {t.label}</option>)}
        </Select>
      </div>

      {list === null ? <PageLoader /> : list.length === 0 ? (
        <Card><EmptyState icon="🛡️" title="Nothing here" body="A quiet log is a good log." /></Card>
      ) : (
        <motion.div variants={stagger(0.025)} initial="initial" animate="animate" className="space-y-2">
          {list.map(i => {
            const sev = severity(i.severity)
            const ty = incidentType(i.type)
            const st = incidentStatus(i.status)
            return (
              <motion.button variants={rise} key={i.id} onClick={() => api.get(`/safety/${i.id}`).then(setDetail).catch(e => toast(e.message, 'err'))}
                className="card w-full p-3.5 sm:px-4 text-left flex items-center gap-3 hover:shadow-lift transition"
                style={{ borderLeft: `4px solid ${sev.bar}` }}>
                <span className="text-[17px] shrink-0" title={ty.label}>{ty.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-head font-bold text-[13.5px] text-ink truncate">{i.title}</span>
                    {i.confidential && <Lock size={12} className="text-ember shrink-0" />}
                  </span>
                  <span className="block text-[11.5px] text-dim mt-0.5 truncate">
                    {i.code} · {fmtDateLong(i.occurred_at)} · {i.location_name || 'No location'} · by {i.reported_by_name || 'staff'}
                  </span>
                </span>
                <Badge className={cx(sev.cls, 'shrink-0')}>{sev.label}</Badge>
                <Badge className={cx(st.cls, 'shrink-0 hidden xs:inline-flex')}>{st.label}</Badge>
              </motion.button>
            )
          })}
        </motion.div>
      )}

      {/* new incident */}
      <Sheet open={!!form} onClose={() => setForm(null)} kicker="Safety" title="Report an incident" wide
        footer={<><Btn variant="ghost" onClick={() => setForm(null)}>Cancel</Btn><Btn onClick={save} disabled={!form?.title?.trim()}>File report</Btn></>}>
        {form && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="One-line summary" className="sm:col-span-2">
              <input className="input" value={form.title} onChange={e => setForm(s => ({ ...s, title: e.target.value }))} placeholder="Slip on wet stairs — Music Hall entrance" />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={v => setForm(s => ({ ...s, type: v }))}>
                {INCIDENT_TYPES.map(t => <option key={t.v} value={t.v}>{t.emoji} {t.label}</option>)}
              </Select>
            </Field>
            <Field label="Severity">
              <Select value={form.severity} onChange={v => setForm(s => ({ ...s, severity: v }))}>
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} — {severity(n).label}</option>)}
              </Select>
            </Field>
            <Field label="Location" className="sm:col-span-2">
              <Select value={form.location_id} onChange={v => setForm(s => ({ ...s, location_id: v }))}>
                <option value="">— somewhere on property —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="What happened" className="sm:col-span-2">
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(s => ({ ...s, description: e.target.value }))} />
            </Field>
            <Field label="People involved" className="sm:col-span-2" hint="Names or roles — keep medical details factual.">
              <input className="input" value={form.people_involved} onChange={e => setForm(s => ({ ...s, people_involved: e.target.value }))} />
            </Field>
            <Field label="Immediate actions taken" className="sm:col-span-2">
              <textarea className="input" rows={2} value={form.actions_taken} onChange={e => setForm(s => ({ ...s, actions_taken: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2 flex items-center justify-between bg-sunken/60 rounded-xl px-3.5 py-3">
              <div>
                <div className="font-head font-bold text-[13px] text-ink">Confidential</div>
                <div className="text-[11.5px] text-dim">Only confidential-access holders (and you) can open it.</div>
              </div>
              <Toggle on={form.confidential} onChange={v => setForm(s => ({ ...s, confidential: v }))} label="Confidential" />
            </div>
          </div>
        )}
      </Sheet>

      {/* incident detail */}
      <Sheet open={!!detail} onClose={() => setDetail(null)} kicker={detail?.code || ''} title={detail?.title || ''} wide
        footer={<>
          {canManage && detail?.status !== 'closed' && (
            <Btn variant="accent" onClick={() => patch({ status: 'closed' }, 'Incident closed')}>Close incident</Btn>
          )}
          {canManage && detail?.status === 'closed' && (
            <Btn variant="soft" onClick={() => patch({ status: 'review' }, 'Reopened for review')}>Reopen</Btn>
          )}
          <span className="flex-1" />
          <Btn variant="ghost" onClick={() => setDetail(null)}>Close</Btn>
        </>}>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge className={severity(detail.severity).cls}>Severity {detail.severity} — {severity(detail.severity).label}</Badge>
              <Badge className="bg-sunken text-dim">{incidentType(detail.type).emoji} {incidentType(detail.type).label}</Badge>
              <Badge className={incidentStatus(detail.status).cls}>{incidentStatus(detail.status).label}</Badge>
              {detail.confidential && <Badge className="bg-ember/12 text-ember"><Lock size={11} /> confidential</Badge>}
            </div>
            <div className="text-[12.5px] text-dim">
              {fmtDateLong(detail.occurred_at)} · {detail.location_name || 'No location'} · reported by {detail.reported_by_name || 'staff'} {ago(detail.created_at)}
            </div>
            {[['What happened', detail.description], ['People involved', detail.people_involved],
              ['Actions taken', detail.actions_taken]].map(([label, text]) => text && (
              <div key={label}>
                <Kicker className="!text-dim mb-1">{label}</Kicker>
                <p className="text-[13.5px] text-ink whitespace-pre-wrap leading-relaxed">{text}</p>
              </div>
            ))}
            {canManage ? (
              <Field label="Follow-up" hint="Saved when you click away.">
                <textarea className="input" rows={3} defaultValue={detail.followup || ''}
                  placeholder="Prevention steps, parent calls, training notes…"
                  onBlur={e => { if (e.target.value !== (detail.followup || '')) patch({ followup: e.target.value }, 'Follow-up saved') }} />
              </Field>
            ) : detail.followup && (
              <div>
                <Kicker className="!text-dim mb-1">Follow-up</Kicker>
                <p className="text-[13.5px] text-ink whitespace-pre-wrap leading-relaxed">{detail.followup}</p>
              </div>
            )}
            {canManage && detail.status === 'open' && (
              <Btn size="sm" variant="soft" onClick={() => patch({ status: 'review' }, 'Moved to review')}>Move to review</Btn>
            )}
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}
