import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { cx, ago, fmtDateLong } from '../../lib.js'
import { Stars } from '../../components/ui.jsx'
import { SWIFT } from '../../motion.js'

const STATUS = {
  open: { label: 'Received', cls: 'bg-lake/12 text-lake', note: 'Our team has it — we’ll pick it up shortly.' },
  in_progress: { label: 'In progress', cls: 'bg-summer/12 text-summer', note: 'Someone is on it right now.' },
  on_hold: { label: 'On hold', cls: 'bg-ember/12 text-ember', note: 'Waiting on a part or a window — not forgotten.' },
  closed: { label: 'Resolved', cls: 'bg-green/20 text-green-dark', note: 'All done. Thanks for telling us!' },
}

export default function Track() {
  const { ptoken } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [rating, setRating] = useState(0)
  const [ratingComment, setRatingComment] = useState('')
  const [ratedNow, setRatedNow] = useState(false)
  const fileRef = useRef()
  const endRef = useRef()

  const load = () =>
    fetch(`/api/public/track/${ptoken}`)
      .then(r => { if (!r.ok) throw new Error('This link is not active anymore.'); return r.json() })
      .then(setData).catch(e => setErr(e.message))

  useEffect(() => {
    load()
    // near-real-time without sockets: poll while the tab is visible
    const iv = setInterval(() => { if (!document.hidden) load() }, 5000)
    const onVis = () => !document.hidden && load()
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [ptoken]) // eslint-disable-line

  const msgCount = data?.messages.length
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgCount])

  async function send(e) {
    e?.preventDefault()
    if (!msg.trim()) return
    setBusy(true)
    try {
      const r = await fetch(`/api/public/track/${ptoken}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not send')
      setMsg(''); load()
    } catch (e2) { setErr(e2.message); setTimeout(() => setErr(''), 4000) } finally { setBusy(false) }
  }

  async function sendPhotos(files) {
    if (!files?.length) return
    setBusy(true)
    try {
      const fd = new FormData()
      for (const f of [...files].slice(0, 2)) fd.append('files', f)
      const r = await fetch(`/api/public/track/${ptoken}/photos`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Upload failed')
      load()
    } catch (e2) { setErr(e2.message); setTimeout(() => setErr(''), 4000) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function sendRating() {
    try {
      const r = await fetch(`/api/public/track/${ptoken}/rating`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: ratingComment }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Could not save')
      setRatedNow(true); load()
    } catch (e2) { setErr(e2.message); setTimeout(() => setErr(''), 4000) }
  }

  if (err && !data) {
    return (
      <div className="min-h-screen-dyn bg-bg bg-topo-ink flex items-center justify-center px-5">
        <div className="card max-w-md w-full p-8 text-center text-ink font-head">{err}</div>
      </div>
    )
  }
  if (!data) return <div className="min-h-screen-dyn bg-bg" />

  const t = data.ticket
  const s = STATUS[t.status] || STATUS.open
  const closed = t.status === 'closed'
  const showRating = closed && !t.rating && !ratedNow
  const photos = data.attachments.filter(a => a.mime?.startsWith('image/'))

  return (
    <div className="min-h-screen-dyn bg-bg bg-topo-ink flex flex-col items-center px-4 sm:px-5"
      style={{ paddingTop: 'calc(var(--sat) + 1.5rem)', paddingBottom: 'calc(var(--sab) + 1.5rem)' }}>
      <motion.img initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        src="/brand/logo-colour.png" alt={data.org.name} className="h-9 mb-5" />

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: SWIFT }}
        className="card max-w-lg w-full overflow-hidden">
        {/* header */}
        <div className="px-5 pt-5 pb-4 border-b border-line/70">
          <div className="flex items-center justify-between gap-3">
            <span className="kicker text-green-dark">{t.code}</span>
            <span className={cx('px-2.5 py-1 rounded-full text-[11.5px] font-head font-bold', s.cls)}>{s.label}</span>
          </div>
          <h1 className="font-head font-bold text-[17px] text-ink mt-1.5 leading-snug">{t.title}</h1>
          <p className="text-[12px] text-faint mt-1">
            Reported {fmtDateLong(t.created_at)}{t.location_name ? ` · ${t.location_name}` : ''}
          </p>
          <p className="text-[12.5px] text-dim mt-1.5">{s.note}</p>
        </div>

        {/* conversation */}
        <div className="px-5 py-4 max-h-[46vh] overflow-y-auto space-y-3">
          {data.messages.length === 0 && (
            <p className="text-[13px] text-faint text-center py-3">Updates from our team will appear here.</p>
          )}
          <AnimatePresence initial={false}>
            {data.messages.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className={cx('flex', m.is_guest ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[85%] rounded-2xl px-3.5 py-2.5',
                  m.is_guest ? 'bg-brand text-white rounded-br-md' : 'bg-sunken text-ink rounded-bl-md')}>
                  <div className={cx('text-[10.5px] font-head font-bold mb-0.5', m.is_guest ? 'text-white/60' : 'text-faint')}>
                    {m.is_guest ? 'You' : m.author_name} · {ago(m.created_at)}
                  </div>
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{m.body}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {photos.length > 0 && (
            <div className="flex gap-2 flex-wrap pt-1">
              {photos.map(p => (
                <a key={p.id} href={`/api/files/${p.filename}`} target="_blank" rel="noreferrer">
                  <img src={`/api/files/${p.filename}`} alt={p.original_name} className="w-16 h-16 object-cover rounded-xl border border-line" />
                </a>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* composer / rating */}
        <div className="px-5 pb-5 pt-3 border-t border-line/70">
          {showRating ? (
            <div className="text-center">
              <p className="font-head font-bold text-[14px] text-ink mb-2">How did we do?</p>
              <div className="flex justify-center mb-3"><Stars value={rating} onChange={setRating} size={30} /></div>
              {rating > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                  <textarea className="input mb-2.5" rows={2} placeholder="Anything to add? (optional)"
                    value={ratingComment} onChange={e => setRatingComment(e.target.value)} />
                  <motion.button whileTap={{ scale: 0.97 }} onClick={sendRating}
                    className="btn w-full py-2.5 rounded-xl bg-brand text-white font-head font-bold text-[14px] hover:bg-brand-deep transition">
                    Send rating
                  </motion.button>
                </motion.div>
              )}
            </div>
          ) : closed ? (
            <p className="text-center text-[12.5px] text-faint">
              {t.rating || ratedNow ? `Thanks for the ${t.rating || rating}-star rating! 🌲` : 'This ticket is resolved.'}
            </p>
          ) : (
            <form onSubmit={send}>
              <div className="flex gap-2 items-end">
                <textarea className="input flex-1 !min-h-0" rows={1} placeholder="Reply to our team…"
                  value={msg} onChange={e => setMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e) }} />
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => sendPhotos(e.target.files)} />
                <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => fileRef.current?.click()}
                  className="p-2.5 rounded-xl bg-sunken text-dim hover:text-ink transition" title="Add a photo" aria-label="Add a photo">
                  📷
                </motion.button>
                <motion.button whileTap={{ scale: 0.95 }} type="submit" disabled={busy || !msg.trim()}
                  className="btn px-4 py-2.5 rounded-xl bg-brand text-white font-head font-bold text-[13.5px] hover:bg-brand-deep transition disabled:opacity-50">
                  Send
                </motion.button>
              </div>
              {err && <div className="text-[12.5px] font-head font-semibold text-danger mt-2">{err}</div>}
              <p className="text-[11px] text-faint mt-2">Keep this link — it’s your private line to the team.</p>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  )
}
