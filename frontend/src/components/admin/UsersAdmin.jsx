import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, KeyRound, SlidersHorizontal } from 'lucide-react'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'
import { Btn, Avatar, Badge, Sheet, Field, Select, Toggle, PageLoader, SearchInput, Kicker } from '../ui.jsx'
import { cx, ago } from '../../lib.js'

function OverridesSheet({ user, catalog, roles, onClose, onSaved }) {
  const { toast } = useApp()
  const [over, setOver] = useState({ ...(user.overrides || {}) })
  const role = roles.find(r => r.key === user.role_key)
  const base = role?.permissions || {}
  const count = Object.keys(over).length

  function cycle(key) {
    setOver(o => {
      const cur = o[key]
      const next = { ...o }
      if (cur === undefined) next[key] = true        // inherit -> allow
      else if (cur === true) next[key] = false       // allow -> deny
      else delete next[key]                          // deny -> inherit
      return next
    })
  }

  async function save() {
    try {
      await api.patch(`/users/${user.id}`, { overrides: over })
      toast(`Overrides saved for ${user.name}`)
      onSaved(); onClose()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <Sheet open onClose={onClose} kicker={`${user.name} · ${role?.label || user.role_key}`} title="Per-person overrides" wide
      footer={<>
        <span className="text-[12px] text-dim mr-auto">{count} override{count === 1 ? '' : 's'}</span>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}>Save overrides</Btn>
      </>}>
      <p className="text-[12.5px] text-dim mb-4 -mt-1">
        Overrides beat the role: <b className="text-summer">allow</b> opens a door the role doesn’t,
        <b className="text-danger"> deny</b> closes one it does. Tap a pill to cycle.
      </p>
      <div className="space-y-5">
        {catalog.map(group => (
          <div key={group.group}>
            <Kicker className="!text-dim mb-2">{group.group}</Kicker>
            <div className="space-y-1">
              {group.perms.map(p => {
                const o = over[p.key]
                const effective = o !== undefined ? o : !!base[p.key]
                return (
                  <div key={p.key} className="flex items-center gap-3 py-1">
                    <span className={cx('w-2 h-2 rounded-full shrink-0', effective ? 'bg-summer' : 'bg-line')}
                      title={effective ? 'Effective: allowed' : 'Effective: not allowed'} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink">{p.label}</span>
                    </span>
                    <button onClick={() => cycle(p.key)}
                      className={cx('px-2.5 py-1 rounded-full text-[11px] font-head font-bold uppercase tracking-wider border transition min-w-[72px]',
                        o === undefined && 'border-line text-faint hover:border-faint',
                        o === true && 'border-summer/50 bg-summer/10 text-summer',
                        o === false && 'border-danger/50 bg-danger/10 text-danger')}>
                      {o === undefined ? `role: ${base[p.key] ? 'on' : 'off'}` : o ? 'allow' : 'deny'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

export default function UsersAdmin() {
  const { toast, user: me, reload } = useApp()
  const [users, setUsers] = useState(null)
  const [rolesData, setRolesData] = useState(null)
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [nu, setNu] = useState({ name: '', email: '', role_key: 'staff', dept: 'General', password: '' })
  const [overridesFor, setOverridesFor] = useState(null)
  const [pwdFor, setPwdFor] = useState(null)
  const [pwd, setPwd] = useState('')

  const load = () => Promise.all([
    api.get('/users').then(setUsers),
    api.get('/roles').then(setRolesData),
  ]).catch(e => toast(e.message, 'err'))
  useEffect(() => { load() }, []) // eslint-disable-line

  const filtered = useMemo(() => (users || []).filter(u =>
    !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase())
  ), [users, q])

  if (!users || !rolesData) return <PageLoader />

  async function patch(id, body, msg) {
    try {
      await api.patch(`/users/${id}`, body)
      if (msg) toast(msg)
      load()
      if (id === me.id) reload()
    } catch (e) { toast(e.message, 'err'); load() }
  }

  async function create() {
    try {
      await api.post('/users', nu)
      toast(`${nu.name} added — they can sign in now`)
      setCreateOpen(false)
      setNu({ name: '', email: '', role_key: 'staff', dept: 'General', password: '' })
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Find a person…" className="w-full sm:w-64" />
        <Btn size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> Add person</Btn>
      </div>

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[720px]">
          <thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Overrides</th><th>Last seen</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {filtered.map(u => {
              const overrideCount = Object.keys(u.overrides || {}).length
              return (
                <tr key={u.id} className={cx(!u.active && 'opacity-50')}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} color={u.color} size={32} />
                      <div className="min-w-0">
                        <div className="font-head font-bold text-[13px] text-ink">{u.name}{u.id === me.id && <span className="text-faint font-medium"> · you</span>}</div>
                        <div className="text-[11.5px] text-faint truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Select value={u.role_key} onChange={v => patch(u.id, { role_key: v }, `${u.name} is now ${v}`)} className="!w-[140px]">
                      {rolesData.roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </Select>
                  </td>
                  <td className="text-dim text-[13px]">{u.dept}</td>
                  <td>
                    <button onClick={() => setOverridesFor(u)}
                      className={cx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-head font-bold border transition',
                        overrideCount ? 'border-ember/40 bg-ember/8 text-ember' : 'border-line text-dim hover:border-faint')}>
                      <SlidersHorizontal size={11} />{overrideCount || 'none'}
                    </button>
                  </td>
                  <td className="text-[12px] text-dim whitespace-nowrap">{u.last_login ? ago(u.last_login) : 'never'}</td>
                  <td><Toggle on={u.active} label="Active" onChange={v => patch(u.id, { active: v }, v ? `${u.name} reactivated` : `${u.name} deactivated`)} /></td>
                  <td>
                    <button onClick={() => { setPwdFor(u); setPwd('') }} title="Reset password"
                      className="text-faint hover:text-brand transition"><KeyRound size={15} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} kicker="People" title="Add a person"
        footer={<><Btn variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Btn>
          <Btn onClick={create} disabled={!nu.name || !nu.email || nu.password.length < 8}>Add person</Btn></>}>
        <div className="space-y-4">
          <Field label="Full name"><input className="input" value={nu.name} onChange={e => setNu(s => ({ ...s, name: e.target.value }))} /></Field>
          <Field label="Email"><input type="email" className="input" value={nu.email} onChange={e => setNu(s => ({ ...s, email: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <Select value={nu.role_key} onChange={v => setNu(s => ({ ...s, role_key: v }))}>
                {rolesData.roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </Select>
            </Field>
            <Field label="Department"><input className="input" value={nu.dept} onChange={e => setNu(s => ({ ...s, dept: e.target.value }))} /></Field>
          </div>
          <Field label="Starting password" hint="At least 8 characters — they can change it after first sign-in.">
            <input className="input" value={nu.password} onChange={e => setNu(s => ({ ...s, password: e.target.value }))} />
          </Field>
        </div>
      </Sheet>

      <Sheet open={!!pwdFor} onClose={() => setPwdFor(null)} kicker={pwdFor?.name} title="Reset password"
        footer={<><Btn variant="ghost" onClick={() => setPwdFor(null)}>Cancel</Btn>
          <Btn disabled={pwd.length < 8} onClick={async () => {
            try { await api.post(`/users/${pwdFor.id}/reset-password`, { password: pwd }); toast('Password reset'); setPwdFor(null) }
            catch (e) { toast(e.message, 'err') }
          }}>Reset</Btn></>}>
        <Field label="New password" hint="At least 8 characters. Share it with them directly.">
          <input className="input" value={pwd} onChange={e => setPwd(e.target.value)} />
        </Field>
      </Sheet>

      {overridesFor && (
        <OverridesSheet user={overridesFor} catalog={rolesData.catalog} roles={rolesData.roles}
          onClose={() => setOverridesFor(null)} onSaved={load} />
      )}
    </div>
  )
}
