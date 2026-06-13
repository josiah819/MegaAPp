// Tolerant iCalendar reader for personal calendar overlays — built for the
// files Google Calendar, Outlook and Apple Calendar actually publish.
// Parses VEVENTs, expands the common RRULEs inside a window, and returns
// plain { date, end_date, all_day, time, title… } rows in camp-local time
// (the server runs with TZ pinned, so Date getters are camp-local).
//
// Deliberate simplifications, fine for an overlay: TZID/floating times are
// treated as camp-local wall time; exotic RRULE parts (BYSETPOS, monthly
// BYDAY) fall back to the simple cadence.

const MS_DAY = 86400000

const pad = n => String(n).padStart(2, '0')
const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`

// 20260714 → all-day · 20260714T173000 → wall time · …T173000Z → UTC instant
function parseStamp(value) {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (h === undefined) return { date: new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0), allDay: true }
  const date = z
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0)))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0))
  return { date, allDay: false }
}

const stampKey = (d, allDay) => (allDay ? localISO(d) : `${localISO(d)} ${localTime(d)}`)

const unescapeText = v => String(v)
  .replace(/\\n/gi, ' · ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim()

// Property line → [left, value], honouring quoted params (ALTREP="http://…")
function splitProp(raw) {
  let inQ = false
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') inQ = !inQ
    else if (raw[i] === ':' && !inQ) return [raw.slice(0, i), raw.slice(i + 1)]
  }
  return null
}

export function parseICS(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '')
  const events = []
  let calName = ''
  let cur = null
  let depth = 0 // VALARM and friends nest inside VEVENT — ignore their props

  for (const raw of unfolded.split(/\r?\n/)) {
    if (!raw) continue
    const parts = splitProp(raw)
    if (!parts) continue
    const [left, value] = parts
    const name = left.split(';')[0].toUpperCase()

    if (name === 'BEGIN') {
      if (value === 'VEVENT' && !cur) cur = { exdates: [] }
      else if (cur) depth++
      continue
    }
    if (name === 'END') {
      if (depth > 0) { depth--; continue }
      if (value === 'VEVENT' && cur) { events.push(cur); cur = null }
      continue
    }
    if (!cur) {
      if (name === 'X-WR-CALNAME') calName = unescapeText(value)
      continue
    }
    if (depth > 0) continue

    switch (name) {
      case 'UID': cur.uid = value.trim(); break
      case 'SUMMARY': cur.title = unescapeText(value); break
      case 'LOCATION': cur.location = unescapeText(value).slice(0, 200); break
      case 'DESCRIPTION': cur.descr = unescapeText(value).slice(0, 400); break
      case 'STATUS': cur.status = value.trim().toUpperCase(); break
      case 'DTSTART': cur.start = parseStamp(value); break
      case 'DTEND': cur.end = parseStamp(value); break
      case 'RRULE': cur.rrule = parseRRule(value); break
      case 'RECURRENCE-ID': cur.recurrenceId = parseStamp(value); break
      case 'EXDATE':
        for (const v of value.split(',')) {
          const p = parseStamp(v)
          if (p) cur.exdates.push(stampKey(p.date, p.allDay))
        }
        break
    }
  }
  return { calName, events: events.filter(e => e.start && e.status !== 'CANCELLED') }
}

function parseRRule(value) {
  const r = {}
  for (const part of String(value).split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) r[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase()
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ)) return null
  return {
    freq: r.FREQ,
    interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL ? parseStamp(r.UNTIL) : null,
    byday: r.BYDAY ? r.BYDAY.split(',').map(s => s.trim()).filter(Boolean) : null,
  }
}

const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

// Occurrence start Dates for one event, clipped to [windowStart, windowEnd].
function expandRule(ev, windowStart, windowEnd, durMs) {
  const start = ev.start.date
  const { rrule } = ev
  if (!rrule) return start.getTime() + durMs >= windowStart.getTime() && start <= windowEnd ? [start] : []

  const out = []
  const untilMs = rrule.until
    ? rrule.until.date.getTime() + (rrule.until.allDay ? MS_DAY - 1 : 0)
    : Infinity
  const endMs = Math.min(untilMs, windowEnd.getTime())
  const max = rrule.count || Infinity
  const keep = d => {
    if (d.getTime() + durMs >= windowStart.getTime()) out.push(d)
    return out.length < 500
  }

  // WEEKLY with BYDAY walks calendar weeks; everything else steps from DTSTART.
  if (rrule.freq === 'WEEKLY' && rrule.byday?.length) {
    const days = [...new Set(rrule.byday.map(s => DOW[s.slice(-2)]).filter(n => n !== undefined))].sort()
    if (!days.length) return out
    const anchor = new Date(start)
    anchor.setDate(anchor.getDate() - anchor.getDay()) // Sunday of DTSTART's week
    let n = 0
    for (let w = 0; w < 6000; w += rrule.interval) {
      for (const dow of days) {
        const d = new Date(anchor)
        d.setDate(anchor.getDate() + w * 7 + dow)
        d.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0)
        if (d < start) continue
        if (n >= max) return out
        n++
        if (d.getTime() > endMs) return out
        if (!keep(d)) return out
      }
    }
    return out
  }

  let n = 0
  for (let i = 0; i < 6000; i++) {
    const d = new Date(start)
    if (rrule.freq === 'DAILY') d.setDate(start.getDate() + i * rrule.interval)
    else if (rrule.freq === 'WEEKLY') d.setDate(start.getDate() + i * 7 * rrule.interval)
    else if (rrule.freq === 'MONTHLY') {
      d.setDate(1)
      d.setMonth(start.getMonth() + i * rrule.interval)
      d.setDate(start.getDate())
      if (d.getDate() !== start.getDate()) continue // Feb 31st — skipped, not counted
    } else d.setFullYear(start.getFullYear() + i * rrule.interval)
    if (n >= max) break
    n++
    if (d.getTime() > endMs) break
    if (!keep(d)) break
  }
  return out
}

// The main entry: ICS text → flat camp-local events inside [fromISO, toISO].
export function expandICS(text, fromISO, toISO) {
  const windowStart = new Date(`${fromISO}T00:00:00`)
  const windowEnd = new Date(`${toISO}T23:59:59`)
  const { calName, events } = parseICS(text)

  // RECURRENCE-ID rows are moved instances: they render standalone and knock
  // their original slot out of the master's expansion.
  const moved = new Map()
  for (const e of events) {
    if (!e.recurrenceId || !e.uid) continue
    if (!moved.has(e.uid)) moved.set(e.uid, new Set())
    moved.get(e.uid).add(stampKey(e.recurrenceId.date, e.recurrenceId.allDay))
  }

  const out = []
  for (const ev of events) {
    const allDay = ev.start.allDay
    const durMs = ev.end
      ? Math.max(0, ev.end.date - ev.start.date)
      : (allDay ? MS_DAY : 0)
    const skip = new Set(ev.exdates)
    if (!ev.recurrenceId && ev.uid && moved.has(ev.uid)) {
      for (const k of moved.get(ev.uid)) skip.add(k)
    }
    const starts = ev.recurrenceId
      ? expandRule({ ...ev, rrule: null }, windowStart, windowEnd, durMs)
      : expandRule(ev, windowStart, windowEnd, durMs)

    for (const s of starts) {
      if (skip.has(stampKey(s, allDay))) continue
      if (s > windowEnd) continue
      // DTEND is exclusive for all-day events: a one-day event ends where it
      // starts. All-day spans count whole days (starts are noon-anchored).
      const last = allDay
        ? new Date(s.getTime() + Math.max(0, Math.round(durMs / MS_DAY) - 1) * MS_DAY)
        : new Date(s.getTime() + Math.max(0, durMs - 1))
      const endISO = localISO(last)
      const startISO = localISO(s)
      out.push({
        uid: ev.uid || '',
        title: ev.title || '(untitled)',
        date: startISO,
        end_date: endISO > startISO ? endISO : null,
        all_day: allDay,
        time: allDay ? null : localTime(s),
        end_time: allDay || !durMs ? null : localTime(new Date(s.getTime() + durMs)),
        location: ev.location || '',
        descr: ev.descr || '',
      })
      if (out.length >= 1000) break
    }
    if (out.length >= 1000) break
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')))
  return { name: calName, events: out }
}

// ---- fetching --------------------------------------------------------------
// Users paste arbitrary URLs, so the fetcher refuses anything that points
// inside the network (SSRF guard) and caps size + time.

const PRIVATE_HOST = /^(localhost|.*\.(local|localdomain|internal|intranet|lan|home|corp))$/i
const PRIVATE_IP = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.)/

export function normalizeFeedUrl(raw) {
  let u
  try {
    u = new URL(String(raw || '').trim().replace(/^webcal:/i, 'https:'))
  } catch {
    throw new Error('That doesn’t look like a URL — paste the full address, starting with https://')
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Calendar feeds must be http(s) or webcal links')
  const host = u.hostname.toLowerCase()
  if (host.includes(':') || PRIVATE_HOST.test(host) || PRIVATE_IP.test(host)) {
    throw new Error('That address points inside a private network — calendar feeds must be public URLs')
  }
  return u.toString()
}

export async function fetchICS(url) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 10000)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { accept: 'text/calendar, text/plain, */*', 'user-agent': 'WoodsOS-Calendar/1.0' },
    })
    if (!res.ok) throw new Error(`The feed answered ${res.status} — check the link is the private/secret iCal address`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len > 3_000_000) throw new Error('Feed is too large (3 MB max)')
    const text = await res.text()
    if (text.length > 3_000_000) throw new Error('Feed is too large (3 MB max)')
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4000))) {
      throw new Error('That URL didn’t return an iCalendar (.ics) file — in Google Calendar use the “Secret address in iCal format”')
    }
    return text
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The feed took too long to answer (10 s limit)')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
