import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api.js'
import { PageHead, Card, IconBtn, Btn, Spinner, Badge } from '../components/ui.jsx'
import { cx, todayISO, addDays, fmtRange, bookingStatus } from '../lib.js'
import { pageAnim } from '../motion.js'

const STATUS_BAR = {
  tentative: 'bg-ember/80', confirmed: 'bg-lake', in_progress: 'bg-summer',
  completed: 'bg-faint', inquiry: 'bg-faint', cancelled: 'bg-danger/60',
}

export default function CalendarPage() {
  const [anchor, setAnchor] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` })
  const [bookings, setBookings] = useState(null)
  const today = todayISO()

  const monthMeta = useMemo(() => {
    const first = new Date(`${anchor}T12:00:00`)
    const label = first.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
    const gridStart = addDays(anchor, -((first.getDay() + 6) % 7))
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
    return { label, days, month: first.getMonth() }
  }, [anchor])

  useEffect(() => {
    setBookings(null)
    api.get(`/bookings/calendar?start=${monthMeta.days[0]}&end=${monthMeta.days[41]}`)
      .then(setBookings).catch(() => setBookings([]))
  }, [anchor]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    const m = new Map()
    for (const d of monthMeta.days) m.set(d, [])
    for (const b of bookings || []) {
      for (const d of monthMeta.days) {
        if (b.start_date <= d && b.end_date >= d) m.get(d).push(b)
      }
    }
    return m
  }, [bookings, monthMeta])

  function shift(n) {
    const d = new Date(`${anchor}T12:00:00`)
    d.setMonth(d.getMonth() + n)
    setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Operate" title="Calendar" sub="Every group on the property, at a glance."
        actions={
          <div className="flex items-center gap-1.5">
            <IconBtn title="Previous month" onClick={() => shift(-1)}><ChevronLeft size={17} /></IconBtn>
            <Btn variant="soft" size="sm" onClick={() => { const d = new Date(); setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`) }}>Today</Btn>
            <IconBtn title="Next month" onClick={() => shift(1)}><ChevronRight size={17} /></IconBtn>
            <div className="font-head font-bold text-[15px] text-ink ml-2 whitespace-nowrap">{monthMeta.label}</div>
          </div>
        } />

      {bookings === null ? <div className="py-20 text-center"><Spinner size={28} /></div> : (
        <>
          {/* month grid — desktop */}
          <Card className="hidden md:block overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                <div key={d} className="kicker text-dim text-center py-2.5">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthMeta.days.map((d, i) => {
                const inMonth = new Date(`${d}T12:00:00`).getMonth() === monthMeta.month
                const list = byDay.get(d) || []
                return (
                  <div key={d} className={cx('min-h-[96px] p-1.5 border-b border-r border-line/50 [&:nth-child(7n)]:border-r-0',
                    i >= 35 && 'border-b-0', !inMonth && 'bg-sunken/40')}>
                    <div className={cx('text-[11.5px] font-head font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full tnum',
                      d === today ? 'bg-green text-[#16321c]' : inMonth ? 'text-ink' : 'text-faint')}>
                      {Number(d.slice(8))}
                    </div>
                    <div className="space-y-1">
                      {list.slice(0, 3).map(b => (
                        <Link key={b.id} to={`/bookings/${b.id}`}
                          className="flex items-center gap-1.5 px-1.5 py-1 rounded-md bg-sunken/80 hover:bg-sunken transition group">
                          <span className={cx('w-1 h-3.5 rounded-full shrink-0', STATUS_BAR[b.status] || 'bg-faint')} />
                          <span className="text-[11px] font-semibold text-ink truncate group-hover:text-brand">{b.name}</span>
                        </Link>
                      ))}
                      {list.length > 3 && <div className="text-[10.5px] text-faint pl-1.5">+{list.length - 3} more</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* agenda — mobile */}
          <div className="md:hidden space-y-2.5">
            {monthMeta.days.filter(d => new Date(`${d}T12:00:00`).getMonth() === monthMeta.month && (byDay.get(d) || []).some(b => b.start_date === d || d === today))
              .map(d => {
                const list = (byDay.get(d) || [])
                const starting = list.filter(b => b.start_date === d)
                const show = starting.length ? starting : list
                if (!show.length) return null
                return (
                  <Card key={d} className="p-3.5">
                    <div className={cx('kicker mb-2', d === today ? '!text-green-dark' : '!text-dim')}>
                      {new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' })}
                      {d === today && ' · today'}
                    </div>
                    <div className="space-y-2">
                      {show.map(b => {
                        const s = bookingStatus(b.status)
                        return (
                          <Link key={b.id} to={`/bookings/${b.id}`} className="flex items-center gap-3">
                            <span className={cx('w-1.5 h-9 rounded-full shrink-0', STATUS_BAR[b.status])} />
                            <span className="min-w-0 flex-1">
                              <span className="block font-head font-bold text-[13.5px] text-ink truncate">{b.name}</span>
                              <span className="block text-[12px] text-dim">{fmtRange(b.start_date, b.end_date)} · {b.headcount} ppl</span>
                            </span>
                            <Badge className={s.cls}>{s.label}</Badge>
                          </Link>
                        )
                      })}
                    </div>
                  </Card>
                )
              })}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 px-1">
            {Object.entries({ tentative: 'Tentative', confirmed: 'Confirmed', in_progress: 'On site', completed: 'Completed' }).map(([k, label]) => (
              <span key={k} className="flex items-center gap-1.5 text-[11.5px] font-head font-semibold text-dim">
                <span className={cx('w-2.5 h-2.5 rounded-full', STATUS_BAR[k])} /> {label}
              </span>
            ))}
          </div>
        </>
      )}
    </motion.div>
  )
}
