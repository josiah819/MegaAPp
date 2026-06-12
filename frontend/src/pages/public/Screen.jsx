import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

const fetchScreen = token => fetch(`/api/public/screen/${token}`).then(r => {
  if (!r.ok) throw new Error('This screen link is not active')
  return r.json()
})

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="text-right">
      <div className="font-display text-[64px] leading-none tracking-wide tnum screen-shadow">
        {now.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}
      </div>
      <div className="text-[16px] text-white/70 font-head font-semibold tracking-[0.2em] uppercase mt-1">
        {now.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
    </div>
  )
}

const panelAnim = {
  initial: { opacity: 0, y: 36, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -24, transition: { duration: 0.35 } },
}

function WelcomePanel({ data }) {
  return (
    <motion.div {...panelAnim} className="flex flex-col items-center justify-center text-center h-full px-12">
      <img src="/brand/logo-stacked-white.png" alt="" className="w-32 mb-10 opacity-95" />
      <div className="font-display uppercase text-[min(9vw,110px)] leading-[0.92] screen-shadow max-w-[900px]">
        {data.settings.welcome || `Welcome to ${data.org.name}`}
      </div>
      <div className="mt-8 text-[20px] text-[#A3CD42] font-head font-bold tracking-[0.3em] uppercase">{data.org.tagline}</div>
    </motion.div>
  )
}

function SchedulePanel({ data }) {
  const s = data.panels.schedule
  return (
    <motion.div {...panelAnim} className="h-full px-14 py-10 flex flex-col">
      <div className="font-head font-bold text-[16px] tracking-[0.34em] uppercase text-[#A3CD42] mb-7">Today at camp</div>
      <div className="grid grid-cols-2 gap-10 flex-1 min-h-0">
        <div>
          <div className="text-white/50 font-head font-bold uppercase tracking-[0.2em] text-[13px] mb-4">Groups on site</div>
          {s.groups.length === 0 && <div className="text-white/60 text-[22px]">A quiet day on the property.</div>}
          <div className="space-y-3.5">
            {s.groups.slice(0, 6).map(g => (
              <div key={g.code} className="flex items-baseline gap-4">
                <span className="font-display text-[34px] leading-none">{g.name}</span>
                <span className="text-[#A3CD42] text-[18px] font-head font-bold tnum">{g.headcount}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-8">
          {s.arriving.length > 0 && (
            <div>
              <div className="text-white/50 font-head font-bold uppercase tracking-[0.2em] text-[13px] mb-3">Arriving today</div>
              {s.arriving.map(g => <div key={g.code} className="text-[22px] font-head font-semibold">{g.name} <span className="text-white/50 tnum">· {g.headcount}</span></div>)}
            </div>
          )}
          {s.departing.length > 0 && (
            <div>
              <div className="text-white/50 font-head font-bold uppercase tracking-[0.2em] text-[13px] mb-3">Heading home</div>
              {s.departing.map(g => <div key={g.code} className="text-[22px] font-head font-semibold">{g.name}</div>)}
            </div>
          )}
          {s.events.length > 0 && (
            <div>
              <div className="text-white/50 font-head font-bold uppercase tracking-[0.2em] text-[13px] mb-3">Events</div>
              {s.events.map((e, i) => <div key={i} className="text-[22px] font-head font-semibold">{e.emoji} {e.title} <span className="text-white/50">· {e.location}</span></div>)}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function WeatherPanel({ data }) {
  const w = data.panels.weather
  if (!w?.current) return null
  return (
    <motion.div {...panelAnim} className="h-full px-14 py-10 flex flex-col">
      <div className="font-head font-bold text-[16px] tracking-[0.34em] uppercase text-[#A3CD42] mb-6">Lake Rosseau weather</div>
      <div className="flex items-center gap-10 mb-12">
        <span className="text-[120px] leading-none">{w.current.icon}</span>
        <div>
          <div className="font-display text-[140px] leading-[0.85] tnum screen-shadow">{w.current.temp}°</div>
          <div className="text-[26px] text-white/75 font-head font-semibold mt-2">{w.current.label} · feels like {w.current.feels}°</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-6 mt-auto">
        {(w.daily || []).slice(0, 4).map(d => (
          <div key={d.date} className="bg-white/[0.07] rounded-3xl px-6 py-5 text-center">
            <div className="text-white/60 font-head font-bold uppercase tracking-[0.18em] text-[14px]">
              {new Date(`${d.date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short' })}
            </div>
            <div className="text-[44px] my-2">{d.icon}</div>
            <div className="text-[24px] font-head font-bold tnum">{d.max}°<span className="text-white/45 text-[18px]"> / {d.min}°</span></div>
            {d.precip > 20 && <div className="text-[#7CC4DD] text-[14px] font-head font-semibold mt-1">💧 {d.precip}%</div>}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

function LodgingPanel({ data }) {
  const rows = data.panels.lodging || []
  return (
    <motion.div {...panelAnim} className="h-full px-14 py-10">
      <div className="font-head font-bold text-[16px] tracking-[0.34em] uppercase text-[#A3CD42] mb-7">Tonight’s lodging</div>
      {rows.length === 0 ? <div className="text-white/60 text-[24px]">No groups in lodges tonight.</div> : (
        <div className="grid grid-cols-2 gap-x-14 gap-y-4">
          {rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-6 border-b border-white/10 pb-3">
              <span className="font-display text-[30px]">{r.name}</span>
              <span className="text-white/70 text-[18px] font-head font-semibold text-right">{r.group_name}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

function AnnouncementsPanel({ data }) {
  const list = data.panels.announcements || []
  return (
    <motion.div {...panelAnim} className="h-full px-14 py-10">
      <div className="font-head font-bold text-[16px] tracking-[0.34em] uppercase text-[#A3CD42] mb-7">Announcements</div>
      {list.length === 0 ? <div className="text-white/60 text-[24px]">Nothing posted this week.</div> : (
        <div className="space-y-7 max-w-[1000px]">
          {list.slice(0, 4).map((a, i) => (
            <div key={i}>
              {a.title && <div className="font-display text-[38px] leading-tight mb-1">{a.title}</div>}
              <p className="text-[22px] text-white/80 leading-relaxed">{a.body}</p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

function KudosPanel({ data }) {
  const list = data.panels.kudos || []
  const values = data.panels.kudos_values || []
  const vOf = key => values.find(v => v.key === key)
  return (
    <motion.div {...panelAnim} className="h-full px-14 py-10">
      <div className="font-head font-bold text-[16px] tracking-[0.34em] uppercase text-[#A3CD42] mb-7">Crew kudos</div>
      {list.length === 0 ? <div className="text-white/60 text-[24px]">The wall is waiting for its first kudos.</div> : (
        <div className="grid grid-cols-2 gap-x-12 gap-y-6 max-w-[1200px]">
          {list.slice(0, 4).map((k, i) => {
            const v = vOf(k.value_key)
            return (
              <div key={i} className="border-l-4 border-[#A3CD42]/60 pl-5">
                <div className="font-head font-bold text-[19px] text-white/90">
                  {k.from_name || 'Someone'} → {k.to_name}{v ? <span className="text-white/55 font-semibold">  ·  {v.emoji} {v.name}</span> : null}
                </div>
                <p className="text-[21px] text-white/75 leading-snug mt-1">“{k.message}”</p>
              </div>
            )
          })}
        </div>
      )}
    </motion.div>
  )
}

export default function Screen() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const load = () => fetchScreen(token).then(setData).catch(e => setErr(e.message))
    load()
    const t = setInterval(load, 60 * 1000)
    return () => clearInterval(t)
  }, [token])

  const panels = useMemo(() => {
    if (!data) return []
    const out = []
    if (data.panels.schedule) out.push(['welcome', WelcomePanel], ['schedule', SchedulePanel])
    else out.push(['welcome', WelcomePanel])
    if (data.panels.weather?.current) out.push(['weather', WeatherPanel])
    if (data.panels.lodging) out.push(['lodging', LodgingPanel])
    if (data.panels.announcements) out.push(['announcements', AnnouncementsPanel])
    if (data.panels.kudos?.length) out.push(['kudos', KudosPanel])
    return out
  }, [data])

  useEffect(() => {
    if (!data || panels.length < 2) return
    const t = setInterval(() => setIdx(i => (i + 1) % panels.length), (data.settings.rotate_seconds || 12) * 1000)
    return () => clearInterval(t)
  }, [data, panels.length])

  if (err) return (
    <div className="h-screen-dyn bg-[#0E2429] text-white flex items-center justify-center font-head text-[20px]">{err}</div>
  )
  if (!data) return <div className="h-screen-dyn bg-[#0E2429]" />

  const ticker = (data.panels.announcements || []).map(a => a.title || a.body).join('   ·   ')
  const [key, Active] = panels[idx % panels.length] || []

  return (
    <div className="h-screen-dyn overflow-hidden bg-topo text-white flex flex-col"
      style={{ background: 'radial-gradient(120% 100% at 50% 115%, #17444E 0%, #0E2429 55%, #0A1B1F 100%)' }}>
      <div className="flex items-start justify-between px-14 pt-10">
        <div className="flex items-center gap-5">
          <img src="/brand/logo-white.png" alt="" className="h-12" />
          {data.panels.whosout && (
            <span className="px-4 py-1.5 rounded-full bg-white/10 text-[15px] font-head font-bold">
              🚙 {data.panels.whosout.off} staff off property
            </span>
          )}
        </div>
        <Clock />
      </div>

      <div className="flex-1 min-h-0 relative">
        <AnimatePresence mode="wait">
          {Active && <Active key={key} data={data} />}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3 px-14 pb-6">
        <div className="flex gap-2">
          {panels.map(([k], i) => (
            <span key={k} className={`h-1.5 rounded-full transition-all duration-500 ${i === idx % panels.length ? 'w-8 bg-[#A3CD42]' : 'w-1.5 bg-white/25'}`} />
          ))}
        </div>
        {ticker && (
          <div className="flex-1 overflow-hidden whitespace-nowrap ml-6 text-white/65 font-head font-semibold text-[15px]">
            <span className="ticker-track">{ticker}</span>
          </div>
        )}
      </div>
    </div>
  )
}
