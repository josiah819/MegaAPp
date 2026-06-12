import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Award } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, SearchInput, Avatar, Badge, PageLoader, EmptyState, Seg } from '../components/ui.jsx'
import { cx } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

/* Org chart — reporting lines drawn as an indented tree (leadrMW port) */
function OrgChart({ list }) {
  const nav = useNavigate()
  const byManager = useMemo(() => {
    const m = new Map()
    for (const p of list) {
      const key = list.some(x => x.id === p.manager_id) ? p.manager_id : null
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(p)
    }
    return m
  }, [list])

  const Node = ({ p, depth }) => {
    const reports = byManager.get(p.id) || []
    return (
      <div className={cx(depth > 0 && 'ml-5 sm:ml-7 border-l-2 border-line/70 pl-3.5 sm:pl-5')}>
        <motion.button initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: depth * 0.04 }}
          onClick={() => nav(`/people/${p.id}`)}
          className="card w-full sm:w-auto sm:min-w-[260px] px-3.5 py-2.5 my-1.5 flex items-center gap-3 text-left hover:shadow-lift transition">
          <Avatar name={p.name} color={p.color} size={34} />
          <span className="min-w-0">
            <span className="block font-head font-bold text-[13px] text-ink truncate">{p.name}</span>
            <span className="block text-[11px] text-dim truncate">{p.title || p.role_label} · {p.dept}</span>
          </span>
          {reports.length > 0 && <span className="ml-auto text-[10.5px] font-head font-bold text-faint tnum shrink-0">{reports.length} ⤵</span>}
        </motion.button>
        {reports.map(r => <Node key={r.id} p={r} depth={depth + 1} />)}
      </div>
    )
  }

  const roots = byManager.get(null) || []
  return <div>{roots.map(p => <Node key={p.id} p={p} depth={0} />)}</div>
}

export default function People() {
  const { toast, settings } = useApp()
  const nav = useNavigate()
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [view, setView] = useState('directory')

  useEffect(() => { api.get('/people').then(setList).catch(e => { toast(e.message, 'err'); setList([]) }) }, []) // eslint-disable-line
  const depts = settings.org?.departments || []

  const filtered = useMemo(() => (list || []).filter(p =>
    (!dept || p.dept === dept) &&
    (!q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.title || '').toLowerCase().includes(q.toLowerCase()))
  ), [list, q, dept])

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Crew" title="People" sub="The crew that makes the property go."
        actions={<Seg value={view} onChange={setView} options={[{ v: 'directory', label: 'Directory' }, { v: 'org', label: 'Org chart' }]} />} />

      {view === 'org' ? (list === null ? <PageLoader /> : <OrgChart list={list} />) : (<>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <SearchInput value={q} onChange={setQ} placeholder="Find someone…" className="w-full sm:w-64 sm:mr-2" />
        <button onClick={() => setDept('')} className={cx('px-3 py-1.5 rounded-full text-[12px] font-head font-bold border transition',
          !dept ? 'bg-brand text-white border-brand' : 'border-line text-dim hover:border-faint')}>Everyone</button>
        {depts.map(d => (
          <button key={d} onClick={() => setDept(dept === d ? '' : d)}
            className={cx('px-3 py-1.5 rounded-full text-[12px] font-head font-bold border transition',
              dept === d ? 'bg-brand text-white border-brand' : 'border-line text-dim hover:border-faint')}>{d}</button>
        ))}
      </div>

      {list === null ? <PageLoader /> : filtered.length === 0 ? (
        <Card><EmptyState icon="🔭" title="Nobody matches" body="Try a different search." /></Card>
      ) : (
        <motion.div variants={stagger(0.025)} initial="initial" animate="animate"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(p => (
            <motion.button variants={rise} key={p.id} onClick={() => nav(`/people/${p.id}`)}
              className="card p-4 text-center hover:shadow-lift transition group">
              <div className="relative inline-block">
                <Avatar name={p.name} color={p.color} size={56} className="mx-auto" />
                <span className={cx('absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-surface',
                  p.off_property ? 'bg-ember' : 'bg-summer')} title={p.off_property ? 'Off property' : 'On property'} />
              </div>
              <div className="font-head font-bold text-[13.5px] text-ink mt-2.5 group-hover:text-brand transition-colors">{p.name}</div>
              <div className="text-[11.5px] text-dim truncate">{p.title || p.role_label}</div>
              <div className="flex items-center justify-center gap-2 mt-2">
                <Badge className="bg-sunken text-dim">{p.dept}</Badge>
                {p.kudos_count > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-head font-bold text-ember">
                    <Award size={11} />{p.kudos_count}
                  </span>
                )}
              </div>
            </motion.button>
          ))}
        </motion.div>
      )}
      </>)}
    </motion.div>
  )
}
