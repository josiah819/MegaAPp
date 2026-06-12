import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock, Plus, Check, Trash2, Users } from 'lucide-react'
import { api } from '../../api.js'
import { useApp } from '../../store.jsx'
import { Btn, Kicker, Sheet, Field, Select, PageLoader, ConfirmBtn } from '../ui.jsx'
import { cx } from '../../lib.js'
import { SPRING } from '../../motion.js'

/* A single animated matrix cell */
function PermCell({ on, locked, onToggle }) {
  return (
    <button disabled={locked} onClick={onToggle}
      className={cx('mx-auto flex items-center justify-center w-[30px] h-[30px] rounded-lg transition ring-focus',
        locked ? 'cursor-not-allowed' : 'hover:scale-110 active:scale-95')}
      aria-pressed={on}>
      <motion.span layout transition={SPRING}
        className={cx('w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center transition-colors',
          on
            ? locked ? 'bg-brand-deep border-brand-deep text-white/90' : 'bg-accent border-accent text-white'
            : 'border-line bg-transparent')}>
        <AnimatePresence>
          {on && (
            <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}
              transition={SPRING}>
              {locked ? <Lock size={11} /> : <Check size={13} strokeWidth={3.5} />}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </button>
  )
}

export default function PermissionsMatrix() {
  const { toast, flags } = useApp()
  const [data, setData] = useState(null)      // { roles, catalog, modules }
  const [draft, setDraft] = useState({})      // roleKey -> permissions object (working copy)
  const [createOpen, setCreateOpen] = useState(false)
  const [newRole, setNewRole] = useState({ label: '', clone_from: 'staff', rank: 30 })
  const [editRole, setEditRole] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const d = await api.get('/roles').catch(e => { toast(e.message, 'err'); return null })
    if (!d) return
    setData(d)
    setDraft(Object.fromEntries(d.roles.map(r => [r.key, { ...(r.permissions || {}) }])))
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const dirtyRoles = useMemo(() => {
    if (!data) return []
    return data.roles.filter(r => {
      if (r.key === 'admin') return false
      const orig = r.permissions || {}
      const cur = draft[r.key] || {}
      const keys = new Set([...Object.keys(orig), ...Object.keys(cur)])
      return [...keys].some(k => !!orig[k] !== !!cur[k])
    }).map(r => r.key)
  }, [data, draft])

  if (!data) return <PageLoader />

  const flagByModule = Object.fromEntries((flags || []).map(f => [f.key, f]))

  function toggle(roleKey, permKey) {
    if (roleKey === 'admin') return
    setDraft(d => ({ ...d, [roleKey]: { ...d[roleKey], [permKey]: !d[roleKey]?.[permKey] } }))
  }
  function toggleGroup(roleKey, group) {
    if (roleKey === 'admin') return
    const keys = group.perms.map(p => p.key)
    const allOn = keys.every(k => draft[roleKey]?.[k])
    setDraft(d => ({ ...d, [roleKey]: { ...d[roleKey], ...Object.fromEntries(keys.map(k => [k, !allOn])) } }))
  }

  async function saveAll() {
    setSaving(true)
    try {
      for (const key of dirtyRoles) {
        await api.patch(`/roles/${key}`, { permissions: draft[key] })
      }
      toast(`Permissions saved for ${dirtyRoles.length} role${dirtyRoles.length > 1 ? 's' : ''} ✅`)
      await load()
    } catch (e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function createRole() {
    try {
      await api.post('/roles', newRole)
      toast(`Role “${newRole.label}” created`)
      setCreateOpen(false)
      setNewRole({ label: '', clone_from: 'staff', rank: 30 })
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  async function saveRoleMeta() {
    try {
      await api.patch(`/roles/${editRole.key}`, { label: editRole.label, description: editRole.description, rank: Number(editRole.rank) })
      toast('Role updated')
      setEditRole(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-[13px] text-dim max-w-xl">
          Columns are roles, rows are permissions. <b className="text-ink">Administrator is locked on everything</b> — that’s the lockout safety net.
          Per-person exceptions live in the People tab.
        </p>
        <Btn size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New role</Btn>
      </div>

      <div className="card overflow-x-auto scroll-x relative">
        <table className="w-full border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b-2 border-line">
              <th className="sticky left-0 bg-surface z-10 text-left px-4 py-3 kicker text-dim min-w-[230px]">Permission</th>
              {data.roles.map(r => (
                <th key={r.key} className="px-2 py-3 min-w-[92px]">
                  <button onClick={() => r.key !== 'admin' && setEditRole({ ...r })}
                    className={cx('w-full text-center group', r.key !== 'admin' && 'cursor-pointer')}>
                    <span className={cx('block font-head font-bold text-[12.5px]',
                      r.key === 'admin' ? 'text-brand-deep' : 'text-ink group-hover:text-brand transition-colors')}>
                      {r.key === 'admin' && <Lock size={10} className="inline mr-1 -mt-0.5" />}{r.label}
                    </span>
                    <span className="block text-[10px] text-faint font-head font-semibold mt-0.5">
                      <Users size={9} className="inline -mt-0.5 mr-0.5" />{r.members} · rank {r.rank}
                      {!r.is_system && <span className="text-green-dark"> · custom</span>}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.catalog.map(group => {
              const moduleOff = group.module && flagByModule[group.module] && !flagByModule[group.module].enabled
              return (
                <React.Fragment key={group.group}>
                  <tr className="bg-sunken/60">
                    <td className="sticky left-0 bg-sunken z-10 px-4 py-2">
                      <span className="kicker !text-ink">{group.group}</span>
                      {moduleOff && <span className="ml-2 text-[10px] font-head font-bold text-ember uppercase">module off</span>}
                    </td>
                    {data.roles.map(r => (
                      <td key={r.key} className="text-center py-1.5">
                        {r.key !== 'admin' && (
                          <button onClick={() => toggleGroup(r.key, group)}
                            className="text-[10px] font-head font-bold text-faint hover:text-brand uppercase tracking-wider transition">
                            all
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                  {group.perms.map(p => (
                    <tr key={p.key} className={cx('border-b border-line/40 last:border-0 hover:bg-accent/[0.035] transition-colors', moduleOff && 'opacity-50')}>
                      <td className="sticky left-0 bg-surface z-10 px-4 py-2">
                        <span className="block text-[13px] font-semibold text-ink">{p.label}</span>
                        <span className="block text-[11px] text-faint leading-tight">{p.description}</span>
                      </td>
                      {data.roles.map(r => (
                        <td key={r.key} className="text-center py-1">
                          <PermCell
                            on={r.key === 'admin' ? true : !!draft[r.key]?.[p.key]}
                            locked={r.key === 'admin'}
                            onToggle={() => toggle(r.key, p.key)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* save bar */}
      <AnimatePresence>
        {dirtyRoles.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
            transition={SPRING}
            className="fixed z-50 left-1/2 -translate-x-1/2 flex items-center gap-3 px-5 py-3 rounded-2xl bg-brand-deep text-white shadow-pop"
            style={{ bottom: 'calc(var(--sab) + 84px)' }}>
            <span className="text-[13px] font-head font-semibold">
              Unsaved changes · {dirtyRoles.length} role{dirtyRoles.length > 1 ? 's' : ''}
            </span>
            <Btn size="sm" variant="ghost" className="!text-white/70 hover:!text-white"
              onClick={() => setDraft(Object.fromEntries(data.roles.map(r => [r.key, { ...(r.permissions || {}) }])))}>
              Discard
            </Btn>
            <Btn size="sm" variant="accent" onClick={saveAll} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Btn>
          </motion.div>
        )}
      </AnimatePresence>

      {/* create role */}
      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} kicker="Permissions" title="New role"
        footer={<><Btn variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Btn>
          <Btn onClick={createRole} disabled={!newRole.label.trim()}>Create role</Btn></>}>
        <div className="space-y-4">
          <Field label="Role name">
            <input className="input" value={newRole.label} onChange={e => setNewRole(s => ({ ...s, label: e.target.value }))}
              placeholder="Kitchen Lead" />
          </Field>
          <Field label="Start from a copy of" hint="You can fine-tune every permission after creating it.">
            <Select value={newRole.clone_from} onChange={v => setNewRole(s => ({ ...s, clone_from: v }))}>
              <option value="">— blank role —</option>
              {data.roles.filter(r => r.key !== 'admin').map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Rank" hint="Just for ordering — higher ranks list first.">
            <input type="number" className="input" value={newRole.rank} onChange={e => setNewRole(s => ({ ...s, rank: e.target.value }))} />
          </Field>
        </div>
      </Sheet>

      {/* edit role meta */}
      <Sheet open={!!editRole} onClose={() => setEditRole(null)} kicker="Permissions" title={`Edit “${editRole?.label}”`}
        footer={<>
          {editRole && !editRole.is_system && (
            <ConfirmBtn label={editRole.members > 0 ? `Delete & move ${editRole.members} to Staff?` : 'Delete role?'} onConfirm={async () => {
              try {
                const r = await api.del(`/roles/${editRole.key}`)
                toast(r.reassigned ? `Role deleted — ${r.reassigned} people moved to Staff` : 'Role deleted')
                setEditRole(null); load()
              } catch (e) { toast(e.message, 'err') }
            }}><Trash2 size={14} /> Delete</ConfirmBtn>
          )}
          <span className="flex-1" />
          <Btn variant="ghost" onClick={() => setEditRole(null)}>Cancel</Btn>
          <Btn onClick={saveRoleMeta}>Save</Btn>
        </>}>
        {editRole && (
          <div className="space-y-4">
            {editRole.is_system && (
              <div className="text-[12.5px] bg-sunken rounded-xl px-3.5 py-2.5 text-dim">
                System role — you can rename it and edit its permissions, but it can’t be deleted.
              </div>
            )}
            <Field label="Name"><input className="input" value={editRole.label} onChange={e => setEditRole(s => ({ ...s, label: e.target.value }))} /></Field>
            <Field label="Description">
              <textarea className="input" rows={2} value={editRole.description || ''} onChange={e => setEditRole(s => ({ ...s, description: e.target.value }))} />
            </Field>
            <Field label="Rank"><input type="number" className="input" value={editRole.rank} onChange={e => setEditRole(s => ({ ...s, rank: e.target.value }))} /></Field>
          </div>
        )}
      </Sheet>
    </div>
  )
}
