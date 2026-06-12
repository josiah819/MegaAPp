export const cx = (...parts) => parts.flat().filter(Boolean).join(' ')

// ---- dates ----
const dt = v => (v instanceof Date ? v : new Date(typeof v === 'string' && v.length === 10 ? `${v}T12:00:00` : v))

export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function addDays(iso, n) {
  const d = dt(iso)
  d.setDate(d.getDate() + n)
  return todayISO(d)
}
export function weekStart(iso = todayISO()) {
  const d = dt(iso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return todayISO(d)
}

export const fmtDate = v => (v ? dt(v).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—')
export const fmtDateLong = v => (v ? dt(v).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '—')
export const fmtTime = v => (v ? dt(v).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '—')
export const fmtDow = v => dt(v).toLocaleDateString('en-CA', { weekday: 'short' })

export function fmtRange(a, b) {
  if (!a || !b) return '—'
  const A = dt(a), B = dt(b)
  const sameMonth = A.getMonth() === B.getMonth() && A.getFullYear() === B.getFullYear()
  if (a === b) return fmtDate(a)
  return sameMonth
    ? `${A.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}–${B.getDate()}`
    : `${fmtDate(a)} – ${fmtDate(b)}`
}

export function ago(v) {
  const s = Math.max(0, (Date.now() - dt(v).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return fmtDate(v)
}
export function untilTxt(v) {
  if (!v) return ''
  const m = Math.round((dt(v).getTime() - Date.now()) / 60000)
  if (m <= -60) return `${Math.floor(-m / 60)}h ${-m % 60}m overdue`
  if (m < 0) return `${-m}m overdue`
  if (m < 60) return `back in ${m}m`
  return `back ~${fmtTime(v)}`
}

export const money = n =>
  Number(n || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })

export const initials = name =>
  String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')

// ---- identity swatches (statuses, phases, people accents) ----
export const SWATCHES = {
  stone: '#7C8780', lake: '#357490', pine: '#1E5B45', ember: '#C75B26', gold: '#B28426',
  clay: '#B2402E', plum: '#7D5BA6', moss: '#5B8A3C', teal: '#2F6F6A', bark: '#8A5A3B',
}
export const swatch = key => SWATCHES[key] || SWATCHES.stone

export const PRIORITIES = [
  { v: 0, label: 'Low', cls: 'text-dim bg-sunken' },
  { v: 1, label: 'Normal', cls: 'text-lake bg-lake/10' },
  { v: 2, label: 'High', cls: 'text-ember bg-ember/12' },
  { v: 3, label: 'Urgent', cls: 'text-danger bg-danger/12' },
  { v: 4, label: '🔥 ASAP', cls: 'text-white bg-danger' },
]
export const priority = v => PRIORITIES[Math.min(4, Math.max(0, v | 0))]

export const TICKET_STATUSES = [
  { v: 'open', label: 'Open', cls: 'bg-lake/12 text-lake' },
  { v: 'in_progress', label: 'In progress', cls: 'bg-summer/12 text-summer' },
  { v: 'on_hold', label: 'On hold', cls: 'bg-ember/12 text-ember' },
  { v: 'pending_close', label: 'Pending close', cls: 'bg-leadership/12 text-leadership' },
  { v: 'closed', label: 'Closed', cls: 'bg-sunken text-dim' },
]
export const ticketStatus = v => TICKET_STATUSES.find(s => s.v === v) || TICKET_STATUSES[0]

export const BOOKING_STATUSES = [
  { v: 'inquiry', label: 'Inquiry', cls: 'bg-sunken text-dim' },
  { v: 'tentative', label: 'Tentative', cls: 'bg-ember/12 text-ember' },
  { v: 'confirmed', label: 'Confirmed', cls: 'bg-lake/12 text-lake' },
  { v: 'in_progress', label: 'On site', cls: 'bg-summer/15 text-summer' },
  { v: 'completed', label: 'Completed', cls: 'bg-sunken text-dim' },
  { v: 'cancelled', label: 'Cancelled', cls: 'bg-danger/10 text-danger' },
]
export const bookingStatus = v => BOOKING_STATUSES.find(s => s.v === v) || BOOKING_STATUSES[0]

export const SEGMENTS = [
  ['retreat', 'Retreat'], ['school_trip', 'School trip'], ['corporate', 'Corporate'],
  ['church', 'Church'], ['internal', 'Internal'], ['other', 'Other'],
]

export const LEAD_STAGES = [
  { v: 'new', label: 'New', cls: 'bg-lake/12 text-lake' },
  { v: 'contacted', label: 'Contacted', cls: 'bg-leadership/12 text-leadership' },
  { v: 'tour', label: 'Tour', cls: 'bg-summer/12 text-summer' },
  { v: 'proposal', label: 'Proposal', cls: 'bg-ember/12 text-ember' },
  { v: 'won', label: 'Won', cls: 'bg-green/20 text-green-dark' },
  { v: 'lost', label: 'Lost', cls: 'bg-sunken text-dim' },
]
export const leadStage = v => LEAD_STAGES.find(s => s.v === v) || LEAD_STAGES[0]

export const INVOICE_STATUSES = [
  { v: 'draft', label: 'Draft', cls: 'bg-sunken text-dim' },
  { v: 'sent', label: 'Sent', cls: 'bg-lake/12 text-lake' },
  { v: 'partial', label: 'Partly paid', cls: 'bg-leadership/12 text-leadership' },
  { v: 'paid', label: 'Paid', cls: 'bg-green/20 text-green-dark' },
  { v: 'overdue', label: 'Overdue', cls: 'bg-danger/12 text-danger' },
  { v: 'void', label: 'Void', cls: 'bg-sunken text-faint line-through' },
]
export const invoiceStatus = v => INVOICE_STATUSES.find(s => s.v === v) || INVOICE_STATUSES[0]

export const MEALS = [
  { v: 'breakfast', label: 'Breakfast', emoji: '🍳' },
  { v: 'lunch', label: 'Lunch', emoji: '🥪' },
  { v: 'dinner', label: 'Dinner', emoji: '🍽️' },
  { v: 'snack', label: 'Snack', emoji: '🍪' },
]
export const mealOf = v => MEALS.find(m => m.v === v) || MEALS[2]

export const GOAL_STATUSES = [
  { v: 'on', label: 'On track', cls: 'bg-summer/12 text-summer' },
  { v: 'behind', label: 'Behind', cls: 'bg-ember/12 text-ember' },
  { v: 'risk', label: 'At risk', cls: 'bg-danger/12 text-danger' },
  { v: 'done', label: 'Done', cls: 'bg-green/20 text-green-dark' },
]
export const goalStatus = v => GOAL_STATUSES.find(s => s.v === v) || GOAL_STATUSES[0]

// ---- round 3 ----
export const INCIDENT_TYPES = [
  { v: 'medical', label: 'Medical', emoji: '🩹' },
  { v: 'behavioral', label: 'Behavioral', emoji: '🗣️' },
  { v: 'safety', label: 'Safety', emoji: '⚠️' },
  { v: 'security', label: 'Security', emoji: '🔐' },
  { v: 'property', label: 'Property', emoji: '🏚️' },
  { v: 'other', label: 'Other', emoji: '📋' },
]
export const incidentType = v => INCIDENT_TYPES.find(t => t.v === v) || INCIDENT_TYPES[5]

export const SEVERITIES = [
  null,
  { v: 1, label: 'Minor', cls: 'bg-sunken text-dim', bar: '#7C8780' },
  { v: 2, label: 'Moderate', cls: 'bg-gold/15 text-gold', bar: '#B28426' },
  { v: 3, label: 'Serious', cls: 'bg-ember/15 text-ember', bar: '#C75B26' },
  { v: 4, label: 'Critical', cls: 'bg-danger/15 text-danger', bar: '#B2402E' },
]
export const severity = v => SEVERITIES[Math.min(4, Math.max(1, v | 0))]

export const INCIDENT_STATUSES = [
  { v: 'open', label: 'Open', cls: 'bg-ember/12 text-ember' },
  { v: 'review', label: 'In review', cls: 'bg-lake/12 text-lake' },
  { v: 'closed', label: 'Closed', cls: 'bg-sunken text-dim' },
]
export const incidentStatus = v => INCIDENT_STATUSES.find(s => s.v === v) || INCIDENT_STATUSES[0]

export const LF_STATUSES = [
  { v: 'open', label: 'In storage', cls: 'bg-lake/12 text-lake' },
  { v: 'claimed', label: 'Claimed', cls: 'bg-green/20 text-green-dark' },
  { v: 'returned', label: 'Returned', cls: 'bg-green/20 text-green-dark' },
  { v: 'donated', label: 'Donated', cls: 'bg-sunken text-dim' },
  { v: 'disposed', label: 'Disposed', cls: 'bg-sunken text-faint' },
]
export const lfStatus = v => LF_STATUSES.find(s => s.v === v) || LF_STATUSES[0]

export const LF_CATEGORIES = [
  ['electronics', '📱 Electronics'], ['clothing', '👕 Clothing'], ['jewelry', '💍 Jewelry'],
  ['documents', '📄 Documents'], ['toys', '🧸 Toys'], ['other', '🎒 Other'],
]

export const GEAR_CONDITIONS = [
  { v: 'good', label: 'Good', cls: 'bg-green/20 text-green-dark' },
  { v: 'worn', label: 'Worn', cls: 'bg-gold/15 text-gold' },
  { v: 'damaged', label: 'Damaged', cls: 'bg-danger/12 text-danger' },
]
export const gearCondition = v => GEAR_CONDITIONS.find(c => c.v === v) || GEAR_CONDITIONS[0]

export const EXPENSE_STATUSES = [
  { v: 'pending', label: 'Pending', cls: 'bg-gold/15 text-gold' },
  { v: 'approved', label: 'Approved', cls: 'bg-green/20 text-green-dark' },
  { v: 'rejected', label: 'Rejected', cls: 'bg-danger/12 text-danger' },
]
export const expenseStatus = v => EXPENSE_STATUSES.find(s => s.v === v) || EXPENSE_STATUSES[0]

export const money2 = n =>
  Number(n || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })
