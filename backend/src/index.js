import express from 'express'
import cors from 'cors'
import { migrate } from './migrate.js'
import { requireAuth, requireFlag } from './auth.js'
import { getWeather } from './weather.js'
import { getSetting, ah } from './lib.js'
import { securityHeaders, requestStats, publicLimiter, apiLimiter } from './security.js'

import { router as authRoutes } from './routes/auth.routes.js'
import { router as usersRoutes } from './routes/users.routes.js'
import { router as rolesRoutes } from './routes/roles.routes.js'
import { router as adminRoutes } from './routes/admin.routes.js'
import { router as notificationsRoutes } from './routes/notifications.routes.js'
import { router as searchRoutes } from './routes/search.routes.js'
import { router as bookingsRoutes } from './routes/bookings.routes.js'
import { router as accommodationRoutes } from './routes/accommodation.routes.js'
import { router as locationsRoutes } from './routes/locations.routes.js'
import { router as ticketsRoutes, runScheduledTickets, runTicketSla } from './routes/tickets.routes.js'
import { router as assetsRoutes } from './routes/assets.routes.js'
import { router as tasksRoutes } from './routes/tasks.routes.js'
import { router as tripsRoutes, watchOverdueTrips } from './routes/trips.routes.js'
import { router as shoppingRoutes } from './routes/shopping.routes.js'
import { router as peopleRoutes, watchCertExpiry } from './routes/people.routes.js'
import { router as communityRoutes } from './routes/community.routes.js'
import { router as reportsRoutes } from './routes/reports.routes.js'
import { router as publicRoutes } from './routes/public.routes.js'
import { router as leadsRoutes } from './routes/leads.routes.js'
import { router as billingRoutes } from './routes/billing.routes.js'
import { router as cateringRoutes } from './routes/catering.routes.js'
import { router as growthRoutes } from './routes/growth.routes.js'
import { router as metricsRoutes } from './routes/metrics.routes.js'
import { router as mcpRoutes } from './routes/mcp.routes.js'
import { router as oauthRoutes, wellKnown as oauthWellKnown } from './routes/oauth.routes.js'
import { router as aiRoutes } from './routes/ai.routes.js'
import { router as motdRoutes } from './routes/motd.routes.js'
import { router as gearRoutes, watchOverdueGear } from './routes/gear.routes.js'
import { router as budgetsRoutes, watchBudgetBurn } from './routes/budgets.routes.js'
import { router as safetyRoutes } from './routes/safety.routes.js'
import { router as lostfoundRoutes } from './routes/lostfound.routes.js'
import { router as calendarRoutes } from './routes/calendar.routes.js'
import { UPLOAD_DIR } from './upload.js'

const app = express()
app.set('trust proxy', true)
app.use(cors())
app.use(securityHeaders)
app.use(requestStats)
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'woodsos' }))

// Uploaded files — random 32-hex filenames are the capability; guests need
// these for chat photos, so the route is public by design.
app.use('/api/files', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true, index: false, dotfiles: 'deny' }))

// The MCP endpoint authenticates with personal access tokens or OAuth bearers,
// not sessions — it lives outside the JWT wall and carries its own rate limit.
app.use('/api/mcp', mcpRoutes)

// OAuth 2.1 for Claude.ai chat + Cowork connectors. Discovery metadata lives at
// the domain root (nginx proxies /.well-known/); the endpoints do their own auth
// and need form-encoded bodies (the /token + /authorize POSTs) as well as JSON.
app.use(oauthWellKnown)
app.use('/api/oauth', express.urlencoded({ extended: true }), oauthRoutes)

// Public (token-gated) endpoints
app.use('/api/public', publicLimiter, publicRoutes)

// Auth + bootstrap
app.use('/api/auth', authRoutes)

// Everything below requires a session
app.get('/api/weather', requireAuth, ah(async (req, res) => {
  const screens = await getSetting('screens', {})
  res.json(await getWeather(screens.lat, screens.lon))
}))

// The calendar spans modules (each layer self-gates on its module flag and
// permission) and personal feeds belong to every signed-in account — no flag.
app.use('/api/calendar', requireAuth, apiLimiter, calendarRoutes)

app.use('/api/users', requireAuth, apiLimiter, usersRoutes)
app.use('/api/roles', requireAuth, apiLimiter, rolesRoutes)
app.use('/api/admin', requireAuth, apiLimiter, adminRoutes)
app.use('/api/notifications', requireAuth, apiLimiter, notificationsRoutes)
app.use('/api/search', requireAuth, apiLimiter, searchRoutes)
app.use('/api/motd', requireAuth, apiLimiter, motdRoutes)
app.use('/api/ai', requireAuth, apiLimiter, requireFlag('ai'), aiRoutes)

app.use('/api/bookings', requireAuth, apiLimiter, requireFlag('bookings'), bookingsRoutes)
app.use('/api/leads', requireAuth, apiLimiter, requireFlag('bookings'), leadsRoutes)
app.use('/api/billing', requireAuth, apiLimiter, requireFlag('bookings'), billingRoutes)
app.use('/api/catering', requireAuth, apiLimiter, requireFlag('bookings'), cateringRoutes)
app.use('/api/accommodation', requireAuth, apiLimiter, requireFlag('accommodation'), accommodationRoutes)
app.use('/api/locations', requireAuth, apiLimiter, requireFlag('locations'), locationsRoutes)
app.use('/api/tickets', requireAuth, apiLimiter, requireFlag('facilities'), ticketsRoutes)
app.use('/api/assets', requireAuth, apiLimiter, requireFlag('facilities'), assetsRoutes)
app.use('/api/tasks', requireAuth, apiLimiter, requireFlag('tasks'), tasksRoutes)
app.use('/api/trips', requireAuth, apiLimiter, requireFlag('signout'), tripsRoutes)
app.use('/api/shopping', requireAuth, apiLimiter, requireFlag('shopping'), shoppingRoutes)
app.use('/api/gear', requireAuth, apiLimiter, requireFlag('gear'), gearRoutes)
app.use('/api/budgets', requireAuth, apiLimiter, requireFlag('budgets'), budgetsRoutes)
app.use('/api/safety', requireAuth, apiLimiter, requireFlag('safety'), safetyRoutes)
app.use('/api/lostfound', requireAuth, apiLimiter, requireFlag('lostfound'), lostfoundRoutes)
app.use('/api/people', requireAuth, apiLimiter, requireFlag('people'), peopleRoutes)
app.use('/api/growth', requireAuth, apiLimiter, requireFlag('people'), growthRoutes)
app.use('/api/community', requireAuth, apiLimiter, requireFlag('community'), communityRoutes)
app.use('/api/reports', requireAuth, apiLimiter, requireFlag('reports'), reportsRoutes)
app.use('/api/metrics', requireAuth, apiLimiter, requireFlag('reports'), metricsRoutes)

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

// Error envelope
app.use((err, req, res, next) => {
  const status = err.status || 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err.message || 'Something went wrong' })
})

const PORT = Number(process.env.PORT) || 4000

async function start() {
  let tries = 0
  for (;;) {
    try {
      await migrate()
      break
    } catch (e) {
      if (++tries > 10) throw e
      console.log(`DB not ready (${e.message}) — retrying in 3s`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  // Background work: recurring tickets, SLA escalations, overdue sign-outs,
  // overdue gear, budget burn alerts, certification expiries.
  const tick = () => Promise.allSettled([
    runScheduledTickets(), runTicketSla(), watchOverdueTrips(),
    watchOverdueGear(), watchBudgetBurn(), watchCertExpiry(),
  ])
  setInterval(tick, 10 * 60 * 1000)
  setTimeout(tick, 15 * 1000)

  app.listen(PORT, () => console.log(`WoodsOS API on :${PORT}`))
}

start().catch(e => {
  console.error('Fatal boot error:', e)
  process.exit(1)
})
