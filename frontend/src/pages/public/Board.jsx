import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { cx, fmtDate, fmtDow, todayISO, addDays } from '../../lib.js'

const GROUP_COLORS = ['#1E5A64', '#1F6331', '#C26628', '#1B5470', '#1087A3', '#30A059', '#7D5BA6', '#8A5A3B']
const colorFor = id => GROUP_COLORS[id % GROUP_COLORS.length]

export default function Board() {
  const { token } = useParams()
  const [params, setParams] = useSearchParams()
  const start = params.get('start') || ''
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const today = todayISO()

  useEffect(() => {
    const load = () => fetch(`/api/public/board/${token}${start ? `?start=${start}` : ''}`)
      .then(r => { if (!r.ok) throw new Error('This board link is not active'); return r.json() })
      .then(setData).catch(e => setErr(e.message))
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [token, start])

  if (err) return <div className="min-h-screen-dyn bg-bg flex items-center justify-center font-head text-ink text-[17px]">{err}</div>
  if (!data) return <div className="min-h-screen-dyn bg-bg" />

  return (
    <div className="min-h-screen-dyn bg-bg bg-topo-ink text-ink px-4 sm:px-8 py-6" style={{ paddingTop: 'calc(var(--sat) + 1.5rem)' }}>
      <div className="max-w-[1100px] mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6 no-print">
          <div>
            <div className="kicker text-green-dark mb-1">{data.org.name} · Who’s On</div>
            <h1 className="disp text-[36px] sm:text-[44px]">{fmtDate(data.days[0])} – {fmtDate(data.days[6])}</h1>
          </div>
          <div className="flex gap-2 font-head font-bold text-[13px]">
            <button className="px-3.5 py-2 rounded-xl bg-surface border border-line hover:border-brand transition"
              onClick={() => setParams({ start: addDays(data.start, -7) })}>← Prev</button>
            <button className="px-3.5 py-2 rounded-xl bg-surface border border-line hover:border-brand transition"
              onClick={() => setParams({})}>This week</button>
            <button className="px-3.5 py-2 rounded-xl bg-surface border border-line hover:border-brand transition"
              onClick={() => setParams({ start: addDays(data.start, 7) })}>Next →</button>
            <button className="px-3.5 py-2 rounded-xl bg-brand text-white hover:bg-brand-deep transition" onClick={() => window.print()}>Print</button>
          </div>
        </div>

        {data.attention.length > 0 && (
          <div className="card p-4 mb-5 border-ember/40">
            <div className="kicker text-ember mb-2">Heads up</div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
              {data.attention.map((a, i) => (
                <span key={i}><b className="font-head">{a.name}</b> — {a.note || a.condition}</span>
              ))}
            </div>
          </div>
        )}

        <div className="card overflow-x-auto scroll-x">
          <div className="min-w-[780px]">
            <div className="grid border-b-2 border-line" style={{ gridTemplateColumns: '170px repeat(7, 1fr)' }}>
              <div className="px-3.5 py-2.5 kicker text-dim">Lodge</div>
              {data.days.map(d => (
                <div key={d} className={cx('px-2 py-2.5 text-center', d === today && 'bg-green/10')}>
                  <div className="kicker !tracking-[0.12em] text-dim">{fmtDow(d)}</div>
                  <div className={cx('text-[13px] font-head font-bold tnum', d === today ? 'text-green-dark' : 'text-ink')}>{fmtDate(d)}</div>
                </div>
              ))}
            </div>
            {data.rows.map(row => (
              <div key={row.id} className="grid border-b border-line/50 last:border-0"
                style={{ gridTemplateColumns: '170px repeat(7, 1fr)' }}>
                <div className="px-3.5 py-2.5 min-w-0">
                  <span className="block text-[12.5px] font-head font-bold truncate">{row.name}</span>
                  <span className="block text-[10.5px] text-faint">{row.beds ? `${row.beds} beds` : row.zone}</span>
                </div>
                {data.days.map(d => {
                  const block = row.blocks.find(b => b.date_from <= d && b.date_to >= d)
                  if (!block) return <div key={d} className={cx('border-l border-line/40', d === today && 'bg-green/[0.06]')} />
                  const isStart = block.date_from === d || d === data.days[0]
                  return (
                    <div key={d} className={cx('border-l border-line/40 py-1.5', d === today && 'bg-green/[0.06]')}>
                      <div className={cx('h-[30px] flex items-center overflow-hidden',
                        isStart ? 'rounded-l-md pl-1.5 ml-0.5' : '-ml-px',
                        (block.date_to === d || d === data.days[6]) && 'rounded-r-md mr-0.5')}
                        style={{ background: colorFor(block.booking_id), opacity: block.status === 'tentative' ? 0.5 : 0.92 }}>
                        {isStart && <span className="text-[10px] font-head font-bold text-white truncate">{block.name}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11.5px] text-faint mt-4 flex flex-wrap gap-x-5 gap-y-1">
          <span>{data.totals.groups} groups this week · {data.totals.beds} beds</span>
          <span>Solid = confirmed / on site · faded = tentative</span>
          <span>Refreshes automatically</span>
        </div>
      </div>
    </div>
  )
}
