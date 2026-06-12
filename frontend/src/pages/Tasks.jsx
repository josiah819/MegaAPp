import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, ChevronLeft, ChevronRight, MapPin, CheckSquare, LayoutTemplate, Lock, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import {
  PageHead, Card, Btn, Seg, Select, Sheet, Field, Avatar, AvatarStack, EmptyState,
  PageLoader, ConfirmBtn, ConfettiBurst, Kicker, Badge,
} from '../components/ui.jsx'
import { Ring } from '../components/charts.jsx'
import { cx, fmtDate, todayISO, addDays, priority, PRIORITIES, swatch } from '../lib.js'
import { pageAnim, SPRING } from '../motion.js'

function TaskDrawer({ open, onClose, task, data, onSaved, onDone }) {
  const { toast, can } = useApp()
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const editable = can('tasks.edit')

  useEffect(() => {
    if (!open) return
    setF(task ? {
      ...task,
      checklist: Array.isArray(task.checklist) ? task.checklist : [],
      assignees: task.assignees || [],
      tags: task.tags || [],
      blocked_by: task.blocked_by || [],
    } : {
      title: '', notes: '', status_id: data.statuses[0]?.id, priority: 1, phase_id: '',
      location_id: '', due: '', tags: [], checklist: [], assignees: [], blocked_by: [],
    })
  }, [open, task]) // eslint-disable-line

  if (!f) return null
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  async function save() {
    setBusy(true)
    try {
      const body = {
        title: f.title, notes: f.notes, status_id: Number(f.status_id), priority: Number(f.priority),
        phase_id: f.phase_id ? Number(f.phase_id) : null, location_id: f.location_id ? Number(f.location_id) : null,
        due: f.due || null, tags: f.tags, checklist: f.checklist, assignees: f.assignees,
        blocked_by: f.blocked_by,
      }
      await (task?.id ? api.patch(`/tasks/${task.id}`, body) : api.post('/tasks', body))
      const status = data.statuses.find(s => s.id === Number(f.status_id))
      const wasDone = task && data.statuses.find(s => s.id === task.status_id)?.kind === 'done'
      if (status?.kind === 'done' && !wasDone) { onDone?.(); toast('Task done — nice work 🎉') }
      else toast(task?.id ? 'Task saved' : 'Task added')
      onSaved(); onClose()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker="Tasks" title={task?.id ? 'Edit task' : 'New task'} wide
      footer={<>
        {task?.id && editable && (
          <ConfirmBtn label="Delete task?" onConfirm={async () => {
            try { await api.del(`/tasks/${task.id}`); toast('Task deleted'); onSaved(); onClose() } catch (e) { toast(e.message, 'err') }
          }}>Delete</ConfirmBtn>
        )}
        <span className="flex-1" />
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        {editable && <Btn onClick={save} disabled={busy || !f.title}>{task?.id ? 'Save' : 'Add task'}</Btn>}
      </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Title" className="sm:col-span-2">
          <input className="input" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Docks in — main waterfront" />
        </Field>
        <Field label="Status">
          <Select value={f.status_id} onChange={v => set('status_id', v)} disabled={!editable}>
            {data.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={v => set('priority', v)} disabled={!editable}>
            {PRIORITIES.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Season / phase">
          <Select value={f.phase_id || ''} onChange={v => set('phase_id', v)} disabled={!editable}>
            <option value="">— none —</option>
            {data.phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Location">
          <Select value={f.location_id || ''} onChange={v => set('location_id', v)} disabled={!editable}>
            <option value="">— anywhere —</option>
            {data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Due">
          <input type="date" className="input" value={f.due ? String(f.due).slice(0, 10) : ''} onChange={e => set('due', e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Assignees">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {data.people.map(p => {
              const onIt = f.assignees.includes(p.id)
              return (
                <button key={p.id} type="button" disabled={!editable}
                  onClick={() => set('assignees', onIt ? f.assignees.filter(x => x !== p.id) : [...f.assignees, p.id])}
                  className={cx('flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[12px] font-head font-semibold transition',
                    onIt ? 'border-accent bg-accent/10 text-ink' : 'border-line text-dim hover:border-faint')}>
                  <Avatar name={p.name} color={p.color} size={20} />{p.name.split(' ')[0]}
                </button>
              )
            })}
          </div>
        </Field>
        <Field label="Blocked by" hint="This task waits until its blockers are done." className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(f.blocked_by || []).map(id => {
              const b = data.tasks?.find(t => t.id === id)
              return (
                <button key={id} type="button" disabled={!editable}
                  onClick={() => set('blocked_by', f.blocked_by.filter(x => x !== id))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-ember/10 text-ember text-[12px] font-head font-semibold">
                  <Lock size={11} /> {b?.title || `#${id}`} ×
                </button>
              )
            })}
            {editable && (
              <Select value="" onChange={v => v && set('blocked_by', [...new Set([...(f.blocked_by || []), Number(v)])])} className="!w-auto min-w-[180px]">
                <option value="">+ add a blocker…</option>
                {(data.tasks || []).filter(t => t.id !== task?.id && !(f.blocked_by || []).includes(t.id) && data.statusById?.[t.status_id]?.kind !== 'done')
                  .map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            )}
          </div>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea className="input" rows={2} value={f.notes || ''} onChange={e => set('notes', e.target.value)} disabled={!editable} />
        </Field>
        {task?.id && !task.parent_id && (
          <Field label="Sub-tasks" hint="Real tasks nested under this one (the FTF jobs pattern)." className="sm:col-span-2">
            <SubTasks parent={task} data={data} onChanged={onSaved} editable={editable} />
          </Field>
        )}
        <Field label="Checklist" className="sm:col-span-2">
          <div className="space-y-1.5">
            {f.checklist.map((c, i) => (
              <div key={c.id || i} className="flex items-center gap-2.5">
                <button type="button" disabled={!editable}
                  onClick={() => set('checklist', f.checklist.map((x, j) => j === i ? { ...x, done: !x.done } : x))}
                  className={cx('w-[19px] h-[19px] rounded-md border-2 flex items-center justify-center transition shrink-0',
                    c.done ? 'bg-summer border-summer text-white' : 'border-line hover:border-summer')}>
                  {c.done && <CheckSquare size={12} />}
                </button>
                <input className={cx('flex-1 bg-transparent text-[13.5px] focus:outline-none border-b border-transparent focus:border-line py-0.5', c.done && 'line-through text-faint')}
                  value={c.text} disabled={!editable}
                  onChange={e => set('checklist', f.checklist.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                {editable && (
                  <button type="button" className="text-faint hover:text-danger text-[16px] leading-none"
                    onClick={() => set('checklist', f.checklist.filter((_, j) => j !== i))}>×</button>
                )}
              </div>
            ))}
            {editable && (
              <button type="button" onClick={() => set('checklist', [...f.checklist, { id: `c${Date.now()}`, text: '', done: false }])}
                className="text-[12.5px] font-head font-bold text-brand hover:underline">+ Add item</button>
            )}
          </div>
        </Field>
      </div>
    </Sheet>
  )
}

function SubTasks({ parent, data, onChanged, editable }) {
  const { toast } = useApp()
  const [text, setText] = useState('')
  const kids = (data.tasks || []).filter(t => t.parent_id === parent.id)
  const doneId = data.statuses.find(s => s.kind === 'done')?.id
  const openId = data.statuses[0]?.id

  async function toggle(k) {
    const isDone = data.statusById[k.status_id]?.kind === 'done'
    try {
      await api.patch(`/tasks/${k.id}`, { status_id: isDone ? openId : doneId })
      onChanged()
    } catch (e) { toast(e.message, 'err') }
  }
  async function add() {
    if (!text.trim()) return
    try {
      await api.post('/tasks', { title: text.trim(), parent_id: parent.id })
      setText(''); onChanged()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <div className="space-y-1.5 pt-1">
      {kids.map(k => {
        const isDone = data.statusById[k.status_id]?.kind === 'done'
        return (
          <div key={k.id} className="flex items-center gap-2.5">
            <button type="button" disabled={!editable} onClick={() => toggle(k)}
              className={cx('w-[19px] h-[19px] rounded-md border-2 flex items-center justify-center transition shrink-0',
                isDone ? 'bg-summer border-summer text-white' : 'border-line hover:border-summer')}>
              {isDone && <CheckSquare size={12} />}
            </button>
            <span className={cx('flex-1 text-[13.5px]', isDone && 'line-through text-faint')}>{k.title}</span>
            {editable && (
              <button type="button" className="text-faint hover:text-danger text-[16px] leading-none"
                onClick={async () => { try { await api.del(`/tasks/${k.id}`); onChanged() } catch (e) { toast(e.message, 'err') } }}>×</button>
            )}
          </div>
        )
      })}
      {editable && (
        <div className="flex gap-2">
          <input className="input !py-1.5 text-[13px]" value={text} placeholder="Add a sub-task and press Enter"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        </div>
      )}
      {!kids.length && !editable && <span className="text-[12px] text-faint">None.</span>}
    </div>
  )
}

function TaskCard({ t, data, onOpen, onMove }) {
  const { can } = useApp()
  const p = priority(t.priority)
  const phase = data.phases.find(ph => ph.id === t.phase_id)
  const assignees = (t.assignees || []).map(id => data.people.find(pp => pp.id === id)).filter(Boolean)
  const checklist = Array.isArray(t.checklist) ? t.checklist : []
  const doneCount = checklist.filter(c => c.done).length
  const overdue = t.due && t.due < todayISO() && data.statusById[t.status_id]?.kind !== 'done'
  const idx = data.statuses.findIndex(s => s.id === t.status_id)
  const blockedBy = (t.blocked_by || [])
    .map(id => data.taskById?.[id]).filter(Boolean)
    .filter(b => data.statusById[b.status_id]?.kind !== 'done')

  return (
    <motion.div layout transition={SPRING}
      className="card p-3 group cursor-pointer hover:shadow-lift transition-shadow relative"
      onClick={() => onOpen(t)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={cx('text-[13px] font-head font-bold leading-snug',
            data.statusById[t.status_id]?.kind === 'done' ? 'text-faint line-through' : 'text-ink')}>{t.title}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px] text-dim">
            {blockedBy.length > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-px rounded font-head font-bold bg-ember/10 text-ember"
                title={`Waiting on: ${blockedBy.map(b => b.title).join(', ')}`}>
                <Lock size={9} /> blocked
              </span>
            )}
            {t.priority > 1 && <span className={cx('px-1.5 py-px rounded font-head font-bold', p.cls)}>{p.label}</span>}
            {t.location_name && <span className="inline-flex items-center gap-0.5 truncate max-w-[120px]"><MapPin size={10} className="shrink-0" />{t.location_name}</span>}
            {t.due && <span className={cx('tnum', overdue && 'text-danger font-bold')}>{fmtDate(t.due)}</span>}
            {checklist.length > 0 && <span className="tnum">{doneCount}/{checklist.length} ✓</span>}
            {t.sub_count > 0 && (
              <span className={cx('tnum px-1.5 py-px rounded font-head font-bold',
                t.sub_done === t.sub_count ? 'bg-summer/12 text-summer' : 'bg-sunken text-dim')}>
                ⧉ {t.sub_done}/{t.sub_count}
              </span>
            )}
            {phase && <span className="px-1.5 py-px rounded font-head font-semibold text-white/95" style={{ background: swatch(phase.color) }}>{phase.name}</span>}
          </div>
        </div>
        {assignees.length > 0 && <AvatarStack people={assignees} size={22} max={3} />}
      </div>
      {can('tasks.edit') && (
        <div className="hover-reveal absolute -top-2 right-2 flex gap-1">
          {idx > 0 && (
            <button onClick={e => { e.stopPropagation(); onMove(t, data.statuses[idx - 1].id) }}
              title={`Move to ${data.statuses[idx - 1].name}`}
              className="w-6 h-6 rounded-full bg-surface border border-line shadow-soft flex items-center justify-center text-dim hover:text-ink">
              <ChevronLeft size={13} />
            </button>
          )}
          {idx < data.statuses.length - 1 && (
            <button onClick={e => { e.stopPropagation(); onMove(t, data.statuses[idx + 1].id) }}
              title={`Move to ${data.statuses[idx + 1].name}`}
              className="w-6 h-6 rounded-full bg-surface border border-line shadow-soft flex items-center justify-center text-dim hover:text-ink">
              <ChevronRight size={13} />
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}

export default function Tasks() {
  const { can, toast } = useApp()
  const [raw, setRaw] = useState(null)
  const [view, setView] = useState('board')
  const [phaseFilter, setPhaseFilter] = useState('')
  const [drawer, setDrawer] = useState(null) // {task} | {task:null} for new
  const [confetti, setConfetti] = useState(0)
  const [people, setPeople] = useState([])
  const [locations, setLocations] = useState([])
  const [tplOpen, setTplOpen] = useState(false)

  const load = () => api.get('/tasks').then(setRaw).catch(e => { toast(e.message, 'err') })
  useEffect(() => {
    load()
    api.get('/people').then(setPeople).catch(() => {})
    api.get('/locations').then(setLocations).catch(() => {})
  }, []) // eslint-disable-line

  const data = useMemo(() => {
    if (!raw) return null
    const locById = new Map(locations.map(l => [l.id, l]))
    const tasks = raw.tasks.map(t => ({ ...t, location_name: t.location_name || locById.get(t.location_id)?.name }))
    return {
      ...raw,
      people, locations, tasks,
      statusById: Object.fromEntries(raw.statuses.map(s => [s.id, s])),
      taskById: Object.fromEntries(tasks.map(t => [t.id, t])),
    }
  }, [raw, people, locations])

  const filtered = useMemo(() => {
    if (!data) return []
    // sub-tasks live inside their parent's drawer, not on the board
    return data.tasks.filter(t => !t.parent_id && (!phaseFilter || t.phase_id === Number(phaseFilter)))
  }, [data, phaseFilter])

  async function move(t, statusId) {
    try {
      await api.patch(`/tasks/${t.id}`, { status_id: statusId })
      if (data.statusById[statusId]?.kind === 'done') { setConfetti(c => c + 1); toast('Done — beauty 🎉') }
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  if (!data) return <PageLoader />

  const phaseProgress = data.phases.map(ph => {
    const inPhase = data.tasks.filter(t => t.phase_id === ph.id)
    const done = inPhase.filter(t => data.statusById[t.status_id]?.kind === 'done')
    return { ...ph, total: inPhase.length, pct: inPhase.length ? (done.length / inPhase.length) * 100 : 0 }
  })

  return (
    <motion.div {...pageAnim}>
      <ConfettiBurst fire={confetti} />
      <PageHead kicker="Property" title="Tasks" sub="One board for seasons, groups, and everything in between."
        actions={
          <div className="flex items-center gap-2">
            <Seg value={view} onChange={setView} options={[{ v: 'board', label: 'Board' }, { v: 'list', label: 'List' }, { v: 'week', label: 'My week' }]} />
            {can('tasks.templates') && (
              <Btn variant="soft" onClick={() => setTplOpen(true)}><LayoutTemplate size={14} /> Templates</Btn>
            )}
            {can('tasks.edit') && <Btn onClick={() => setDrawer({ task: null })}><Plus size={15} /> Task</Btn>}
          </div>
        } />

      {/* phase strip */}
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 mb-5 -mx-1 px-1">
        <button onClick={() => setPhaseFilter('')}
          className={cx('shrink-0 card px-3.5 py-2.5 flex items-center gap-2.5 transition',
            !phaseFilter ? 'ring-2 ring-accent/60' : 'opacity-75 hover:opacity-100')}>
          <span className="font-head font-bold text-[12.5px] text-ink">All work</span>
          <span className="text-[11px] text-dim tnum">{data.tasks.length}</span>
        </button>
        {phaseProgress.map(ph => (
          <button key={ph.id} onClick={() => setPhaseFilter(String(ph.id) === phaseFilter ? '' : String(ph.id))}
            className={cx('shrink-0 card px-3.5 py-2 flex items-center gap-2.5 transition',
              phaseFilter === String(ph.id) ? 'ring-2 ring-accent/60' : 'opacity-75 hover:opacity-100')}>
            <Ring pct={ph.pct} size={32} stroke={4} color={swatch(ph.color)}>
              <span className="text-[8.5px] font-bold tnum text-ink">{Math.round(ph.pct)}</span>
            </Ring>
            <span className="text-left">
              <span className="block font-head font-bold text-[12.5px] text-ink whitespace-nowrap">{ph.name}</span>
              <span className="block text-[10.5px] text-dim tnum">{ph.total} tasks</span>
            </span>
          </button>
        ))}
      </div>

      {view === 'board' ? (
        <div className="flex gap-3.5 overflow-x-auto scroll-x snap-x snap-mandatory pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
          {data.statuses.map(s => {
            const cards = filtered.filter(t => t.status_id === s.id)
            return (
              <div key={s.id} className="snap-start shrink-0 w-[82vw] xs:w-[300px] flex flex-col max-h-[68vh]">
                <div className="flex items-center gap-2 px-1 pb-2.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: swatch(s.color) }} />
                  <span className="font-head font-bold text-[13px] text-ink">{s.name}</span>
                  <span className="text-[11.5px] text-faint tnum">{cards.length}</span>
                </div>
                <div className="space-y-2.5 overflow-y-auto no-scrollbar rounded-xl flex-1 min-h-[120px] pb-2">
                  {cards.map(t => <TaskCard key={t.id} t={t} data={data} onOpen={task => setDrawer({ task })} onMove={move} />)}
                  {cards.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-line/80 py-8 text-center text-[12px] text-faint">empty</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : view === 'week' ? (
        <MyWeek data={data} filtered={filtered} onOpen={task => setDrawer({ task })} onMove={move} />
      ) : (
        <div className="space-y-5">
          {data.statuses.map(s => {
            const rows = filtered.filter(t => t.status_id === s.id)
            if (!rows.length) return null
            return (
              <div key={s.id}>
                <Kicker className="!text-dim mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: swatch(s.color) }} />{s.name} · {rows.length}
                </Kicker>
                <div className="space-y-2">
                  {rows.map(t => <TaskCard key={t.id} t={t} data={data} onOpen={task => setDrawer({ task })} onMove={move} />)}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && <Card><EmptyState icon="🌤️" title="Nothing here" body="No tasks in this slice." /></Card>}
        </div>
      )}

      <TaskDrawer open={!!drawer} onClose={() => setDrawer(null)} task={drawer?.task} data={data}
        onSaved={load} onDone={() => setConfetti(c => c + 1)} />
      <TemplatesSheet open={tplOpen} onClose={() => setTplOpen(false)} data={data} onApplied={load} />
    </motion.div>
  )
}

/* ---- My week: just my tasks, bucketed the way a human plans ---- */
function MyWeek({ data, filtered, onOpen, onMove }) {
  const { user } = useApp()
  const today = todayISO()
  const weekEnd = addDays(today, 6)
  const mine = filtered.filter(t => (t.assignees || []).includes(user.id) && data.statusById[t.status_id]?.kind !== 'done')
  const buckets = [
    ['🔥 Overdue', mine.filter(t => t.due && t.due < today)],
    ['📍 Today', mine.filter(t => t.due === today)],
    ['🗓️ This week', mine.filter(t => t.due && t.due > today && t.due <= weekEnd)],
    ['🌊 Later', mine.filter(t => t.due && t.due > weekEnd)],
    ['🍃 No date', mine.filter(t => !t.due)],
  ]
  if (!mine.length) return <Card><EmptyState icon="🏝️" title="Your week is clear" body="Nothing assigned to you in this slice — go help the waterfront crew." /></Card>
  return (
    <div className="space-y-5">
      {buckets.map(([label, rows]) => rows.length > 0 && (
        <div key={label}>
          <Kicker className="!text-dim mb-2">{label} · {rows.length}</Kicker>
          <div className="grid md:grid-cols-2 gap-2.5">
            {rows.map(t => <TaskCard key={t.id} t={t} data={data} onOpen={onOpen} onMove={onMove} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---- Templates: stamp a standard checklist onto the board ---- */
function TemplatesSheet({ open, onClose, data, onApplied }) {
  const { toast } = useApp()
  const [list, setList] = useState(null)
  const [applying, setApplying] = useState(null)   // template being applied
  const [creating, setCreating] = useState(null)   // new template form
  const [apply, setApply] = useState({ phase_id: '', location_id: '', start_date: todayISO() })

  const load = () => api.get('/tasks/templates').then(setList).catch(e => { toast(e.message, 'err'); setList([]) })
  useEffect(() => { if (open) { load(); setApplying(null); setCreating(null) } }, [open]) // eslint-disable-line

  async function doApply() {
    try {
      const r = await api.post(`/tasks/templates/${applying.id}/apply`, {
        phase_id: apply.phase_id ? Number(apply.phase_id) : null,
        location_id: apply.location_id ? Number(apply.location_id) : null,
        start_date: apply.start_date || null,
      })
      toast(`${r.created} tasks stamped onto the board ✨`)
      setApplying(null); onApplied(); onClose()
    } catch (e) { toast(e.message, 'err') }
  }

  async function saveTemplate() {
    try {
      await api.post('/tasks/templates', { ...creating, items: creating.items.filter(i => i.title.trim()) })
      toast('Template saved'); setCreating(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker="Tasks" title="Templates" wide
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
        {!creating && <Btn variant="soft" onClick={() => setCreating({ name: '', descr: '', items: [{ title: '', priority: 1, offset_days: 0 }] })}><Plus size={14} /> New template</Btn>}
        {creating && <Btn onClick={saveTemplate} disabled={!creating.name.trim() || !creating.items.some(i => i.title.trim())}>Save template</Btn>}
        {applying && <Btn variant="accent" onClick={doApply}>Stamp {applying.items.length} tasks</Btn>}
      </>}>
      {!list ? <PageLoader /> : creating ? (
        <div className="space-y-4">
          <Field label="Template name"><input className="input" value={creating.name} onChange={e => setCreating(s => ({ ...s, name: e.target.value }))} placeholder="Lodge turnover" /></Field>
          <Field label="Description"><input className="input" value={creating.descr} onChange={e => setCreating(s => ({ ...s, descr: e.target.value }))} /></Field>
          <div>
            <Kicker className="!text-dim mb-2">Tasks in this template</Kicker>
            <div className="space-y-2">
              {creating.items.map((it, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input className="input flex-1" placeholder="Task title" value={it.title}
                    onChange={e => setCreating(s => ({ ...s, items: s.items.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
                  <Select value={it.priority} onChange={v => setCreating(s => ({ ...s, items: s.items.map((x, j) => j === i ? { ...x, priority: Number(v) } : x) }))} className="!w-[110px] shrink-0">
                    {PRIORITIES.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
                  </Select>
                  <span className="flex items-center gap-1 text-[11.5px] text-faint shrink-0">+
                    <input type="number" className="input !w-[56px] !px-1.5 text-right" value={it.offset_days}
                      onChange={e => setCreating(s => ({ ...s, items: s.items.map((x, j) => j === i ? { ...x, offset_days: Number(e.target.value) } : x) }))} />d
                  </span>
                  <button className="text-faint hover:text-danger" onClick={() => setCreating(s => ({ ...s, items: s.items.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <Btn size="sm" variant="ghost" className="mt-2" onClick={() => setCreating(s => ({ ...s, items: [...s.items, { title: '', priority: 1, offset_days: 0 }] }))}>
              <Plus size={13} /> Add task
            </Btn>
          </div>
        </div>
      ) : applying ? (
        <div className="space-y-4">
          <div className="bg-sunken/60 rounded-xl px-3.5 py-2.5">
            <span className="font-head font-bold text-[14px] text-ink">{applying.name}</span>
            <span className="text-[12px] text-dim block">{applying.items.length} tasks — due dates count from the start date below.</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input type="date" className="input" value={apply.start_date} onChange={e => setApply(s => ({ ...s, start_date: e.target.value }))} /></Field>
            <Field label="Phase">
              <Select value={apply.phase_id} onChange={v => setApply(s => ({ ...s, phase_id: v }))}>
                <option value="">— none —</option>
                {data.phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Location" className="col-span-2">
              <Select value={apply.location_id} onChange={v => setApply(s => ({ ...s, location_id: v }))}>
                <option value="">— anywhere —</option>
                {data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="space-y-1">
            {applying.items.map((it, i) => (
              <div key={i} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                <span className="text-ink flex-1">{it.title}</span>
                <span className="text-faint text-[11.5px] tnum">day +{it.offset_days || 0}</span>
              </div>
            ))}
          </div>
          <button className="text-[12.5px] font-head font-bold text-dim hover:text-ink" onClick={() => setApplying(null)}>← back to templates</button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.length === 0 && <EmptyState icon="📋" title="No templates yet" body="Save your standard checklists once — lodge turnover, waterfront opening — and stamp them in seconds." />}
          {list.map(t => (
            <div key={t.id} className="card p-4 flex items-center gap-4">
              <LayoutTemplate size={18} className="text-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-head font-bold text-[13.5px] text-ink">{t.name}</div>
                <div className="text-[12px] text-dim truncate">{t.descr || `${t.items.length} tasks`} · {t.items.length} tasks</div>
              </div>
              <ConfirmBtn label="Delete?" onConfirm={async () => { await api.del(`/tasks/templates/${t.id}`).catch(() => {}); load() }}><Trash2 size={14} /></ConfirmBtn>
              <Btn size="sm" onClick={() => { setApplying(t); setApply({ phase_id: '', location_id: '', start_date: todayISO() }) }}>Use</Btn>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
