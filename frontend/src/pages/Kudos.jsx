import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, TrendingUp } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Btn, Kicker, Avatar, Select, Field, PageLoader, ConfettiBurst, EmptyState } from '../components/ui.jsx'
import { Spark } from '../components/charts.jsx'
import { cx, ago } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

const EMOJIS = ['👏', '🔥', '❤️', '🎉', '🌲']

export default function Kudos() {
  const { can, toast, user } = useApp()
  const [wall, setWall] = useState(null)
  const [people, setPeople] = useState([])
  const [toId, setToId] = useState('')
  const [valueKey, setValueKey] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confetti, setConfetti] = useState(0)
  const [pulse, setPulse] = useState(null)

  const load = () => api.get('/people/kudos/wall').then(setWall).catch(e => { toast(e.message, 'err') })
  useEffect(() => {
    load()
    api.get('/people').then(setPeople).catch(() => {})
    if (can('pulse.results')) api.get('/people/pulse/summary').then(setPulse).catch(() => {})
  }, []) // eslint-disable-line

  async function give() {
    setBusy(true)
    try {
      await api.post('/people/kudos', { to_id: Number(toId), value_key: valueKey, message })
      setMessage(''); setToId(''); setValueKey('')
      setConfetti(c => c + 1)
      toast('Kudos posted 🎉')
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  async function react(id, emoji) {
    try {
      const r = await api.post(`/people/kudos/${id}/react`, { emoji })
      setWall(w => ({ ...w, kudos: w.kudos.map(k => k.id === id ? { ...k, reactions: r.reactions } : k) }))
    } catch (e) { toast(e.message, 'err') }
  }

  if (!wall) return <PageLoader />
  const vMeta = key => (wall.values || []).find(v => v.key === key)

  return (
    <motion.div {...pageAnim}>
      <ConfettiBurst fire={confetti} />
      <PageHead kicker="Crew" title="Kudos" sub="Catch someone living the values — and say it out loud." />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-3">
          {can('kudos.give') && (
            <Card className="p-4">
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <Field label="Who deserves it?">
                  <Select value={toId} onChange={setToId}>
                    <option value="">Pick a person…</option>
                    {people.filter(p => p.id !== user.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
                <Field label="Which value did they live?">
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {(wall.values || []).map(v => (
                      <button key={v.key} type="button" onClick={() => setValueKey(valueKey === v.key ? '' : v.key)}
                        className={cx('px-2.5 py-1.5 rounded-full border text-[12px] font-head font-bold transition',
                          valueKey === v.key ? 'border-accent bg-accent/10 text-ink' : 'border-line text-dim hover:border-faint')}>
                        {v.emoji} {v.name}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <div className="flex gap-2">
                <input className="input" placeholder="What did they do?" value={message}
                  onChange={e => setMessage(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && toId && message.trim() && give()} />
                <Btn onClick={give} disabled={busy || !toId || !message.trim()}><Send size={15} /></Btn>
              </div>
            </Card>
          )}

          <motion.div variants={stagger(0.05)} initial="initial" animate="animate" className="space-y-3">
            {wall.kudos.length === 0 && <Card><EmptyState icon="🌟" title="The wall is waiting" body="Be the first to call out something great." /></Card>}
            {wall.kudos.map(k => {
              const v = vMeta(k.value_key)
              return (
                <motion.div variants={rise} key={k.id}>
                  <Card className="p-4">
                    <div className="flex items-center gap-2.5 mb-2">
                      <Avatar name={k.from_name || '?'} color={k.from_color} size={30} />
                      <div className="text-[13px]">
                        <span className="font-head font-bold text-ink">{k.from_name || 'Someone'}</span>
                        <span className="text-faint mx-1.5">→</span>
                        <span className="font-head font-bold text-ink">{k.to_name}</span>
                        {v && <span className="ml-2 text-[11.5px] text-dim bg-sunken px-2 py-0.5 rounded-full font-head font-semibold">{v.emoji} {v.name}</span>}
                      </div>
                      <span className="ml-auto text-[11px] text-faint shrink-0">{ago(k.created_at)}</span>
                    </div>
                    <p className="text-[14px] text-ink leading-relaxed pl-[42px]">{k.message}</p>
                    <div className="flex gap-1 mt-2.5 pl-[42px]">
                      {EMOJIS.map(e => {
                        const users = (k.reactions || {})[e] || []
                        const mine = users.includes(user.id)
                        return (
                          <motion.button key={e} whileTap={{ scale: 1.3 }} onClick={() => react(k.id, e)}
                            className={cx('px-2 py-1 rounded-full text-[12.5px] transition border',
                              users.length ? 'border-accent/40 bg-accent/8' : 'border-transparent hover:bg-sunken',
                              mine && 'ring-1 ring-accent/50')}>
                            {e}{users.length > 0 && <span className="ml-1 text-[10.5px] font-bold text-dim tnum">{users.length}</span>}
                          </motion.button>
                        )
                      })}
                    </div>
                  </Card>
                </motion.div>
              )
            })}
          </motion.div>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <Kicker className="!text-dim mb-3">Most celebrated · 30 days</Kicker>
            {wall.leaders.length === 0 ? <div className="text-dim text-[13px]">No kudos yet this month.</div> : (
              <div className="space-y-2.5">
                {wall.leaders.map((l, i) => (
                  <div key={l.id} className="flex items-center gap-3">
                    <span className="disp text-[20px] text-faint w-5 text-center">{i + 1}</span>
                    <Avatar name={l.name} color={l.color} size={30} />
                    <span className="font-head font-bold text-[13px] text-ink flex-1 truncate">{l.name}</span>
                    <span className="text-[12px] text-ember font-head font-bold tnum">{l.n} 🏅</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {pulse && (
            <Card className="p-4">
              <Kicker className="!text-dim mb-3 flex items-center gap-1.5"><TrendingUp size={12} /> Team pulse</Kicker>
              {(() => {
                const pts = pulse.weeks.filter(w => w.mood != null).map(w => Number(w.mood))
                const latest = [...pulse.weeks].reverse().find(w => w.mood != null)
                return (
                  <>
                    {latest ? (
                      <div className="flex items-end gap-3 mb-2">
                        <span className="disp text-[34px] leading-none text-ink tnum">{Number(latest.mood).toFixed(1)}</span>
                        <span className="text-[11.5px] text-dim pb-1">avg mood / 5 · {latest.n} answers</span>
                      </div>
                    ) : <div className="text-dim text-[12.5px] mb-2">Fewer than 3 responses — numbers hidden for anonymity.</div>}
                    {pts.length > 1 && <Spark points={pts} width={220} height={40} />}
                    {pulse.comments.slice(0, 2).map((c, i) => (
                      <p key={i} className="text-[12.5px] text-dim italic mt-2.5 border-l-2 border-line pl-2.5">“{c.comment}”</p>
                    ))}
                  </>
                )
              })()}
            </Card>
          )}
        </div>
      </div>
    </motion.div>
  )
}
