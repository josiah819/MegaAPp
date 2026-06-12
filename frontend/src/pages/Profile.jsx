import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../store.jsx'
import { api, setToken } from '../api.js'
import { PageHead, Card, Btn, Kicker, Field, Avatar, Seg, Badge, Toggle } from '../components/ui.jsx'
import { pageAnim } from '../motion.js'

// VAPID public key (base64url) → Uint8Array for PushManager.subscribe
function urlB64ToUint8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function PushCard() {
  const { settings, toast } = useApp()
  const [state, setState] = useState('checking') // checking | unsupported | off | on | busy
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && !!settings.vapid_public

  useEffect(() => {
    if (!supported) return setState('unsupported')
    navigator.serviceWorker.getRegistration().then(async reg => {
      if (!reg) return setState('unsupported')
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'on' : 'off')
    }).catch(() => setState('unsupported'))
  }, [supported])

  async function toggle(on) {
    setState('busy')
    try {
      const reg = await navigator.serviceWorker.ready
      if (on) {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') throw new Error('Notifications were blocked by the browser')
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(settings.vapid_public),
        })
        await api.post('/auth/push/subscribe', sub.toJSON())
        toast('Push notifications on — this device will buzz 🔔')
        setState('on')
      } else {
        const sub = await reg.pushManager.getSubscription()
        if (sub) { await api.post('/auth/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe() }
        toast('Push notifications off for this device')
        setState('off')
      }
    } catch (e) { toast(e.message, 'err'); setState(on ? 'off' : 'on') }
  }

  if (state === 'unsupported') return null
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Kicker className="!text-dim mb-1">Push notifications</Kicker>
          <p className="text-[12.5px] text-dim leading-relaxed">
            Assignments, guest messages, approvals, and overdue gear — even when WoodsOS is closed.
            Per device; works best installed as an app.
          </p>
        </div>
        <Toggle on={state === 'on'} disabled={state === 'busy' || state === 'checking'}
          onChange={toggle} label="Push notifications" />
      </div>
    </Card>
  )
}

export default function Profile() {
  const { user, toast, theme, setTheme } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  async function changePassword(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api.post('/auth/change-password', { current, next })
      if (r?.token) setToken(r.token) // other sessions are signed out; this one rolls forward
      toast('Password changed — other devices were signed out ✅')
      setCurrent(''); setNext('')
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }

  const grantedCount = Object.values(user.perms || {}).filter(Boolean).length

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="You" title="Profile" />
      <div className="grid lg:grid-cols-2 gap-4 max-w-3xl">
        <Card className="p-5">
          <div className="flex items-center gap-4 mb-5">
            <Avatar name={user.name} color={user.color} size={56} />
            <div>
              <div className="font-head font-bold text-[16px] text-ink">{user.name}</div>
              <div className="text-[12.5px] text-dim">{user.email}</div>
              <div className="flex gap-1.5 mt-1.5">
                <Badge className="bg-brand/10 text-brand capitalize">{user.role_key}</Badge>
                <Badge className="bg-sunken text-dim">{user.dept}</Badge>
              </div>
            </div>
          </div>
          <Kicker className="!text-dim mb-2">Theme</Kicker>
          <Seg value={theme} onChange={setTheme} options={[
            { v: 'auto', label: 'Auto' }, { v: 'light', label: 'Daybreak' }, { v: 'dark', label: 'Night paddle' },
          ]} />
          <p className="text-[12px] text-faint mt-4">
            Your access: {grantedCount} permissions via the {user.role_key} role
            {Object.keys(user.overrides || {}).length ? ` + ${Object.keys(user.overrides).length} personal overrides` : ''}.
          </p>
        </Card>

        <Card className="p-5">
          <Kicker className="!text-dim mb-4">Change password</Kicker>
          <form onSubmit={changePassword} className="space-y-4">
            <Field label="Current password">
              <input type="password" className="input" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 8 characters. Changing it signs out your other devices.">
              <input type="password" className="input" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
            </Field>
            <Btn type="submit" disabled={busy || next.length < 8 || !current}>Update password</Btn>
          </form>
        </Card>

        <div className="lg:col-span-2"><PushCard /></div>
      </div>
    </motion.div>
  )
}
