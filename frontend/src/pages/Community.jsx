import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Megaphone, Pin, Send, Cake, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Btn, Kicker, Avatar, Seg, Toggle, PageLoader, EmptyState, ConfirmBtn } from '../components/ui.jsx'
import { cx, ago, fmtDate } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

const KIND_META = {
  announcement: { label: 'Announcement', icon: '📣', cls: 'bg-brand/10 text-brand' },
  praise: { label: 'Praise', icon: '🙌', cls: 'bg-summer/12 text-summer' },
  prayer: { label: 'Prayer', icon: '🙏', cls: 'bg-leadership/12 text-leadership' },
  post: { label: 'Post', icon: '🌲', cls: 'bg-sunken text-dim' },
}
const EMOJIS = ['👏', '❤️', '🙏', '🎉', '🌲']

function PostCard({ p, onChanged }) {
  const { user, can, toast } = useApp()
  const [comments, setComments] = useState(null)
  const [comment, setComment] = useState('')
  const meta = KIND_META[p.kind] || KIND_META.post

  async function react(emoji) {
    try {
      const r = await api.post(`/community/${p.id}/react`, { emoji })
      onChanged({ ...p, reactions: r.reactions })
    } catch (e) { toast(e.message, 'err') }
  }
  async function loadComments() {
    if (comments) { setComments(null); return }
    setComments(await api.get(`/community/${p.id}/comments`).catch(() => []))
  }
  async function sendComment() {
    if (!comment.trim()) return
    try {
      await api.post(`/community/${p.id}/comments`, { body: comment })
      setComment('')
      setComments(await api.get(`/community/${p.id}/comments`))
      onChanged({ ...p, comment_count: Number(p.comment_count) + 1 })
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <Card className={cx('p-4', p.pinned && 'ring-1 ring-green/50')}>
      <div className="flex items-center gap-2.5 mb-2">
        <Avatar name={p.author_name || '?'} color={p.author_color} size={32} />
        <div className="min-w-0 flex-1">
          <span className="font-head font-bold text-[13.5px] text-ink">{p.author_name || 'Someone at camp'}</span>
          <span className="block text-[11px] text-faint">{ago(p.created_at)}</span>
        </div>
        <span className={cx('px-2 py-0.5 rounded-full text-[10.5px] font-head font-bold', meta.cls)}>{meta.icon} {meta.label}</span>
        {p.pinned && <Pin size={13} className="text-green-dark rotate-45" />}
      </div>
      {p.title && <div className="font-head font-bold text-[15px] text-ink mb-1">{p.title}</div>}
      <p className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap">{p.body}</p>
      <div className="flex items-center gap-1 mt-3 flex-wrap">
        {EMOJIS.map(e => {
          const users = (p.reactions || {})[e] || []
          const mine = users.includes(user.id)
          return (
            <motion.button key={e} whileTap={{ scale: 1.25 }} onClick={() => react(e)}
              className={cx('px-2 py-1 rounded-full text-[12.5px] transition border',
                users.length ? 'border-accent/40 bg-accent/8' : 'border-transparent hover:bg-sunken',
                mine && 'ring-1 ring-accent/50')}>
              {e}{users.length > 0 && <span className="ml-1 text-[10.5px] font-bold text-dim tnum">{users.length}</span>}
            </motion.button>
          )
        })}
        <button onClick={loadComments} className="ml-auto text-[12px] font-head font-bold text-dim hover:text-ink transition">
          {p.comment_count > 0 ? `${p.comment_count} comment${p.comment_count > 1 ? 's' : ''}` : 'Comment'}
        </button>
        {(can('community.moderate') || p.author_id === user.id) && (
          <ConfirmBtn label="Remove?" onConfirm={async () => {
            try { await api.del(`/community/${p.id}`); onChanged(null, p.id) } catch (e) { toast(e.message, 'err') }
          }}><Trash2 size={13} /></ConfirmBtn>
        )}
        {can('community.moderate') && (
          <button onClick={async () => { await api.patch(`/community/${p.id}/pin`).catch(() => {}); onChanged({ ...p, pinned: !p.pinned }) }}
            className="text-[12px] font-head font-bold text-dim hover:text-ink"><Pin size={13} className={p.pinned ? 'text-green-dark' : ''} /></button>
        )}
      </div>
      <AnimatePresence>
        {comments && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="mt-3 pt-3 border-t border-line/60 space-y-2.5">
              {comments.map(c => (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar name={c.author_name || '?'} color={c.author_color} size={24} />
                  <div className="bg-sunken/70 rounded-xl px-3 py-2 text-[13px] flex-1">
                    <span className="font-head font-bold text-ink text-[12px]">{c.author_name}</span>
                    <p className="text-ink">{c.body}</p>
                  </div>
                </div>
              ))}
              {can('community.post') && (
                <div className="flex gap-2">
                  <input className="input" placeholder="Add a comment…" value={comment} onChange={e => setComment(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendComment()} />
                  <Btn size="sm" onClick={sendComment} disabled={!comment.trim()}><Send size={13} /></Btn>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

export default function Community() {
  const { can, toast, flagOn } = useApp()
  const [data, setData] = useState(null)
  const [celebrations, setCelebrations] = useState([])
  const [kind, setKind] = useState('post')
  const [body, setBody] = useState('')
  const [anon, setAnon] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/community').then(setData).catch(e => { toast(e.message, 'err') })
  useEffect(() => {
    load()
    if (flagOn('people') && can('people.view')) api.get('/people/celebrations').then(setCelebrations).catch(() => {})
  }, []) // eslint-disable-line

  async function post() {
    setBusy(true)
    try {
      await api.post('/community', { kind, body, anonymous: anon })
      setBody(''); setAnon(false)
      toast('Posted to the board')
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  function onChanged(updated, deletedId) {
    setData(d => ({
      ...d,
      posts: deletedId ? d.posts.filter(x => x.id !== deletedId) : d.posts.map(x => x.id === updated.id ? updated : x),
    }))
  }

  if (!data) return <PageLoader />
  const kinds = [{ v: 'post', label: '🌲 Post' }, { v: 'praise', label: '🙌 Praise' }, { v: 'prayer', label: '🙏 Prayer' }]
  if (can('community.announce')) kinds.unshift({ v: 'announcement', label: '📣 Announce' })

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Crew" title="Community" sub="Announcements, prayer & praise, and life around the property." />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-3">
          {can('community.post') && (
            <Card className="p-4">
              <Seg value={kind} onChange={setKind} options={kinds} size="sm" className="mb-3" />
              <textarea className="input" rows={2} value={body} onChange={e => setBody(e.target.value)}
                placeholder={kind === 'announcement' ? 'Tell the whole crew…' : kind === 'prayer' ? 'Share a prayer request…' : 'What’s happening?'} />
              <div className="flex items-center justify-between mt-2.5">
                {kind !== 'announcement' ? (
                  <label className="flex items-center gap-2 text-[12.5px] font-head font-semibold text-dim cursor-pointer">
                    <Toggle on={anon} onChange={setAnon} label="Post anonymously" /> Anonymous
                  </label>
                ) : <span className="text-[12px] text-dim flex items-center gap-1.5"><Megaphone size={13} /> Goes to the board + smart screens</span>}
                <Btn size="sm" onClick={post} disabled={busy || !body.trim()}>Post</Btn>
              </div>
            </Card>
          )}

          <motion.div variants={stagger(0.05)} initial="initial" animate="animate" className="space-y-3">
            {data.posts.length === 0 && <Card><EmptyState icon="🏕️" title="Quiet board" body="Start the conversation." /></Card>}
            {data.posts.map(p => (
              <motion.div variants={rise} key={p.id}><PostCard p={p} onChanged={onChanged} /></motion.div>
            ))}
          </motion.div>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <Kicker className="!text-dim mb-3">Coming up</Kicker>
            {data.events.length === 0 ? <div className="text-dim text-[13px]">Nothing on the calendar.</div> : (
              <div className="space-y-3">
                {data.events.map(e => (
                  <div key={e.id} className="flex gap-3">
                    <span className="text-[20px] leading-none mt-0.5">{e.emoji}</span>
                    <div className="min-w-0">
                      <div className="font-head font-bold text-[13px] text-ink leading-snug">{e.title}</div>
                      <div className="text-[11.5px] text-dim">{fmtDate(e.date)}{e.location ? ` · ${e.location}` : ''}</div>
                      {e.descr && <div className="text-[11.5px] text-faint mt-0.5">{e.descr}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {celebrations.length > 0 ? (
            <Card className="p-4">
              <Kicker className="!text-dim mb-3 flex items-center gap-1.5"><Cake size={12} /> Celebrations</Kicker>
              <div className="space-y-2.5">
                {celebrations.map((c, i) => (
                  <div key={`${c.kind}${c.id}${i}`} className="flex items-center gap-2.5">
                    <Avatar name={c.name} color={c.color} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink truncate">{c.name}</span>
                      <span className="block text-[11px] text-dim">
                        {c.kind === 'birthday' ? '🎂 Birthday' : `🌲 ${c.years} year${c.years > 1 ? 's' : ''} at camp`}
                      </span>
                    </span>
                    <span className="text-[11.5px] text-faint tnum shrink-0">
                      {c.days === 0 ? 'today 🎉' : c.days === 1 ? 'tomorrow' : `in ${c.days}d`}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ) : data.birthdays.length > 0 && (
            <Card className="p-4">
              <Kicker className="!text-dim mb-3 flex items-center gap-1.5"><Cake size={12} /> Birthdays soon</Kicker>
              <div className="space-y-2.5">
                {data.birthdays.map(b => (
                  <div key={b.id} className="flex items-center gap-2.5">
                    <Avatar name={b.name} color={b.color} size={26} />
                    <span className="text-[13px] font-semibold text-ink flex-1 truncate">{b.name}</span>
                    <span className="text-[11.5px] text-dim tnum">{fmtDate(b.birthday)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </motion.div>
  )
}
