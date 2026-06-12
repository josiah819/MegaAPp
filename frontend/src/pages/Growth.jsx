import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, ArrowRight, Check, Trash2, Target, Sparkles, RefreshCcw } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Kicker, Btn, Badge, Sheet, Field, Select, PageLoader, EmptyState, Avatar, Tabs, Toggle, ConfettiBurst } from '../components/ui.jsx'
import { Ring } from '../components/charts.jsx'
import { cx, fmtDate, fmtDateLong, ago, goalStatus, GOAL_STATUSES } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

export default function Growth() {
  const { can } = useApp()
  const tabs = [
    can('oneonones.use') && { v: 'oo', label: '1:1s' },
    can('goals.use') && { v: 'goals', label: 'Goals' },
    can('feedback.use') && { v: 'fb', label: 'Feedback' },
  ].filter(Boolean)
  const [tab, setTab] = useState(tabs[0]?.v)

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Crew" title="Growth" sub="1:1s, goals, and honest feedback — the leadership half of camp." />
      {tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs} className="mb-5" />}
      {tab === 'oo' && <OneOnOnes />}
      {tab === 'goals' && <Goals />}
      {tab === 'fb' && <Feedback />}
    </motion.div>
  )
}

/* ============================== 1:1s ============================== */
function OneOnOnes() {
  const { toast, user, can } = useApp()
  const [list, setList] = useState(null)
  const [people, setPeople] = useState([])
  const [openId, setOpenId] = useState(null)
  const [m, setM] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ with_id: '', date: '', recurrence: 'biweekly' })
  const [newItem, setNewItem] = useState('')
  const [newKind, setNewKind] = useState('talking')

  const load = () => api.get('/growth/oneonones').then(setList).catch(e => toast(e.message, 'err'))
  useEffect(() => {
    load()
    if (can('people.view')) api.get('/people').then(setPeople).catch(() => {})
  }, []) // eslint-disable-line

  const open = async id => {
    try { setM(await api.get(`/growth/oneonones/${id}`)); setOpenId(id) } catch (e) { toast(e.message, 'err') }
  }
  const otherOf = x => (x.a_id === user.id ? { name: x.b_name, color: x.b_color } : { name: x.a_name, color: x.a_color })

  async function addItem() {
    if (!newItem.trim()) return
    try {
      await api.post(`/growth/oneonones/${m.id}/items`, { text: newItem, kind: newKind })
      setNewItem(''); open(m.id)
    } catch (e) { toast(e.message, 'err') }
  }
  async function toggleItem(it) {
    try { await api.patch(`/growth/oo-items/${it.id}`, { done: !it.done }); open(m.id) } catch (e) { toast(e.message, 'err') }
  }
  async function wrapUp() {
    try {
      const next = await api.post(`/growth/oneonones/${m.id}/next`)
      toast('Wrapped — open points rolled into the next one 🤝')
      setOpenId(null); setM(null); load()
      void next
    } catch (e) { toast(e.message, 'err') }
  }

  if (!list) return <PageLoader />
  const active = list.filter(x => x.status !== 'done')
  const past = list.filter(x => x.status === 'done').slice(0, 6)

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Btn onClick={() => setCreateOpen(true)}><Plus size={15} /> New 1:1</Btn>
      </div>
      {active.length === 0 && past.length === 0 && (
        <EmptyState icon="🤝" title="No 1:1s yet"
          body="A standing 1:1 is the highest-leverage 30 minutes in camp leadership. Set one up."
          action={<Btn onClick={() => setCreateOpen(true)}><Plus size={14} /> New 1:1</Btn>} />
      )}
      <motion.div variants={stagger(0.05)} initial="initial" animate="animate" className="grid md:grid-cols-2 gap-3.5">
        {active.map(x => {
          const o = otherOf(x)
          return (
            <motion.button key={x.id} variants={rise} onClick={() => open(x.id)}
              className="card p-4 text-left hover:shadow-lift transition-shadow">
              <div className="flex items-center gap-3">
                <Avatar name={o.name} color={o.color} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="font-head font-bold text-[14.5px] text-ink">{o.name}</div>
                  <div className="text-[12px] text-dim">{x.date ? fmtDateLong(x.date) : 'unscheduled'} · {x.recurrence}</div>
                </div>
                {x.open_items > 0 && <Badge className="bg-accent/12 text-accent">{x.open_items} open</Badge>}
              </div>
            </motion.button>
          )
        })}
      </motion.div>
      {past.length > 0 && (
        <div className="mt-6">
          <Kicker className="!text-dim mb-2.5">Recent wrap-ups</Kicker>
          <div className="space-y-2">
            {past.map(x => {
              const o = otherOf(x)
              return (
                <button key={x.id} onClick={() => open(x.id)} className="card w-full p-3 text-left flex items-center gap-3 hover:shadow-lift transition-shadow">
                  <Avatar name={o.name} color={o.color} size={28} />
                  <span className="text-[13px] text-ink font-semibold">{o.name}</span>
                  <span className="text-[12px] text-faint ml-auto">{ago(x.ended_at || x.date)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* meeting sheet */}
      <Sheet open={!!openId} onClose={() => { setOpenId(null); setM(null) }} wide
        kicker="1:1" title={m ? `${otherOf(m).name} ${m.status === 'done' ? '· wrapped' : ''}` : ''}
        footer={m && m.status !== 'done' && <>
          <Btn variant="ghost" onClick={() => { setOpenId(null); setM(null) }}>Close</Btn>
          <Btn variant="accent" onClick={wrapUp}><RefreshCcw size={14} /> Wrap up & schedule next</Btn>
        </>}>
        {m && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="When">
                <input type="datetime-local" className="input" value={m.date ? new Date(m.date).toISOString().slice(0, 16) : ''}
                  disabled={m.status === 'done'}
                  onChange={async e => {
                    try { await api.patch(`/growth/oneonones/${m.id}`, { date: e.target.value || null }); open(m.id) } catch (err) { toast(err.message, 'err') }
                  }} />
              </Field>
              <Field label="Cadence">
                <Select value={m.recurrence} disabled={m.status === 'done'} onChange={async v => {
                  try { await api.patch(`/growth/oneonones/${m.id}`, { recurrence: v }); open(m.id) } catch (err) { toast(err.message, 'err') }
                }}>
                  {['weekly', 'biweekly', 'monthly'].map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
            </div>

            {['talking', 'action'].map(kind => {
              const items = m.items.filter(i => i.kind === kind)
              return (
                <div key={kind}>
                  <Kicker className="!text-dim mb-2">{kind === 'talking' ? 'Talking points' : 'Action items'}</Kicker>
                  <div className="space-y-1.5">
                    <AnimatePresence>
                      {items.map(it => (
                        <motion.div key={it.id} layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                          className="flex items-start gap-2.5 group">
                          <button onClick={() => m.status !== 'done' && toggleItem(it)}
                            className={cx('mt-0.5 w-[20px] h-[20px] rounded-md border-2 flex items-center justify-center transition shrink-0',
                              it.done ? 'bg-accent border-accent text-white' : 'border-line hover:border-accent')}>
                            {it.done && <Check size={12} strokeWidth={3.5} />}
                          </button>
                          <span className={cx('text-[13.5px] flex-1 leading-snug', it.done ? 'text-faint line-through' : 'text-ink')}>
                            {it.text}
                            <span className="text-[11px] text-faint ml-2">{it.author_id === m.a_id ? m.a_name.split(' ')[0] : m.b_name.split(' ')[0]}</span>
                          </span>
                          {m.status !== 'done' && (
                            <button className="opacity-0 group-hover:opacity-100 text-faint hover:text-danger transition"
                              onClick={async () => { await api.del(`/growth/oo-items/${it.id}`).catch(() => {}); open(m.id) }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {items.length === 0 && <div className="text-[12.5px] text-faint">Nothing yet.</div>}
                  </div>
                </div>
              )
            })}

            {m.status !== 'done' && (
              <div className="flex gap-2">
                <Select value={newKind} onChange={setNewKind} className="!w-[130px] shrink-0">
                  <option value="talking">Talk about</option>
                  <option value="action">Action</option>
                </Select>
                <input className="input flex-1" placeholder="Add a point…" value={newItem}
                  onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
                <Btn size="sm" onClick={addItem} disabled={!newItem.trim()}><Plus size={14} /></Btn>
              </div>
            )}

            <Field label="Shared notes" hint="Visible to both of you — and only you two. Not even admins can read a 1:1.">
              <textarea className="input" rows={3} defaultValue={m.shared_notes} disabled={m.status === 'done'}
                onBlur={async e => {
                  if (e.target.value === m.shared_notes) return
                  try { await api.patch(`/growth/oneonones/${m.id}`, { shared_notes: e.target.value }) } catch (err) { toast(err.message, 'err') }
                }} />
            </Field>
            {m.summary && (
              <div className="bg-sunken/70 rounded-xl px-3.5 py-2.5">
                <Kicker className="!text-dim mb-1">Summary</Kicker>
                <p className="text-[13px] text-ink">{m.summary}</p>
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* create sheet */}
      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} kicker="1:1" title="New 1:1"
        footer={<><Btn variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Btn>
          <Btn disabled={!form.with_id} onClick={async () => {
            try {
              await api.post('/growth/oneonones', { ...form, with_id: Number(form.with_id), date: form.date || null })
              toast('1:1 created 🤝'); setCreateOpen(false); setForm({ with_id: '', date: '', recurrence: 'biweekly' }); load()
            } catch (e) { toast(e.message, 'err') }
          }}>Create</Btn></>}>
        <div className="space-y-4">
          <Field label="With">
            <Select value={form.with_id} onChange={v => setForm(s => ({ ...s, with_id: v }))}>
              <option value="">— pick a person —</option>
              {people.filter(p => p.id !== user.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First meeting"><input type="datetime-local" className="input" value={form.date} onChange={e => setForm(s => ({ ...s, date: e.target.value }))} /></Field>
            <Field label="Cadence">
              <Select value={form.recurrence} onChange={v => setForm(s => ({ ...s, recurrence: v }))}>
                {['weekly', 'biweekly', 'monthly'].map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          </div>
        </div>
      </Sheet>
    </div>
  )
}

/* ============================== goals ============================== */
function Goals() {
  const { toast, user } = useApp()
  const [goals, setGoals] = useState(null)
  const [edit, setEdit] = useState(null)       // goal sheet (new/existing)
  const [checkin, setCheckin] = useState(null) // {goal, progress, status, comment}
  const [fire, setFire] = useState(0)

  const load = () => api.get('/growth/goals').then(setGoals).catch(e => toast(e.message, 'err'))
  useEffect(() => { load() }, []) // eslint-disable-line

  if (!goals) return <PageLoader />
  const groups = [
    ['org', '🏕️ Org goals'], ['team', '🛶 Team goals'], ['individual', '🌱 My goals'],
  ].map(([k, label]) => [label, goals.filter(g => g.type === k && (k !== 'individual' || g.owner_id === user.id))])

  async function saveCheckin() {
    try {
      await api.post(`/growth/goals/${checkin.goal.id}/checkin`, checkin)
      if (checkin.status === 'done' || Number(checkin.progress) >= 100) setFire(f => f + 1)
      toast('Check-in saved 🎯')
      setCheckin(null); load()
    } catch (e) { toast(e.message, 'err') }
  }
  async function saveGoal() {
    const body = { ...edit, due: edit.due || null }
    try {
      if (edit.id) await api.patch(`/growth/goals/${edit.id}`, body)
      else await api.post('/growth/goals', body)
      toast(edit.id ? 'Goal updated' : 'Goal planted 🌱')
      setEdit(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <div>
      <ConfettiBurst fire={fire} />
      <div className="flex justify-end mb-4">
        <Btn onClick={() => setEdit({ title: '', descr: '', type: 'individual', dept: '', due: '', krs: [] })}><Plus size={15} /> New goal</Btn>
      </div>
      <div className="space-y-6">
        {groups.map(([label, list]) => list.length > 0 && (
          <div key={label}>
            <Kicker className="!text-dim mb-2.5">{label}</Kicker>
            <motion.div variants={stagger(0.04)} initial="initial" animate="animate" className="grid md:grid-cols-2 gap-3.5">
              {list.map(g => {
                const s = goalStatus(g.status)
                return (
                  <motion.div key={g.id} variants={rise} className="card p-4">
                    <div className="flex items-start gap-3.5">
                      <Ring pct={g.progress} size={52} stroke={6} color={g.status === 'risk' ? 'rgb(var(--c-danger))' : g.status === 'behind' ? 'rgb(var(--c-ember))' : 'rgb(var(--c-accent))'} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <button className="font-head font-bold text-[14px] text-ink leading-snug text-left hover:text-brand transition"
                            onClick={() => setEdit({ ...g, due: g.due ? String(g.due).slice(0, 10) : '', krs: g.krs || [] })}>
                            {g.title}
                          </button>
                          <Badge className={s.cls}>{s.label}</Badge>
                        </div>
                        <div className="text-[11.5px] text-faint mt-0.5">
                          {g.owner_name && g.owner_id !== user.id ? `${g.owner_name} · ` : ''}{g.dept ? `${g.dept} · ` : ''}{g.due ? `due ${fmtDate(g.due)}` : 'no due date'}
                        </div>
                        {(g.krs || []).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {g.krs.map((kr, i) => (
                              <div key={i} className="flex items-center gap-2 text-[12.5px]">
                                <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', kr.done ? 'bg-summer' : 'bg-line')} />
                                <span className={kr.done ? 'text-faint line-through' : 'text-dim'}>{kr.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {(g.type !== 'individual' || g.owner_id === user.id) && g.status !== 'done' && (
                          <Btn size="sm" variant="soft" className="mt-2.5"
                            onClick={() => setCheckin({ goal: g, progress: g.progress, status: g.status, comment: '' })}>
                            <Target size={13} /> Check in
                          </Btn>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          </div>
        ))}
        {goals.length === 0 && (
          <EmptyState icon="🎯" title="No goals yet" body="Org goals set direction, team goals share the load, personal goals grow people." />
        )}
      </div>

      {/* check-in sheet */}
      <Sheet open={!!checkin} onClose={() => setCheckin(null)} kicker="Check-in" title={checkin?.goal.title}
        footer={<><Btn variant="ghost" onClick={() => setCheckin(null)}>Cancel</Btn><Btn onClick={saveCheckin}>Save check-in</Btn></>}>
        {checkin && (
          <div className="space-y-4">
            <Field label={`Progress — ${checkin.progress}%`}>
              <input type="range" min="0" max="100" step="5" value={checkin.progress}
                onChange={e => setCheckin(s => ({ ...s, progress: Number(e.target.value) }))} className="w-full accent-[#30A059]" />
            </Field>
            <Field label="Status">
              <div className="flex gap-2">
                {GOAL_STATUSES.map(s => (
                  <button key={s.v} onClick={() => setCheckin(c => ({ ...c, status: s.v }))}
                    className={cx('px-2.5 py-1 rounded-full text-[11.5px] font-head font-bold transition',
                      checkin.status === s.v ? s.cls + ' ring-1 ring-current' : 'bg-sunken text-faint hover:text-ink')}>
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="What changed?">
              <textarea className="input" rows={3} value={checkin.comment} onChange={e => setCheckin(s => ({ ...s, comment: e.target.value }))} />
            </Field>
          </div>
        )}
      </Sheet>

      {/* goal sheet */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} kicker="Goals" title={edit?.id ? 'Edit goal' : 'New goal'}
        footer={edit && <>
          {edit.id && edit.owner_id === user.id && (
            <Btn variant="ghost" className="!text-danger" onClick={async () => {
              try { await api.del(`/growth/goals/${edit.id}`); toast('Goal removed'); setEdit(null); load() } catch (e) { toast(e.message, 'err') }
            }}><Trash2 size={14} /></Btn>
          )}
          <span className="flex-1" />
          <Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn>
          <Btn onClick={saveGoal} disabled={!edit.title?.trim()}>{edit.id ? 'Save' : 'Create'}</Btn>
        </>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Goal"><input className="input" value={edit.title} onChange={e => setEdit(s => ({ ...s, title: e.target.value }))} placeholder="Every cabin Ready by 3pm on turnover days" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select value={edit.type} onChange={v => setEdit(s => ({ ...s, type: v }))} disabled={!!edit.id}>
                  <option value="individual">Personal</option>
                  <option value="team">Team</option>
                  <option value="org">Org-wide</option>
                </Select>
              </Field>
              <Field label="Due"><input type="date" className="input" value={edit.due} onChange={e => setEdit(s => ({ ...s, due: e.target.value }))} /></Field>
            </div>
            {edit.type === 'team' && <Field label="Department"><input className="input" value={edit.dept || ''} onChange={e => setEdit(s => ({ ...s, dept: e.target.value }))} /></Field>}
            <Field label="Why it matters"><textarea className="input" rows={2} value={edit.descr || ''} onChange={e => setEdit(s => ({ ...s, descr: e.target.value }))} /></Field>
            <div>
              <Kicker className="!text-dim mb-2">Key results</Kicker>
              <div className="space-y-2">
                {(edit.krs || []).map((kr, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Toggle on={!!kr.done} onChange={v => setEdit(s => ({ ...s, krs: s.krs.map((x, j) => j === i ? { ...x, done: v } : x) }))} label="done" />
                    <input className="input flex-1" value={kr.text} onChange={e => setEdit(s => ({ ...s, krs: s.krs.map((x, j) => j === i ? { ...x, text: e.target.value } : x) }))} />
                    <button className="text-faint hover:text-danger" onClick={() => setEdit(s => ({ ...s, krs: s.krs.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <Btn size="sm" variant="ghost" className="mt-2" onClick={() => setEdit(s => ({ ...s, krs: [...(s.krs || []), { text: '', done: false }] }))}>
                <Plus size={13} /> Add key result
              </Btn>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

/* ============================== feedback ============================== */
function Feedback() {
  const { toast, user, can } = useApp()
  const [data, setData] = useState(null)
  const [people, setPeople] = useState([])
  const [ask, setAsk] = useState(null)   // {responder_id, prompt}
  const [give, setGive] = useState(null) // {to_id, fb_type, message}
  const [answer, setAnswer] = useState(null) // {req, response}

  const load = () => api.get('/growth/feedback').then(setData).catch(e => toast(e.message, 'err'))
  useEffect(() => {
    load()
    if (can('people.view')) api.get('/people').then(setPeople).catch(() => {})
  }, []) // eslint-disable-line

  if (!data) return <PageLoader />
  const pending = data.inbox.filter(f => f.status === 'pending')

  return (
    <div>
      <div className="flex flex-wrap justify-end gap-2 mb-4">
        <Btn variant="soft" onClick={() => setAsk({ responder_id: '', prompt: '' })}>Ask for feedback</Btn>
        <Btn onClick={() => setGive({ to_id: '', fb_type: 'praise', message: '' })}><Sparkles size={14} /> Give feedback</Btn>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* inbox: answer requests */}
        <Card className="p-4">
          <Kicker className="!text-dim mb-3">Waiting on you {pending.length > 0 && <Badge className="bg-ember/12 text-ember ml-1">{pending.length}</Badge>}</Kicker>
          {pending.length === 0 && <div className="text-[13px] text-faint">Nobody's waiting — nice.</div>}
          <div className="space-y-3">
            {pending.map(f => (
              <div key={f.id} className="bg-sunken/60 rounded-xl p-3.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <Avatar name={f.requester_name} color={f.requester_color} size={24} />
                  <span className="text-[13px] font-head font-bold text-ink">{f.requester_name}</span>
                  <span className="text-[11px] text-faint ml-auto">{ago(f.created_at)}</span>
                </div>
                <p className="text-[13px] text-dim italic">“{f.prompt}”</p>
                <div className="flex gap-2 mt-2.5">
                  <Btn size="sm" onClick={() => setAnswer({ req: f, response: '' })}>Answer</Btn>
                  <Btn size="sm" variant="ghost" onClick={async () => {
                    try { await api.post(`/growth/feedback/${f.id}/respond`, { decline: true }); toast('Passed politely'); load() } catch (e) { toast(e.message, 'err') }
                  }}>Pass</Btn>
                </div>
              </div>
            ))}
          </div>

          <Kicker className="!text-dim mt-5 mb-3">You asked</Kicker>
          {data.requested.length === 0 && <div className="text-[13px] text-faint">You haven't asked for feedback yet — brave move when you do.</div>}
          <div className="space-y-2.5">
            {data.requested.map(f => (
              <div key={f.id} className="text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{f.responder_name}</span>
                  <Badge className={f.status === 'answered' ? 'bg-green/20 text-green-dark' : f.status === 'declined' ? 'bg-sunken text-faint' : 'bg-ember/12 text-ember'}>{f.status}</Badge>
                </div>
                <p className="text-dim italic text-[12.5px] mt-0.5">“{f.prompt}”</p>
                {f.response && <p className="mt-1 text-ink bg-accent/[0.05] rounded-lg px-3 py-2 leading-relaxed">{f.response}</p>}
              </div>
            ))}
          </div>
        </Card>

        {/* received */}
        <Card className="p-4">
          <Kicker className="!text-dim mb-3">For you</Kicker>
          {data.received.length === 0 && <div className="text-[13px] text-faint">No direct feedback yet.</div>}
          <div className="space-y-3">
            {data.received.map(f => (
              <div key={f.id} className={cx('rounded-xl p-3.5', f.fb_type === 'growth' ? 'bg-leadership/[0.06] border border-leadership/15' : 'bg-green/[0.08] border border-green/20')}>
                <div className="flex items-center gap-2 mb-1">
                  <Avatar name={f.from_name} color={f.from_color} size={24} />
                  <span className="text-[13px] font-head font-bold text-ink">{f.from_name}</span>
                  <Badge className={f.fb_type === 'growth' ? 'bg-leadership/12 text-leadership' : 'bg-green/20 text-green-dark'}>
                    {f.fb_type === 'growth' ? '🌱 growth' : '⭐ praise'}
                  </Badge>
                  <span className="text-[11px] text-faint ml-auto">{ago(f.created_at)}</span>
                </div>
                <p className="text-[13.5px] text-ink leading-relaxed">{f.message}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ask sheet */}
      <Sheet open={!!ask} onClose={() => setAsk(null)} kicker="Feedback" title="Ask for feedback"
        footer={<><Btn variant="ghost" onClick={() => setAsk(null)}>Cancel</Btn>
          <Btn disabled={!ask?.responder_id || !ask?.prompt.trim()} onClick={async () => {
            try { await api.post('/growth/feedback/request', { ...ask, responder_id: Number(ask.responder_id) }); toast('Request sent 🪞'); setAsk(null); load() } catch (e) { toast(e.message, 'err') }
          }}>Send request</Btn></>}>
        {ask && (
          <div className="space-y-4">
            <Field label="From">
              <Select value={ask.responder_id} onChange={v => setAsk(s => ({ ...s, responder_id: v }))}>
                <option value="">— pick a person —</option>
                {people.filter(p => p.id !== user.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="What do you want feedback on?" hint="Specific beats general — “my dock-in briefing” beats “my leadership”.">
              <textarea className="input" rows={3} value={ask.prompt} onChange={e => setAsk(s => ({ ...s, prompt: e.target.value }))} />
            </Field>
          </div>
        )}
      </Sheet>

      {/* give sheet */}
      <Sheet open={!!give} onClose={() => setGive(null)} kicker="Feedback" title="Give feedback"
        footer={<><Btn variant="ghost" onClick={() => setGive(null)}>Cancel</Btn>
          <Btn disabled={!give?.to_id || !give?.message.trim()} onClick={async () => {
            try { await api.post('/growth/feedback/give', { ...give, to_id: Number(give.to_id) }); toast('Sent — privately 🌱'); setGive(null); load() } catch (e) { toast(e.message, 'err') }
          }}>Send</Btn></>}>
        {give && (
          <div className="space-y-4">
            <Field label="To">
              <Select value={give.to_id} onChange={v => setGive(s => ({ ...s, to_id: v }))}>
                <option value="">— pick a person —</option>
                {people.filter(p => p.id !== user.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Kind" hint="Praise lands on their wall of wins. Growth notes stay between you two.">
              <div className="flex gap-2">
                {[['praise', '⭐ Praise'], ['growth', '🌱 Growth']].map(([v, l]) => (
                  <button key={v} onClick={() => setGive(s => ({ ...s, fb_type: v }))}
                    className={cx('px-3 py-1.5 rounded-xl text-[12.5px] font-head font-bold transition',
                      give.fb_type === v ? 'bg-brand text-white' : 'bg-sunken text-dim hover:text-ink')}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label="The feedback">
              <textarea className="input" rows={4} value={give.message} onChange={e => setGive(s => ({ ...s, message: e.target.value }))} />
            </Field>
          </div>
        )}
      </Sheet>

      {/* answer sheet */}
      <Sheet open={!!answer} onClose={() => setAnswer(null)} kicker="Feedback" title={`Answer ${answer?.req.requester_name}`}
        footer={<><Btn variant="ghost" onClick={() => setAnswer(null)}>Cancel</Btn>
          <Btn disabled={!answer?.response.trim()} onClick={async () => {
            try { await api.post(`/growth/feedback/${answer.req.id}/respond`, { response: answer.response }); toast('Answered 🪞'); setAnswer(null); load() } catch (e) { toast(e.message, 'err') }
          }}>Send answer</Btn></>}>
        {answer && (
          <div className="space-y-4">
            <p className="text-[13px] text-dim italic bg-sunken/60 rounded-xl px-3.5 py-2.5">“{answer.req.prompt}”</p>
            <Field label="Your feedback">
              <textarea className="input" rows={5} autoFocus value={answer.response} onChange={e => setAnswer(s => ({ ...s, response: e.target.value }))} />
            </Field>
          </div>
        )}
      </Sheet>
    </div>
  )
}
