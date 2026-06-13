import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Plus, Copy, Check, KeyRound, Lock, Terminal, ShieldCheck, Activity } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import {
  PageHead, Card, Btn, Badge, Kicker, Field, Select, Sheet, EmptyState, PageLoader, ConfirmBtn, Tabs,
} from '../components/ui.jsx'
import { cx, ago, fmtDate } from '../lib.js'
import { pageAnim, rise, stagger } from '../motion.js'

/* Claude & AI — WoodsOS is AI-native. Mint a personal access token, hand it to
   plain Claude (Code / Desktop), and every tool mirrors your permissions.
   No API keys, no credits — the token IS you. */

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  return (
    <Btn size="sm" variant="soft" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600) } catch { /* no-op */ }
    }}>
      {done ? <><Check size={13} /> Copied</> : <><Copy size={13} /> {label}</>}
    </Btn>
  )
}

export default function Ai() {
  const { can, toast, user } = useApp()
  const [tokens, setTokens] = useState(null)
  const [tools, setTools] = useState([])
  const [minted, setMinted] = useState(null)   // { token, row } — shown ONCE
  const [mintForm, setMintForm] = useState(null)
  const [tab, setTab] = useState('connect')
  const [allTokens, setAllTokens] = useState(null)
  const [activity, setActivity] = useState(null)

  const load = () => {
    api.get('/ai/tokens').then(setTokens).catch(e => { toast(e.message, 'err'); setTokens([]) })
    api.get('/ai/tools').then(setTools).catch(() => {})
  }
  useEffect(load, []) // eslint-disable-line
  useEffect(() => {
    if (tab === 'org' && can('ai.manage')) {
      api.get('/ai/all-tokens').then(setAllTokens).catch(() => setAllTokens([]))
      api.get('/ai/activity').then(setActivity).catch(() => setActivity([]))
    }
  }, [tab]) // eslint-disable-line

  if (!tokens) return <PageLoader />

  const origin = window.location.origin
  const mcpUrl = `${origin}/api/mcp`
  const exampleToken = minted?.token || 'wos_pat_…your-token…'
  const cmd = `claude mcp add --transport http woodsos ${mcpUrl} --header "Authorization: Bearer ${exampleToken}"`
  const allowed = tools.filter(t => t.allowed)
  const writes = allowed.filter(t => t.write)

  async function mint() {
    try {
      const r = await api.post('/ai/tokens', mintForm)
      setMinted(r); setMintForm(null); load()
    } catch (e) { toast(e.message, 'err') }
  }

  const tabs = [{ v: 'connect', label: 'Connect Claude' }, { v: 'tools', label: `Tools (${allowed.length})` }]
  if (can('ai.manage')) tabs.push({ v: 'org', label: 'Org access' })

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="AI-native" title="Claude & AI"
        sub="WoodsOS speaks MCP. Mint a token, connect plain Claude, and it can read camp, write camp, and brief you — exactly within your permissions." />

      <Tabs value={tab} onChange={setTab} tabs={tabs} className="mb-6" />

      {tab === 'connect' && (
        <motion.div variants={stagger(0.05)} initial="initial" animate="animate" className="grid lg:grid-cols-3 gap-4">
          <motion.div variants={rise} className="lg:col-span-2 space-y-4">
            <Card className="p-5">
              <Kicker className="!text-dim mb-3">Three steps, no API keys</Kicker>
              <ol className="space-y-4">
                {[
                  ['Mint your personal token', 'It inherits your WoodsOS permissions — nothing more. Shown once, revoke any time.'],
                  ['Tell Claude about WoodsOS', 'One command in your terminal connects Claude Code (or add it as a connector in Claude Desktop).'],
                  ['Just talk', '“What’s the daily brief?” · “Open a ticket: dock light flickering at the Boathouse, high priority.” · “Sign 6 walkies out to Emma until 5pm.” · “Export this month’s expenses as CSV.”'],
                ].map(([title, body], i) => (
                  <li key={i} className="flex gap-3.5">
                    <span className="w-7 h-7 rounded-full bg-brand text-white font-head font-bold text-[13px] flex items-center justify-center shrink-0">{i + 1}</span>
                    <span>
                      <span className="block font-head font-bold text-[14px] text-ink">{title}</span>
                      <span className="block text-[12.5px] text-dim mt-0.5 leading-relaxed">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-5 rounded-xl bg-[#10333A] text-[#CFE3DA] p-4 font-mono text-[11.5px] leading-relaxed overflow-x-auto">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#7FA8A0] mb-2">
                  <Terminal size={12} /> claude code
                </div>
                <code className="whitespace-pre-wrap break-all">{cmd}</code>
              </div>
              <div className="flex gap-2 mt-3">
                <CopyBtn text={cmd} label="Copy command" />
                <span className="text-[11.5px] text-faint self-center">
                  {minted ? 'Includes your new token — paste and go.' : 'Mint a token first and the command fills itself in.'}
                </span>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <Kicker className="!text-dim">Your tokens</Kicker>
                <Btn size="sm" onClick={() => setMintForm({ name: 'Claude', days: '' })}><Plus size={13} /> New token</Btn>
              </div>
              {tokens.length === 0 ? (
                <EmptyState icon="🗝️" title="No tokens yet" body="Mint one and Claude is on staff in under a minute." />
              ) : (
                <div className="space-y-2">
                  {tokens.map(t => (
                    <div key={t.id} className={cx('flex flex-wrap items-center gap-2.5 rounded-xl px-3.5 py-2.5 bg-sunken/60', t.revoked && 'opacity-50')}>
                      <KeyRound size={14} className="text-faint shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-head font-bold text-[13px] text-ink">{t.name}</span>
                        <span className="block text-[11px] text-faint font-mono">{t.prefix}</span>
                      </span>
                      <span className="text-[11.5px] text-dim">
                        {t.revoked ? 'revoked' : t.last_used_at ? `used ${ago(t.last_used_at)}` : 'never used'}
                        {t.expires_at && !t.revoked ? ` · expires ${fmtDate(t.expires_at)}` : ''}
                      </span>
                      {!t.revoked && (
                        <ConfirmBtn label="Revoke?" onConfirm={async () => {
                          try { await api.del(`/ai/tokens/${t.id}`); toast('Token revoked'); load() } catch (e) { toast(e.message, 'err') }
                        }}>Revoke</ConfirmBtn>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <Kicker className="!text-dim mb-2.5">Claude.ai chat &amp; Cowork</Kicker>
              <p className="text-[12.5px] text-dim leading-relaxed mb-3">
                Chat, Desktop and Cowork connect through a <b className="text-ink">custom connector</b> (OAuth) instead of a
                pasted token. In Claude, open <b className="text-ink">Customize → Connectors</b>, hit{' '}
                <b className="text-ink">+ → Add custom connector</b>, and give it this URL:
              </p>
              <div className="rounded-xl bg-sunken px-3.5 py-2.5 font-mono text-[12px] break-all select-all">{mcpUrl}</div>
              <p className="text-[12.5px] text-dim leading-relaxed mt-3">
                Claude walks you through signing in to WoodsOS and approving access — it then acts as you, within your
                permissions. In a conversation, open the <b className="text-ink">+ menu (lower left) → Connectors</b> and
                switch WoodsOS on. On Team/Enterprise an owner adds the same URL under{' '}
                <b className="text-ink">Organization settings → Connectors</b>, then everyone connects with one click.
              </p>
              <p className="text-[11.5px] text-faint mt-2.5">
                Needs WoodsOS on a public HTTPS address (a tunnel or deploy) so Claude’s cloud can reach it.
                On your local network, Claude Code above is the way in.
              </p>
            </Card>
          </motion.div>

          <motion.div variants={rise} className="space-y-4">
            <div className="rounded-2xl p-5 bg-panel bg-topo text-panel-ink shadow-soft overflow-hidden">
              <Sparkles size={22} className="text-green mb-3" />
              <div className="disp text-[24px] leading-tight text-white">The token is you.</div>
              <p className="text-[12.5px] text-panel-ink/80 leading-relaxed mt-2">
                Every tool call resolves your live permissions at that moment. Lose a permission, Claude loses it too.
                Write tools additionally need the <b className="text-white">AI can write</b> permission — and everything
                Claude changes lands in the audit log with your name on it.
              </p>
            </div>
            <Card className="p-5">
              <Kicker className="!text-dim mb-2.5">What you can do right now</Kicker>
              <div className="space-y-1.5 text-[12.5px]">
                <div className="flex justify-between"><span className="text-dim">Tools available to you</span><b className="font-head text-ink tnum">{allowed.length}</b></div>
                <div className="flex justify-between"><span className="text-dim">…of which write tools</span><b className="font-head text-ink tnum">{writes.length}</b></div>
                <div className="flex justify-between"><span className="text-dim">AI write access</span>
                  <Badge className={can('ai.write') ? 'bg-summer/12 text-summer' : 'bg-sunken text-dim'}>{can('ai.write') ? 'on' : 'read-only'}</Badge>
                </div>
              </div>
              <p className="text-[11.5px] text-faint mt-3">Also try the machine-readable front door: <a className="text-brand hover:underline" href="/llms.txt" target="_blank" rel="noreferrer">/llms.txt</a></p>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {tab === 'tools' && (
        <div className="space-y-2">
          <p className="text-[12.5px] text-dim mb-3">
            The full catalog. Locked tools need a permission you don’t hold — an admin can grant it in Admin → Permissions.
          </p>
          {tools.map(t => (
            <Card key={t.name} className={cx('p-3.5 flex items-start gap-3', !t.allowed && 'opacity-55')}>
              <span className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                t.allowed ? 'bg-accent/10 text-accent' : 'bg-sunken text-faint')}>
                {t.allowed ? <Sparkles size={15} /> : <Lock size={14} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-[12.5px] font-bold text-ink">{t.name}</code>
                  {t.write && <Badge className="bg-ember/10 text-ember">write</Badge>}
                  {t.perm && !t.allowed && <Badge className="bg-sunken text-faint">{t.perm}</Badge>}
                </span>
                <span className="block text-[12px] text-dim mt-1 leading-relaxed">{t.description}</span>
              </span>
            </Card>
          ))}
        </div>
      )}

      {tab === 'org' && can('ai.manage') && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <Kicker className="!text-dim mb-3 flex items-center gap-2"><ShieldCheck size={13} /> Every token in the org</Kicker>
            {!allTokens ? <PageLoader /> : allTokens.length === 0 ? (
              <div className="text-[12.5px] text-faint">Nobody has minted one yet.</div>
            ) : (
              <div className="space-y-1.5">
                {allTokens.map(t => (
                  <div key={t.id} className={cx('flex items-center gap-2.5 text-[12.5px] rounded-xl px-3 py-2 bg-sunken/50', t.revoked && 'opacity-45')}>
                    <span className="font-head font-bold text-ink min-w-0 truncate">{t.user_name}</span>
                    <span className="text-faint font-mono text-[11px]">{t.prefix}</span>
                    <span className="ml-auto text-faint shrink-0">{t.revoked ? 'revoked' : t.last_used_at ? `used ${ago(t.last_used_at)}` : 'unused'}</span>
                    {!t.revoked && (
                      <ConfirmBtn label="Revoke?" onConfirm={async () => {
                        await api.del(`/ai/tokens/${t.id}`)
                        setAllTokens(await api.get('/ai/all-tokens'))
                      }}>Revoke</ConfirmBtn>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <Kicker className="!text-dim mb-3 flex items-center gap-2"><Activity size={13} /> AI activity (writes are audited)</Kicker>
            {!activity ? <PageLoader /> : activity.length === 0 ? (
              <div className="text-[12.5px] text-faint">No AI writes yet — reads don’t log.</div>
            ) : (
              <div className="space-y-1.5 max-h-[440px] overflow-y-auto">
                {activity.map((a, i) => (
                  <div key={i} className="text-[12px] flex items-center gap-2">
                    <span className="font-head font-bold text-ink shrink-0">{a.user_name}</span>
                    <code className="text-dim font-mono text-[11px] truncate">{a.action}</code>
                    <span className="text-faint ml-auto shrink-0">{ago(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* mint sheet */}
      <Sheet open={!!mintForm} onClose={() => setMintForm(null)} kicker="Claude & AI" title="Mint a personal token"
        footer={<><Btn variant="ghost" onClick={() => setMintForm(null)}>Cancel</Btn><Btn onClick={mint}>Mint token</Btn></>}>
        {mintForm && (
          <div className="space-y-4">
            <Field label="Name it" hint="So future-you knows which device this lives on.">
              <input className="input" value={mintForm.name} onChange={e => setMintForm(s => ({ ...s, name: e.target.value }))} placeholder="Claude on my laptop" />
            </Field>
            <Field label="Expiry">
              <Select value={mintForm.days} onChange={v => setMintForm(s => ({ ...s, days: v }))}>
                <option value="">Never (revoke manually)</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </Select>
            </Field>
          </div>
        )}
      </Sheet>

      {/* token reveal — shown exactly once */}
      <Sheet open={!!minted} onClose={() => setMinted(null)} kicker="Copy it now" title="Your token — shown once"
        footer={<Btn onClick={() => setMinted(null)}>I’ve copied it</Btn>}>
        {minted && (
          <div className="space-y-4">
            <p className="text-[13px] text-dim leading-relaxed">
              This is the only time WoodsOS will show the full token — only its fingerprint is stored.
            </p>
            <div className="rounded-xl bg-sunken p-3.5 font-mono text-[12px] break-all select-all">{minted.token}</div>
            <div className="flex gap-2">
              <CopyBtn text={minted.token} label="Copy token" />
              <CopyBtn text={`claude mcp add --transport http woodsos ${mcpUrl} --header "Authorization: Bearer ${minted.token}"`} label="Copy full command" />
            </div>
          </div>
        )}
      </Sheet>
    </motion.div>
  )
}
