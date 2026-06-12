import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X, ChevronDown, Search } from 'lucide-react'
import { cx, initials } from '../lib.js'
import { SPRING, sheetUp, fade, pop } from '../motion.js'

/* ---------- buttons ---------- */
const BTN_VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-deep shadow-soft',
  accent: 'bg-green text-[#13302a] hover:brightness-105 shadow-soft font-bold',
  soft: 'bg-sunken text-ink hover:bg-line/70',
  ghost: 'text-dim hover:text-ink hover:bg-sunken',
  outline: 'border border-line bg-surface text-ink hover:border-brand hover:text-brand',
  danger: 'bg-danger/10 text-danger hover:bg-danger hover:text-white',
}
export function Btn({ variant = 'primary', size = 'md', className, children, ...props }) {
  return (
    <motion.button
      whileTap={{ scale: 0.965 }}
      transition={SPRING}
      className={cx(
        'btn inline-flex items-center justify-center gap-2 rounded-xl font-head font-semibold transition ring-focus disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'px-3 py-1.5 text-[12.5px]' : size === 'lg' ? 'px-5 py-3 text-[15px]' : 'px-4 py-2 text-[13.5px]',
        BTN_VARIANTS[variant], className
      )}
      {...props}>
      {children}
    </motion.button>
  )
}

export function IconBtn({ className, title, children, ...props }) {
  return (
    <motion.button whileTap={{ scale: 0.92 }} title={title} aria-label={title}
      className={cx('icon-btn p-2 rounded-xl text-dim hover:text-ink hover:bg-sunken transition ring-focus', className)}
      {...props}>
      {children}
    </motion.button>
  )
}

/* ---------- typography & layout ---------- */
export const Kicker = ({ className, children }) => (
  <div className={cx('kicker text-accent', className)}>{children}</div>
)

export function PageHead({ kicker, title, sub, actions, className }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-6', className)}>
      <div className="min-w-0">
        {kicker && <Kicker className="mb-1.5 flex items-center gap-2">
          <span className="inline-block w-6 h-[2px] bg-accent rounded-full" />{kicker}
        </Kicker>}
        <h1 className="disp text-[40px] sm:text-[48px] text-ink">{title}</h1>
        {sub && <p className="text-dim mt-1.5 max-w-xl">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

export const Card = ({ className, children, ...p }) => (
  <div className={cx('card', className)} {...p}>{children}</div>
)

/* ---------- badges, avatars ---------- */
export const Badge = ({ className, children }) => (
  <span className={cx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11.5px] font-head font-bold whitespace-nowrap', className)}>
    {children}
  </span>
)

export function Avatar({ name, color = '#1E5A64', size = 32, className, ring }) {
  return (
    <span
      className={cx('inline-flex items-center justify-center rounded-full font-head font-bold text-white select-none shrink-0', ring && 'ring-2 ring-surface', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: color }}>
      {initials(name)}
    </span>
  )
}

export function AvatarStack({ people = [], size = 26, max = 4 }) {
  const show = people.slice(0, max)
  return (
    <span className="inline-flex items-center">
      {show.map((p, i) => (
        <span key={p.id ?? i} style={{ marginLeft: i ? -size * 0.3 : 0, zIndex: 10 - i }} title={p.name}>
          <Avatar name={p.name} color={p.color} size={size} ring />
        </span>
      ))}
      {people.length > max && (
        <span className="ml-1 text-[11px] font-head font-bold text-dim">+{people.length - max}</span>
      )}
    </span>
  )
}

/* ---------- form bits ---------- */
export const Field = ({ label, hint, children, className }) => (
  <label className={cx('block min-w-0', className)}>
    {label && <span className="label">{label}</span>}
    {children}
    {hint && <span className="block text-[12px] text-faint mt-1">{hint}</span>}
  </label>
)

export function Toggle({ on, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={cx('relative w-[42px] h-[24px] rounded-full transition-colors ring-focus shrink-0',
        on ? 'bg-summer' : 'bg-line', disabled && 'opacity-40 pointer-events-none')}>
      <motion.span layout transition={SPRING}
        className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow"
        style={{ left: on ? 'calc(100% - 21px)' : '3px' }} />
    </button>
  )
}

export function Seg({ value, onChange, options, className, size = 'md' }) {
  return (
    <div className={cx('inline-flex p-1 rounded-xl bg-sunken gap-0.5 max-w-full overflow-x-auto no-scrollbar', className)}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.v
        const label = typeof o === 'string' ? o : o.label
        const active = value === v
        return (
          <button key={v} onClick={() => onChange(v)}
            className={cx('relative rounded-lg font-head font-semibold transition whitespace-nowrap ring-focus',
              size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[12.5px]',
              active ? 'text-ink' : 'text-dim hover:text-ink')}>
            {active && (
              <motion.span layoutId="seg-pill" transition={SPRING}
                className="absolute inset-0 bg-surface rounded-lg shadow-soft" />
            )}
            <span className="relative z-10">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Tabs({ value, onChange, tabs, className }) {
  return (
    <div className={cx('flex gap-1 border-b border-line overflow-x-auto no-scrollbar', className)}>
      {tabs.map(t => {
        const active = value === t.v
        return (
          <button key={t.v} onClick={() => onChange(t.v)}
            className={cx('relative px-3.5 py-2.5 font-head font-semibold text-[13px] whitespace-nowrap transition ring-focus',
              active ? 'text-accent' : 'text-dim hover:text-ink')}>
            {t.label}
            {t.badge ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-accent/12 text-accent text-[10.5px] font-bold">{t.badge}</span> : null}
            {active && (
              <motion.span layoutId="tab-line" transition={SPRING}
                className="absolute left-2 right-2 -bottom-px h-[2.5px] rounded-full bg-accent" />
            )}
          </button>
        )
      })}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        className="input pl-9" type="search" />
    </div>
  )
}

/* ---------- modal / bottom sheet ---------- */
export function Sheet({ open, onClose, title, kicker, children, footer, wide }) {
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const onKey = e => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
          <motion.div {...fade} className="absolute inset-0 bg-[#0A1B1E]/55 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            {...(reduced ? fade : undefined)}
            variants={reduced ? undefined : { ...sheetUp, animate: { ...sheetUp.animate }, }}
            initial={reduced ? undefined : 'initial'} animate={reduced ? undefined : 'animate'} exit={reduced ? undefined : 'exit'}
            drag={reduced ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(e, info) => { if (info.offset.y > 90 || info.velocity.y > 600) onClose?.() }}
            className={cx('relative w-full sm:w-auto sm:min-w-[440px] bg-surface sm:rounded-2xl rounded-t-2xl shadow-sheet sm:shadow-pop',
              'flex flex-col sheet-max overflow-hidden', wide ? 'sm:max-w-3xl sm:w-[760px]' : 'sm:max-w-lg')}>
            <div className="sm:hidden pt-2.5 flex justify-center" aria-hidden>
              <span className="w-10 h-1 rounded-full bg-line" />
            </div>
            <div className="flex items-start justify-between gap-4 px-5 pt-3.5 sm:pt-5 pb-3 border-b border-line/70">
              <div>
                {kicker && <Kicker className="mb-0.5">{kicker}</Kicker>}
                <h2 className="font-head font-bold text-[16.5px] text-ink">{title}</h2>
              </div>
              <IconBtn title="Close" onClick={onClose} className="-mr-1.5 -mt-1"><X size={17} /></IconBtn>
            </div>
            <div className="overflow-y-auto px-5 py-4 grow">{children}</div>
            {footer && (
              <div className="px-5 py-3.5 border-t border-line/70 flex items-center justify-end gap-2 bg-surface"
                style={{ paddingBottom: 'calc(0.875rem + var(--sab))' }}>
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

/* ---------- two-tap destructive confirm ---------- */
export function ConfirmBtn({ onConfirm, children, label = 'Sure?', variant = 'danger', size = 'sm', ...props }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 2600)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Btn variant={armed ? 'danger' : 'ghost'} size={size}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))} {...props}>
      {armed ? label : children}
    </Btn>
  )
}

/* ---------- empty / loading states ---------- */
export function EmptyState({ icon, title, body, action, className }) {
  return (
    <motion.div {...pop} className={cx('text-center py-14 px-6', className)}>
      <div className="text-[34px] mb-2.5" aria-hidden>{icon || '🌲'}</div>
      <div className="font-head font-bold text-[15px] text-ink">{title}</div>
      {body && <p className="text-dim text-[13px] mt-1 max-w-sm mx-auto">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </motion.div>
  )
}

export const Spinner = ({ size = 22, className }) => (
  <span className={cx('inline-block animate-spin rounded-full border-2 border-line border-t-brand', className)}
    style={{ width: size, height: size }} aria-label="Loading" />
)

export function PageLoader() {
  return <div className="flex items-center justify-center py-24"><Spinner size={28} /></div>
}

/* ---------- stat tile with animated number ---------- */
export function CountUp({ value, duration = 0.8 }) {
  const [n, setN] = useState(0)
  const ref = useRef()
  useEffect(() => {
    const target = Number(value) || 0
    const start = performance.now()
    cancelAnimationFrame(ref.current)
    const step = t => {
      const p = Math.min(1, (t - start) / (duration * 1000))
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) ref.current = requestAnimationFrame(step)
    }
    ref.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(ref.current)
  }, [value, duration])
  return <span className="tnum">{n}</span>
}

export function StatTile({ label, value, icon, tone = 'text-accent', sub, onClick }) {
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp onClick={onClick} whileTap={onClick ? { scale: 0.98 } : undefined}
      className={cx('card px-4 py-3.5 flex items-center gap-3.5 text-left w-full', onClick && 'hover:shadow-lift transition-shadow')}>
      <span className={cx('w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center', tone)}>{icon}</span>
      <span className="min-w-0">
        <span className="block disp text-[26px] leading-none text-ink"><CountUp value={value} /></span>
        <span className="block kicker text-dim mt-1 truncate" style={{ letterSpacing: '0.14em' }}>{label}</span>
        {sub && <span className="block text-[11.5px] text-faint mt-0.5 truncate">{sub}</span>}
      </span>
    </Comp>
  )
}

/* ---------- confetti burst (task done, kudos given) ---------- */
const CONFETTI_COLORS = ['#A3CD42', '#30A059', '#C26628', '#1087A3', '#F7F3EA', '#1E5A64']
export function ConfettiBurst({ fire }) {
  const [bursts, setBursts] = useState([])
  useEffect(() => {
    if (!fire) return
    const id = Date.now()
    setBursts(b => [...b, id])
    const t = setTimeout(() => setBursts(b => b.filter(x => x !== id)), 1400)
    return () => clearTimeout(t)
  }, [fire])
  if (!bursts.length) return null
  return createPortal(
    <div className="fixed inset-0 z-[85] pointer-events-none overflow-hidden" aria-hidden>
      {bursts.map(id => (
        <span key={id} className="absolute left-1/2 top-[42%]">
          {Array.from({ length: 26 }).map((_, i) => {
            const angle = (i / 26) * Math.PI * 2
            const dist = 110 + (i % 5) * 46
            return (
              <motion.span key={i}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
                animate={{
                  x: Math.cos(angle) * dist,
                  y: Math.sin(angle) * dist * 0.85 + 130,
                  opacity: 0, scale: 0.6, rotate: 200 + i * 23,
                }}
                transition={{ duration: 1.15, ease: [0.16, 0.6, 0.45, 1] }}
                className="absolute block"
                style={{
                  width: i % 3 === 0 ? 9 : 6, height: i % 4 === 0 ? 11 : 7,
                  borderRadius: i % 2 ? 2 : 99,
                  background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                }} />
            )
          })}
        </span>
      ))}
    </div>,
    document.body
  )
}

/* ---------- star rating (guest CSAT) ---------- */
export function Stars({ value = 0, onChange, size = 22, className }) {
  const interactive = !!onChange
  return (
    <span className={cx('inline-flex gap-1', className)} role={interactive ? 'radiogroup' : undefined}>
      {[1, 2, 3, 4, 5].map(i => (
        <motion.button key={i} type="button" disabled={!interactive}
          whileTap={interactive ? { scale: 0.85 } : undefined}
          onClick={() => onChange?.(i)}
          className={cx(!interactive && 'cursor-default', 'ring-focus rounded')}
          aria-label={`${i} star${i > 1 ? 's' : ''}`}>
          <svg width={size} height={size} viewBox="0 0 24 24"
            fill={i <= value ? '#E2A33C' : 'none'}
            stroke={i <= value ? '#E2A33C' : 'rgb(var(--c-faint))'} strokeWidth="1.8">
            <path d="M12 2.7l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-.9z" strokeLinejoin="round" />
          </svg>
        </motion.button>
      ))}
    </span>
  )
}

/* ---------- dropdown select (native, brand-skinned) ---------- */
export function Select({ value, onChange, children, className, ...props }) {
  return (
    <span className={cx('relative inline-block w-full', className)}>
      <select value={value} onChange={e => onChange(e.target.value)} className="input appearance-none pr-9" {...props}>
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
    </span>
  )
}
