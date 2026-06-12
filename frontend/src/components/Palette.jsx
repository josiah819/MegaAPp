import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { NAV, itemVisible } from './Shell.jsx'
import { cx } from '../lib.js'
import { fade } from '../motion.js'

export function Palette({ open, onClose }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [sel, setSel] = useState(0)
  const nav = useNavigate()
  const { can, flagOn } = useApp()
  const timer = useRef()

  const navActions = useMemo(() =>
    NAV.flatMap(g => g.items)
      .filter(i => itemVisible(i, can, flagOn))
      .map(i => ({ type: 'nav', icon: '→', title: `Go to ${i.label}`, link: i.to })),
    [can, flagOn])

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const matchedNav = ql
      ? navActions.filter(a => a.title.toLowerCase().includes(ql))
      : navActions.slice(0, 6)
    return [...results, ...matchedNav].slice(0, 12)
  }, [q, results, navActions])

  useEffect(() => {
    if (!open) { setQ(''); setResults([]); setSel(0); return }
  }, [open])

  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < 2) { setResults([]); return }
    timer.current = setTimeout(async () => {
      try {
        const { results } = await api.get(`/search?q=${encodeURIComponent(q.trim())}`)
        setResults(results)
        setSel(0)
      } catch { /* noop */ }
    }, 180)
    return () => clearTimeout(timer.current)
  }, [q])

  function go(item) {
    onClose()
    if (item?.link) nav(item.link)
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[75] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div {...fade} className="absolute inset-0 bg-[#0A1B1E]/50 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }} transition={{ duration: 0.16 }}
            className="relative w-full max-w-xl card shadow-pop overflow-hidden">
            <div className="flex items-center gap-3 px-4 border-b border-line/70">
              <Search size={16} className="text-faint shrink-0" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(shown.length - 1, s + 1)) }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
                  if (e.key === 'Enter') { e.preventDefault(); go(shown[sel]) }
                }}
                placeholder="Search bookings, tickets, people, places…"
                className="w-full py-3.5 bg-transparent focus:outline-none text-[15px] text-ink placeholder:text-faint" />
            </div>
            <div className="max-h-[46vh] overflow-y-auto py-1.5">
              {shown.length === 0 && (
                <div className="py-10 text-center text-dim text-[13px]">Nothing yet — keep typing 🌲</div>
              )}
              {shown.map((r, i) => (
                <button key={`${r.type}-${r.link}-${i}`} onClick={() => go(r)} onMouseEnter={() => setSel(i)}
                  className={cx('w-full flex items-center gap-3 px-4 py-2.5 text-left transition',
                    i === sel ? 'bg-accent/10' : 'hover:bg-sunken/60')}>
                  <span className="text-[16px] w-6 text-center shrink-0">{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold text-ink truncate">{r.title}</span>
                    {r.sub && <span className="block text-[11.5px] text-dim truncate">{r.sub}</span>}
                  </span>
                  {i === sel && <CornerDownLeft size={14} className="text-faint shrink-0" />}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
