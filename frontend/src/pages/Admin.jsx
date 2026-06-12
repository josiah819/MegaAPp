import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Tabs, Toggle, Kicker, PageLoader, Select } from '../components/ui.jsx'
import { cx, ago } from '../lib.js'
import { pageAnim } from '../motion.js'
import PermissionsMatrix from '../components/admin/PermissionsMatrix.jsx'
import UsersAdmin from '../components/admin/UsersAdmin.jsx'
import SettingsAdmin from '../components/admin/SettingsAdmin.jsx'

function ModulesAdmin() {
  const { flags, toast, reload } = useApp()
  const [busyKey, setBusyKey] = useState(null)

  async function toggle(f) {
    setBusyKey(f.key)
    try {
      await api.put(`/admin/flags/${f.key}`, { enabled: !f.enabled })
      toast(`${f.label} ${f.enabled ? 'switched off' : 'switched on'}`)
      reload()
    } catch (e) { toast(e.message, 'err') } finally { setBusyKey(null) }
  }

  return (
    <div>
      <p className="text-[13px] text-dim mb-4 max-w-xl">
        Switching a module off hides it for <b className="text-ink">everyone</b> — navigation, pages and its API.
        Roles and overrides only matter while the module is on.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {flags.map(f => (
          <Card key={f.key} className={cx('p-4 transition', !f.enabled && 'opacity-60')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-head font-bold text-[14px] text-ink">{f.label}</div>
                <div className="text-[12px] text-dim mt-0.5 leading-snug">{f.description}</div>
              </div>
              <Toggle on={f.enabled} disabled={busyKey === f.key} onChange={() => toggle(f)} label={f.label} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

const ACTION_ICON = {
  'user.create': '👤', 'user.update': '👤', 'user.reset_password': '🔑', 'password.change': '🔑',
  'role.create': '🛡️', 'role.update': '🛡️', 'role.delete': '🛡️', 'module.toggle': '🧩',
  'settings.update': '⚙️', 'tokens.rotate': '🔗', 'booking.create': '🏕️', 'booking.update': '🏕️',
  'booking.delete': '🏕️', 'ticket.create': '🎫', 'ticket.closed': '✅', 'ticket.delete': '🗑️',
  'task.create': '☑️', 'task.complete': '🎉', 'trip.out': '🚙', 'trip.in': '🏠',
  'location.condition': '🧹', 'kudos.give': '🌟', 'accommodation.block': '🛏️',
}

function AuditLog() {
  const { toast } = useApp()
  const [rows, setRows] = useState(null)
  const [entity, setEntity] = useState('')

  useEffect(() => {
    setRows(null)
    api.get(`/admin/audit${entity ? `?entity=${entity}` : ''}`).then(setRows).catch(e => { toast(e.message, 'err'); setRows([]) })
  }, [entity]) // eslint-disable-line

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Select value={entity} onChange={setEntity} className="!w-48">
          <option value="">All activity</option>
          {['user', 'role', 'module', 'settings', 'booking', 'ticket', 'task', 'trip', 'location', 'kudos', 'post'].map(e =>
            <option key={e} value={e}>{e}</option>)}
        </Select>
      </div>
      {!rows ? <PageLoader /> : (
        <Card className="divide-y divide-line/50">
          {rows.length === 0 && <div className="p-8 text-center text-dim text-[13px]">Nothing logged yet.</div>}
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-3.5 px-4 py-2.5">
              <span className="text-[16px] w-6 text-center">{ACTION_ICON[r.action] || '•'}</span>
              <span className="min-w-0 flex-1">
                <span className="text-[13px] text-ink">
                  <b className="font-head">{r.user_name}</b>
                  <span className="text-dim"> · {r.action.replace(/[._]/g, ' ')}</span>
                  {r.detail?.name && <span className="text-dim"> — {r.detail.name}</span>}
                  {r.detail?.code && <span className="text-dim"> — {r.detail.code}</span>}
                </span>
              </span>
              <span className="text-[11px] text-faint whitespace-nowrap">{ago(r.created_at)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

/* ---- Message of the day (FTF) — posts every signed-in person sees once ---- */
function MotdAdmin() {
  const { toast } = useApp()
  const [list, setList] = useState(null)
  const [f, setF] = useState(null)
  const load = () => api.get('/motd/all').then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  useEffect(load, []) // eslint-disable-line

  async function save() {
    try {
      f.id ? await api.patch(`/motd/${f.id}`, f) : await api.post('/motd', f)
      toast('Message saved 📣'); setF(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  if (!list) return <PageLoader />
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1">
        <Kicker className="!text-dim">Message of the day</Kicker>
        {!f && <button onClick={() => setF({ title: '', body: '' })} className="text-[12px] font-head font-bold text-brand hover:underline">+ New message</button>}
      </div>
      <p className="text-[12px] text-faint mb-4">A popup everyone sees on sign-in until they dismiss it — perfect for “water’s off in Cedarwood until 2”.</p>
      {f && (
        <div className="bg-sunken/60 rounded-xl p-3.5 mb-4 space-y-3">
          <input className="input" value={f.title} placeholder="Title" onChange={e => setF(s => ({ ...s, title: e.target.value }))} />
          <textarea className="input" rows={3} value={f.body} placeholder="The details…" onChange={e => setF(s => ({ ...s, body: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setF(null)} className="text-[12px] font-head font-bold text-dim">Cancel</button>
            <button onClick={save} disabled={!f.title?.trim()} className="text-[12px] font-head font-bold text-brand disabled:opacity-50">Post it</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {list.length === 0 && !f && <div className="text-[12.5px] text-faint">Nothing posted yet.</div>}
        {list.map(m => (
          <div key={m.id} className={cx('flex items-start gap-3 rounded-xl px-3.5 py-2.5 bg-sunken/50', !m.active && 'opacity-50')}>
            <div className="min-w-0 flex-1">
              <div className="font-head font-bold text-[13px] text-ink">{m.title}</div>
              <div className="text-[11.5px] text-dim truncate">{m.body}</div>
              <div className="text-[10.5px] text-faint mt-0.5">{m.author || '—'} · {ago(m.created_at)} · seen by {m.seen_by}</div>
            </div>
            <Toggle on={m.active} label="Active" onChange={async v => {
              await api.patch(`/motd/${m.id}`, { active: v }).catch(() => {}); load()
            }} />
            <button onClick={() => setF(m)} className="text-[11.5px] font-head font-bold text-dim hover:text-ink">Edit</button>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ---- System health (FTF) — the pulse of the box itself ---- */
function SystemHealth() {
  const { toast } = useApp()
  const [h, setH] = useState(null)
  const load = () => api.get('/admin/system-health').then(setH).catch(e => { toast(e.message, 'err') })
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, []) // eslint-disable-line

  if (!h) return <PageLoader />
  const up = s => {
    const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
    return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`
  }
  const max = Math.max(1, ...h.per_minute)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Uptime', up(h.uptime_s)], ['DB ping', `${h.db_ping_ms} ms`], ['Avg response', `${h.avg_ms} ms`],
          ['Memory', `${h.rss_mb} MB`]].map(([l, v]) => (
          <Card key={l} className="px-4 py-3.5">
            <div className="disp text-[22px] text-ink">{v}</div>
            <div className="kicker text-dim mt-0.5">{l}</div>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <Kicker className="!text-dim mb-3">Requests per minute · last 30</Kicker>
        <div className="flex items-end gap-[3px] h-[70px]">
          {h.per_minute.map((n, i) => (
            <div key={i} className="flex-1 h-full flex flex-col justify-end" title={`${n} req`}>
              <div className="rounded-t bg-brand/70 min-h-[2px]" style={{ height: `${(n / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[12px] text-dim font-head font-semibold">
          <span>{h.requests.toLocaleString()} requests since boot</span>
          <span className={h.errors_5xx ? 'text-danger' : ''}>{h.errors_5xx} server errors</span>
          <span className={h.rate_limited ? 'text-ember' : ''}>{h.rate_limited} rate-limited</span>
          <span>DB {h.db_size}</span>
          <span>{h.node}</span>
        </div>
      </Card>
      <Card className="p-5">
        <Kicker className="!text-dim mb-3">Live records</Kicker>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-[12.5px]">
          {Object.entries(h.counts).map(([k, v]) => (
            <div key={k} className="flex justify-between"><span className="text-dim capitalize">{k.replace(/_/g, ' ')}</span><b className="font-head text-ink tnum">{Number(v).toLocaleString()}</b></div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export default function Admin() {
  const { can } = useApp()
  const tabs = useMemo(() => {
    const t = []
    if (can('roles.manage')) t.push({ v: 'permissions', label: 'Permissions' })
    if (can('users.manage')) t.push({ v: 'people', label: 'People' })
    if (can('settings.admin')) t.push({ v: 'modules', label: 'Modules' }, { v: 'settings', label: 'Settings' })
    if (can('motd.manage')) t.push({ v: 'motd', label: 'MOTD' })
    if (can('system.health')) t.push({ v: 'health', label: 'System health' })
    if (can('audit.view')) t.push({ v: 'audit', label: 'Audit log' })
    return t
  }, [can])
  const [tab, setTab] = useState(tabs[0]?.v)

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Insight" title="Admin"
        sub="Who can see what, which modules are on, and how the platform behaves." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} className="mb-6" />
      {tab === 'permissions' && <PermissionsMatrix />}
      {tab === 'people' && <UsersAdmin />}
      {tab === 'modules' && <ModulesAdmin />}
      {tab === 'settings' && <SettingsAdmin />}
      {tab === 'motd' && <MotdAdmin />}
      {tab === 'health' && <SystemHealth />}
      {tab === 'audit' && <AuditLog />}
    </motion.div>
  )
}
