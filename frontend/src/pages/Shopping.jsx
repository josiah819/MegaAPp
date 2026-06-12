import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Car, Check, Flag } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Btn, Kicker, Select, EmptyState, PageLoader, ConfirmBtn, Avatar } from '../components/ui.jsx'
import { cx, ago } from '../lib.js'
import { pageAnim, SPRING } from '../motion.js'

export default function Shopping() {
  const { can, toast, settings } = useApp()
  const [data, setData] = useState(null)
  const [text, setText] = useState('')
  const [qty, setQty] = useState('')
  const [category, setCategory] = useState('Hardware')
  const [townId, setTownId] = useState('')

  const cats = settings.shopping?.categories || ['Other']
  const load = () => api.get('/shopping').then(setData).catch(e => { toast(e.message, 'err') })
  useEffect(() => { load() }, []) // eslint-disable-line

  const byTown = useMemo(() => {
    if (!data) return []
    const groups = new Map()
    for (const item of data.items) {
      const key = item.town_name || 'Anywhere'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [data])

  async function add(e) {
    e?.preventDefault()
    if (!text.trim()) return
    try {
      await api.post('/shopping/items', { text: text.trim(), qty, category, town_id: townId ? Number(townId) : null })
      setText(''); setQty('')
      load()
    } catch (err) { toast(err.message, 'err') }
  }

  async function toggle(item) {
    try { await api.patch(`/shopping/items/${item.id}`, { completed: !item.completed }); load() } catch (e) { toast(e.message, 'err') }
  }

  async function startRun() {
    try { await api.post('/shopping/runs', { town_id: townId ? Number(townId) : null }); toast('Town run started 🚙'); load() } catch (e) { toast(e.message, 'err') }
  }
  async function endRun() {
    try { const r = await api.post(`/shopping/runs/${data.active_run.id}/end`); toast(`Run done — ${r.items_purchased} items picked up`); load() } catch (e) { toast(e.message, 'err') }
  }

  if (!data) return <PageLoader />
  const open = data.items.filter(i => !i.completed).length

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Crew" title="Shopping" sub={`${open} item${open === 1 ? '' : 's'} waiting for the next town run.`}
        actions={can('shopping.run') && !data.active_run && (
          <Btn onClick={startRun}><Car size={15} /> Start town run</Btn>
        )} />

      <AnimatePresence>
        {data.active_run && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <Card className="p-4 mb-5 border-summer/40 bg-summer/[0.05] flex items-center gap-3.5">
              <motion.span animate={{ x: [0, 5, 0] }} transition={{ repeat: Infinity, duration: 1.6 }}>
                <Car size={22} className="text-summer" />
              </motion.span>
              <div className="flex-1 min-w-0">
                <div className="font-head font-bold text-[14px] text-ink">
                  {data.active_run.runner || 'Someone'} is on a run{data.active_run.town_name ? ` to ${data.active_run.town_name}` : ''}
                </div>
                <div className="text-[12px] text-dim">Started {ago(data.active_run.started_at)} — check items off as they’re grabbed.</div>
              </div>
              {can('shopping.run') && <Btn size="sm" variant="accent" onClick={endRun}><Flag size={14} /> End run</Btn>}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {can('shopping.edit') && (
        <form onSubmit={add} className="card p-3.5 mb-5 grid grid-cols-2 sm:grid-cols-[1fr_90px_130px_150px_auto] gap-2">
          <input className="input col-span-2 sm:col-span-1" placeholder="What does camp need?" value={text} onChange={e => setText(e.target.value)} />
          <input className="input" placeholder="Qty" value={qty} onChange={e => setQty(e.target.value)} />
          <Select value={category} onChange={setCategory}>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={townId} onChange={setTownId}>
            <option value="">Any town</option>
            {data.towns.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Btn type="submit" disabled={!text.trim()} className="col-span-2 sm:col-span-1"><Plus size={15} /> Add</Btn>
        </form>
      )}

      {data.items.length === 0 ? (
        <Card><EmptyState icon="🛒" title="List is empty" body="Add what camp needs and it’ll wait here for the next run." /></Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {byTown.map(([town, items]) => (
            <Card key={town} className="p-4">
              <Kicker className="!text-dim mb-3 flex items-center justify-between">
                <span>{town}</span>
                <span className="tnum normal-case tracking-normal">{items.filter(i => !i.completed).length} open</span>
              </Kicker>
              <div className="space-y-1">
                {items.map(item => (
                  <motion.div layout transition={SPRING} key={item.id}
                    className="flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg hover:bg-sunken/60 group">
                    <button disabled={!can('shopping.edit')} onClick={() => toggle(item)}
                      className={cx('w-[21px] h-[21px] rounded-md border-2 flex items-center justify-center transition shrink-0',
                        item.completed ? 'bg-summer border-summer text-white' : 'border-line hover:border-summer')}>
                      <AnimatePresence>{item.completed && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={SPRING}>
                          <Check size={13} strokeWidth={3.5} />
                        </motion.span>
                      )}</AnimatePresence>
                    </button>
                    <span className={cx('flex-1 min-w-0 text-[13.5px]', item.completed ? 'line-through text-faint' : 'text-ink font-semibold')}>
                      {item.text}{item.qty && <span className="text-dim font-normal"> · {item.qty}</span>}
                      <span className="block text-[11px] text-faint font-normal">{item.category}{item.added_by_name ? ` · ${item.added_by_name}` : ''}</span>
                    </span>
                    {can('shopping.edit') && (
                      <ConfirmBtn label="Remove?" onConfirm={async () => { await api.del(`/shopping/items/${item.id}`); load() }} className="hover-reveal">
                        ×
                      </ConfirmBtn>
                    )}
                  </motion.div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {data.last_run && !data.active_run && (
        <div className="text-[12px] text-faint mt-4">
          Last run: {data.last_run.runner || 'someone'} → {data.last_run.town_name || 'town'}, {ago(data.last_run.ended_at)} · {data.last_run.items_purchased} items
        </div>
      )}
    </motion.div>
  )
}
