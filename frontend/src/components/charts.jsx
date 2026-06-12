import React from 'react'
import { motion } from 'framer-motion'
import { cx } from '../lib.js'
import { SWIFT } from '../motion.js'

/* Hand-rolled SVG charts — animated, theme-aware, no chart library. */

export function Bars({ data = [], height = 120, color = 'rgb(var(--c-accent))', className, labelEvery = 1 }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div className={cx('w-full', className)}>
      <div className="flex items-end gap-[6px]" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex-1 h-full flex flex-col items-center justify-end min-w-0" title={`${d.label}: ${d.value}`}>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(3, (d.value / max) * 100)}%` }}
              transition={{ duration: 0.6, ease: SWIFT, delay: i * 0.035 }}
              className="w-full rounded-t-md min-h-[3px]"
              style={{ background: d.color || color, opacity: d.value === 0 ? 0.25 : 1 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[6px] mt-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[10px] text-faint font-head font-semibold truncate">
            {i % labelEvery === 0 ? d.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

export function HBars({ data = [], color = 'rgb(var(--c-accent))', className }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div className={cx('space-y-2.5', className)}>
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-[12px] mb-1">
            <span className="font-head font-semibold text-ink truncate pr-3">{d.label}</span>
            <span className="text-dim tnum">{d.value}</span>
          </div>
          <div className="h-[7px] rounded-full bg-sunken overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${(d.value / max) * 100}%` }}
              transition={{ duration: 0.7, ease: SWIFT, delay: i * 0.05 }}
              className="h-full rounded-full" style={{ background: d.color || color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Ring({ pct = 0, size = 64, stroke = 7, color = 'rgb(var(--c-accent))', track = 'rgb(var(--c-sunken))', children, className }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct))
  return (
    <span className={cx('relative inline-flex items-center justify-center shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * p) / 100 }}
          transition={{ duration: 0.9, ease: SWIFT }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children ?? (
        <span className="font-head font-bold text-[12px] text-ink tnum">{Math.round(p)}%</span>
      )}</span>
    </span>
  )
}

export function Spark({ points = [], width = 120, height = 36, color = 'rgb(var(--c-accent))', className }) {
  if (!points.length) return null
  const max = Math.max(1, ...points)
  const min = Math.min(0, ...points)
  const span = max - min || 1
  const step = width / Math.max(1, points.length - 1)
  const d = points.map((v, i) =>
    `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <motion.path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: SWIFT }} />
    </svg>
  )
}

/* Multi-series line/area chart. series: [{ points:[n], color, label, fill }] */
export function Lines({ series = [], labels = [], height = 130, className, labelEvery = 2 }) {
  const W = 100 // viewBox units; scales to container
  const all = series.flatMap(s => s.points)
  if (!all.length) return null
  const max = Math.max(1, ...all)
  const n = Math.max(...series.map(s => s.points.length))
  const x = i => (n <= 1 ? 0 : (i / (n - 1)) * W)
  const y = v => height - 6 - (v / max) * (height - 18)
  const path = pts => pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  return (
    <div className={cx('w-full', className)}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full block" style={{ height }}>
        {[0.25, 0.5, 0.75].map(g => (
          <line key={g} x1="0" x2={W} y1={y(max * g)} y2={y(max * g)}
            stroke="rgb(var(--c-line))" strokeWidth="0.4" strokeDasharray="1.5 2" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, si) => (
          <g key={si}>
            {s.fill !== false && (
              <motion.path
                d={`${path(s.points)} L${x(s.points.length - 1)},${height - 4} L0,${height - 4} Z`}
                fill={s.color} initial={{ opacity: 0 }} animate={{ opacity: 0.09 }} transition={{ duration: 0.8 }} />
            )}
            <motion.path d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: SWIFT, delay: si * 0.15 }} />
          </g>
        ))}
      </svg>
      {labels.length > 0 && (
        <div className="flex justify-between mt-1">
          {labels.map((l, i) => (
            <span key={i} className="text-[9.5px] text-faint font-head font-semibold">
              {i % labelEvery === 0 ? l : ''}
            </span>
          ))}
        </div>
      )}
      {series.some(s => s.label) && (
        <div className="flex gap-4 mt-2">
          {series.map((s, i) => s.label && (
            <span key={i} className="flex items-center gap-1.5 text-[11px] text-dim font-head font-semibold">
              <span className="w-2.5 h-[3px] rounded-full" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* Intensity strip — e.g. tickets by weekday, sign-outs by hour. */
export function Heat({ data = [], rgbVar = '--c-accent', className }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div className={cx('flex gap-1.5', className)}>
      {data.map((d, i) => (
        <div key={i} className="flex-1 min-w-0 text-center" title={`${d.label}: ${d.value}`}>
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: SWIFT, delay: i * 0.04 }}
            className="h-9 rounded-lg flex items-center justify-center text-[11px] font-head font-bold tnum"
            style={{
              backgroundColor: `rgb(var(${rgbVar}) / ${0.08 + (d.value / max) * 0.72})`,
              color: d.value / max > 0.55 ? 'white' : 'rgb(var(--c-ink))',
            }}>
            {d.value || ''}
          </motion.div>
          <div className="text-[9.5px] text-faint font-head font-semibold mt-1 truncate">{d.label}</div>
        </div>
      ))}
    </div>
  )
}

export function Donut({ parts = [], size = 120, stroke = 16, className, children }) {
  const total = Math.max(1, parts.reduce((a, p) => a + p.value, 0))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <span className={cx('relative inline-flex', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-sunken))" strokeWidth={stroke} />
        {parts.map((p, i) => {
          const frac = p.value / total
          const seg = (
            <motion.circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={p.color} strokeWidth={stroke}
              strokeDasharray={`${c * frac} ${c}`}
              initial={{ strokeDashoffset: c * 0.25 }}
              animate={{ strokeDashoffset: -c * acc }}
              transition={{ duration: 0.8, ease: SWIFT, delay: 0.1 }} />
          )
          acc += frac
          return seg
        })}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-center">{children}</span>
    </span>
  )
}
