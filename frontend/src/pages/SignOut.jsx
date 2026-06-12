import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, Undo2, History } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Btn, Badge, Kicker, Avatar, Field, Select, PageLoader, Sheet } from '../components/ui.jsx'
import { cx, ago, untilTxt, fmtTime, fmtDateLong } from '../lib.js'
import { pageAnim, SPRING } from '../motion.js'

function chipBtn(active) {
  return cx('px-3 py-1.5 rounded-full border text-[12.5px] font-head font-bold transition',
    active ? 'bg-brand text-white border-brand' : 'border-line text-dim hover:border-faint hover:text-ink')
}

function SignOutForm({ onDone }) {
  const { settings, toast, reload, can, user } = useApp()
  const so = settings.signout || {}
  const [dest, setDest] = useState('')
  const [customDest, setCustomDest] = useState('')
  const [dur, setDur] = useState('2 h')
  const [vehicle, setVehicle] = useState('')
  const [companions, setCompanions] = useState('')
  const [forUser, setForUser] = useState('')
  const [people, setPeople] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (can('signout.manage') && can('people.view')) api.get('/people').then(setPeople).catch(() => {})
  }, []) // eslint-disable-line

  const durations = { '1 h': 1, '2 h': 2, '3 h': 3, 'Half day': 5, 'Overnight': 18 }

  async function go() {
    setBusy(true)
    try {
      const hours = durations[dur] ?? 2
      await api.post('/trips/out', {
        destination: customDest || dest,
        expected_return: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
        vehicle, companions,
        user_id: forUser ? Number(forUser) : undefined,
      })
      toast('Signed out — travel safe 👋')
      reload(); onDone()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {people.length > 0 && (
        <Field label="Who’s heading out?">
          <Select value={forUser} onChange={setForUser}>
            <option value="">Me ({user.name})</option>
            {people.filter(p => p.id !== user.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Destination">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(so.destinations || []).map(d => (
            <button key={d} type="button" className={chipBtn(dest === d && !customDest)}
              onClick={() => { setDest(d); setCustomDest('') }}>{d}</button>
          ))}
        </div>
        <input className="input" placeholder="Or type somewhere else…" value={customDest}
          onChange={e => setCustomDest(e.target.value)} />
      </Field>
      <Field label="Roughly how long?">
        <div className="flex flex-wrap gap-1.5">
          {(so.durations || Object.keys(durations)).map(d => (
            <button key={d} type="button" className={chipBtn(dur === d)} onClick={() => setDur(d)}>{d}</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle"><input className="input" value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="Camp van 2" /></Field>
        <Field label="Companions"><input className="input" value={companions} onChange={e => setCompanions(e.target.value)} placeholder="Who’s with you?" /></Field>
      </div>
      <Btn size="lg" className="w-full" onClick={go} disabled={busy || (!dest && !customDest)}>
        Sign {forUser ? 'them' : 'me'} out
      </Btn>
    </div>
  )
}

export default function SignOut() {
  const { can, my_trip, reload, toast, badges } = useApp()
  const [board, setBoard] = useState(null)
  const [history, setHistory] = useState(null)
  const [histOpen, setHistOpen] = useState(false)

  const loadBoard = () => {
    if (!can('signout.board')) { setBoard({ trips: [], counts: {} }); return }
    api.get('/trips/board').then(setBoard).catch(() => setBoard({ trips: [], counts: {} }))
  }
  useEffect(() => {
    loadBoard()
    const t = setInterval(loadBoard, 30 * 1000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line

  async function signIn(tripId) {
    try {
      await api.post(`/trips/${tripId}/in`)
      toast('Signed back in ✅')
      loadBoard(); reload()
    } catch (e) { toast(e.message, 'err') }
  }

  async function openHistory() {
    setHistOpen(true)
    if (!history) api.get('/trips/history').then(setHistory).catch(() => setHistory([]))
  }

  if (!board) return <PageLoader />
  const overdue = board.trips.filter(t => t.overdue)
  const out = board.trips.filter(t => !t.overdue)

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Crew" title="Sign-Out" sub="Who’s off property right now — and when they’re due back."
        actions={can('signout.manage') && <Btn variant="outline" size="sm" onClick={openHistory}><History size={14} /> History</Btn>} />

      <div className="grid lg:grid-cols-5 gap-4">
        {/* my status + form */}
        {can('signout.use') && (
          <div className="lg:col-span-2">
            <Card className="p-5 sticky top-[76px]">
              <AnimatePresence mode="wait">
                {my_trip ? (
                  <motion.div key="out" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Kicker className="!text-ember mb-2">You’re off property</Kicker>
                    <div className="disp text-[30px] text-ink mb-1">{my_trip.destination || 'Out'}</div>
                    <div className="text-[13px] text-dim mb-5">
                      Since {fmtTime(my_trip.signed_out_at)}{my_trip.expected_return ? ` · ${untilTxt(my_trip.expected_return)}` : ''}
                    </div>
                    <Btn size="lg" variant="accent" className="w-full" onClick={() => signIn(my_trip.id)}>
                      <Undo2 size={17} /> I’m back on property
                    </Btn>
                  </motion.div>
                ) : (
                  <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Kicker className="!text-dim mb-3">Heading off property?</Kicker>
                    <SignOutForm onDone={loadBoard} />
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </div>
        )}

        {/* board */}
        {can('signout.board') && (
          <div className={can('signout.use') ? 'lg:col-span-3' : 'lg:col-span-5'}>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[['Off property', board.counts.off ?? 0, 'text-ember'], ['Overdue', overdue.length, overdue.length ? 'text-danger' : 'text-dim'], ['On property', board.counts.on ?? 0, 'text-summer']].map(([label, n, tone]) => (
                <Card key={label} className="px-4 py-3 text-center">
                  <div className={cx('disp text-[30px] leading-none tnum', tone)}>{n}</div>
                  <div className="kicker text-dim mt-1" style={{ letterSpacing: '0.14em' }}>{label}</div>
                </Card>
              ))}
            </div>

            {overdue.length > 0 && (
              <div className="mb-4">
                <Kicker className="!text-danger mb-2">⚠ Overdue</Kicker>
                <div className="space-y-2">
                  {overdue.map(t => (
                    <motion.div key={t.id} animate={{ opacity: [1, 0.75, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                      <Card className="p-4 border-danger/40 bg-danger/[0.04] flex items-center gap-3.5">
                        <Avatar name={t.name} color={t.color} size={38} />
                        <div className="min-w-0 flex-1">
                          <div className="font-head font-bold text-[14px] text-ink">{t.name}</div>
                          <div className="text-[12.5px] text-danger font-semibold">{untilTxt(t.expected_return)} · {t.destination || 'unknown destination'}</div>
                          {t.vehicle && <div className="text-[11.5px] text-dim">{t.vehicle}{t.companions ? ` · with ${t.companions}` : ''}</div>}
                        </div>
                        {t.phone && (
                          <a href={`tel:${t.phone}`} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-danger text-white font-head font-bold text-[12.5px]">
                            <Phone size={14} /> Call
                          </a>
                        )}
                        {can('signout.manage') && <Btn size="sm" variant="soft" onClick={() => signIn(t.id)}>Back</Btn>}
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            <Kicker className="!text-dim mb-2">Currently out</Kicker>
            {out.length === 0 ? (
              <Card className="p-6 text-center text-dim text-[13.5px]">Everyone’s on property. 🌲</Card>
            ) : (
              <div className="space-y-2">
                {out.map(t => (
                  <motion.div key={t.id} layout transition={SPRING}>
                    <Card className="p-3.5 flex items-center gap-3.5">
                      <Avatar name={t.name} color={t.color} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="font-head font-bold text-[13.5px] text-ink">{t.name} <span className="text-faint font-semibold text-[11.5px]">· {t.dept}</span></div>
                        <div className="text-[12px] text-dim truncate">
                          {t.destination || '—'} · out {ago(t.signed_out_at)}{t.expected_return ? ` · ${untilTxt(t.expected_return)}` : ''}
                        </div>
                      </div>
                      {t.vehicle && <Badge className="bg-sunken text-dim hidden sm:inline-flex">{t.vehicle}</Badge>}
                      {can('signout.manage') && <Btn size="sm" variant="soft" onClick={() => signIn(t.id)}>Back</Btn>}
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Sheet open={histOpen} onClose={() => setHistOpen(false)} kicker="Sign-Out" title="Trip history" wide>
        {!history ? <PageLoader /> : (
          <div className="space-y-1.5">
            {history.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sunken/60">
                <Avatar name={t.name} color={t.color} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink truncate">{t.name} → {t.destination || '—'}</span>
                  <span className="block text-[11.5px] text-dim">{fmtDateLong(t.signed_out_at)} · {fmtTime(t.signed_out_at)}–{t.signed_in_at ? fmtTime(t.signed_in_at) : 'still out'}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}
