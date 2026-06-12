import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { cx } from '../../lib.js'
import { SWIFT } from '../../motion.js'

export default function Report() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const [meta, setMeta] = useState(null)
  const [err, setErr] = useState('')
  // QR posters deep-link the location: /report/<token>?loc=<id>
  const [f, setF] = useState({ category: '', location_id: params.get('loc') || '', details: '', name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    fetch(`/api/public/report/${token}`)
      .then(r => { if (!r.ok) throw new Error('This link is not active — please find a staff member.'); return r.json() })
      .then(setMeta).catch(e => setErr(e.message))
  }, [token])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await fetch(`/api/public/report/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, location_id: f.location_id ? Number(f.location_id) : null }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Something went wrong')
      setDone(j)
    } catch (e2) { setErr(e2.message); setTimeout(() => setErr(''), 4000) } finally { setBusy(false) }
  }

  if (!meta && !err) return <div className="min-h-screen-dyn bg-bg" />

  return (
    <div className="min-h-screen-dyn bg-bg bg-topo-ink flex flex-col items-center px-5 py-8"
      style={{ paddingTop: 'calc(var(--sat) + 2rem)', paddingBottom: 'calc(var(--sab) + 2rem)' }}>
      <motion.img initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        src="/brand/logo-colour.png" alt="Muskoka Woods" className="h-10 mb-6" />

      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="card max-w-md w-full p-8 text-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15, type: 'spring', stiffness: 380, damping: 18 }}
              className="w-16 h-16 mx-auto rounded-full bg-summer/15 text-summer flex items-center justify-center text-[30px] mb-4">✓</motion.div>
            <h1 className="disp text-[34px] text-ink mb-2">Got it — thank you!</h1>
            <p className="text-dim text-[14px] leading-relaxed">
              Our team has been notified and we’re on it.
              Your reference code is
            </p>
            <div className="font-head font-extrabold text-[24px] text-brand tracking-wider my-3 tnum">{done.code}</div>
            {done.track_path && (
              <a href={done.track_path}
                className="block w-full py-3 rounded-xl bg-brand text-white font-head font-bold text-[14.5px] hover:bg-brand-deep transition mb-2.5">
                Follow your report — chat with our team
              </a>
            )}
            <button onClick={async () => {
              const url = `${location.origin}${done.track_path}`
              try { await navigator.clipboard.writeText(url) } catch { /* older browsers */ }
              if (navigator.share) navigator.share({ title: 'Muskoka Woods — my report', url }).catch(() => {})
            }} className="text-[12px] font-head font-bold text-dim hover:text-ink transition">
              Copy the link to keep it
            </button>
            <p className="text-faint text-[12.5px] mt-3">Or mention the code to any staff member.</p>
            <button onClick={() => { setDone(null); setF({ category: '', location_id: '', details: '', name: '', email: '' }) }}
              className="mt-5 text-[13px] font-head font-bold text-brand hover:underline">Report something else</button>
          </motion.div>
        ) : err && !meta ? (
          <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card max-w-md w-full p-8 text-center text-ink font-head">
            {err}
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={submit}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: SWIFT }}
            className="card max-w-md w-full p-6 sm:p-7">
            <div className="kicker text-green-dark mb-1.5">{meta.org.name}</div>
            <h1 className="disp text-[34px] text-ink leading-none mb-2">Spotted something?</h1>
            <p className="text-dim text-[13.5px] leading-relaxed mb-5">{meta.intro}</p>

            <label className="label">What kind of thing?</label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {meta.categories.map(c => (
                <button type="button" key={c.key} onClick={() => setF(s => ({ ...s, category: c.key }))}
                  className={cx('px-3 py-2.5 rounded-xl border-2 text-[13px] font-head font-bold text-left transition',
                    f.category === c.key ? 'border-brand bg-brand/8 text-ink' : 'border-line text-dim hover:border-faint')}>
                  {c.label}
                </button>
              ))}
            </div>

            <label className="label">Where?</label>
            <select className="input mb-4" value={f.location_id} onChange={e => setF(s => ({ ...s, location_id: e.target.value }))}>
              <option value="">Not sure / somewhere else</option>
              {meta.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>

            <label className="label">What’s going on?</label>
            <textarea required minLength={5} className="input mb-4" rows={3} value={f.details}
              onChange={e => setF(s => ({ ...s, details: e.target.value }))}
              placeholder="e.g. The tap in Cedarwood’s south washroom won’t stop dripping" />

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="label">Your name <span className="text-faint normal-case tracking-normal">(optional)</span></label>
                <input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Email <span className="text-faint normal-case tracking-normal">(optional)</span></label>
                <input type="email" className="input" value={f.email} onChange={e => setF(s => ({ ...s, email: e.target.value }))} />
              </div>
            </div>

            {err && <div className="text-[13px] font-head font-semibold text-danger mb-3">{err}</div>}

            <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy || f.details.trim().length < 5}
              className="btn w-full py-3 rounded-xl bg-brand text-white font-head font-bold text-[15px] hover:bg-brand-deep transition disabled:opacity-50">
              {busy ? 'Sending…' : 'Send it in'}
            </motion.button>
            <p className="text-center text-[11.5px] text-faint mt-3">Takes ~30 seconds · goes straight to the facilities team</p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
