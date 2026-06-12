import React, { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, CalendarDays, Tent, BedDouble, Wrench, SquareCheckBig, MapPin, Mountain,
  DoorOpen, ShoppingCart, Users, Award, MessagesSquare, BarChart3, ShieldCheck, Bell, Search,
  Menu, X, LogOut, Moon, Sun, MonitorSmartphone, KeyRound, ChevronRight, Undo2,
  Filter, ReceiptText, UtensilsCrossed, Sprout, Backpack, Wallet, Siren, PackageSearch, Sparkles, Megaphone,
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { cx, ago } from '../lib.js'
import { Avatar, IconBtn, Btn, Kicker, Spinner } from './ui.jsx'
import { SPRING, fade, sheetUp } from '../motion.js'
import { Palette } from './Palette.jsx'

export const NAV = [
  {
    group: 'Operate',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, acc: 'acc-blue', end: true },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays, flag: 'bookings', perm: 'bookings.view', acc: 'acc-blue' },
      { to: '/bookings', label: 'Bookings', icon: Tent, flag: 'bookings', perm: 'bookings.view', acc: 'acc-blue' },
      { to: '/leads', label: 'Leads', icon: Filter, flag: 'bookings', perm: 'bookings.leads', acc: 'acc-blue' },
      { to: '/billing', label: 'Billing', icon: ReceiptText, flag: 'bookings', perm: 'bookings.billing', acc: 'acc-blue' },
      { to: '/catering', label: 'Catering', icon: UtensilsCrossed, flag: 'bookings', perm: 'bookings.catering', acc: 'acc-summer' },
      { to: '/accommodation', label: 'Accommodation', icon: BedDouble, flag: 'accommodation', perm: 'accommodation.view', acc: 'acc-lead' },
      { to: '/budgets', label: 'Budgets', icon: Wallet, flag: 'budgets', perm: ['budgets.view', 'budgets.submit'], acc: 'acc-blue', badge: 'expense_pending' },
    ],
  },
  {
    group: 'Property',
    items: [
      { to: '/tickets', label: 'Facilities', icon: Wrench, flag: 'facilities', perm: 'tickets.view', acc: 'acc-ember', badge: 'tickets_open' },
      { to: '/tasks', label: 'Tasks', icon: SquareCheckBig, flag: 'tasks', perm: 'tasks.view', acc: 'acc-summer', badge: 'my_tasks_due' },
      { to: '/gear', label: 'Gear', icon: Backpack, flag: 'gear', perm: 'gear.view', acc: 'acc-summer', badge: 'gear_overdue' },
      { to: '/locations', label: 'Locations', icon: MapPin, flag: 'locations', perm: 'locations.view', acc: 'acc-green' },
      { to: '/map', label: '3D Map', icon: Mountain, flag: 'map', perm: 'map.view', acc: 'acc-green' },
    ],
  },
  {
    group: 'Crew',
    items: [
      { to: '/signout', label: 'Sign-Out', icon: DoorOpen, flag: 'signout', perm: ['signout.use', 'signout.board'], acc: 'acc-lake', badge: 'whos_out' },
      { to: '/shopping', label: 'Shopping', icon: ShoppingCart, flag: 'shopping', perm: 'shopping.view', acc: 'acc-bright' },
      { to: '/safety', label: 'Safety', icon: Siren, flag: 'safety', perm: ['incidents.view', 'incidents.report'], acc: 'acc-ember' },
      { to: '/lostfound', label: 'Lost & Found', icon: PackageSearch, flag: 'lostfound', perm: 'lostfound.view', acc: 'acc-bright' },
      { to: '/people', label: 'People', icon: Users, flag: 'people', perm: 'people.view', acc: 'acc-lead' },
      { to: '/kudos', label: 'Kudos', icon: Award, flag: 'people', perm: 'people.view', acc: 'acc-bright' },
      { to: '/growth', label: 'Growth', icon: Sprout, flag: 'people', perm: ['oneonones.use', 'goals.use', 'feedback.use'], acc: 'acc-green', badge: 'growth_inbox' },
      { to: '/community', label: 'Community', icon: MessagesSquare, flag: 'community', perm: 'community.view', acc: 'acc-lake' },
    ],
  },
  {
    group: 'Insight',
    items: [
      { to: '/reports', label: 'Insights', icon: BarChart3, flag: 'reports', perm: ['reports.view', 'metrics.bookings', 'metrics.facilities', 'metrics.tasks', 'metrics.people', 'metrics.signout', 'metrics.shopping', 'metrics.gear', 'metrics.budgets', 'metrics.safety'], acc: 'acc-blue' },
      { to: '/ai', label: 'Claude AI', icon: Sparkles, flag: 'ai', perm: 'ai.use', acc: 'acc-bright' },
      { to: '/admin', label: 'Admin', icon: ShieldCheck, perm: ['users.manage', 'roles.manage', 'settings.admin', 'audit.view', 'motd.manage', 'system.health'], acc: 'acc-blue' },
    ],
  },
]

export function itemVisible(item, can, flagOn) {
  if (item.flag && !flagOn(item.flag)) return false
  if (!item.perm) return true
  const perms = Array.isArray(item.perm) ? item.perm : [item.perm]
  return perms.some(can)
}

function useActiveItem() {
  const { pathname } = useLocation()
  return useMemo(() => {
    const all = NAV.flatMap(g => g.items)
    return all.find(i => (i.end ? pathname === i.to : pathname.startsWith(i.to) && i.to !== '/')) ||
      all.find(i => i.to === '/')
  }, [pathname])
}

/* ------------------------------------------------ side nav (desktop) */
function SideNav() {
  const { can, flagOn, badges, settings } = useApp()
  return (
    <aside className="hidden lg:flex flex-col w-[248px] shrink-0 bg-panel bg-topo text-panel-ink h-screen-dyn sticky top-0">
      <div className="px-5 pt-6 pb-5 flex items-center gap-3">
        <img src="/brand/logo-stacked-white.png" alt="Muskoka Woods" className="w-11 h-auto drop-shadow" />
        <div>
          <div className="disp text-[22px] leading-none">WoodsOS</div>
          <div className="text-[10.5px] font-head font-semibold tracking-[0.18em] uppercase text-panel-ink/55 mt-0.5">
            {settings.org?.name || 'Muskoka Woods'}
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto no-scrollbar px-3 pb-4">
        {NAV.map(g => {
          const items = g.items.filter(i => itemVisible(i, can, flagOn))
          if (!items.length) return null
          return (
            <div key={g.group} className="mt-4">
              <div className="px-3 pb-1.5 text-[10px] font-head font-bold uppercase tracking-[0.26em] text-panel-ink/40">
                {g.group}
              </div>
              {items.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end} className="block relative">
                  {({ isActive }) => (
                    <span className={cx('relative flex items-center gap-3 px-3 py-[9px] rounded-xl font-head font-semibold text-[13.5px] transition-colors',
                      isActive ? 'text-white' : 'text-panel-ink/70 hover:text-white hover:bg-white/5')}>
                      {isActive && (
                        <motion.span layoutId="nav-active" transition={SPRING}
                          className="absolute inset-0 rounded-xl bg-white/10 ring-1 ring-white/10" />
                      )}
                      {isActive && (
                        <motion.span layoutId="nav-tick" transition={SPRING}
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-green" />
                      )}
                      <item.icon size={17} className="relative z-10 shrink-0" />
                      <span className="relative z-10 flex-1">{item.label}</span>
                      {item.badge && badges[item.badge] > 0 && (
                        <span className="relative z-10 min-w-[20px] text-center px-1.5 py-0.5 rounded-full bg-green text-[#16321c] text-[10.5px] font-bold tnum">
                          {badges[item.badge]}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>
      <UserCard />
    </aside>
  )
}

function UserCard() {
  const { user, logout, theme, setTheme } = useApp()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const next = { auto: 'light', light: 'dark', dark: 'auto' }
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : MonitorSmartphone
  return (
    <div className="relative px-3 pb-4">
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-full left-3 right-3 mb-2 rounded-xl bg-surface text-ink shadow-pop border border-line overflow-hidden">
            <button onClick={() => { setOpen(false); nav('/profile') }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-head font-semibold hover:bg-sunken">
              <KeyRound size={15} className="text-dim" /> My profile & password
            </button>
            <button onClick={() => setTheme(next[theme])}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-head font-semibold hover:bg-sunken">
              <ThemeIcon size={15} className="text-dim" /> Theme: {theme}
            </button>
            <button onClick={logout}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-head font-semibold text-danger hover:bg-danger/8">
              <LogOut size={15} /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition text-left">
        <Avatar name={user.name} color={user.color} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-head font-bold truncate">{user.name}</span>
          <span className="block text-[11px] text-panel-ink/50 truncate">{user.title || user.role_key}</span>
        </span>
        <ChevronRight size={15} className={cx('text-panel-ink/40 transition-transform', open && 'rotate-90')} />
      </button>
    </div>
  )
}

/* ------------------------------------------------ top bar */
function TopBar({ onPalette }) {
  const { badges, my_trip, reload, toast, settings } = useApp()
  const [bellOpen, setBellOpen] = useState(false)

  async function backNow() {
    try {
      await api.post(`/trips/${my_trip.id}/in`)
      toast('Welcome back — signed in ✅')
      reload()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <header className="sticky top-0 z-40 bg-bg/85 backdrop-blur border-b border-line/70"
      style={{ paddingTop: 'var(--sat)' }}>
      <div className="flex items-center gap-2 px-4 sm:px-6 h-[58px]">
        <img src="/brand/logo-white.png" alt="Muskoka Woods" className="h-6 lg:hidden logo-adaptive" />
        <button onClick={onPalette}
          className="hidden sm:flex items-center gap-2.5 flex-1 max-w-[420px] px-3.5 py-2 rounded-xl bg-surface border border-line text-faint hover:border-brand/50 hover:text-dim transition text-[13px] font-head">
          <Search size={14} />
          Search camp… <span className="ml-auto text-[10.5px] border border-line rounded px-1.5 py-0.5">⌘K</span>
        </button>
        <div className="flex-1 sm:hidden" />
        <AnimatePresence>
          {my_trip && (
            <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
              <Btn size="sm" variant="accent" onClick={backNow} className="whitespace-nowrap">
                <Undo2 size={14} /> I’m back
              </Btn>
            </motion.div>
          )}
        </AnimatePresence>
        <IconBtn title="Search" className="sm:hidden" onClick={onPalette}><Search size={19} /></IconBtn>
        <div className="relative">
          <IconBtn title="Notifications" onClick={() => setBellOpen(o => !o)}>
            <Bell size={19} />
            {badges.notifications > 0 && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING}
                className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-ember text-white text-[9.5px] font-bold flex items-center justify-center tnum">
                {badges.notifications > 9 ? '9+' : badges.notifications}
              </motion.span>
            )}
          </IconBtn>
          <NotifPanel open={bellOpen} onClose={() => setBellOpen(false)} />
        </div>
      </div>
    </header>
  )
}

function NotifPanel({ open, onClose }) {
  const { reload } = useApp()
  const [items, setItems] = useState(null)
  const nav = useNavigate()
  const ref = useRef()

  useEffect(() => {
    if (!open) return
    api.get('/notifications').then(setItems).catch(() => setItems([]))
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('pointerdown', onDoc), 0)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open, onClose])

  async function readAll() {
    await api.post('/notifications/read-all').catch(() => {})
    setItems(items?.map(i => ({ ...i, read: true })) || [])
    reload()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={ref} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.16 }}
          className="absolute right-0 top-[110%] w-[min(360px,calc(100vw-24px))] card shadow-pop overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line/70">
            <Kicker className="!text-dim">Notifications</Kicker>
            <button onClick={readAll} className="text-[11.5px] font-head font-bold text-brand hover:underline">Mark all read</button>
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {!items && <div className="py-8 text-center"><Spinner /></div>}
            {items?.length === 0 && <div className="py-8 text-center text-dim text-[13px]">All caught up 🌲</div>}
            {items?.map(n => (
              <button key={n.id} onClick={async () => {
                api.post(`/notifications/${n.id}/read`).catch(() => {})
                onClose()
                if (n.link) nav(n.link)
              }}
                className={cx('w-full text-left flex gap-3 px-4 py-3 border-b border-line/50 last:border-0 hover:bg-sunken/60 transition',
                  !n.read && 'bg-accent/[0.045]')}>
                <span className="text-[18px] leading-none mt-0.5">{n.icon}</span>
                <span className="min-w-0">
                  <span className={cx('block text-[13px] leading-snug', n.read ? 'text-dim' : 'text-ink font-semibold')}>{n.title}</span>
                  {n.body && <span className="block text-[12px] text-faint truncate mt-0.5">{n.body}</span>}
                  <span className="block text-[10.5px] text-faint mt-1 font-head font-semibold uppercase tracking-wider">{ago(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------ mobile tabs */
function MobileTabs({ onMore }) {
  const { can, flagOn, badges } = useApp()
  const candidates = ['/', '/tasks', '/tickets', '/signout', '/bookings', '/locations', '/shopping', '/community']
  const all = NAV.flatMap(g => g.items)
  const tabs = candidates
    .map(to => all.find(i => i.to === to))
    .filter(i => i && itemVisible(i, can, flagOn))
    .slice(0, 4)
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-panel/97 backdrop-blur text-panel-ink border-t border-white/8"
      style={{ paddingBottom: 'var(--sab)' }}>
      <div className="flex">
        {tabs.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} className="flex-1">
            {({ isActive }) => (
              <span className="relative flex flex-col items-center gap-1 pt-2.5 pb-2">
                {isActive && (
                  <motion.span layoutId="tab-glow" transition={SPRING}
                    className="absolute top-0 w-9 h-[3px] rounded-b-full bg-green" />
                )}
                <span className="relative">
                  <item.icon size={21} className={isActive ? 'text-green' : 'text-panel-ink/60'} />
                  {item.badge && badges[item.badge] > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-ember text-white text-[9px] font-bold flex items-center justify-center tnum">
                      {badges[item.badge] > 9 ? '9+' : badges[item.badge]}
                    </span>
                  )}
                </span>
                <span className={cx('text-[10px] font-head font-bold', isActive ? 'text-green' : 'text-panel-ink/55')}>
                  {item.label}
                </span>
              </span>
            )}
          </NavLink>
        ))}
        <button onClick={onMore} className="flex-1 flex flex-col items-center gap-1 pt-2.5 pb-2">
          <Menu size={21} className="text-panel-ink/60" />
          <span className="text-[10px] font-head font-bold text-panel-ink/55">More</span>
        </button>
      </div>
    </nav>
  )
}

function MoreSheet({ open, onClose }) {
  const { can, flagOn, user, logout, theme, setTheme } = useApp()
  const nav = useNavigate()
  const next = { auto: 'light', light: 'dark', dark: 'auto' }
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <motion.div {...fade} className="absolute inset-0 bg-[#0A1B1E]/55" onClick={onClose} />
          <motion.div variants={sheetUp} initial="initial" animate="animate" exit="exit"
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(e, info) => { if (info.offset.y > 80) onClose() }}
            className="absolute bottom-0 inset-x-0 bg-surface rounded-t-2xl shadow-sheet sheet-max overflow-y-auto"
            style={{ paddingBottom: 'calc(var(--sab) + 16px)' }}>
            <div className="pt-2.5 flex justify-center"><span className="w-10 h-1 rounded-full bg-line" /></div>
            <div className="flex items-center gap-3 px-5 pt-3 pb-4 border-b border-line/70">
              <Avatar name={user.name} color={user.color} size={40} />
              <div className="min-w-0 flex-1">
                <div className="font-head font-bold text-[15px] truncate">{user.name}</div>
                <div className="text-[12px] text-dim truncate">{user.title || user.role_key}</div>
              </div>
              <IconBtn title="Close" onClick={onClose}><X size={18} /></IconBtn>
            </div>
            {NAV.map(g => {
              const items = g.items.filter(i => itemVisible(i, can, flagOn))
              if (!items.length) return null
              return (
                <div key={g.group} className="px-5 pt-4">
                  <Kicker className="!text-dim mb-2">{g.group}</Kicker>
                  <div className="grid grid-cols-3 xs:grid-cols-4 gap-2">
                    {items.map(item => (
                      <button key={item.to} onClick={() => { onClose(); nav(item.to) }}
                        className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-sunken/70 hover:bg-sunken transition">
                        <item.icon size={20} className="text-brand" />
                        <span className="text-[11px] font-head font-semibold text-ink text-center leading-tight px-1">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            <div className="px-5 pt-5 flex gap-2">
              <Btn variant="soft" size="sm" className="flex-1" onClick={() => { onClose(); nav('/profile') }}>
                <KeyRound size={14} /> Profile
              </Btn>
              <Btn variant="soft" size="sm" className="flex-1" onClick={() => setTheme(next[theme])}>
                Theme: {theme}
              </Btn>
              <Btn variant="danger" size="sm" className="flex-1" onClick={logout}><LogOut size={14} /> Sign out</Btn>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------ message of the day (FTF) */
function MotdPopup() {
  const [msgs, setMsgs] = useState([])
  useEffect(() => {
    api.get('/motd').then(m => setMsgs(m || [])).catch(() => {})
  }, [])
  async function dismiss(id) {
    setMsgs(list => list.filter(m => m.id !== id))
    api.post(`/motd/${id}/dismiss`).catch(() => {})
  }
  const m = msgs[0]
  return (
    <AnimatePresence>
      {m && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4">
          <motion.div {...fade} className="absolute inset-0 bg-[#0A1B1E]/55 backdrop-blur-[2px]" />
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={SPRING}
            className="relative card shadow-pop w-full max-w-[440px] overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-brand via-green to-brand" />
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                  <Megaphone size={19} className="text-brand" />
                </span>
                <div className="min-w-0">
                  <Kicker className="!text-faint">Message of the day</Kicker>
                  <h3 className="font-head font-bold text-[17px] leading-snug mt-0.5">{m.title}</h3>
                </div>
              </div>
              {m.body && <p className="text-[13.5px] text-dim leading-relaxed mt-3 whitespace-pre-wrap">{m.body}</p>}
              <div className="flex items-center justify-between mt-5">
                <span className="text-[11.5px] text-faint font-head font-semibold">
                  {m.author || 'WoodsOS'}{msgs.length > 1 ? ` · ${msgs.length - 1} more after this` : ''}
                </span>
                <Btn size="sm" onClick={() => dismiss(m.id)}>Got it</Btn>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------ shell */
export default function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const active = useActiveItem()
  const { pathname } = useLocation()

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { setMoreOpen(false) }, [pathname])

  return (
    <div className={cx('flex min-h-screen-dyn bg-bg bg-topo-ink grain', active?.acc || 'acc-blue')}>
      <SideNav />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onPalette={() => setPaletteOpen(true)} />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-7 pb-28 lg:pb-10 max-w-[1280px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
      <MobileTabs onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <MotdPopup />
    </div>
  )
}
