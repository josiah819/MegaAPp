import React, { useEffect, useState } from 'react'
import { Copy, RefreshCcw, ExternalLink } from 'lucide-react'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'
import { Btn, Card, Kicker, Field, Toggle, PageLoader } from '../ui.jsx'

const csv = arr => (arr || []).join(', ')
const parseCsv = s => String(s).split(',').map(x => x.trim()).filter(Boolean)

export default function SettingsAdmin() {
  const { toast, reload } = useApp()
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/admin/settings').then(setS).catch(e => toast(e.message, 'err'))
  useEffect(() => { load() }, []) // eslint-disable-line

  if (!s) return <PageLoader />
  const set = (key, patch) => setS(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  async function save(key) {
    setBusy(true)
    try {
      await api.put(`/admin/settings/${key}`, s[key])
      toast('Saved ✅')
      reload()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  async function rotate(which) {
    try {
      const { tokens } = await api.post('/admin/tokens/rotate', { which })
      setS(prev => ({ ...prev, tokens }))
      toast('Link rotated — old links are dead now')
    } catch (e) { toast(e.message, 'err') }
  }

  const links = [
    ['Smart screen', 'screen', '/screen/'],
    ['Who’s On board', 'board', '/board/'],
    ['Guest report form', 'report', '/report/'],
    ['Calendar feed (iCal)', 'ical', '/api/public/ical/'],
  ]

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card className="p-5">
        <Kicker className="!text-dim mb-4">Organization</Kicker>
        <div className="space-y-4">
          <Field label="Name"><input className="input" value={s.org.name || ''} onChange={e => set('org', { name: e.target.value })} /></Field>
          <Field label="Tagline"><input className="input" value={s.org.tagline || ''} onChange={e => set('org', { tagline: e.target.value })} /></Field>
          <Field label="Departments" hint="Comma separated.">
            <input className="input" value={csv(s.org.departments)} onChange={e => set('org', { departments: parseCsv(e.target.value) })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emergency contact"><input className="input" value={s.org.emergency_contact_name || ''} onChange={e => set('org', { emergency_contact_name: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={s.org.emergency_contact_phone || ''} onChange={e => set('org', { emergency_contact_phone: e.target.value })} /></Field>
          </div>
          <Btn size="sm" onClick={() => save('org')} disabled={busy}>Save organization</Btn>
        </div>
      </Card>

      <Card className="p-5">
        <Kicker className="!text-dim mb-4">Public links</Kicker>
        <div className="space-y-3">
          {links.map(([label, key, path]) => {
            const url = `${location.origin}${path}${s.tokens?.[key] || ''}`
            return (
              <div key={key} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-head font-bold text-ink">{label}</div>
                  <div className="text-[11px] text-faint truncate tnum">{url}</div>
                </div>
                <a href={url} target="_blank" rel="noreferrer" className="icon-btn p-2 rounded-xl text-dim hover:text-ink hover:bg-sunken" title="Open"><ExternalLink size={14} /></a>
                <button className="icon-btn p-2 rounded-xl text-dim hover:text-ink hover:bg-sunken" title="Copy"
                  onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Copied'))}><Copy size={14} /></button>
                <button className="icon-btn p-2 rounded-xl text-dim hover:text-danger hover:bg-sunken" title="Rotate (kills old link)"
                  onClick={() => rotate(key)}><RefreshCcw size={14} /></button>
              </div>
            )
          })}
        </div>
        <p className="text-[11.5px] text-faint mt-3.5">Anyone with a link can view that page — rotate if one leaks.</p>
      </Card>

      <Card className="p-5">
        <Kicker className="!text-dim mb-4">Sign-out</Kicker>
        <div className="space-y-4">
          <Field label="Quick destinations" hint="Comma separated.">
            <input className="input" value={csv(s.signout.destinations)} onChange={e => set('signout', { destinations: parseCsv(e.target.value) })} />
          </Field>
          <Field label="Quick durations" hint="Comma separated.">
            <input className="input" value={csv(s.signout.durations)} onChange={e => set('signout', { durations: parseCsv(e.target.value) })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Curfew"><input className="input" value={s.signout.curfew || ''} onChange={e => set('signout', { curfew: e.target.value })} placeholder="23:00" /></Field>
            <Field label="Overdue webhook" hint="Slack/Teams/Discord — optional.">
              <input className="input" value={s.signout.webhook_url || ''} onChange={e => set('signout', { webhook_url: e.target.value })} placeholder="https://hooks…" />
            </Field>
          </div>
          <Btn size="sm" onClick={() => save('signout')} disabled={busy}>Save sign-out</Btn>
        </div>
      </Card>

      <Card className="p-5">
        <Kicker className="!text-dim mb-4">Smart screens</Kicker>
        <div className="space-y-4">
          <Field label="Welcome message">
            <textarea className="input" rows={2} value={s.screens.welcome_message || ''} onChange={e => set('screens', { welcome_message: e.target.value })} />
          </Field>
          <Field label="Seconds per panel">
            <input type="number" min="5" className="input !w-28" value={s.screens.rotate_seconds || 12}
              onChange={e => set('screens', { rotate_seconds: Number(e.target.value) || 12 })} />
          </Field>
          <div>
            <span className="label">Panels</span>
            <div className="grid grid-cols-2 gap-2.5">
              {Object.entries({ welcome: 'Welcome', schedule: 'Today’s schedule', weather: 'Weather', lodging: 'Lodging', announcements: 'Announcements', kudos: 'Kudos wall', whosout: 'Who’s out count' }).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2.5 text-[13px] font-head font-semibold text-ink cursor-pointer">
                  <Toggle on={['whosout', 'kudos'].includes(k) ? s.screens.panels?.[k] === true : s.screens.panels?.[k] !== false}
                    onChange={v => set('screens', { panels: { ...s.screens.panels, [k]: v } })} label={label} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <Btn size="sm" onClick={() => save('screens')} disabled={busy}>Save screens</Btn>
        </div>
      </Card>

      <Card className="p-5">
        <Kicker className="!text-dim mb-4">Billing</Kicker>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tax rate %">
              <input type="number" className="input" value={s.billing?.tax_rate ?? 13}
                onChange={e => set('billing', { tax_rate: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Tax label">
              <input className="input" value={s.billing?.tax_label || 'HST'} onChange={e => set('billing', { tax_label: e.target.value })} />
            </Field>
            <Field label="Invoice prefix">
              <input className="input" value={s.billing?.invoice_prefix || 'INV-'} onChange={e => set('billing', { invoice_prefix: e.target.value })} />
            </Field>
          </div>
          <Field label="Payment instructions" hint="Shown on invoices.">
            <textarea className="input" rows={2} value={s.billing?.payment_instructions || ''}
              onChange={e => set('billing', { payment_instructions: e.target.value })} />
          </Field>
          <Btn size="sm" onClick={() => save('billing')} disabled={busy}>Save billing</Btn>
        </div>
      </Card>

      <Card className="p-5">
        <Kicker className="!text-dim mb-4">Ticket SLAs</Kicker>
        <p className="text-[12px] text-faint mb-3 -mt-2">Hours until a new ticket is due, by priority. Past-due tickets escalate once with a nudge.</p>
        <div className="grid grid-cols-4 gap-3">
          {[[4, '🔥 ASAP'], [3, 'Urgent'], [2, 'High'], [1, 'Normal']].map(([p, label]) => (
            <Field key={p} label={label}>
              <input type="number" min="1" className="input" value={s.sla?.hours?.[p] ?? ''}
                onChange={e => set('sla', { hours: { ...(s.sla?.hours || {}), [p]: Number(e.target.value) || 0 } })} />
            </Field>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[13px] font-head font-semibold text-ink">Escalate past-due tickets</span>
          <Toggle on={s.sla?.escalate !== false} onChange={v => set('sla', { escalate: v })} label="Escalate" />
        </div>
        <Btn size="sm" className="mt-4" onClick={() => save('sla')} disabled={busy}>Save SLAs</Btn>
      </Card>

      <Card className="p-5">
        <Kicker className="!text-dim mb-4">Claude & AI</Kicker>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-head font-bold text-[13.5px] text-ink">AI access enabled</div>
            <p className="text-[12px] text-faint mt-0.5 max-w-md">
              The org-wide master switch for the MCP endpoint. Individual access is the ai.use / ai.write
              permissions; tokens are managed on the Claude AI page.
            </p>
          </div>
          <Toggle on={s.ai?.enabled !== false} onChange={v => set('ai', { enabled: v })} label="AI enabled" />
        </div>
        <Btn size="sm" className="mt-4" onClick={() => save('ai')} disabled={busy}>Save AI settings</Btn>
      </Card>

      <Card className="p-5">
        <Kicker className="!text-dim mb-4">Guest report form</Kicker>
        <div className="grid lg:grid-cols-2 gap-4">
          <Field label="Intro text">
            <textarea className="input" rows={2} value={s.report.intro || ''} onChange={e => set('report', { intro: e.target.value })} />
          </Field>
          <Field label="Categories" hint="Comma separated — key:Label pairs are kept simple as labels.">
            <input className="input" value={(s.report.categories || []).map(c => c.label).join(', ')}
              onChange={e => set('report', {
                categories: parseCsv(e.target.value).map(label => {
                  const existing = (s.report.categories || []).find(c => c.label === label)
                  return existing || { key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label }
                }),
              })} />
          </Field>
        </div>
        <Btn size="sm" className="mt-4" onClick={() => save('report')} disabled={busy}>Save report form</Btn>
      </Card>
    </div>
  )
}
