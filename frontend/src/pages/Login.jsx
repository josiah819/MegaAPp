import React, { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useApp } from '../store.jsx'
import { Btn, Field, Spinner } from '../components/ui.jsx'
import { SWIFT } from '../motion.js'

const riseIn = (d = 0) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.55, ease: SWIFT, delay: d } },
})

export default function Login() {
  const { user, loading, login } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!loading && user) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen-dyn grid lg:grid-cols-[1.1fr_1fr] bg-bg">
      {/* brand panel */}
      <div className="relative overflow-hidden bg-brand-deep min-h-[36vh] lg:min-h-0">
        <img src="/brand/hero.webp" alt="" className="absolute inset-0 w-full h-full object-cover object-center"
          style={{ filter: 'saturate(1.05)' }} />
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(12deg, rgba(10,30,34,0.92) 8%, rgba(14,44,50,0.45) 48%, rgba(14,44,50,0.25) 100%)' }} />
        <div className="absolute inset-0 bg-topo opacity-70" />
        <div className="relative h-full flex flex-col justify-between p-7 sm:p-10" style={{ paddingTop: 'calc(var(--sat) + 1.75rem)' }}>
          <motion.img {...riseIn(0.05)} src="/brand/logo-white.png" alt="Muskoka Woods" className="h-9 sm:h-11 w-auto self-start" />
          <div className="hidden lg:block">
            <motion.div {...riseIn(0.18)} className="kicker text-green mb-3 flex items-center gap-2.5">
              <span className="inline-block w-7 h-[2px] bg-green rounded-full" /> The camp operations platform
            </motion.div>
            <motion.h1 {...riseIn(0.28)} className="disp text-white text-[64px] xl:text-[78px] max-w-[560px]">
              Every part of camp.<br />
              <span className="text-green">One place.</span>
            </motion.h1>
            <motion.p {...riseIn(0.4)} className="text-white/75 max-w-md mt-4 text-[15px] leading-relaxed">
              Bookings, facilities, tasks, sign-out, people and the property itself —
              run from one beautiful basecamp.
            </motion.p>
          </div>
          <motion.div {...riseIn(0.5)} className="hidden lg:flex items-center gap-3 text-white/55 text-[12px] font-head font-semibold tracking-[0.18em] uppercase">
            Lake Rosseau, Ontario <span className="w-1 h-1 rounded-full bg-green inline-block" /> est. 1979
          </motion.div>
        </div>
      </div>

      {/* form */}
      <div className="flex items-center justify-center px-6 py-10 sm:py-14 bg-topo-ink">
        <div className="w-full max-w-[400px]">
          <motion.div {...riseIn(0.1)}>
            <div className="kicker text-green-dark mb-2">Welcome back</div>
            <h2 className="disp text-[44px] text-ink">Sign in to WoodsOS</h2>
            <p className="text-dim mt-2">Use your Muskoka Woods staff account.</p>
          </motion.div>

          <motion.form {...riseIn(0.22)} onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Email">
              <input className="input" type="email" autoComplete="email" required
                placeholder="you@muskokawoods.com" value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <input className="input" type="password" autoComplete="current-password" required
                placeholder="••••••••••" value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
            {error && (
              <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -7, 7, -4, 4, 0] }}
                transition={{ duration: 0.4 }}
                className="text-[13px] font-head font-semibold text-danger bg-danger/8 border border-danger/20 rounded-xl px-3.5 py-2.5">
                {error}
              </motion.div>
            )}
            <Btn type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? <Spinner size={17} className="!border-white/30 !border-t-white" /> : <>Step inside <ArrowRight size={16} /></>}
            </Btn>
          </motion.form>

          <motion.div {...riseIn(0.34)} className="mt-7 card px-4 py-3.5 text-[12.5px] text-dim leading-relaxed">
            <span className="font-head font-bold text-ink block mb-1">Demo workspace</span>
            <span className="block"><b className="text-ink">admin@muskokawoods.com</b> — full admin</span>
            <span className="block">sarah@ · director · dave@ · manager · liam@ · staff · olivia@ · front desk · ravi@ · viewer</span>
            <span className="block mt-1">Password for everyone: <b className="text-ink">WoodsOS!demo</b></span>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
