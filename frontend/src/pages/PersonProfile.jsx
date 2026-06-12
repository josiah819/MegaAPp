import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Cake, Phone, Mail, MapPinned, ScrollText, Plus } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { Card, Kicker, Avatar, Badge, PageLoader, Btn, Field, Select, Sheet, ConfirmBtn } from '../components/ui.jsx'
import { cx, ago, fmtDate, untilTxt } from '../lib.js'
import { pageAnim } from '../motion.js'

/* Certifications card — lifeguard, first aid, food safe; expiry color-coded. */
function CertsCard({ person, onChanged }) {
  const { can, toast } = useApp()
  const [form, setForm] = useState(null)
  const certs = person.certs || []
  const canManage = can('people.certs')
  if (!certs.length && !canManage) return null

  const chip = c => {
    if (!c.expires) return ['no expiry', 'bg-sunken text-dim']
    if (c.days_left < 0) return [`expired ${fmtDate(c.expires)}`, 'bg-danger/12 text-danger']
    if (c.days_left <= 60) return [`expires in ${c.days_left}d`, 'bg-ember/12 text-ember']
    return [`until ${fmtDate(c.expires)}`, 'bg-summer/12 text-summer']
  }

  async function save() {
    try {
      await api.post('/people/certs', { ...form, user_id: person.id })
      toast('Certification added 📜'); setForm(null); onChanged()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <Kicker className="!text-dim">Certifications</Kicker>
        {canManage && (
          <Btn size="sm" variant="ghost" onClick={() => setForm({ name: '', issuer: '', issued: '', expires: '', notes: '' })}>
            <Plus size={13} /> Add
          </Btn>
        )}
      </div>
      {certs.length === 0 && <div className="text-[12.5px] text-faint">None on file.</div>}
      <div className="space-y-2">
        {certs.map(c => {
          const [label, cls] = chip(c)
          return (
            <div key={c.id} className="flex items-center gap-2.5">
              <ScrollText size={14} className="text-faint shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-head font-semibold text-ink truncate">{c.name}</span>
                {c.issuer && <span className="block text-[11px] text-faint truncate">{c.issuer}</span>}
              </span>
              <Badge className={cls}>{label}</Badge>
              {canManage && (
                <ConfirmBtn label="Remove?" onConfirm={async () => {
                  await api.del(`/people/certs/${c.id}`); onChanged()
                }}>×</ConfirmBtn>
              )}
            </div>
          )
        })}
      </div>
      <Sheet open={!!form} onClose={() => setForm(null)} kicker={person.name} title="Add certification"
        footer={<><Btn variant="ghost" onClick={() => setForm(null)}>Cancel</Btn><Btn onClick={save} disabled={!form?.name?.trim()}>Add</Btn></>}>
        {form && (
          <div className="space-y-4">
            <Field label="Certification"><input className="input" value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} placeholder="National Lifeguard (NL)" /></Field>
            <Field label="Issuer"><input className="input" value={form.issuer} onChange={e => setForm(s => ({ ...s, issuer: e.target.value }))} placeholder="Lifesaving Society" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issued"><input type="date" className="input" value={form.issued} onChange={e => setForm(s => ({ ...s, issued: e.target.value }))} /></Field>
              <Field label="Expires"><input type="date" className="input" value={form.expires} onChange={e => setForm(s => ({ ...s, expires: e.target.value }))} /></Field>
            </div>
            <Field label="Notes"><input className="input" value={form.notes} onChange={e => setForm(s => ({ ...s, notes: e.target.value }))} /></Field>
          </div>
        )}
      </Sheet>
    </Card>
  )
}

export default function PersonProfile() {
  const { id } = useParams()
  const nav = useNavigate()
  const { toast, settings } = useApp()
  const [p, setP] = useState(null)

  const loadPerson = () => api.get(`/people/${id}`).then(setP).catch(e => { toast(e.message, 'err'); nav('/people') })
  useEffect(() => {
    setP(null)
    loadPerson()
  }, [id]) // eslint-disable-line

  if (!p) return <PageLoader />
  const values = settings.org?.values || []
  const vMeta = key => values.find(v => v.key === key)

  return (
    <motion.div {...pageAnim}>
      <button onClick={() => nav('/people')} className="flex items-center gap-1.5 text-[12.5px] font-head font-bold text-dim hover:text-ink transition mb-5">
        <ArrowLeft size={14} /> People
      </button>

      <div className="flex flex-wrap items-center gap-5 mb-7">
        <Avatar name={p.name} color={p.color} size={84} />
        <div className="min-w-0">
          <h1 className="disp text-[38px] sm:text-[46px] text-ink leading-none">{p.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <Badge className="bg-brand/10 text-brand">{p.title || p.role_label}</Badge>
            <Badge className="bg-sunken text-dim">{p.dept}</Badge>
            {p.trip ? (
              <Badge className="bg-ember/12 text-ember">Off property · {p.trip.destination || 'out'}{p.trip.expected_return ? ` · ${untilTxt(p.trip.expected_return)}` : ''}</Badge>
            ) : (
              <Badge className="bg-summer/12 text-summer">On property</Badge>
            )}
          </div>
          {p.bio && <p className="text-dim text-[13.5px] mt-2.5 max-w-xl leading-relaxed">{p.bio}</p>}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="p-5">
            <Kicker className="!text-dim mb-4">Kudos shelf</Kicker>
            {p.kudos.length === 0 ? (
              <div className="text-dim text-[13.5px]">No kudos yet — be the first. 🌟</div>
            ) : (
              <div className="space-y-3.5">
                {p.kudos.map(k => {
                  const v = vMeta(k.value_key)
                  return (
                    <motion.div key={k.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl bg-sunken/60 px-4 py-3">
                      <div className="flex items-center gap-2 text-[12px] mb-1">
                        <Avatar name={k.from_name || '?'} color={k.from_color} size={20} />
                        <span className="font-head font-bold text-ink">{k.from_name || 'Someone'}</span>
                        {v && <span className="text-dim">· {v.emoji} {v.name}</span>}
                        <span className="text-faint ml-auto">{ago(k.created_at)}</span>
                      </div>
                      <p className="text-[13.5px] text-ink leading-relaxed">{k.message}</p>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5 space-y-2.5 text-[13.5px]">
            <Kicker className="!text-dim mb-1">Contact</Kicker>
            {p.email && <a className="flex items-center gap-2.5 text-brand hover:underline" href={`mailto:${p.email}`}><Mail size={14} className="text-faint" />{p.email}</a>}
            {p.phone ? <a className="flex items-center gap-2.5 text-brand hover:underline" href={`tel:${p.phone}`}><Phone size={14} className="text-faint" />{p.phone}</a> : <span className="flex items-center gap-2.5 text-dim"><Phone size={14} className="text-faint" />No phone on file</span>}
            {p.birthday && <span className="flex items-center gap-2.5 text-ink"><Cake size={14} className="text-faint" />{fmtDate(p.birthday)}</span>}
            {p.start_date && <span className="flex items-center gap-2.5 text-dim">🌲 At camp since {fmtDate(p.start_date)}</span>}
          </Card>

          {(p.manager_name || (p.reports || []).length > 0) && (
            <Card className="p-5">
              <Kicker className="!text-dim mb-3">Reporting line</Kicker>
              {p.manager_name && (
                <Link to={`/people/${p.manager_id}`} className="flex items-center gap-2.5 text-[13px] text-ink hover:text-brand transition mb-2">
                  <span className="text-faint text-[11px] font-head font-bold uppercase w-14 shrink-0">Lead</span>
                  {p.manager_name}
                </Link>
              )}
              {(p.reports || []).map(r => (
                <Link key={r.id} to={`/people/${r.id}`} className="flex items-center gap-2.5 text-[13px] text-ink hover:text-brand transition py-0.5">
                  <span className="text-faint text-[11px] font-head font-bold uppercase w-14 shrink-0">Team</span>
                  <Avatar name={r.name} color={r.color} size={20} /> {r.name}
                </Link>
              ))}
            </Card>
          )}

          <CertsCard person={p} onChanged={loadPerson} />

          <Card className="p-5">
            <Kicker className="!text-dim mb-3">Open tasks</Kicker>
            {p.open_tasks.length === 0 ? <div className="text-dim text-[13px]">A clean plate.</div> : (
              <div className="space-y-2">
                {p.open_tasks.map(t => (
                  <Link key={t.id} to="/tasks" className="flex items-center gap-2.5 group">
                    <MapPinned size={13} className="text-faint shrink-0" />
                    <span className="text-[13px] text-ink truncate group-hover:text-brand flex-1">{t.title}</span>
                    {t.due && <span className="text-[11.5px] text-faint tnum shrink-0">{fmtDate(t.due)}</span>}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </motion.div>
  )
}
