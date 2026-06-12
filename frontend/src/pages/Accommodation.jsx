import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Link2, BedDouble, Sparkles as SparkleIcon } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Btn, IconBtn, Kicker, PageLoader, Sheet, Field, Select, Seg, Badge, EmptyState } from '../components/ui.jsx'
import { cx, todayISO, addDays, weekStart, fmtDate, fmtDateLong, fmtDow } from '../lib.js'
import { pageAnim } from '../motion.js'

const GROUP_COLORS = ['#1E5A64', '#1F6331', '#C26628', '#1B5470', '#1087A3', '#30A059', '#7D5BA6', '#8A5A3B']
const colorFor = id => GROUP_COLORS[id % GROUP_COLORS.length]

function AddBlock({ open, onClose, lodge, day, onSaved }) {
  const { toast } = useApp()
  const [bookings, setBookings] = useState([])
  const [f, setF] = useState({ booking_id: '', date_from: day, date_to: addDays(day, 2) })
  useEffect(() => {
    if (!open) return
    setF({ booking_id: '', date_from: day, date_to: addDays(day, 2) })
    api.get('/bookings?when=upcoming').then(setBookings).catch(() => {})
  }, [open]) // eslint-disable-line
  async function save() {
    try {
      const r = await api.post('/accommodation/block', { ...f, booking_id: Number(f.booking_id), location_id: lodge.id })
      toast(r.warning || `${lodge.name} blocked`)
      onSaved(); onClose()
    } catch (e) { toast(e.message, 'err') }
  }
  return (
    <Sheet open={open} onClose={onClose} kicker={lodge?.name} title="Block for a group"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={!f.booking_id}>Block</Btn></>}>
      <div className="space-y-4">
        <Field label="Group">
          <Select value={f.booking_id} onChange={v => setF(s => ({ ...s, booking_id: v }))}>
            <option value="">Choose…</option>
            {bookings.map(b => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className="input" value={f.date_from} onChange={e => setF(s => ({ ...s, date_from: e.target.value }))} /></Field>
          <Field label="To"><input type="date" className="input" value={f.date_to} onChange={e => setF(s => ({ ...s, date_to: e.target.value }))} /></Field>
        </div>
      </div>
    </Sheet>
  )
}

export default function Accommodation() {
  const { can, toast, settings } = useApp()
  const nav = useNavigate()
  const [view, setView] = useState('grid')
  const [start, setStart] = useState(weekStart())
  const [data, setData] = useState(null)
  const [add, setAdd] = useState(null) // {lodge, day}
  const [boardLink, setBoardLink] = useState(null)
  const today = todayISO()

  const load = () => api.get(`/accommodation?start=${start}`).then(setData).catch(e => { toast(e.message, 'err') })
  useEffect(() => { setData(null); load() }, [start]) // eslint-disable-line
  useEffect(() => { api.get('/admin/links').then(l => setBoardLink(l.board)).catch(() => {}) }, [])

  const conditions = settings.locations_meta?.conditions || []
  const condMeta = key => conditions.find(c => c.key === key)

  function copyLink() {
    const url = `${location.origin}${boardLink}`
    navigator.clipboard?.writeText(url).then(() => toast('Public board link copied 📋')).catch(() => toast(url))
  }

  if (view === 'housekeeping') {
    return (
      <motion.div {...pageAnim}>
        <PageHead kicker="Operate" title="Accommodation" sub="The turnover board — what flips today, what isn't ready."
          actions={<Seg value={view} onChange={setView} options={[
            { v: 'grid', label: 'Grid' }, { v: 'housekeeping', label: '🧹 Housekeeping' },
          ]} />} />
        <HousekeepingBoard conditions={conditions} />
      </motion.div>
    )
  }

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Operate" title="Accommodation" sub="Who sleeps where, one week at a time."
        actions={
          <div className="flex items-center gap-1.5 flex-wrap">
            {can('housekeeping.board') && (
              <Seg value={view} onChange={setView} options={[
                { v: 'grid', label: 'Grid' }, { v: 'housekeeping', label: '🧹 Housekeeping' },
              ]} />
            )}
            {boardLink && <Btn variant="outline" size="sm" onClick={copyLink}><Link2 size={14} /> Who’s On link</Btn>}
            <IconBtn title="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={17} /></IconBtn>
            <Btn variant="soft" size="sm" onClick={() => setStart(weekStart())}>This week</Btn>
            <IconBtn title="Next week" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={17} /></IconBtn>
          </div>
        } />

      {!data ? <PageLoader /> : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-[12.5px] text-dim font-head font-semibold">
            <span className="inline-flex items-center gap-1.5"><BedDouble size={13} className="text-faint" />{data.totals.beds} beds on the grid</span>
            <span>{data.totals.groups} group{data.totals.groups === 1 ? '' : 's'} this week</span>
            <span className="tnum">{fmtDate(data.days[0])} – {fmtDate(data.days[6])}</span>
          </div>

          <Card className="overflow-x-auto scroll-x">
            <div className="min-w-[860px]">
              {/* header row */}
              <div className="grid border-b-2 border-line" style={{ gridTemplateColumns: '180px repeat(7, 1fr)' }}>
                <div className="px-3.5 py-2.5 kicker text-dim sticky left-0 bg-surface z-10">Lodge</div>
                {data.days.map(d => (
                  <div key={d} className={cx('px-2 py-2.5 text-center', d === today && 'bg-green/10 rounded-t-lg')}>
                    <div className="kicker !tracking-[0.14em] text-dim">{fmtDow(d)}</div>
                    <div className={cx('text-[13px] font-head font-bold tnum', d === today ? 'text-green-dark' : 'text-ink')}>{fmtDate(d)}</div>
                  </div>
                ))}
              </div>

              {data.rows.map(row => {
                const cm = condMeta(row.condition)
                return (
                  <div key={row.id} className="grid border-b border-line/50 last:border-0 group/row"
                    style={{ gridTemplateColumns: '180px repeat(7, 1fr)' }}>
                    <div className="px-3.5 py-2 sticky left-0 bg-surface z-10 flex items-center gap-2 min-w-0">
                      <span className={cx('w-2 h-2 rounded-full shrink-0',
                        row.condition === 'clean' ? 'bg-summer' : cm?.blocking ? 'bg-danger' : 'bg-ember')}
                        title={cm?.label || row.condition} />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-head font-bold text-ink truncate">{row.name}</span>
                        <span className="block text-[10.5px] text-faint">{row.beds ? `${row.beds} beds` : row.zone}</span>
                      </span>
                    </div>
                    {data.days.map(d => {
                      const block = row.blocks.find(b => b.date_from <= d && b.date_to >= d)
                      if (!block) {
                        return (
                          <button key={d} disabled={!can('accommodation.edit')}
                            onClick={() => setAdd({ lodge: row, day: d })}
                            className={cx('h-[46px] border-l border-line/40 transition',
                              d === today && 'bg-green/[0.06]',
                              can('accommodation.edit') && 'hover:bg-accent/10 cursor-pointer')} />
                        )
                      }
                      const isStart = block.date_from === d || d === data.days[0]
                      const isEnd = block.date_to === d || d === data.days[6]
                      return (
                        <div key={d} className={cx('h-[46px] border-l border-line/40 py-1.5', d === today && 'bg-green/[0.06]')}>
                          <motion.button
                            initial={{ opacity: 0, scaleX: 0.85 }} animate={{ opacity: 1, scaleX: 1 }}
                            onClick={() => nav(`/bookings/${block.booking_id}`)}
                            title={`${block.name} (${block.code})`}
                            className={cx('w-full h-full flex items-center text-left overflow-hidden',
                              isStart ? 'rounded-l-lg pl-2 ml-0.5' : '-ml-px',
                              isEnd ? 'rounded-r-lg mr-0.5' : '')}
                            style={{ background: colorFor(block.booking_id), opacity: block.status === 'tentative' ? 0.55 : 0.92 }}>
                            {isStart && (
                              <span className="text-[10.5px] font-head font-bold text-white truncate screen-shadow">
                                {block.name}
                              </span>
                            )}
                          </motion.button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </Card>

          <div className="mt-3 text-[11.5px] text-faint">
            Solid bars are confirmed or on-site; faded bars are tentative. {can('accommodation.edit') ? 'Click an empty cell to block a lodge.' : ''}
          </div>
        </>
      )}

      <AddBlock open={!!add} onClose={() => setAdd(null)} lodge={add?.lodge} day={add?.day} onSaved={load} />
    </motion.div>
  )
}

/* ---- Housekeeping turnover board (the ALICE/Quore room-status pattern) ---- */
function HousekeepingBoard({ conditions }) {
  const { can, toast } = useApp()
  const [date, setDate] = useState(todayISO())
  const [hk, setHk] = useState(null)

  const load = () => api.get(`/accommodation/housekeeping?date=${date}`).then(setHk).catch(e => toast(e.message, 'err'))
  useEffect(() => { setHk(null); load() }, [date]) // eslint-disable-line

  async function setCondition(unit, condition) {
    try {
      await api.patch(`/locations/${unit.id}`, { condition })
      toast(`${unit.name} → ${conditions.find(c => c.key === condition)?.label || condition}`)
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  if (!hk) return <PageLoader />
  const turnovers = hk.units.filter(u => u.needs_turnover)
  const arrivalsOnly = hk.units.filter(u => u.arriving && !u.needs_turnover)
  const notReady = hk.units.filter(u => !u.needs_turnover && !u.arriving && u.condition !== 'clean')
  const canEdit = can('locations.edit')

  const UnitCard = ({ u, accent }) => (
    <Card className={cx('p-4', accent && `border-l-4 ${accent}`)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-head font-bold text-[14px] text-ink">{u.name}</div>
          <div className="text-[11.5px] text-dim">{u.zone}{u.beds ? ` · ${u.beds} beds` : ''}</div>
        </div>
        {u.same_day_flip && <Badge className="bg-danger/12 text-danger">same-day flip</Badge>}
      </div>
      <div className="mt-2 space-y-1 text-[12.5px]">
        {u.leaving && <div className="text-dim">↘ <span className="font-head font-semibold text-ink">{u.leaving.name}</span> checks out</div>}
        {u.arriving && <div className="text-dim">↗ <span className="font-head font-semibold text-ink">{u.arriving.name}</span> arrives ({u.arriving.headcount} ppl)</div>}
        {u.staying && !u.leaving && !u.arriving && <div className="text-faint">{u.staying.name} staying over</div>}
      </div>
      {u.condition_note && <div className="text-[11.5px] text-faint italic mt-1.5">“{u.condition_note}”</div>}
      <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-line/60">
        {conditions.map(c => (
          <button key={c.key} disabled={!canEdit} onClick={() => setCondition(u, c.key)}
            className={cx('px-2.5 py-1 rounded-full text-[11px] font-head font-bold transition',
              u.condition === c.key
                ? (c.key === 'clean' ? 'bg-summer text-white' : c.blocking ? 'bg-danger text-white' : 'bg-ember text-white')
                : 'bg-sunken text-dim hover:text-ink',
              !canEdit && 'pointer-events-none opacity-70')}>
            {c.label}
          </button>
        ))}
      </div>
    </Card>
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-1.5">
          <IconBtn title="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={17} /></IconBtn>
          <Btn variant="soft" size="sm" onClick={() => setDate(todayISO())}>Today</Btn>
          <IconBtn title="Next day" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={17} /></IconBtn>
        </div>
        <span className="font-head font-bold text-[14px] text-ink">{fmtDateLong(date)}</span>
        <div className="flex gap-4 ml-auto text-[12px] font-head font-bold">
          <span className="text-ember">{hk.summary.turnovers} turnover{hk.summary.turnovers === 1 ? '' : 's'}</span>
          <span className="text-danger">{hk.summary.same_day} same-day</span>
          <span className="text-lake">{hk.summary.arrivals} arrival{hk.summary.arrivals === 1 ? '' : 's'}</span>
          <span className="text-dim">{hk.summary.not_ready} not ready</span>
        </div>
      </div>

      {turnovers.length === 0 && arrivalsOnly.length === 0 && notReady.length === 0 ? (
        <Card><EmptyState icon="🧹" title="Nothing to flip" body="No checkouts, no arrivals, every room ready. Coffee time." /></Card>
      ) : (
        <div className="space-y-6">
          {turnovers.length > 0 && (
            <div>
              <Kicker className="!text-ember mb-2.5">Turnovers — {fmtDate(date)}</Kicker>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {turnovers.map(u => <UnitCard key={u.id} u={u} accent="border-l-ember" />)}
              </div>
            </div>
          )}
          {arrivalsOnly.length > 0 && (
            <div>
              <Kicker className="!text-lake mb-2.5">Arrivals into ready rooms</Kicker>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {arrivalsOnly.map(u => <UnitCard key={u.id} u={u} accent="border-l-lake" />)}
              </div>
            </div>
          )}
          {notReady.length > 0 && (
            <div>
              <Kicker className="!text-dim mb-2.5">Needs attention (no movement today)</Kicker>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {notReady.map(u => <UnitCard key={u.id} u={u} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
