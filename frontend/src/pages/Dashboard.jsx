import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Tent, Wrench, DoorOpen, SquareCheckBig, ArrowRight, Sun } from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { StatTile, Card, Kicker, Badge, Avatar, Btn, Spinner } from '../components/ui.jsx'
import { cx, todayISO, fmtRange, fmtDate, ago, untilTxt, bookingStatus, priority } from '../lib.js'
import { SWIFT } from '../motion.js'

const rise = i => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: SWIFT, delay: 0.06 * i } },
})

function Greeting() {
  const { user } = useApp()
  const h = new Date().getHours()
  const word = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const date = new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <motion.div {...rise(0)} className="mb-6">
      <Kicker className="!text-green-dark mb-1.5 flex items-center gap-2">
        <span className="inline-block w-6 h-[2px] bg-green rounded-full" />{date}
      </Kicker>
      <h1 className="disp text-[42px] sm:text-[52px] text-ink">
        {word}, {user.name.split(' ')[0]}
      </h1>
    </motion.div>
  )
}

function PulseCard() {
  const { toast } = useApp()
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/people/pulse/mine').then(setState).catch(() => setState({})) }, [])

  async function send(mood) {
    setBusy(true)
    try {
      const r = await api.post('/people/pulse', { mood })
      setState(s => ({ ...s, response: r }))
      toast('Thanks — pulse logged 🌲')
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const moods = ['😩', '😕', '😐', '🙂', '🤩']
  if (!state) return null
  return (
    <Card className="p-4">
      <Kicker className="!text-dim mb-2.5">Weekly pulse</Kicker>
      {state.response ? (
        <div className="text-[13.5px] text-dim">
          Logged for this week — <span className="text-[18px] align-middle">{moods[(state.response.mood || 3) - 1]}</span>{' '}
          <button className="text-brand font-head font-semibold hover:underline"
            onClick={() => setState(s => ({ ...s, response: null }))}>change</button>
        </div>
      ) : (
        <div>
          <div className="text-[13.5px] text-ink mb-2.5 font-semibold">How’s your week going?</div>
          <div className="flex gap-1.5">
            {moods.map((m, i) => (
              <motion.button key={i} whileHover={{ scale: 1.18, y: -3 }} whileTap={{ scale: 0.9 }}
                disabled={busy} onClick={() => send(i + 1)}
                className="flex-1 text-[24px] py-1.5 rounded-xl hover:bg-sunken transition">{m}</motion.button>
            ))}
          </div>
          <div className="text-[11px] text-faint mt-2">Anonymous in team results until 3+ people answer.</div>
        </div>
      )}
    </Card>
  )
}

export default function Dashboard() {
  const { can, flagOn, badges, settings } = useApp()
  const nav = useNavigate()
  const [cal, setCal] = useState(null)
  const [attention, setAttention] = useState(null)
  const [tasksMine, setTasksMine] = useState(null)
  const [weather, setWeather] = useState(null)
  const [kudos, setKudos] = useState(null)
  const today = todayISO()

  useEffect(() => {
    if (can('bookings.view') && flagOn('bookings')) {
      api.get(`/bookings/calendar?start=${today}&end=${today}`).then(setCal).catch(() => setCal([]))
    } else setCal([])
    api.get('/weather').then(setWeather).catch(() => {})
    if (can('people.view') && flagOn('people')) {
      api.get('/people/kudos/wall').then(d => setKudos(d.kudos.slice(0, 3))).catch(() => setKudos([]))
    } else setKudos([])

    const jobs = []
    if (can('signout.board') && flagOn('signout')) {
      jobs.push(api.get('/trips/board').then(d => d.trips.filter(t => t.overdue).map(t => ({
        icon: '🛟', tone: 'text-danger', title: `${t.name} is overdue`, sub: untilTxt(t.expected_return), link: '/signout',
      }))).catch(() => []))
    }
    if (can('tickets.view') && flagOn('facilities')) {
      jobs.push(api.get('/tickets?status=active').then(list =>
        list.filter(t => t.priority >= 2).slice(0, 4).map(t => ({
          icon: t.priority >= 3 ? '⚠️' : '🎫', tone: t.priority >= 3 ? 'text-danger' : 'text-ember',
          title: t.title, sub: `${t.code} · ${t.location_name || 'No location'}`, link: `/tickets/${t.id}`,
        }))).catch(() => []))
    }
    if (can('locations.view') && flagOn('locations')) {
      jobs.push(api.get('/locations').then(list =>
        list.filter(l => ['maintenance'].includes(l.condition)).slice(0, 3).map(l => ({
          icon: '🔧', tone: 'text-ember', title: `${l.name} on maintenance hold`, sub: l.condition_note || 'See locations', link: '/locations',
        }))).catch(() => []))
    }
    Promise.all(jobs).then(r => setAttention(r.flat())).catch(() => setAttention([]))

    if (can('tasks.view') && flagOn('tasks')) {
      api.get('/tasks').then(({ statuses, tasks }) => {
        const done = new Set(statuses.filter(s => s.kind === 'done').map(s => s.id))
        setTasksMine(tasks.filter(t => !done.has(t.status_id)).slice(0, 6))
      }).catch(() => setTasksMine([]))
    } else setTasksMine([])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onSiteToday = useMemo(() => (cal || []).filter(b =>
    b.start_date <= today && b.end_date >= today && ['confirmed', 'in_progress'].includes(b.status)), [cal, today])

  return (
    <div>
      <Greeting />

      <motion.div {...rise(1)} className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatTile label="Groups on site" value={onSiteToday.length} icon={<Tent size={19} />} onClick={() => nav('/bookings')} />
        <StatTile label="Open tickets" value={badges.tickets_open || 0} icon={<Wrench size={19} />} onClick={() => nav('/tickets')} />
        <StatTile label="Off property" value={badges.whos_out || 0} icon={<DoorOpen size={19} />} onClick={() => nav('/signout')} />
        <StatTile label="My tasks due" value={badges.my_tasks_due || 0} icon={<SquareCheckBig size={19} />} onClick={() => nav('/tasks')} />
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Today at camp */}
          <motion.div {...rise(2)}>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3.5">
                <Kicker className="!text-dim">Today at camp</Kicker>
                <Link to="/calendar" className="text-[12px] font-head font-bold text-brand hover:underline flex items-center gap-1">
                  Calendar <ArrowRight size={12} />
                </Link>
              </div>
              {cal === null ? <div className="py-6 text-center"><Spinner /></div> : onSiteToday.length === 0 ? (
                <div className="text-dim text-[13.5px] py-2">A quiet property today — no groups on site.</div>
              ) : (
                <div className="space-y-2">
                  {onSiteToday.map(b => {
                    const s = bookingStatus(b.status)
                    return (
                      <Link key={b.id} to={`/bookings/${b.id}`}
                        className="flex items-center gap-3.5 p-2.5 -mx-2.5 rounded-xl hover:bg-sunken/60 transition group">
                        <span className="w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
                          <Tent size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-head font-bold text-[13.5px] text-ink truncate">{b.name}</span>
                          <span className="block text-[12px] text-dim">{b.code} · {fmtRange(b.start_date, b.end_date)} · {b.headcount} people</span>
                        </span>
                        <Badge className={s.cls}>{s.label}</Badge>
                      </Link>
                    )
                  })}
                </div>
              )}
            </Card>
          </motion.div>

          {/* Needs attention */}
          <motion.div {...rise(3)}>
            <Card className="p-5">
              <Kicker className="!text-dim mb-3.5">Needs attention</Kicker>
              {attention === null ? <div className="py-6 text-center"><Spinner /></div> : attention.length === 0 ? (
                <div className="text-dim text-[13.5px] py-2">Nothing waving for help right now. 🌅</div>
              ) : (
                <div className="space-y-1">
                  {attention.map((a, i) => (
                    <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i, duration: 0.35, ease: SWIFT }}>
                      <Link to={a.link} className="flex items-center gap-3 px-2.5 py-2 -mx-2.5 rounded-xl hover:bg-sunken/60 transition">
                        <span className="text-[17px]">{a.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className={cx('block text-[13.5px] font-semibold truncate', a.tone || 'text-ink')}>{a.title}</span>
                          <span className="block text-[12px] text-dim truncate">{a.sub}</span>
                        </span>
                        <ArrowRight size={13} className="text-faint shrink-0" />
                      </Link>
                    </motion.div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>

          {/* Open tasks */}
          {tasksMine !== null && tasksMine.length > 0 && (
            <motion.div {...rise(4)}>
              <Card className="p-5">
                <div className="flex items-center justify-between mb-3.5">
                  <Kicker className="!text-dim">Open tasks</Kicker>
                  <Link to="/tasks" className="text-[12px] font-head font-bold text-brand hover:underline flex items-center gap-1">
                    Board <ArrowRight size={12} />
                  </Link>
                </div>
                <div className="space-y-1">
                  {tasksMine.map(t => (
                    <Link key={t.id} to="/tasks" className="flex items-center gap-3 px-2.5 py-2 -mx-2.5 rounded-xl hover:bg-sunken/60 transition">
                      <span className={cx('px-1.5 py-0.5 rounded-md text-[10.5px] font-head font-bold', priority(t.priority).cls)}>
                        {priority(t.priority).label}
                      </span>
                      <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink truncate">{t.title}</span>
                      {t.due && <span className={cx('text-[12px] tnum shrink-0', t.due < todayISO() ? 'text-danger font-bold' : 'text-dim')}>{fmtDate(t.due)}</span>}
                    </Link>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}
        </div>

        {/* right rail */}
        <div className="space-y-4">
          <motion.div {...rise(3)}><PulseCard /></motion.div>

          {weather?.current && (
            <motion.div {...rise(4)}>
              <Card className="p-4 overflow-hidden relative">
                <div className="absolute -right-7 -top-7 w-28 h-28 rounded-full bg-green/10" aria-hidden />
                <Kicker className="!text-dim mb-2 flex items-center gap-1.5"><Sun size={12} /> Lake Rosseau</Kicker>
                <div className="flex items-center gap-3.5">
                  <span className="text-[38px] leading-none">{weather.current.icon}</span>
                  <div>
                    <div className="disp text-[34px] leading-none text-ink tnum">{weather.current.temp}°</div>
                    <div className="text-[12px] text-dim mt-0.5">{weather.current.label} · feels {weather.current.feels}°</div>
                  </div>
                </div>
                <div className="flex gap-1.5 mt-3.5">
                  {(weather.daily || []).slice(0, 4).map(d => (
                    <div key={d.date} className="flex-1 text-center rounded-xl bg-sunken/70 py-2">
                      <div className="text-[10px] font-head font-bold text-dim uppercase">{fmtDate(d.date).split(' ')[0]} {fmtDate(d.date).split(' ')[1]}</div>
                      <div className="text-[16px] my-0.5">{d.icon}</div>
                      <div className="text-[11px] tnum text-ink font-semibold">{d.max}°<span className="text-faint">/{d.min}°</span></div>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}

          {kudos !== null && kudos.length > 0 && (
            <motion.div {...rise(5)}>
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <Kicker className="!text-dim">Fresh kudos</Kicker>
                  <Link to="/kudos" className="text-[12px] font-head font-bold text-brand hover:underline">Wall</Link>
                </div>
                <div className="space-y-3.5">
                  {kudos.map(k => (
                    <div key={k.id} className="flex gap-2.5">
                      <Avatar name={k.to_name} color={k.to_color} size={28} />
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-head font-bold text-ink">
                          {k.from_name || 'Someone'} <span className="text-faint font-medium">→</span> {k.to_name}
                        </div>
                        <div className="text-[12.5px] text-dim leading-snug line-clamp-2">{k.message}</div>
                        <div className="text-[10.5px] text-faint mt-0.5 font-head font-semibold uppercase tracking-wider">{ago(k.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
