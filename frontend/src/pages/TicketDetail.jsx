import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Trash2, Lock, Sparkles, Link2, Copy, Paperclip, MessageCircle, History, Star,
  Eye, EyeOff, Plus, X, Hand, MessageSquareQuote,
} from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import {
  Card, Btn, Badge, Kicker, PageLoader, ConfirmBtn, Field, Select, Avatar, Seg, Stars, IconBtn, Sheet, AvatarStack,
} from '../components/ui.jsx'
import { cx, ago, fmtDate, todayISO, priority, ticketStatus, TICKET_STATUSES, PRIORITIES } from '../lib.js'
import { pageAnim } from '../motion.js'

const EVENT_TEXT = {
  created: e => `Ticket created${e.detail?.source === 'guest' ? ' from a guest report' : e.detail?.source === 'scheduled' ? ' by the scheduler' : e.detail?.source === 'claude' ? ' by Claude' : ''}`,
  status: e => `Status: ${String(e.detail?.from || '').replace('_', ' ')} → ${String(e.detail?.to || '').replace('_', ' ')}`,
  assigned: e => `Assigned to ${e.detail?.to_name || 'someone'}`,
  priority: e => `Priority changed to ${priority(e.detail?.to).label}`,
  attachment: e => `Added ${e.detail?.count === 1 ? 'an attachment' : `${e.detail?.count} attachments`}`,
  guest_message: () => 'Guest replied',
  guest_photo: e => `Guest added ${e.detail?.count === 1 ? 'a photo' : 'photos'}`,
  chat_link: e => e.detail?.action === 'revoked' ? 'Guest chat link revoked' : 'Guest chat link created',
  rated: e => `Guest rated ${e.detail?.rating}★`,
  close_requested: e => `Closure requested${e.detail?.reason ? ` — “${e.detail.reason}”` : ''}`,
  close_approved: () => 'Closure approved ✅',
  close_denied: e => `Closure denied${e.detail?.note ? ` — “${e.detail.note}”` : ''}`,
  escalated: e => `⏰ Escalated — past its ${fmtDate(e.detail?.due)} due date`,
}

function CannedManager({ open, onClose, onChanged }) {
  const { toast } = useApp()
  const [list, setList] = useState([])
  const [f, setF] = useState(null)
  const load = () => api.get('/tickets/canned').then(setList).catch(() => {})
  useEffect(() => { if (open) load() }, [open])
  async function save() {
    try {
      f.id ? await api.patch(`/tickets/canned/${f.id}`, f) : await api.post('/tickets/canned', f)
      toast('Saved reply stored 💬'); setF(null); load(); onChanged?.()
    } catch (e) { toast(e.message, 'err') }
  }
  return (
    <Sheet open={open} onClose={onClose} kicker="Facilities" title="Saved replies"
      footer={<Btn variant="ghost" onClick={onClose}>Done</Btn>}>
      <p className="text-[12.5px] text-dim mb-3">One tap drops these into the composer — keep them warm, keep them human.</p>
      {f ? (
        <div className="space-y-3">
          <Field label="Title"><input className="input" value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} placeholder="On our way" /></Field>
          <Field label="Reply"><textarea className="input" rows={4} value={f.body} onChange={e => setF(s => ({ ...s, body: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            <Btn size="sm" variant="ghost" onClick={() => setF(null)}>Cancel</Btn>
            <Btn size="sm" onClick={save} disabled={!f.title?.trim() || !f.body?.trim()}>Save</Btn>
          </div>
        </div>
      ) : (
        <>
          <Btn size="sm" variant="soft" className="mb-3" onClick={() => setF({ title: '', body: '' })}><Plus size={13} /> New saved reply</Btn>
          <div className="space-y-2">
            {list.map(c => (
              <div key={c.id} className="bg-sunken/60 rounded-xl px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-head font-bold text-[13px] text-ink">{c.title}</span>
                  <span className="flex gap-1">
                    <Btn size="sm" variant="ghost" onClick={() => setF(c)}>Edit</Btn>
                    <ConfirmBtn label="Remove?" onConfirm={async () => { await api.del(`/tickets/canned/${c.id}`); load(); onChanged?.() }}>Remove</ConfirmBtn>
                  </span>
                </div>
                <p className="text-[12.5px] text-dim mt-1 line-clamp-2">{c.body}</p>
              </div>
            ))}
            {!list.length && <div className="text-[12.5px] text-faint">Nothing saved yet.</div>}
          </div>
        </>
      )}
    </Sheet>
  )
}

export default function TicketDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { can, toast, settings, reload } = useApp()
  const [t, setT] = useState(null)
  const [people, setPeople] = useState([])
  const [locations, setLocations] = useState([])
  const [allTags, setAllTags] = useState([])
  const [canned, setCanned] = useState([])
  const [reply, setReply] = useState('')
  const [mode, setMode] = useState('public')   // public | internal
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [cannedOpen, setCannedOpen] = useState(false)
  const [damage, setDamage] = useState(null)
  const fileRef = useRef()

  const load = () => api.get(`/tickets/${id}`).then(x => {
    setT(x)
    setDamage(x.damage_note || '')
    setMode(m => (x.public_token && can('tickets.chat') ? m : 'internal'))
  }).catch(e => { toast(e.message, 'err'); nav('/tickets') })

  useEffect(() => {
    load()
    if (can('people.view')) api.get('/people').then(setPeople).catch(() => {})
    if (can('locations.view')) api.get('/locations').then(setLocations).catch(() => {})
    api.get('/tickets/tags').then(setAllTags).catch(() => {})
    api.get('/tickets/canned').then(setCanned).catch(() => {})
  }, [id]) // eslint-disable-line

  if (!t) return <PageLoader />
  const s = ticketStatus(t.status)
  const p = priority(t.priority)
  const editable = can('tickets.edit')
  const chatable = can('tickets.chat')
  const canPriority = can('tickets.priority')
  const canApprove = can('tickets.approve_close') || can('tickets.close')
  const hasGuest = !!t.public_token || t.source === 'guest'
  const cats = settings.report_categories?.length ? settings.report_categories : []
  const holdH = Math.round((t.hold_seconds || 0) / 360) / 10
  const overdue = t.due_date && String(t.due_date).slice(0, 10) < todayISO() && t.status !== 'closed'

  async function patch(body, msg) {
    try { await api.patch(`/tickets/${t.id}`, body); if (msg) toast(msg); load(); reload() } catch (e) { toast(e.message, 'err') }
  }

  async function sendReply() {
    if (!reply.trim()) return
    setBusy(true)
    try {
      await api.post(`/tickets/${t.id}/responses`, { body: reply, is_internal: mode === 'internal' })
      setReply(''); load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  async function uploadFiles(files) {
    if (!files?.length) return
    try {
      await api.upload(`/tickets/${t.id}/attachments`, [...files].slice(0, 4))
      toast('Attached 📎'); load()
    } catch (e) { toast(e.message, 'err') } finally { if (fileRef.current) fileRef.current.value = '' }
  }

  async function chatLink() {
    try {
      const r = await api.post(`/tickets/${t.id}/chat-link`)
      const url = `${location.origin}${r.track_path}`
      try { await navigator.clipboard.writeText(url) } catch { /* no clipboard */ }
      toast('Guest link copied — anyone with it can chat on this ticket 🔗')
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function toggleWatch() {
    try {
      t.watching ? await api.del(`/tickets/${t.id}/watch`) : await api.post(`/tickets/${t.id}/watch`)
      toast(t.watching ? 'Stopped watching' : 'Watching — you’ll hear about every update 👁')
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function requestClose() {
    const reason = window.prompt('Why is this ready to close? (the approver sees this)')
    if (reason == null) return
    try {
      await api.post(`/tickets/${t.id}/request-close`, { reason })
      toast('Closure requested 🙋 — approvers have been pinged')
      load(); reload()
    } catch (e) { toast(e.message, 'err') }
  }

  async function decideClosure(approve) {
    const note = approve ? '' : (window.prompt('Tell them what still needs doing:') ?? '')
    if (!approve && note === null) return
    try {
      await api.post(`/tickets/${t.id}/closure/${t.pending_closure.id}`, { approve, note })
      toast(approve ? 'Closed ✅' : 'Sent back ↩️')
      load(); reload()
    } catch (e) { toast(e.message, 'err') }
  }

  async function addTag(tagId) {
    if (!tagId) return
    try { await api.post(`/tickets/${t.id}/tags`, { tag_id: Number(tagId) }); load() } catch (e) { toast(e.message, 'err') }
  }
  async function removeTag(tagId) {
    try { await api.del(`/tickets/${t.id}/tags/${tagId}`); load() } catch (e) { toast(e.message, 'err') }
  }

  function insertCanned(cid) {
    if (!cid) return
    if (cid === '__manage') return setCannedOpen(true)
    const c = canned.find(x => x.id === Number(cid))
    if (c) setReply(r => (r ? `${r}\n${c.body}` : c.body))
  }

  const timeline = [
    ...t.thread.map(r => ({ kind: 'msg', at: r.created_at, r })),
    ...(showHistory ? t.events.filter(e => e.kind !== 'guest_message').map(e => ({ kind: 'event', at: e.created_at, e })) : []),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))

  const images = t.attachments.filter(a => a.mime?.startsWith('image/'))
  const files = t.attachments.filter(a => !a.mime?.startsWith('image/'))
  const tagIds = new Set((t.tags || []).map(g => g.id))
  const addableTags = allTags.filter(g => g.active && !tagIds.has(g.id))
  const statusOptions = TICKET_STATUSES.filter(o =>
    o.v !== 'pending_close' && (o.v !== 'closed' || can('tickets.close')))

  return (
    <motion.div {...pageAnim}>
      <button onClick={() => nav('/tickets')} className="flex items-center gap-1.5 text-[12.5px] font-head font-bold text-dim hover:text-ink transition mb-4">
        <ArrowLeft size={14} /> Facilities
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <Kicker className="mb-1.5">{t.code} · {t.source === 'guest' ? 'Guest report' : t.source === 'scheduled' ? 'Recurring' : `by ${t.created_by_name || 'staff'}`} · {ago(t.created_at)}</Kicker>
          <h1 className="disp text-[32px] sm:text-[40px] text-ink leading-[0.98]">{t.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Badge className={s.cls}>{s.label}</Badge>
            <Badge className={p.cls}>{p.label}</Badge>
            <Badge className="bg-sunken text-dim capitalize">{(cats.find(c => c.key === t.category)?.label) || t.category}</Badge>
            {overdue && <Badge className="bg-danger/12 text-danger">⏰ due {fmtDate(t.due_date)}</Badge>}
            {t.triage?.via === 'claude' && <Badge className="bg-leadership/12 text-leadership"><Sparkles size={11} /> AI triaged</Badge>}
            {holdH > 0 && <Badge className="bg-ember/10 text-ember">⏸ {holdH}h on hold</Badge>}
            {t.damage_note && <Badge className="bg-ember/12 text-ember">🧾 customer damage</Badge>}
            {t.rating && <Badge className="bg-green/15 text-green-dark"><Star size={11} fill="currentColor" /> {t.rating}/5 from guest</Badge>}
            {(t.tags || []).map(g => (
              <span key={g.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-head font-bold text-white"
                style={{ background: g.color }}>
                {g.name}
                {can('tickets.tag') && (
                  <button onClick={() => removeTag(g.id)} className="opacity-70 hover:opacity-100" aria-label={`Remove ${g.name}`}>
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
            {can('tickets.tag') && addableTags.length > 0 && (
              <select value="" onChange={e => addTag(e.target.value)}
                className="text-[11px] font-head font-bold text-dim bg-sunken rounded-full px-2 py-0.5 border-0 cursor-pointer">
                <option value="">+ tag</option>
                {addableTags.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn variant={t.watching ? 'soft' : 'outline'} size="sm" onClick={toggleWatch}>
            {t.watching ? <><EyeOff size={14} /> Unwatch</> : <><Eye size={14} /> Watch</>}
          </Btn>
          {t.status !== 'closed' && t.status !== 'pending_close' && can('tickets.close') && (
            <Btn variant="accent" onClick={() => patch({ status: 'closed' }, 'Ticket closed ✅')}>Close ticket</Btn>
          )}
          {t.status !== 'closed' && t.status !== 'pending_close' && !can('tickets.close') && editable && (
            <Btn variant="accent" onClick={requestClose}><Hand size={14} /> Request close</Btn>
          )}
          {t.status === 'closed' && editable && (
            <Btn variant="soft" onClick={() => patch({ status: 'open' }, 'Reopened')}>Reopen</Btn>
          )}
          {can('tickets.delete') && (
            <ConfirmBtn label="Delete forever?" onConfirm={async () => {
              try { await api.del(`/tickets/${t.id}`); toast('Ticket deleted'); nav('/tickets') } catch (e) { toast(e.message, 'err') }
            }}><Trash2 size={15} /></ConfirmBtn>
          )}
        </div>
      </div>

      {t.pending_closure && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="card border-l-4 border-l-leadership p-4 mb-5 flex flex-wrap items-center gap-3">
          <Hand size={18} className="text-leadership shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-head font-bold text-[13.5px] text-ink">
              {t.pending_closure.requested_by_name || 'Someone'} asked to close this {ago(t.pending_closure.created_at)}
            </div>
            {t.pending_closure.reason && <div className="text-[12.5px] text-dim mt-0.5">“{t.pending_closure.reason}”</div>}
          </div>
          {canApprove ? (
            <div className="flex gap-2">
              <Btn size="sm" variant="accent" onClick={() => decideClosure(true)}>Approve & close</Btn>
              <Btn size="sm" variant="soft" onClick={() => decideClosure(false)}>Send back</Btn>
            </div>
          ) : (
            <Badge className="bg-leadership/12 text-leadership">awaiting approval</Badge>
          )}
        </motion.div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {t.details && (
            <Card className="p-5">
              <Kicker className="!text-dim mb-2.5">Details</Kicker>
              <p className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed">{t.details}</p>
              {t.submitter_name && <div className="text-[12px] text-faint mt-3">Reported by {t.submitter_name}{t.submitter_email ? ` · ${t.submitter_email}` : ''}</div>}
            </Card>
          )}

          {(images.length > 0 || files.length > 0) && (
            <Card className="p-5">
              <Kicker className="!text-dim mb-3">Attachments</Kicker>
              {images.length > 0 && (
                <div className="flex gap-2.5 flex-wrap mb-2">
                  {images.map(a => (
                    <a key={a.id} href={`/api/files/${a.filename}`} target="_blank" rel="noreferrer" className="relative group">
                      <img src={`/api/files/${a.filename}`} alt={a.original_name}
                        className="w-24 h-24 object-cover rounded-xl border border-line group-hover:shadow-lift transition" />
                      {a.guest && <span className="absolute bottom-1 left-1 px-1.5 rounded-md bg-[#0A1B1E]/70 text-white text-[9px] font-head font-bold">guest</span>}
                    </a>
                  ))}
                </div>
              )}
              {files.map(a => (
                <a key={a.id} href={`/api/files/${a.filename}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-[13px] text-brand hover:underline py-0.5">
                  <Paperclip size={13} /> {a.original_name || a.filename}
                </a>
              ))}
            </Card>
          )}

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3.5">
              <Kicker className="!text-dim">Conversation</Kicker>
              <button onClick={() => setShowHistory(h => !h)}
                className={cx('flex items-center gap-1.5 text-[11.5px] font-head font-bold transition', showHistory ? 'text-accent' : 'text-faint hover:text-ink')}>
                <History size={12} /> {showHistory ? 'Hide history' : 'Show history'}
              </button>
            </div>
            {timeline.length === 0 && <div className="text-dim text-[13px] mb-3">No updates yet.</div>}
            <div className="space-y-3 mb-4">
              {timeline.map((item, i) => item.kind === 'event' ? (
                <div key={`e${i}`} className="flex items-center gap-2.5 pl-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-faint shrink-0" />
                  <span className="text-[11.5px] text-faint">
                    {(EVENT_TEXT[item.e.kind] || (() => item.e.kind))(item.e)}
                    {item.e.user_name ? ` — ${item.e.user_name}` : ''} · {ago(item.e.created_at)}
                  </span>
                </div>
              ) : (
                <motion.div key={`m${item.r.id}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3">
                  <Avatar name={item.r.author_name} color={item.r.is_guest ? '#C26628' : (item.r.color || '#1E5A64')} size={30} />
                  <div className={cx('flex-1 min-w-0 rounded-xl px-3.5 py-2.5',
                    item.r.is_internal ? 'bg-ember/[0.07] border border-ember/20'
                      : item.r.is_guest ? 'bg-lake/[0.08] border border-lake/20' : 'bg-sunken/70')}>
                    <div className="flex items-center gap-2 text-[11.5px] mb-1">
                      <span className="font-head font-bold text-ink">{item.r.author_name}</span>
                      <span className="text-faint">{ago(item.r.created_at)}</span>
                      {item.r.is_internal && <span className="inline-flex items-center gap-1 text-ember font-head font-bold"><Lock size={10} /> internal</span>}
                      {item.r.is_guest && <span className="inline-flex items-center gap-1 text-lake font-head font-bold"><MessageCircle size={10} /> guest</span>}
                      {!item.r.is_internal && !item.r.is_guest && hasGuest && <span className="text-[10px] text-faint font-head font-bold uppercase">visible to guest</span>}
                    </div>
                    <p className="text-[13.5px] text-ink whitespace-pre-wrap leading-relaxed">{item.r.body}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {editable && (
              <div>
                <textarea className="input" rows={3}
                  placeholder={mode === 'internal' ? 'Internal note — staff only…' : hasGuest ? 'Reply — the guest sees this on their tracking page…' : 'Write an update…'}
                  value={reply} onChange={e => setReply(e.target.value)} />
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Seg size="sm" value={mode} onChange={setMode} options={[
                      ...(hasGuest && chatable ? [{ v: 'public', label: '💬 Reply to guest' }] : t.public_token ? [] : [{ v: 'public', label: 'Update' }]),
                      { v: 'internal', label: '🔒 Internal note' },
                    ]} />
                    <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => uploadFiles(e.target.files)} />
                    <IconBtn title="Attach files" onClick={() => fileRef.current?.click()}><Paperclip size={16} /></IconBtn>
                    {(canned.length > 0 || can('tickets.canned')) && (
                      <span className="relative inline-flex items-center">
                        <MessageSquareQuote size={14} className="absolute left-2 text-faint pointer-events-none" />
                        <select value="" onChange={e => insertCanned(e.target.value)}
                          className="text-[12px] font-head font-semibold text-dim bg-sunken rounded-lg pl-7 pr-2 py-1.5 border-0 cursor-pointer max-w-[150px]">
                          <option value="">Saved replies</option>
                          {canned.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                          {can('tickets.canned') && <option value="__manage">⚙ Manage…</option>}
                        </select>
                      </span>
                    )}
                  </div>
                  <Btn size="sm" onClick={sendReply} disabled={busy || !reply.trim()}>
                    {mode === 'internal' ? 'Add note' : 'Send'}
                  </Btn>
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {chatable && (
            <Card className="p-5">
              <Kicker className="!text-dim mb-2.5">Guest chat link</Kicker>
              {t.public_token ? (
                <>
                  <p className="text-[12.5px] text-dim leading-relaxed mb-3">
                    The submitter can follow this ticket and message the team at their private link.
                  </p>
                  <div className="flex gap-2">
                    <Btn size="sm" variant="soft" className="flex-1" onClick={async () => {
                      const url = `${location.origin}/track/${t.public_token}`
                      try { await navigator.clipboard.writeText(url); toast('Link copied 🔗') } catch { toast(url) }
                    }}><Copy size={13} /> Copy link</Btn>
                    <ConfirmBtn label="Revoke link?" onConfirm={async () => {
                      try { await api.del(`/tickets/${t.id}/chat-link`); toast('Link revoked'); load() } catch (e) { toast(e.message, 'err') }
                    }}>Revoke</ConfirmBtn>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12.5px] text-dim leading-relaxed mb-3">
                    Create a private link so the reporter can follow along and chat — no account needed.
                  </p>
                  <Btn size="sm" onClick={chatLink}><Link2 size={13} /> Create guest link</Btn>
                </>
              )}
              {t.rating && (
                <div className="mt-4 pt-3 border-t border-line/60">
                  <Stars value={t.rating} size={16} />
                  {t.rating_comment && <p className="text-[12.5px] text-dim italic mt-1.5">“{t.rating_comment}”</p>}
                </div>
              )}
            </Card>
          )}

          <Card className="p-5 space-y-4">
            <Kicker className="!text-dim">Manage</Kicker>
            {t.status === 'pending_close' ? (
              <div className="text-[12.5px] text-dim bg-sunken/70 rounded-xl px-3 py-2.5">
                Status is locked while the closure request is pending.
              </div>
            ) : (
              <Field label="Status">
                <Select value={t.status} onChange={v => patch({ status: v })} disabled={!editable}>
                  {statusOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Priority" hint={canPriority ? undefined : 'Needs the Set-priority permission'}>
              <Select value={t.priority} onChange={v => patch({ priority: Number(v) })} disabled={!canPriority}>
                {PRIORITIES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Assignee">
              <Select value={t.assignee_id || ''} onChange={v => patch({ assignee_id: v ? Number(v) : null })} disabled={!editable}>
                <option value="">— unassigned —</option>
                {people.map(pp => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
              </Select>
            </Field>
            <Field label="Location">
              <Select value={t.location_id || ''} onChange={v => patch({ location_id: v ? Number(v) : null })} disabled={!editable}>
                <option value="">— anywhere —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Due">
              <input type="date" className="input" value={t.due_date ? String(t.due_date).slice(0, 10) : ''}
                onChange={e => patch({ due_date: e.target.value || null })} disabled={!editable} />
            </Field>
            <Field label="Customer damage" hint="Shows on the export — for the deposit conversation.">
              <textarea className="input" rows={2} value={damage ?? ''} disabled={!editable}
                placeholder="Was this guest-caused? Note it here."
                onChange={e => setDamage(e.target.value)}
                onBlur={() => { if ((damage ?? '') !== (t.damage_note || '')) patch({ damage_note: damage }, 'Damage note saved') }} />
            </Field>
          </Card>

          {(t.watchers || []).length > 0 && (
            <Card className="p-4">
              <Kicker className="!text-dim mb-2">Watching</Kicker>
              <div className="flex items-center gap-2">
                <AvatarStack people={t.watchers.map(w => ({ id: w.user_id, name: w.name, color: w.color }))} size={26} max={6} />
                <span className="text-[12px] text-dim">{t.watchers.length} watching</span>
              </div>
            </Card>
          )}

          {t.first_response_at && (
            <Card className="p-4 text-[12px] text-dim space-y-1">
              <div>First response {ago(t.first_response_at)}.</div>
              {t.closed_at && <div>Closed {ago(t.closed_at)}.</div>}
            </Card>
          )}
        </div>
      </div>

      <CannedManager open={cannedOpen} onClose={() => setCannedOpen(false)}
        onChanged={() => api.get('/tickets/canned').then(setCanned).catch(() => {})} />
    </motion.div>
  )
}
