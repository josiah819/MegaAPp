import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api, getToken, setToken } from './api.js'

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

let toastId = 0

export function AppProvider({ children }) {
  const [state, setState] = useState({ user: null, flags: [], settings: {}, badges: {}, my_trip: null })
  const [loading, setLoading] = useState(!!getToken())
  const [toasts, setToasts] = useState([])
  const [theme, setThemeState] = useState(() => localStorage.getItem('wos_theme') || 'auto')

  const toast = useCallback((msg, tone = 'ok') => {
    const id = ++toastId
    setToasts(t => [...t, { id, msg, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3600)
  }, [])

  const reload = useCallback(async () => {
    if (!getToken()) { setState(s => ({ ...s, user: null })); setLoading(false); return }
    try {
      const data = await api.get('/auth/bootstrap')
      setState(data)
    } catch (e) {
      if (e.message !== 'Signed out') console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  // soft-refresh badges while the app is open
  useEffect(() => {
    if (!state.user) return
    const t = setInterval(reload, 90 * 1000)
    return () => clearInterval(t)
  }, [state.user, reload])

  const login = useCallback(async (email, password) => {
    const { token } = await api.post('/auth/login', { email, password })
    setToken(token)
    setLoading(true)
    await reload()
  }, [reload])

  const logout = useCallback(() => {
    setToken(null)
    setState({ user: null, flags: [], settings: {}, badges: {}, my_trip: null })
  }, [])

  const setTheme = useCallback(t => {
    setThemeState(t)
    localStorage.setItem('wos_theme', t)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && mq.matches)
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const can = useCallback(key => !!state.user?.perms?.[key], [state.user])
  const flagOn = useCallback(key => {
    const f = state.flags.find(x => x.key === key)
    return f ? !!f.enabled : true
  }, [state.flags])

  return (
    <AppCtx.Provider value={{ ...state, loading, reload, login, logout, can, flagOn, toast, theme, setTheme }}>
      {children}
      <div className="fixed z-[90] left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none"
        style={{ bottom: 'calc(var(--sab) + 18px)' }}>
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className={`pointer-events-auto px-4 py-2.5 rounded-xl shadow-pop text-[13px] font-head font-semibold
                ${t.tone === 'err' ? 'bg-danger text-white' : 'bg-brand-deep text-white'}`}>
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </AppCtx.Provider>
  )
}
