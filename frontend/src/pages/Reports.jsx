import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Timer, CheckCircle2, AlertTriangle, Star, Gauge, CalendarClock, Tent, HandCoins } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Kicker, PageLoader, Tabs, Badge, Avatar, StatTile, EmptyState, Btn, Sheet, Toggle } from '../components/ui.jsx'
import { Bars, HBars, Donut, Ring, Lines, Heat } from '../components/charts.jsx'
import { cx, fmtDate, swatch, ticketStatus, money, leadStage, ago, severity, incidentType } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

const TICKET_COLORS = { open: '#357490', in_progress: '#30A059', on_hold: '#C26628', closed: '#7C8780' }
const Grid = ({ children, cols = 'md:grid-cols-2' }) => (
  <motion.div variants={stagger(0.05)} initial="initial" animate="animate" className={cx('grid gap-4', cols)}>{children}</motion.div>
)
const Panel = ({ title, children, span }) => (
  <motion.div variants={rise} className={span}>
    <Card className="p-5 h-full">
      <Kicker className="!text-dim mb-4">{title}</Kicker>
      {children}
    </Card>
  </motion.div>
)

export default function Insights() {
  const { can } = useApp()
  const anyMetric = ['bookings', 'facilities', 'tasks', 'people', 'signout', 'shopping', 'gear', 'budgets', 'safety']
    .some(k => can(`metrics.${k}`))
  const tabs = [
    anyMetric && { v: 'my', label: '✦ My Dashboard' },
    can('reports.view') && { v: 'overview', label: 'Overview' },
    can('metrics.bookings') && { v: 'bookings', label: 'Bookings' },
    can('metrics.facilities') && { v: 'facilities', label: 'Facilities' },
    can('metrics.tasks') && { v: 'tasks', label: 'Tasks' },
    can('metrics.people') && { v: 'people', label: 'People' },
    can('metrics.signout') && { v: 'signout', label: 'Sign-out' },
    can('metrics.shopping') && { v: 'shopping', label: 'Shopping' },
    can('metrics.gear') && { v: 'gear', label: 'Gear' },
    can('metrics.budgets') && { v: 'budgets', label: 'Budgets' },
    can('metrics.safety') && { v: 'safety', label: 'Safety' },
  ].filter(Boolean)
  const [tab, setTab] = useState(tabs[0]?.v)

  if (!tabs.length) return <EmptyState icon="🔒" title="No metrics for you yet" body="Ask an admin to grant a metrics permission." />

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Insight" title="Insights" sub="Every module, measured — each tab is its own permission." />
      {tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs} className="mb-6" />}
      {tab === 'my' && <MyDashboard />}
      {tab === 'overview' && <Overview />}
      {tab === 'bookings' && <BookingsTab />}
      {tab === 'facilities' && <FacilitiesTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'signout' && <SignoutTab />}
      {tab === 'shopping' && <ShoppingTab />}
      {tab === 'gear' && <GearTab />}
      {tab === 'budgets' && <BudgetsMetricsTab />}
      {tab === 'safety' && <SafetyTab />}
    </motion.div>
  )
}

function useMetrics(path) {
  const { toast } = useApp()
  const [d, setD] = useState(null)
  useEffect(() => { api.get(path).then(setD).catch(e => toast(e.message, 'err')) }, [path]) // eslint-disable-line
  return d
}

/* ---------------- overview (the original cross-module snapshot) ---------------- */
function Overview() {
  const { settings } = useApp()
  const d = useMetrics('/reports/summary')
  if (!d) return <PageLoader />
  const monthLabel = m => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-CA', { month: 'short' })
  const valueLabels = Object.fromEntries((settings.org?.values || []).map(v => [v.key, `${v.emoji} ${v.name}`]))
  const occToday = d.occupancy.find(o => o.day === new Date().toISOString().slice(0, 10)) || d.occupancy[0]
  return (
    <Grid>
      <Panel title="Guests booked by month">
        <Bars height={140} data={d.bookingsByMonth.map(m => ({ label: monthLabel(m.month), value: m.guests }))} color="#1E5A64" />
      </Panel>
      <Panel title="Tickets by status">
        <div className="flex items-center gap-6">
          <Donut size={130} parts={d.ticketsByStatus.map(t => ({ value: t.n, color: TICKET_COLORS[t.status] || '#7C8780' }))}>
            <span className="text-center">
              <span className="disp text-[26px] block leading-none text-ink tnum">{d.ticketsByStatus.reduce((a, t) => a + t.n, 0)}</span>
              <span className="text-[10px] text-dim font-head font-bold uppercase">total</span>
            </span>
          </Donut>
          <div className="space-y-1.5">
            {d.ticketsByStatus.map(t => (
              <div key={t.status} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: TICKET_COLORS[t.status] }} />
                <span className="text-dim">{ticketStatus(t.status).label}</span>
                <span className="font-bold text-ink tnum ml-1">{t.n}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Sign-outs · last 14 days">
        <Bars height={110} labelEvery={2} color="#1087A3"
          data={d.signouts14.map(s => ({ label: fmtDate(s.day).split(' ')[1], value: s.n }))} />
      </Panel>
      <Panel title="Bed occupancy this week">
        <div className="flex items-center gap-5">
          <Ring pct={occToday && occToday.total ? (occToday.blocked / occToday.total) * 100 : 0} size={92} stroke={10} color="#1B5470" />
          <div className="flex-1">
            <div className="flex items-end gap-1.5 h-[64px]">
              {d.occupancy.map(o => (
                <div key={o.day} className="flex-1 flex flex-col justify-end" title={`${fmtDate(o.day)}: ${o.blocked}/${o.total}`}>
                  <motion.div initial={{ height: 0 }} animate={{ height: `${o.total ? Math.max(4, (o.blocked / o.total) * 100) : 4}%` }}
                    transition={{ duration: 0.6 }} className="rounded-t bg-leadership/80 min-h-[4px]" />
                </div>
              ))}
            </div>
            <div className="text-[11px] text-faint mt-1.5">{occToday?.blocked ?? 0} of {occToday?.total ?? 0} beds blocked today</div>
          </div>
        </div>
      </Panel>
      <Panel title="Ticket hotspots · 90 days">
        <HBars color="#C26628" data={d.topLocations.map(l => ({ label: l.name, value: l.n }))} />
      </Panel>
      <Panel title="Kudos by value">
        {d.kudosByValue.length === 0 ? <div className="text-dim text-[13px]">No kudos yet.</div> : (
          <HBars color="#30A059" data={d.kudosByValue.map(k => ({ label: valueLabels[k.value_key] || k.value_key, value: k.n }))} />
        )}
      </Panel>
    </Grid>
  )
}

/* ---------------- bookings ---------------- */
function BookingsTab() {
  const d = useMetrics('/metrics/bookings')
  if (!d) return <PageLoader />
  const monthLabel = m => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-CA', { month: 'short' })
  const occ = d.occupancyByMonth.filter(o => o.capacity > 0)
  return (
    <div className="space-y-4">
      <Grid cols="grid-cols-2 lg:grid-cols-4">
        <motion.div variants={rise}><StatTile label="Open pipeline" icon={<Tent size={19} />}
          value={d.funnel.filter(f => !['won', 'lost'].includes(f.stage)).reduce((a, f) => a + f.n, 0)} sub={money(d.funnel.filter(f => !['won', 'lost'].includes(f.stage)).reduce((a, f) => a + Number(f.value), 0))} /></motion.div>
        <motion.div variants={rise}><StatTile label="Avg lead age" icon={<CalendarClock size={19} />} value={Math.round(d.leadAge.avg_age_days)} sub="days in the open funnel" /></motion.div>
        <motion.div variants={rise}><StatTile label="Invoiced · 6mo" icon={<HandCoins size={19} />} value={Math.round(d.revenueByMonth.reduce((a, m) => a + Number(m.invoiced), 0))} sub="CAD incl. tax" /></motion.div>
        <motion.div variants={rise}><StatTile label="Collected · 6mo" icon={<HandCoins size={19} />} tone="text-summer" value={Math.round(d.revenueByMonth.reduce((a, m) => a + Number(m.collected), 0))} sub="CAD received" /></motion.div>
      </Grid>
      <Grid>
        <Panel title="Guests by month">
          <Bars height={140} data={d.byMonth.map(m => ({ label: monthLabel(m.month), value: m.guests }))} color="#1E5A64" />
        </Panel>
        <Panel title="Invoiced vs collected">
          <Lines height={140} labels={d.revenueByMonth.map(m => monthLabel(m.month))} labelEvery={1}
            series={[
              { points: d.revenueByMonth.map(m => Number(m.invoiced)), color: '#1E5A64', label: 'Invoiced' },
              { points: d.revenueByMonth.map(m => Number(m.collected)), color: '#30A059', label: 'Collected' },
            ]} />
        </Panel>
        <Panel title="Lead funnel">
          <HBars data={d.funnel
            .sort((a, b) => ['new', 'contacted', 'tour', 'proposal', 'won', 'lost'].indexOf(a.stage) - ['new', 'contacted', 'tour', 'proposal', 'won', 'lost'].indexOf(b.stage))
            .map(f => ({ label: `${leadStage(f.stage).label}${Number(f.value) ? ` · ${money(f.value)}` : ''}`, value: f.n }))} color="#1B5470" />
        </Panel>
        <Panel title="Bed-nights occupancy by month">
          {occ.length === 0 ? <div className="text-dim text-[13px]">No room blocks yet.</div> : (
            <div className="space-y-2.5">
              {occ.map(o => (
                <div key={o.month}>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="font-head font-semibold text-ink">{monthLabel(o.month)}</span>
                    <span className="text-dim tnum">{o.capacity ? Math.round((o.blocked / o.capacity) * 100) : 0}% · {o.blocked} bed-nights</span>
                  </div>
                  <div className="h-[7px] rounded-full bg-sunken overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${o.capacity ? Math.min(100, (o.blocked / o.capacity) * 100) : 0}%` }}
                      transition={{ duration: 0.7 }} className="h-full rounded-full bg-leadership" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Segments · 12 months">
          <HBars data={d.segments.map(s => ({ label: s.segment.replace('_', ' '), value: s.n }))} color="#C26628" />
        </Panel>
        <Panel title="Top customers by value">
          {d.topCustomers.length === 0 ? <div className="text-dim text-[13px]">No customers yet.</div> : (
            <div className="space-y-2">
              {d.topCustomers.map((c, i) => (
                <div key={c.name} className="flex items-center gap-3 text-[13px]">
                  <span className="w-5 text-faint font-head font-bold tnum">{i + 1}</span>
                  <span className="flex-1 text-ink font-semibold truncate">{c.name}</span>
                  <span className="text-faint text-[11.5px]">{c.bookings} bookings</span>
                  <span className="tnum font-bold text-ink">{money(c.value)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- facilities ---------------- */
function FacilitiesTab() {
  const d = useMetrics('/metrics/facilities')
  if (!d) return <PageLoader />
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const byDow = dows.map((label, i) => ({ label, value: d.byWeekday.find(x => x.dow === i + 1)?.n || 0 }))
  return (
    <div className="space-y-4">
      <Grid cols="grid-cols-2 lg:grid-cols-4">
        <motion.div variants={rise}><StatTile label="First response" icon={<Timer size={19} />} value={Math.round(d.timing.avg_first_response_h)} sub="avg hours · 60d" /></motion.div>
        <motion.div variants={rise}><StatTile label="Resolution" icon={<CheckCircle2 size={19} />} tone="text-summer" value={Math.round(d.timing.avg_resolution_h)} sub={`avg hours, ${d.timing.resolved} resolved`} /></motion.div>
        <motion.div variants={rise}><StatTile label="Open backlog" icon={<AlertTriangle size={19} />} tone="text-ember" value={d.backlogAges.reduce((a, b) => a + b.n, 0)} sub="tickets not closed" /></motion.div>
        <motion.div variants={rise}><StatTile label="Guest rating" icon={<Star size={19} />} value={Number(d.ratings.avg) || 0} sub={`${d.ratings.n} rating${d.ratings.n === 1 ? '' : 's'} · /5`} /></motion.div>
      </Grid>
      <Grid>
        <Panel title="Created vs closed · 12 weeks" span="md:col-span-2">
          <Lines height={150} labels={d.flow.map(w => w.week)} labelEvery={2}
            series={[
              { points: d.flow.map(w => w.created), color: '#357490', label: 'Created' },
              { points: d.flow.map(w => w.closed), color: '#30A059', label: 'Closed' },
            ]} />
        </Panel>
        <Panel title="By category · 90 days">
          <HBars data={d.byCategory.map(c => ({ label: c.category, value: c.n }))} color="#C26628" />
        </Panel>
        <Panel title="Hotspot locations · 90 days">
          <HBars data={d.byLocation.map(l => ({ label: l.name, value: l.n }))} color="#1B5470" />
        </Panel>
        <Panel title="Backlog age">
          <Bars height={110} data={d.backlogAges.map(b => ({ label: b.bucket, value: b.n }))} color="#C75B26" />
        </Panel>
        <Panel title="Busiest weekdays · 90 days">
          <Heat data={byDow} />
        </Panel>
        <Panel title="Where reports come from">
          <div className="flex items-center gap-6">
            <Donut size={110} parts={d.sources.map((s, i) => ({ value: s.n, color: ['#1E5A64', '#C26628', '#7D5BA6'][i % 3] }))}>
              <span className="disp text-[22px] text-ink tnum">{d.sources.reduce((a, s) => a + s.n, 0)}</span>
            </Donut>
            <div className="space-y-1.5">
              {d.sources.map((s, i) => (
                <div key={s.source} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: ['#1E5A64', '#C26628', '#7D5BA6'][i % 3] }} />
                  <span className="text-dim capitalize">{s.source}</span>
                  <span className="font-bold text-ink tnum ml-1">{s.n}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Oldest unresolved">
          <div className="space-y-2">
            {d.oldest.map(t => (
              <a key={t.code} href={`/tickets`} className="flex items-center gap-3 text-[13px] group">
                <Badge className={ticketStatus(t.status).cls}>{t.code}</Badge>
                <span className="flex-1 truncate text-ink group-hover:text-brand transition">{t.title}</span>
                <span className="text-faint text-[11.5px] shrink-0">{ago(t.created_at)}</span>
              </a>
            ))}
          </div>
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- tasks ---------------- */
function TasksTab() {
  const d = useMetrics('/metrics/tasks')
  if (!d) return <PageLoader />
  return (
    <div className="space-y-4">
      <Grid cols="grid-cols-2 lg:grid-cols-4">
        <motion.div variants={rise}><StatTile label="Done · this wk" icon={<CheckCircle2 size={19} />} tone="text-summer" value={d.velocity[d.velocity.length - 1]?.done || 0} sub="completed tasks" /></motion.div>
        <motion.div variants={rise}><StatTile label="Cycle time" icon={<Gauge size={19} />} value={Math.round(d.cycle.avg_days)} sub="avg days create → done" /></motion.div>
        <motion.div variants={rise}><StatTile label="Overdue" icon={<AlertTriangle size={19} />} tone="text-danger" value={d.overdue.n} sub="past their due date" /></motion.div>
        <motion.div variants={rise}><StatTile label="Open total" icon={<Tent size={19} />} value={d.byStatus.filter(s => s.kind !== 'done').reduce((a, s) => a + s.n, 0)} sub="across all columns" /></motion.div>
      </Grid>
      <Grid>
        <Panel title="Velocity · created vs done, 12 weeks" span="md:col-span-2">
          <Lines height={150} labels={d.velocity.map(w => w.week)} labelEvery={2}
            series={[
              { points: d.velocity.map(w => w.created), color: '#357490', label: 'Created' },
              { points: d.velocity.map(w => w.done), color: '#30A059', label: 'Done' },
            ]} />
        </Panel>
        <Panel title="Phase progress">
          <div className="space-y-3">
            {d.byPhase.map(p => (
              <div key={p.name}>
                <div className="flex justify-between text-[12.5px] mb-1">
                  <span className="font-head font-bold text-ink">{p.name}</span>
                  <span className="text-dim tnum">{p.done}/{p.total}</span>
                </div>
                <div className="h-[8px] rounded-full bg-sunken overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }}
                    transition={{ duration: 0.7 }} className="h-full rounded-full" style={{ background: swatch(p.color) }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Workload by person">
          <div className="space-y-2">
            {d.workload.map(w => (
              <div key={w.id} className="flex items-center gap-2.5 text-[13px]">
                <Avatar name={w.name} color={w.color} size={24} />
                <span className="flex-1 text-ink font-semibold truncate">{w.name}</span>
                {w.overdue > 0 && <Badge className="bg-danger/10 text-danger">{w.overdue} late</Badge>}
                <span className="text-faint text-[11.5px]">{w.done14} done · 14d</span>
                <span className="tnum font-bold text-ink w-8 text-right">{w.open}</span>
              </div>
            ))}
          </div>
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- people ---------------- */
function PeopleTab() {
  const { settings } = useApp()
  const d = useMetrics('/metrics/people')
  if (!d) return <PageLoader />
  const valueLabels = Object.fromEntries((settings.org?.values || []).map(v => [v.key, `${v.emoji} ${v.name}`]))
  const moods = d.pulseTrend.filter(w => w.mood !== null)
  return (
    <div className="space-y-4">
      <Grid cols="grid-cols-2 lg:grid-cols-4">
        <motion.div variants={rise}><StatTile label="Pulse this wk" icon={<Gauge size={19} />} value={d.participation.responded} sub={`of ${d.participation.staff} staff`} /></motion.div>
        <motion.div variants={rise}><StatTile label="eNPS · 90d" icon={<Star size={19} />} tone={d.enps.score >= 0 ? 'text-summer' : 'text-danger'} value={d.enps.score ?? 0} sub={d.enps.score === null ? 'needs 3+ responses' : `${d.enps.n} responses`} /></motion.div>
        <motion.div variants={rise}><StatTile label="Kudos · 30d" icon={<CheckCircle2 size={19} />} value={d.posts30.kudos} sub="recognitions given" /></motion.div>
        <motion.div variants={rise}><StatTile label="Community · 30d" icon={<Tent size={19} />} value={d.posts30.posts + d.posts30.comments} sub="posts + comments" /></motion.div>
      </Grid>
      <Grid>
        <Panel title="Mood trend · 12 weeks (k≥3 anonymity)">
          {moods.length < 2 ? <div className="text-dim text-[13px]">Not enough pulse history yet — weeks under 3 responses stay hidden.</div> : (
            <Lines height={130} labels={d.pulseTrend.map(w => w.week.slice(-3))} labelEvery={2}
              series={[{ points: d.pulseTrend.map(w => w.mood === null ? null : Number(w.mood)).map(v => v ?? 0), color: '#30A059', label: 'Avg mood /5' }]} />
          )}
        </Panel>
        <Panel title="Kudos leaders · 30 days">
          <div className="space-y-2">
            {d.kudosTop.filter(k => k.received || k.given).map(k => (
              <div key={k.name} className="flex items-center gap-2.5 text-[13px]">
                <Avatar name={k.name} color={k.color} size={24} />
                <span className="flex-1 text-ink font-semibold truncate">{k.name}</span>
                <span className="text-faint text-[11.5px]">gave {k.given}</span>
                <span className="tnum font-bold text-summer w-8 text-right">{k.received}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Kudos by value · 90 days">
          <HBars color="#30A059" data={d.kudosByValue.map(k => ({ label: valueLabels[k.value_key] || k.value_key, value: k.n }))} />
        </Panel>
        <Panel title="Feedback volume · 8 weeks">
          <Bars height={110} data={d.feedbackTrend.map(w => ({ label: w.week, value: w.n }))} color="#1B5470" />
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- sign-out ---------------- */
function SignoutTab() {
  const d = useMetrics('/metrics/signout')
  if (!d) return <PageLoader />
  const hours = Array.from({ length: 16 }, (_, i) => i + 6) // 6:00–21:00
  const byHour = hours.map(h => ({ label: `${h}`, value: d.byHour.find(x => x.hour === h)?.n || 0 }))
  return (
    <div className="space-y-4">
      <Grid cols="grid-cols-2 lg:grid-cols-4">
        <motion.div variants={rise}><StatTile label="Trips · 30d" icon={<Tent size={19} />} value={d.perDay.reduce((a, x) => a + x.n, 0)} sub="off-property sign-outs" /></motion.div>
        <motion.div variants={rise}><StatTile label="Avg duration" icon={<Timer size={19} />} value={Number(d.durations.avg_h)} sub="hours per trip" /></motion.div>
        <motion.div variants={rise}><StatTile label="Completed" icon={<CheckCircle2 size={19} />} tone="text-summer" value={d.durations.completed} sub="signed back in · 30d" /></motion.div>
        <motion.div variants={rise}><StatTile label="Overdue events" icon={<AlertTriangle size={19} />} tone="text-ember" value={d.incidents.overdue} sub="flagged late · 30d" /></motion.div>
      </Grid>
      <Grid>
        <Panel title="Trips per day · 30 days" span="md:col-span-2">
          <Bars height={130} labelEvery={3} data={d.perDay.map(x => ({ label: x.day, value: x.n }))} color="#1087A3" />
        </Panel>
        <Panel title="Top destinations · 90 days">
          <HBars data={d.topDestinations.map(t => ({ label: t.destination, value: t.n }))} color="#1B5470" />
        </Panel>
        <Panel title="Departure hours · 90 days">
          <Heat data={byHour} />
          <div className="text-[10.5px] text-faint mt-1.5">Hour of day (6:00 → 21:00)</div>
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- shopping ---------------- */
function ShoppingTab() {
  const d = useMetrics('/metrics/shopping')
  if (!d) return <PageLoader />
  return (
    <div className="space-y-4">
      <Grid cols="grid-cols-2 lg:grid-cols-4">
        <motion.div variants={rise}><StatTile label="Runs · 90d" icon={<Tent size={19} />} value={d.runs.reduce((a, r) => a + r.runs, 0)} sub="trips to town" /></motion.div>
        <motion.div variants={rise}><StatTile label="Items / run" icon={<CheckCircle2 size={19} />} value={Number(d.perRun.avg_items)} sub="average picked up" /></motion.div>
        <motion.div variants={rise}><StatTile label="Run length" icon={<Timer size={19} />} value={Number(d.perRun.avg_h)} sub="avg hours" /></motion.div>
        <motion.div variants={rise}><StatTile label="Added this wk" icon={<AlertTriangle size={19} />} value={d.added[d.added.length - 1]?.added || 0} sub="new list items" /></motion.div>
      </Grid>
      <Grid>
        <Panel title="List flow · added vs bought, 8 weeks" span="md:col-span-2">
          <Lines height={140} labels={d.added.map(w => w.week)} labelEvery={2}
            series={[
              { points: d.added.map(w => w.added), color: '#7CA41C', label: 'Added' },
              { points: d.added.map(w => w.bought), color: '#30A059', label: 'Bought' },
            ]} />
        </Panel>
        <Panel title="Items by category · 90 days">
          <HBars data={d.byCategory.map(c => ({ label: c.category, value: c.n }))} color="#7CA41C" />
        </Panel>
        <Panel title="Where we shop">
          <HBars data={d.byTown.map(t => ({ label: t.name, value: t.n }))} color="#1B5470" />
        </Panel>
      </Grid>
    </div>
  )
}

/* ---------------- gear ---------------- */
function GearTab() {
  const d = useMetrics('/metrics/gear')
  if (!d) return <PageLoader />
  return (
    <Grid>
      <Panel title="Loans per week · 12 weeks" span="md:col-span-2">
        <Bars data={d.loansByWeek.map(w => ({ label: w.week, value: w.loans }))} height={130} labelEvery={2} />
      </Panel>
      <Panel title="Loans by category · 90 days">
        <HBars data={d.byCategory.map(c => ({ label: c.category, value: c.loans }))} />
      </Panel>
      <Panel title="Fleet condition">
        <div className="flex items-center gap-5">
          <Donut size={120} parts={d.conditionMix.map(c => ({
            value: c.units,
            color: c.condition === 'good' ? '#30A059' : c.condition === 'worn' ? '#B28426' : '#B2402E',
          }))}>
            <span className="disp text-[22px] text-ink">{d.conditionMix.reduce((a, c) => a + c.units, 0)}</span>
          </Donut>
          <div className="space-y-1.5 text-[12.5px]">
            {d.conditionMix.map(c => (
              <div key={c.condition} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.condition === 'good' ? '#30A059' : c.condition === 'worn' ? '#B28426' : '#B2402E' }} />
                <span className="capitalize text-dim">{c.condition}</span>
                <b className="font-head text-ink tnum">{c.units} units</b>
              </div>
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Most-borrowed gear · 90 days">
        <HBars data={d.utilization.slice(0, 8).map(u => ({ label: u.name, value: u.loans }))} color="#1087A3" />
      </Panel>
      <Panel title="Top borrowers · 90 days">
        <HBars data={d.topBorrowers.map(b => ({ label: b.borrower, value: b.loans }))} color="#C26628" />
      </Panel>
      {d.overdue.length > 0 && (
        <Panel title="Overdue right now" span="md:col-span-2">
          <div className="space-y-1.5">
            {d.overdue.map((o, i) => (
              <div key={i} className="flex flex-wrap gap-2 text-[13px]">
                <b className="font-head text-ink">{o.item} ×{o.qty}</b>
                <span className="text-dim">— {o.borrower}</span>
                <span className="text-danger text-[12px] font-head font-bold ml-auto">due {fmtDate(o.due_at)}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </Grid>
  )
}

/* ---------------- budgets ---------------- */
function BudgetsMetricsTab() {
  const d = useMetrics('/metrics/budgets')
  if (!d) return <PageLoader />
  const months = d.spendByMonth.map(m => m.month.slice(5))
  return (
    <Grid>
      <Panel title="Spend by month · approved vs pending" span="md:col-span-2">
        <Lines height={150} labels={months} labelEvery={1} series={[
          { label: 'Approved', color: '#1E5A64', points: d.spendByMonth.map(m => Number(m.spent)) },
          { label: 'Pending', color: '#B28426', points: d.spendByMonth.map(m => Number(m.pending)), fill: false },
        ]} />
      </Panel>
      <Panel title="Burn per budget">
        <div className="space-y-3">
          {d.perBudget.map(b => {
            const pct = b.amount ? Math.min(100, (Number(b.spent) / Number(b.amount)) * 100) : 0
            return (
              <div key={b.name}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="font-head font-semibold text-ink">{b.name}</span>
                  <span className={cx('tnum font-head font-bold', pct >= 95 ? 'text-danger' : pct >= 80 ? 'text-ember' : 'text-dim')}>
                    {money(b.spent)} / {money(b.amount)}
                  </span>
                </div>
                <div className="h-[7px] rounded-full bg-sunken overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    className="h-full rounded-full"
                    style={{ background: pct >= 95 ? '#B2402E' : pct >= 80 ? '#C75B26' : '#1E5A64' }} />
                </div>
              </div>
            )
          })}
        </div>
      </Panel>
      <Panel title="Where the money goes · 90 days">
        <HBars data={d.byCategory.map(c => ({ label: c.category, value: Math.round(Number(c.total)) }))} color="#1F6331" />
      </Panel>
      <Panel title={`Approval queue (${d.pendingQueue.length})`} span="md:col-span-2">
        {d.pendingQueue.length === 0 ? <div className="text-[12.5px] text-faint">All caught up.</div> : (
          <div className="space-y-1.5">
            {d.pendingQueue.map(e => (
              <div key={e.id} className="flex flex-wrap gap-2 text-[13px]">
                <b className="font-head text-ink tnum">{money(e.amount)}</b>
                <span className="text-dim min-w-0 truncate">{e.vendor || e.descr} · {e.budget}</span>
                <span className="text-faint text-[12px] ml-auto">{e.submitted_by} · {fmtDate(e.date)}</span>
              </div>
            ))}
            <div className="text-[11.5px] text-faint pt-1.5">
              Average decision time: {Number(d.approvalSpeed.avg_days)}d over the last 90 days.
            </div>
          </div>
        )}
      </Panel>
    </Grid>
  )
}

/* ---------------- safety ---------------- */
function SafetyTab() {
  const d = useMetrics('/metrics/safety')
  if (!d) return <PageLoader />
  const SEV_COLORS = { 1: '#7C8780', 2: '#B28426', 3: '#C75B26', 4: '#B2402E' }
  return (
    <Grid>
      <Panel title="Incidents by month · 6 months" span="md:col-span-2">
        <Bars data={d.byMonth.map(m => ({ label: m.month.slice(5), value: m.n }))} height={120} color="#C75B26" />
      </Panel>
      <Panel title="By type · 180 days">
        <HBars data={d.byType.map(t => ({ label: `${incidentType(t.type).emoji} ${incidentType(t.type).label}`, value: t.n }))} />
      </Panel>
      <Panel title="By severity">
        <HBars data={d.bySeverity.map(s => ({ label: `${s.severity} — ${severity(s.severity).label}`, value: s.n, color: SEV_COLORS[s.severity] }))} />
      </Panel>
      <Panel title="Hotspots · 180 days">
        {d.byLocation.length === 0 ? <div className="text-[12.5px] text-faint">No location-tagged incidents.</div> :
          <HBars data={d.byLocation.map(l => ({ label: l.name, value: l.n }))} color="#1B5470" />}
      </Panel>
      <Panel title="Closure health">
        <div className="grid grid-cols-3 gap-3 text-center">
          {[['Open', d.closure.open, 'text-ember'], ['Closed', d.closure.closed, 'text-summer'],
            ['Median days', Number(d.closure.median_days_to_close), 'text-ink']].map(([l, v, tone]) => (
            <div key={l} className="bg-sunken/60 rounded-xl py-3">
              <div className={cx('disp text-[26px]', tone)}>{v}</div>
              <div className="kicker text-dim mt-0.5">{l}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Most recent" span="md:col-span-2">
        <div className="space-y-1.5">
          {d.recent.map(i => (
            <div key={i.code} className="flex flex-wrap items-center gap-2 text-[13px]">
              <Badge className={severity(i.severity).cls}>{severity(i.severity).label}</Badge>
              <span className="font-head font-semibold text-ink min-w-0 truncate">{i.title}</span>
              <span className="text-faint text-[12px] ml-auto">{i.code} · {fmtDate(i.occurred_at)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </Grid>
  )
}

/* ---------------- My Dashboard (FTF widget board, WoodsOS-shaped) ---------------- */
const DEFAULT_WIDGETS = ['open_tickets', 'tasks_due', 'whos_out', 'kudos_week']

function MyDashboard() {
  const { user, toast } = useApp()
  const [catalog, setCatalog] = useState(null)
  const [keys, setKeys] = useState(() =>
    Array.isArray(user.prefs?.dashboard) ? user.prefs.dashboard : DEFAULT_WIDGETS)
  const [data, setData] = useState(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  useEffect(() => { api.get('/metrics/dashboard').then(r => setCatalog(r.catalog)).catch(() => setCatalog([])) }, [])
  useEffect(() => {
    if (!keys.length) return setData({})
    api.get(`/metrics/dashboard?widgets=${keys.join(',')}`).then(r => setData(r.data)).catch(() => setData({}))
  }, [keys])

  function persist(next) {
    setKeys(next)
    api.patch('/people/me', { prefs: { dashboard: next } }).catch(e => toast(e.message, 'err'))
  }
  const moveKey = (k, dir) => {
    const i = keys.indexOf(k)
    const j = i + dir
    if (j < 0 || j >= keys.length) return
    const next = [...keys]
    ;[next[i], next[j]] = [next[j], next[i]]
    persist(next)
  }

  if (!catalog || !data) return <PageLoader />
  const meta = Object.fromEntries(catalog.map(c => [c.key, c]))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12.5px] text-dim">Your own wall of numbers — pick widgets from any area you can see.</p>
        <Btn size="sm" variant="soft" onClick={() => setGalleryOpen(true)}>✦ Choose widgets</Btn>
      </div>
      {keys.length === 0 ? (
        <Card><EmptyState icon="✦" title="A blank wall" body="Open the gallery and pin your first widget." /></Card>
      ) : (
        <motion.div variants={stagger(0.04)} initial="initial" animate="animate" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {keys.map(k => meta[k] && (
            <motion.div variants={rise} key={k}>
              <Card className="p-4 h-full group relative">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-[15px]">{meta[k].icon}</span>
                  <Kicker className="!text-dim">{meta[k].label}</Kicker>
                  <span className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => moveKey(k, -1)} className="text-faint hover:text-ink px-1" title="Move up">↑</button>
                    <button onClick={() => moveKey(k, 1)} className="text-faint hover:text-ink px-1" title="Move down">↓</button>
                    <button onClick={() => persist(keys.filter(x => x !== k))} className="text-faint hover:text-danger px-1" title="Remove">×</button>
                  </span>
                </div>
                <WidgetBody k={k} d={data[k]} />
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Sheet open={galleryOpen} onClose={() => setGalleryOpen(false)} kicker="My Dashboard" title="Widget gallery"
        footer={<Btn variant="ghost" onClick={() => setGalleryOpen(false)}>Done</Btn>}>
        <div className="space-y-2">
          {catalog.map(c => (
            <div key={c.key} className={cx('flex items-center gap-3 rounded-xl px-3.5 py-2.5 bg-sunken/60', !c.allowed && 'opacity-50')}>
              <span className="text-[16px]">{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-head font-bold text-[13px] text-ink">{c.label}</span>
                {!c.allowed && <span className="block text-[10.5px] text-faint">needs {c.perm}</span>}
              </span>
              <Toggle on={keys.includes(c.key)} disabled={!c.allowed} label={c.label}
                onChange={on => persist(on ? [...keys, c.key] : keys.filter(x => x !== c.key))} />
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  )
}

function Big({ children, tone = 'text-ink' }) {
  return <span className={cx('disp text-[30px] leading-none', tone)}>{children}</span>
}

function WidgetBody({ k, d }) {
  if (d == null) return <div className="text-[12px] text-faint">No data (or no permission).</div>
  switch (k) {
    case 'open_tickets': return (
      <div className="flex gap-5">
        <span><Big>{d.open}</Big><div className="text-[11px] text-dim mt-1">open</div></span>
        <span><Big tone={d.waiting ? 'text-lake' : 'text-ink'}>{d.waiting}</Big><div className="text-[11px] text-dim mt-1">guest waiting</div></span>
        <span><Big tone={d.overdue ? 'text-danger' : 'text-ink'}>{d.overdue}</Big><div className="text-[11px] text-dim mt-1">overdue</div></span>
      </div>
    )
    case 'ticket_flow': return (
      <Lines height={90} labels={d.map(w => w.week)} labelEvery={2} series={[
        { label: 'Created', color: '#C75B26', points: d.map(w => w.created) },
        { label: 'Closed', color: '#1E5A64', points: d.map(w => w.closed), fill: false },
      ]} />
    )
    case 'guest_rating': return d.n
      ? <div className="flex items-end gap-2"><Big tone="text-gold">{d.stars}★</Big><span className="text-[11.5px] text-dim pb-1">from {d.n} ratings · 90d</span></div>
      : <div className="text-[12px] text-faint">No ratings yet.</div>
    case 'occupancy_week': {
      const pct = d.capacity ? Math.round((d.blocked / d.capacity) * 100) : 0
      return <div className="flex items-center gap-4"><Ring pct={pct} size={62} stroke={7} /><span className="text-[12px] text-dim">{d.blocked} of {d.capacity} beds blocked this week</span></div>
    }
    case 'arrivals': return d.length ? (
      <div className="space-y-1">
        {d.map(b => <div key={b.code} className="flex justify-between text-[12.5px]"><span className="font-head font-semibold text-ink truncate">{b.name}</span><span className="text-faint tnum shrink-0 ml-2">{fmtDate(b.start_date)} · {b.headcount}</span></div>)}
      </div>
    ) : <div className="text-[12px] text-faint">Nothing inbound this week.</div>
    case 'revenue': return (
      <div className="flex gap-5">
        <span><Big tone="text-summer">{money(d.collected_30d)}</Big><div className="text-[11px] text-dim mt-1">collected · 30d</div></span>
        <span><Big>{d.open_invoices}</Big><div className="text-[11px] text-dim mt-1">open invoices</div></span>
      </div>
    )
    case 'tasks_due': return (
      <div className="flex gap-5">
        <span><Big>{d.due_this_week}</Big><div className="text-[11px] text-dim mt-1">due this week</div></span>
        <span><Big tone={d.overdue ? 'text-danger' : 'text-ink'}>{d.overdue}</Big><div className="text-[11px] text-dim mt-1">overdue</div></span>
      </div>
    )
    case 'whos_out': return d.length ? (
      <div className="space-y-1">
        {d.map((p, i) => <div key={i} className="flex justify-between text-[12.5px]"><span className="font-head font-semibold text-ink">{p.name}</span><span className={cx('text-[11.5px]', p.overdue ? 'text-danger font-bold' : 'text-faint')}>{p.destination}{p.overdue ? ' · overdue' : ''}</span></div>)}
      </div>
    ) : <div className="text-[12px] text-faint">Everyone’s on property. 🌲</div>
    case 'gear_now': return (
      <div className="flex gap-5">
        <span><Big>{d.units_out}</Big><div className="text-[11px] text-dim mt-1">units out</div></span>
        <span><Big tone={d.overdue ? 'text-danger' : 'text-ink'}>{d.overdue}</Big><div className="text-[11px] text-dim mt-1">overdue</div></span>
      </div>
    )
    case 'budget_health': return (
      <div className="space-y-2">
        {d.map(b => {
          const pct = b.amount ? Math.min(100, (Number(b.spent) / Number(b.amount)) * 100) : 0
          return (
            <div key={b.name}>
              <div className="flex justify-between text-[11.5px] mb-0.5"><span className="font-head font-semibold text-ink">{b.name}</span><span className="tnum text-dim">{Math.round(pct)}%</span></div>
              <div className="h-[5px] rounded-full bg-sunken overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 95 ? '#B2402E' : pct >= 80 ? '#C75B26' : '#1E5A64' }} />
              </div>
            </div>
          )
        })}
      </div>
    )
    case 'incidents_open': return (
      <div className="flex gap-5">
        <span><Big tone={d.open ? 'text-ember' : 'text-ink'}>{d.open}</Big><div className="text-[11px] text-dim mt-1">open</div></span>
        <span><Big>{d.last_30d}</Big><div className="text-[11px] text-dim mt-1">in 30 days</div></span>
      </div>
    )
    case 'kudos_week': return (
      <div><Big tone="text-summer">{d.n}</Big><div className="text-[11.5px] text-dim mt-1">{d.top ? `this week · ${d.top} leads the wall` : 'kudos this week'}</div></div>
    )
    case 'pulse': return d?.mood
      ? <div><Big tone="text-summer">{d.mood}/5</Big><div className="text-[11.5px] text-dim mt-1">team mood · {d.week} · {d.n} voices</div></div>
      : <div className="text-[12px] text-faint">Not enough responses yet (k ≥ 3).</div>
    case 'certs_expiring': return (
      <div><Big tone={d.n ? 'text-ember' : 'text-ink'}>{d.n}</Big><div className="text-[11.5px] text-dim mt-1">certs expiring within 60 days</div></div>
    )
    case 'shopping_open': return (
      <div><Big>{d.open}</Big><div className="text-[11.5px] text-dim mt-1">{d.active_run ? `items open · run to ${d.active_run} underway` : 'items on the list'}</div></div>
    )
    default: return <pre className="text-[11px] text-dim overflow-auto">{JSON.stringify(d, null, 1)}</pre>
  }
}
