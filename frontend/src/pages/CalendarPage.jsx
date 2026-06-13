import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Plus, SlidersHorizontal, RefreshCw, Trash2,
  AlertTriangle, ExternalLink, CalendarPlus, Globe, HelpCircle,
} from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import {
  PageHead, Card, IconBtn, Btn, Spinner, Badge, Sheet, Field, Toggle, Seg,
  EmptyState, ConfirmBtn, Select,
} from '../components/ui.jsx'
import {
  cx, todayISO, addDays, weekStart, fmtDate, fmtDateLong, fmtRange,
  bookingStatus, priority, severity, SWATCHES,
} from '../lib.js'
import { pageAnim } from '../motion.js'

/* The camp, in time. Month / week / agenda views over permission-filtered
   layers (groups, meals, tasks, tickets, incidents, sign-outs, certs, events,
   birthdays) — plus each person's own Google/Outlook calendars overlaid via
   their secret iCal address. */

const STATUS_BAR = {
  tentative: '#C75B26', confirmed: '#357490', in_progress: '#30A059',
  completed: '#7C8780', cancelled: '#B2402E',
}

const LAYERS = [
  { key: 'bookings', label: 'Groups & bookings', color: '#357490', hint: 'Arrivals, departures, who’s on property' },
  { key: 'events', label: 'Camp events', color: '#1E5B45', hint: 'Staff events and all-camp moments' },
  { key: 'meals', label: 'Catering', color: '#B28426', hint: 'Meal services from the kitchen sheet' },
  { key: 'tasks', label: 'Tasks due', color: '#5B8A3C', hint: 'Board tasks with due dates' },
  { key: 'tickets', label: 'Facilities due', color: '#C75B26', hint: 'Ticket SLA / due dates' },
  { key: 'signout', label: 'Off property', color: '#2F6F6A', hint: 'Sign-outs and expected returns' },
  { key: 'incidents', label: 'Incidents', color: '#B2402E', hint: 'Safety log entries' },
  { key: 'certs', label: 'Cert expiries', color: '#7D5BA6', hint: 'Certifications running out' },
  { key: 'birthdays', label: 'Birthdays & annivs.', color: '#B2588C', hint: 'People worth celebrating' },
]
const layerMeta = key => LAYERS.find(l => l.key === key)

const monthAnchor = iso => `${iso.slice(0, 7)}-01`
const readLS = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb } catch { return fb } }

function chipColor(layer, ev, feedColor) {
  if (layer === 'bookings') return STATUS_BAR[ev.status] || '#7C8780'
  if (layer === 'feed') return feedColor || '#7D5BA6'
  if (layer === 'birthdays') return ev.color || '#B2588C'
  return layerMeta(layer)?.color || '#7C8780'
}

// ---- the page ---------------------------------------------------------------
export default function CalendarPage() {
  const { can, toast } = useApp()
  const navigate = useNavigate()
  const today = todayISO()

  const [view, setView] = useState(() => readLS('wos_cal_view', 'month'))
  const [anchor, setAnchor] = useState(() => todayISO())
  const [hidden, setHidden] = useState(() => new Set(readLS('wos_cal_hidden', [])))
  const [data, setData] = useState(null)
  const [weather, setWeather] = useState(null)
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState(null)            // { layer, ev, feed }
  const [selDay, setSelDay] = useState(null)      // ISO date
  const [panelOpen, setPanelOpen] = useState(false)
  const [evForm, setEvForm] = useState(null)      // { date } → create camp event
  const [taskForm, setTaskForm] = useState(null)  // { date } → quick task

  useEffect(() => { localStorage.setItem('wos_cal_view', JSON.stringify(view)) }, [view])
  useEffect(() => { localStorage.setItem('wos_cal_hidden', JSON.stringify([...hidden])) }, [hidden])

  // Visible range per view
  const range = useMemo(() => {
    if (view === 'month') {
      const first = monthAnchor(anchor)
      const gridStart = addDays(first, -((new Date(`${first}T12:00:00`).getDay() + 6) % 7))
      const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
      return { days, from: days[0], to: days[41], month: new Date(`${first}T12:00:00`).getMonth() }
    }
    if (view === 'week') {
      const ws = weekStart(anchor)
      const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
      return { days, from: ws, to: days[6] }
    }
    const days = Array.from({ length: 30 }, (_, i) => addDays(anchor, i))
    return { days, from: anchor, to: days[29] }
  }, [view, anchor])

  const label = useMemo(() => {
    if (view === 'month') return new Date(`${monthAnchor(anchor)}T12:00:00`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
    if (view === 'week') return `Week of ${fmtDate(range.from)}`
    return `${fmtDate(range.from)} – ${fmtDate(range.to)}`
  }, [view, anchor, range])

  function shift(n) {
    if (view === 'month') {
      const d = new Date(`${monthAnchor(anchor)}T12:00:00`)
      d.setMonth(d.getMonth() + n)
      setAnchor(todayISO(d))
    } else setAnchor(addDays(anchor, n * (view === 'week' ? 7 : 30)))
  }

  const reload = () => api.get(`/calendar?from=${range.from}&to=${range.to}`).then(setData).catch(e => { setData({ layers: {} }); toast(e.message, 'error') })
  useEffect(() => { setData(null); reload() }, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/weather').then(setWeather).catch(() => {}) }, [])

  const weatherByDay = useMemo(() => {
    const m = new Map()
    for (const d of weather?.daily || []) m.set(d.date, d)
    return m
  }, [weather])

  // Layers present in the response (= permitted), in display order
  const presentLayers = useMemo(() => LAYERS.filter(l => data?.layers?.[l.key]), [data])
  const feeds = data?.layers?.feeds || []
  const needle = filter.trim().toLowerCase()
  const matches = ev => !needle || String(ev.title || '').toLowerCase().includes(needle)

  // day → entries  (spanning events land on every covered day)
  const byDay = useMemo(() => {
    const m = new Map()
    for (const d of range.days) m.set(d, [])
    const put = (d, entry) => { if (m.has(d)) m.get(d).push(entry) }
    const spread = (layer, ev, feed) => {
      if (!matches(ev)) return
      const start = ev.date, end = ev.end_date || ev.date
      for (let d = start < range.from ? range.from : start; d <= end && d <= range.to; d = addDays(d, 1)) {
        put(d, { layer, ev, feed, isStart: d === ev.date, isEnd: d === end })
      }
    }
    for (const l of presentLayers) {
      if (hidden.has(l.key)) continue
      for (const ev of data.layers[l.key]) spread(l.key, ev)
    }
    for (const f of feeds) {
      for (const ev of f.events || []) spread('feed', ev, f)
    }
    for (const list of m.values()) {
      list.sort((a, b) =>
        (a.ev.time ? 1 : 0) - (b.ev.time ? 1 : 0) ||
        String(a.ev.time || '').localeCompare(String(b.ev.time || '')) ||
        String(a.ev.title || '').localeCompare(String(b.ev.title || '')))
    }
    return m
  }, [data, presentLayers, feeds, hidden, range, needle]) // eslint-disable-line react-hooks/exhaustive-deps

  const layerCounts = useMemo(() => {
    const c = {}
    for (const l of presentLayers) c[l.key] = (data.layers[l.key] || []).length
    return c
  }, [data, presentLayers])

  const toggleLayer = key => setHidden(h => { const n = new Set(h); n.has(key) ? n.delete(key) : n.add(key); return n })

  const openDay = d => setSelDay(d)
  const openEvent = e => setSel(e)

  const panel = (
    <LayerPanel
      layers={presentLayers} counts={layerCounts} hidden={hidden} onToggle={toggleLayer}
      feeds={feeds} onFeedsChanged={reload} toast={toast}
    />
  )

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Operate" title="Calendar" sub="Camp, in time — every layer you can see, plus your own calendars."
        actions={
          <div className="flex items-center gap-1.5 flex-wrap">
            <Seg size="sm" value={view} onChange={setView}
              options={[{ v: 'month', label: 'Month' }, { v: 'week', label: 'Week' }, { v: 'agenda', label: 'Agenda' }]} />
            <IconBtn title="Previous" onClick={() => shift(-1)}><ChevronLeft size={17} /></IconBtn>
            <Btn variant="soft" size="sm" onClick={() => setAnchor(todayISO())}>Today</Btn>
            <IconBtn title="Next" onClick={() => shift(1)}><ChevronRight size={17} /></IconBtn>
            <div className="font-head font-bold text-[15px] text-ink ml-1 whitespace-nowrap">{label}</div>
          </div>
        } />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={filter} onChange={e => setFilter(e.target.value)} type="search"
          placeholder="Filter events…" className="input !w-[200px] sm:!w-[240px]" />
        {can('community.announce') && (
          <Btn size="sm" variant="soft" onClick={() => setEvForm({ date: today })}>
            <CalendarPlus size={15} /> Event
          </Btn>
        )}
        {can('tasks.edit') && (
          <Btn size="sm" variant="soft" onClick={() => setTaskForm({ date: today })}>
            <Plus size={15} /> Task
          </Btn>
        )}
        <Btn size="sm" variant="soft" className="xl:hidden ml-auto" onClick={() => setPanelOpen(true)}>
          <SlidersHorizontal size={15} /> Layers{feeds.length ? ` · ${feeds.length} cal` : ''}
        </Btn>
      </div>

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_290px] xl:gap-5 items-start">
        <div className="min-w-0">
          {data === null ? <div className="py-20 text-center"><Spinner size={28} /></div> : (
            <>
              {view === 'month' && (
                <MonthGrid range={range} byDay={byDay} today={today} weather={weatherByDay}
                  onDay={openDay} onEvent={openEvent} />
              )}
              {view === 'week' && (
                <WeekGrid range={range} byDay={byDay} today={today} weather={weatherByDay}
                  onDay={openDay} onEvent={openEvent} />
              )}
              {view === 'agenda' && (
                <AgendaList range={range} byDay={byDay} today={today} onEvent={openEvent} />
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 px-1">
                {presentLayers.filter(l => !hidden.has(l.key)).map(l => (
                  <span key={l.key} className="flex items-center gap-1.5 text-[11.5px] font-head font-semibold text-dim">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} /> {l.label}
                  </span>
                ))}
                {feeds.filter(f => f.events?.length).map(f => (
                  <span key={f.id} className="flex items-center gap-1.5 text-[11.5px] font-head font-semibold text-dim">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: f.color }} /> {f.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="hidden xl:block sticky top-4">{panel}</div>
      </div>

      {/* mobile layers sheet */}
      <Sheet open={panelOpen} onClose={() => setPanelOpen(false)} title="Layers & calendars" kicker="Calendar">
        {panel}
      </Sheet>

      <DaySheet
        day={selDay} onClose={() => setSelDay(null)} byDay={byDay} today={today}
        weather={selDay ? weatherByDay.get(selDay) : null}
        onEvent={e => { setSelDay(null); openEvent(e) }}
        onNewEvent={can('community.announce') ? d => { setSelDay(null); setEvForm({ date: d }) } : null}
        onNewTask={can('tasks.edit') ? d => { setSelDay(null); setTaskForm({ date: d }) } : null}
      />

      <EventSheet sel={sel} onClose={() => setSel(null)}
        onGo={link => { setSel(null); navigate(link) }} />

      <NewEventSheet form={evForm} onClose={() => setEvForm(null)}
        onSaved={() => { setEvForm(null); toast('Event added to the calendar'); reload() }} />

      <NewTaskSheet form={taskForm} onClose={() => setTaskForm(null)}
        onSaved={() => { setTaskForm(null); toast('Task created'); reload() }} />
    </motion.div>
  )
}

// ---- chips ------------------------------------------------------------------
function Chip({ entry, onClick, showTime = true }) {
  const { layer, ev, feed, isStart, isEnd } = entry
  const color = chipColor(layer, ev, feed?.color)
  const spans = (ev.end_date || ev.date) !== ev.date
  return (
    <button onClick={onClick}
      className={cx('w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md bg-sunken/80 hover:bg-sunken transition group text-left',
        spans && !isStart && 'opacity-75')}>
      <span className="w-1 h-3.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-[11px] font-semibold text-ink truncate group-hover:text-brand min-w-0">
        {ev.emoji ? `${ev.emoji} ` : ''}
        {showTime && ev.time && isStart ? <span className="text-dim tnum">{ev.time} </span> : null}
        {spans && !isStart ? '… ' : ''}{ev.title}
      </span>
      {ev.done && <span className="text-[10px] shrink-0">✓</span>}
      {(ev.overdue || ev.expired) && <AlertTriangle size={11} className="text-danger shrink-0" />}
    </button>
  )
}

function WeatherMini({ w }) {
  if (!w) return null
  return (
    <span className="text-[10px] text-faint whitespace-nowrap" title={`${w.label} · ${w.min}–${w.max}°`}>
      {w.icon} <span className="tnum">{w.max}°</span>
    </span>
  )
}

// ---- month ------------------------------------------------------------------
function MonthGrid({ range, byDay, today, weather, onDay, onEvent }) {
  return (
    <>
      <Card className="hidden md:block overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="kicker text-dim text-center py-2.5">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {range.days.map((d, i) => {
            const inMonth = new Date(`${d}T12:00:00`).getMonth() === range.month
            const list = byDay.get(d) || []
            return (
              <div key={d}
                className={cx('min-h-[104px] p-1.5 border-b border-r border-line/50 [&:nth-child(7n)]:border-r-0 cursor-pointer hover:bg-sunken/30 transition-colors',
                  i >= 35 && 'border-b-0', !inMonth && 'bg-sunken/40')}
                onClick={() => onDay(d)}>
                <div className="flex items-center justify-between mb-1">
                  <span className={cx('text-[11.5px] font-head font-bold w-6 h-6 flex items-center justify-center rounded-full tnum',
                    d === today ? 'bg-green text-[#16321c]' : inMonth ? 'text-ink' : 'text-faint')}>
                    {Number(d.slice(8))}
                  </span>
                  <WeatherMini w={weather.get(d)} />
                </div>
                <div className="space-y-1" onClick={e => e.stopPropagation()}>
                  {list.slice(0, 4).map((entry, j) => (
                    <Chip key={j} entry={entry} onClick={() => onEvent(entry)} />
                  ))}
                  {list.length > 4 && (
                    <button className="text-[10.5px] text-faint pl-1.5 hover:text-brand" onClick={() => onDay(d)}>
                      +{list.length - 4} more
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* mobile: agenda of the month's busy days */}
      <div className="md:hidden">
        <AgendaList range={{ days: range.days.filter(d => new Date(`${d}T12:00:00`).getMonth() === range.month) }}
          byDay={byDay} today={today} onEvent={onEvent} />
      </div>
    </>
  )
}

// ---- week -------------------------------------------------------------------
function WeekGrid({ range, byDay, today, weather, onDay, onEvent }) {
  return (
    <>
      <Card className="hidden md:block overflow-hidden">
        <div className="grid grid-cols-7">
          {range.days.map((d, i) => {
            const list = byDay.get(d) || []
            return (
              <div key={d} className={cx('border-r border-line/50 last:border-r-0 min-h-[340px] flex flex-col', d === today && 'bg-green/[0.05]')}>
                <button onClick={() => onDay(d)}
                  className={cx('px-2 py-2 border-b border-line text-left hover:bg-sunken/40 transition-colors', d === today && 'bg-green/10')}>
                  <div className="kicker !text-[10px] text-dim">{new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short' })}</div>
                  <div className="flex items-center justify-between">
                    <span className={cx('font-head font-bold text-[15px] tnum', d === today ? 'text-green-dark' : 'text-ink')}>{Number(d.slice(8))}</span>
                    <WeatherMini w={weather.get(d)} />
                  </div>
                </button>
                <div className="p-1.5 space-y-1 overflow-y-auto max-h-[420px]">
                  {list.map((entry, j) => <Chip key={j} entry={entry} onClick={() => onEvent(entry)} />)}
                  {!list.length && <div className="text-[11px] text-faint text-center pt-6">—</div>}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
      <div className="md:hidden">
        <AgendaList range={range} byDay={byDay} today={today} onEvent={onEvent} showEmpty />
      </div>
    </>
  )
}

// ---- agenda -----------------------------------------------------------------
function AgendaList({ range, byDay, today, onEvent, showEmpty = false }) {
  const days = range.days.filter(d => showEmpty || (byDay.get(d) || []).length)
  if (!days.length) {
    return <EmptyState icon="🗓️" title="Nothing on the calendar here"
      body="Try another stretch of time, switch some layers on, or add your own calendar from the panel." />
  }
  return (
    <div className="space-y-2.5">
      {days.map(d => {
        const list = byDay.get(d) || []
        return (
          <Card key={d} className="p-3.5">
            <div className={cx('kicker mb-2', d === today ? '!text-green-dark' : '!text-dim')}>
              {fmtDateLong(d)}{d === today && ' · today'}
            </div>
            {list.length ? (
              <div className="space-y-1.5">
                {list.map((entry, j) => {
                  const { layer, ev, feed } = entry
                  const meta = layer === 'feed' ? { label: feed?.name } : layerMeta(layer)
                  return (
                    <button key={j} onClick={() => onEvent(entry)} className="w-full flex items-center gap-3 text-left group">
                      <span className="w-1.5 h-9 rounded-full shrink-0" style={{ background: chipColor(layer, ev, feed?.color) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-head font-bold text-[13.5px] text-ink truncate group-hover:text-brand">
                          {ev.emoji ? `${ev.emoji} ` : ''}{ev.title}
                        </span>
                        <span className="block text-[12px] text-dim truncate">
                          {ev.time ? `${ev.time}${ev.end_time ? `–${ev.end_time}` : ''} · ` : ''}
                          {ev.end_date && ev.end_date !== ev.date ? `${fmtRange(ev.date, ev.end_date)} · ` : ''}
                          {meta?.label}{ev.location ? ` · ${ev.location}` : ''}{ev.destination ? ` · ${ev.destination}` : ''}
                        </span>
                      </span>
                      {ev.status && <Badge className="bg-sunken text-dim hidden sm:inline-flex">{String(ev.status).replace('_', ' ')}</Badge>}
                    </button>
                  )
                })}
              </div>
            ) : <div className="text-[12px] text-faint">Nothing scheduled.</div>}
          </Card>
        )
      })}
    </div>
  )
}

// ---- side panel: layers + my calendars ---------------------------------------
function LayerPanel({ layers, counts, hidden, onToggle, feeds, onFeedsChanged, toast }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState(SWATCHES.plum)
  const [busy, setBusy] = useState(false)
  const [busyFeed, setBusyFeed] = useState(null)
  const [help, setHelp] = useState(false)

  async function addFeed() {
    if (!name.trim() || !url.trim()) return toast('Name and URL are both needed', 'error')
    setBusy(true)
    try {
      await api.post('/calendar/feeds', { name, url, color })
      setName(''); setUrl(''); setAdding(false)
      toast('Calendar connected')
      onFeedsChanged()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  async function patchFeed(id, body) {
    setBusyFeed(id)
    try { await api.patch(`/calendar/feeds/${id}`, body); onFeedsChanged() }
    catch (e) { toast(e.message, 'error') } finally { setBusyFeed(null) }
  }
  async function refreshFeed(id) {
    setBusyFeed(id)
    try {
      const r = await api.post(`/calendar/feeds/${id}/refresh`)
      toast(r.fetch_status === 'ok' ? `Synced — ${r.cached_events} events` : r.fetch_status, r.fetch_status === 'ok' ? 'ok' : 'error')
      onFeedsChanged()
    } catch (e) { toast(e.message, 'error') } finally { setBusyFeed(null) }
  }
  async function deleteFeed(id) {
    try { await api.del(`/calendar/feeds/${id}`); toast('Calendar removed'); onFeedsChanged() }
    catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="kicker text-dim mb-2.5">Layers</div>
        <div className="space-y-2">
          {layers.map(l => (
            <div key={l.key} className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-head font-semibold text-ink leading-tight">{l.label}</span>
                <span className="block text-[10.5px] text-faint truncate">{l.hint}</span>
              </span>
              <span className="text-[11px] text-faint tnum">{counts[l.key] ?? 0}</span>
              <Toggle on={!hidden.has(l.key)} onChange={() => onToggle(l.key)} label={l.label} />
            </div>
          ))}
          {!layers.length && <div className="text-[12px] text-faint">No shared layers — your role doesn’t include any yet.</div>}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="kicker text-dim flex items-center gap-1.5"><Globe size={12} /> My calendars</div>
          <IconBtn title="How do I get my Google Calendar link?" onClick={() => setHelp(h => !h)}>
            <HelpCircle size={15} />
          </IconBtn>
        </div>

        {help && (
          <div className="rounded-xl bg-sunken px-3 py-2.5 text-[11.5px] text-dim leading-relaxed mb-3">
            <b className="text-ink">Google Calendar:</b> on a computer, open <b className="text-ink">Settings → your calendar →
            Integrate calendar</b> and copy the <b className="text-ink">“Secret address in iCal format”</b> (.ics link).
            <br /><b className="text-ink">Outlook:</b> Settings → Calendar → Shared calendars → Publish → copy the ICS link.
            <br />The link stays private to your account; events refresh about every 15 minutes. Times show in camp time.
          </div>
        )}

        <div className="space-y-2.5">
          {feeds.map(f => (
            <div key={f.id} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: f.color }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-head font-semibold text-ink leading-tight truncate">{f.name}</span>
                <span className={cx('block text-[10.5px] truncate', f.status && f.status !== 'ok' ? 'text-danger' : 'text-faint')}>
                  {f.status && f.status !== 'ok' ? f.status : `${f.events?.length ?? 0} events in view`}
                </span>
              </span>
              {f.status && f.status !== 'ok' && <AlertTriangle size={13} className="text-danger shrink-0" />}
              <IconBtn title="Sync now" className="!p-1.5" onClick={() => refreshFeed(f.id)}>
                <RefreshCw size={13} className={busyFeed === f.id ? 'animate-spin' : ''} />
              </IconBtn>
              <ConfirmBtn label="Remove?" onConfirm={() => deleteFeed(f.id)} className="!p-1.5 !px-2">
                <Trash2 size={13} />
              </ConfirmBtn>
            </div>
          ))}
          {!feeds.length && !adding && (
            <div className="text-[12px] text-faint">Overlay your own Google / Outlook / Apple calendar — it’s only visible to you.</div>
          )}
        </div>

        {adding ? (
          <div className="mt-3 space-y-2.5">
            <Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="My Google Calendar" /></Field>
            <Field label="iCal address (.ics)">
              <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
            </Field>
            <div className="flex items-center gap-1.5 flex-wrap">
              {Object.values(SWATCHES).map(c => (
                <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`}
                  className={cx('w-6 h-6 rounded-full ring-focus transition', color === c && 'ring-2 ring-offset-2 ring-brand')}
                  style={{ background: c }} />
              ))}
            </div>
            <div className="flex gap-2">
              <Btn size="sm" onClick={addFeed} disabled={busy}>{busy ? 'Checking feed…' : 'Connect'}</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <Btn size="sm" variant="soft" className="mt-3 w-full" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add calendar
          </Btn>
        )}
      </Card>
    </div>
  )
}

// ---- day drawer ---------------------------------------------------------------
function DaySheet({ day, onClose, byDay, today, weather, onEvent, onNewEvent, onNewTask }) {
  const list = day ? byDay.get(day) || [] : []
  return (
    <Sheet open={!!day} onClose={onClose} kicker={day === today ? 'Today' : 'Day'}
      title={day ? fmtDateLong(day) : ''}
      footer={(onNewEvent || onNewTask) && day ? (
        <>
          {onNewTask && <Btn size="sm" variant="soft" onClick={() => onNewTask(day)}><Plus size={14} /> Task due this day</Btn>}
          {onNewEvent && <Btn size="sm" onClick={() => onNewEvent(day)}><CalendarPlus size={14} /> Camp event</Btn>}
        </>
      ) : null}>
      {weather && (
        <div className="rounded-xl bg-sunken px-3.5 py-2.5 mb-3 text-[12.5px] text-dim flex items-center gap-2">
          <span className="text-[18px]">{weather.icon}</span>
          <span><b className="text-ink">{weather.label}</b> · {weather.min}° to {weather.max}°{weather.precip != null ? ` · ${weather.precip}% precip` : ''}</span>
        </div>
      )}
      {list.length ? (
        <div className="space-y-1.5">
          {list.map((entry, j) => {
            const { layer, ev, feed } = entry
            const meta = layer === 'feed' ? { label: feed?.name } : layerMeta(layer)
            return (
              <button key={j} onClick={() => onEvent(entry)} className="w-full flex items-center gap-3 text-left group py-1">
                <span className="w-1.5 h-9 rounded-full shrink-0" style={{ background: chipColor(layer, ev, feed?.color) }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-head font-bold text-[13.5px] text-ink truncate group-hover:text-brand">
                    {ev.emoji ? `${ev.emoji} ` : ''}{ev.title}
                  </span>
                  <span className="block text-[12px] text-dim truncate">
                    {ev.time ? `${ev.time}${ev.end_time ? `–${ev.end_time}` : ''} · ` : ''}{meta?.label}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : <EmptyState icon="🌤️" title="A clear day" body="Nothing scheduled on the layers you have switched on." />}
    </Sheet>
  )
}

// ---- event drawer ---------------------------------------------------------------
function Row({ k, children }) {
  if (children == null || children === '') return null
  return (
    <div className="flex gap-3 py-1.5 border-b border-line/50 last:border-0">
      <span className="kicker !text-[10px] text-faint w-24 shrink-0 pt-0.5">{k}</span>
      <span className="text-[13px] text-ink min-w-0">{children}</span>
    </div>
  )
}

function EventSheet({ sel, onClose, onGo }) {
  if (!sel) return <Sheet open={false} onClose={onClose} title="" />
  const { layer, ev, feed } = sel
  const meta = layer === 'feed' ? { label: feed?.name || 'My calendar' } : layerMeta(layer)
  const s = ev.status ? bookingStatus(ev.status) : null
  return (
    <Sheet open onClose={onClose} kicker={meta?.label} title={`${ev.emoji ? `${ev.emoji} ` : ''}${ev.title}`}
      footer={ev.link ? (
        <Btn size="sm" onClick={() => onGo(ev.link)}>
          <ExternalLink size={14} /> Open in WoodsOS
        </Btn>
      ) : null}>
      <div>
        <Row k="When">
          {ev.end_date && ev.end_date !== ev.date ? fmtRange(ev.date, ev.end_date) : fmtDateLong(ev.date)}
          {ev.time ? ` · ${ev.time}${ev.end_time ? `–${ev.end_time}` : ''}` : ''}
        </Row>
        {layer === 'bookings' && (
          <>
            <Row k="Status"><Badge className={s.cls}>{s.label}</Badge></Row>
            <Row k="Guests">{ev.headcount ? `${ev.headcount} people` : null}</Row>
            <Row k="Customer">{ev.customer}</Row>
            <Row k="Code">{ev.code}</Row>
          </>
        )}
        {layer === 'meals' && (
          <>
            <Row k="Covers">{ev.headcount}</Row>
            <Row k="Menu">{ev.menu}</Row>
            <Row k="Dietary">{ev.dietary}</Row>
            <Row k="Where">{ev.location}</Row>
          </>
        )}
        {layer === 'tasks' && (
          <>
            <Row k="Status">{ev.done ? '✓ Done' : ev.status}</Row>
            <Row k="Priority">{ev.priority != null ? priority(ev.priority).label : null}</Row>
            <Row k="Assigned">{ev.assignees}</Row>
          </>
        )}
        {layer === 'tickets' && (
          <>
            <Row k="Status">{String(ev.status || '').replace('_', ' ')}</Row>
            <Row k="Priority">{ev.priority != null ? priority(ev.priority).label : null}</Row>
            <Row k="Where">{ev.location}</Row>
            <Row k="Assigned">{ev.assignee}</Row>
            <Row k="Code">{ev.code}</Row>
          </>
        )}
        {layer === 'incidents' && (
          <>
            <Row k="Severity">{ev.severity ? <Badge className={severity(ev.severity).cls}>{severity(ev.severity).label}</Badge> : null}</Row>
            <Row k="Type">{ev.type}</Row>
            <Row k="Status">{ev.status}</Row>
            <Row k="Code">{ev.code}</Row>
          </>
        )}
        {layer === 'signout' && (
          <>
            <Row k="Destination">{ev.destination}</Row>
            <Row k="Back">{ev.expected_return ? new Date(ev.expected_return).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : 'no ETA given'}</Row>
            {ev.overdue && <Row k="⚠"><span className="text-danger font-semibold">Overdue</span></Row>}
          </>
        )}
        {layer === 'certs' && (
          <Row k="Note"><span className={ev.expired ? 'text-danger font-semibold' : ''}>{ev.expired ? 'Expired' : 'Expires this day'}</span></Row>
        )}
        {layer === 'feed' && (
          <>
            <Row k="Where">{ev.location}</Row>
            <Row k="Details">{ev.descr}</Row>
            <Row k="Calendar">{feed?.name}</Row>
          </>
        )}
        {layer === 'events' && (
          <>
            <Row k="Where">{ev.location}</Row>
            <Row k="Details">{ev.descr}</Row>
          </>
        )}
      </div>
    </Sheet>
  )
}

// ---- quick create: camp event ----------------------------------------------
function NewEventSheet({ form, onClose, onSaved }) {
  const [f, setF] = useState({ title: '', date: '', end_date: '', location: '', emoji: '🌲', descr: '' })
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()
  useEffect(() => { if (form) setF(x => ({ ...x, title: '', date: form.date, end_date: '' })) }, [form])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  async function save() {
    if (!f.title.trim() || !f.date) return toast('Title and date are needed', 'error')
    setBusy(true)
    try { await api.post('/calendar/events', { ...f, end_date: f.end_date || null }); onSaved() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Sheet open={!!form} onClose={onClose} title="New camp event" kicker="Calendar"
      footer={<><Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add event'}</Btn></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-[64px_1fr] gap-2.5">
          <Field label="Emoji">
            <Select value={f.emoji} onChange={v => set('emoji', v)}>
              {['🌲', '🎉', '🛶', '🏕️', '🍔', '🎓', '🧰', '⛪', '🏀', '🎬'].map(e => <option key={e} value={e}>{e}</option>)}
            </Select>
          </Field>
          <Field label="Event"><input className="input" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Staff BBQ at the Point" autoFocus /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Date"><input type="date" className="input" value={f.date} onChange={e => set('date', e.target.value)} /></Field>
          <Field label="Ends (optional)"><input type="date" className="input" value={f.end_date} onChange={e => set('end_date', e.target.value)} /></Field>
        </div>
        <Field label="Location"><input className="input" value={f.location} onChange={e => set('location', e.target.value)} placeholder="The Point" /></Field>
        <Field label="Details"><textarea className="input min-h-[70px]" value={f.descr} onChange={e => set('descr', e.target.value)} /></Field>
        <p className="text-[11.5px] text-faint">Camp events show here and on the Community board for everyone with Community access.</p>
      </div>
    </Sheet>
  )
}

// ---- quick create: task -------------------------------------------------------
function NewTaskSheet({ form, onClose, onSaved }) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()
  useEffect(() => { if (form) { setTitle(''); setDue(form.date) } }, [form])
  async function save() {
    if (!title.trim()) return toast('Give the task a title', 'error')
    setBusy(true)
    try { await api.post('/tasks', { title, due: due || null }); onSaved() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Sheet open={!!form} onClose={onClose} title="Quick task" kicker="Tasks"
      footer={<><Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Create task'}</Btn></>}>
      <div className="space-y-3">
        <Field label="Task"><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Flip Maple Lodge before Friday" autoFocus /></Field>
        <Field label="Due"><input type="date" className="input" value={due} onChange={e => setDue(e.target.value)} /></Field>
        <p className="text-[11.5px] text-faint">Lands in the first column of the board — open Tasks to add details, assignees, or a checklist.</p>
      </div>
    </Sheet>
  )
}
