import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Lock } from 'lucide-react'
import { useApp } from './store.jsx'
import Shell from './components/Shell.jsx'
import { EmptyState, Spinner } from './components/ui.jsx'

import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import CalendarPage from './pages/CalendarPage.jsx'
import Bookings from './pages/Bookings.jsx'
import BookingDetail from './pages/BookingDetail.jsx'
import Accommodation from './pages/Accommodation.jsx'
import Tickets from './pages/Tickets.jsx'
import TicketDetail from './pages/TicketDetail.jsx'
import Tasks from './pages/Tasks.jsx'
import Locations from './pages/Locations.jsx'
import MapPage from './pages/MapPage.jsx'
import SignOut from './pages/SignOut.jsx'
import Shopping from './pages/Shopping.jsx'
import People from './pages/People.jsx'
import PersonProfile from './pages/PersonProfile.jsx'
import Kudos from './pages/Kudos.jsx'
import Community from './pages/Community.jsx'
import Reports from './pages/Reports.jsx'
import Admin from './pages/Admin.jsx'
import Profile from './pages/Profile.jsx'
import Leads from './pages/Leads.jsx'
import Billing from './pages/Billing.jsx'
import Catering from './pages/Catering.jsx'
import Growth from './pages/Growth.jsx'
import Gear from './pages/Gear.jsx'
import Budgets from './pages/Budgets.jsx'
import Safety from './pages/Safety.jsx'
import LostFound from './pages/LostFound.jsx'
import Ai from './pages/Ai.jsx'
import QrPosters from './pages/QrPosters.jsx'
import Screen from './pages/public/Screen.jsx'
import Board from './pages/public/Board.jsx'
import Report from './pages/public/Report.jsx'
import Track from './pages/public/Track.jsx'

function Splash() {
  return (
    <div className="min-h-screen-dyn bg-panel bg-topo flex flex-col items-center justify-center gap-6 text-panel-ink">
      <motion.img src="/brand/logo-stacked-white.png" alt="Muskoka Woods" className="w-24"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
        className="flex flex-col items-center gap-3">
        <div className="disp text-[30px]">WoodsOS</div>
        <Spinner className="!border-white/20 !border-t-green" />
      </motion.div>
    </div>
  )
}

function Protected({ children }) {
  const { user, loading } = useApp()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  return children
}

export function NoAccess() {
  return (
    <EmptyState
      icon={<Lock className="inline text-dim" size={30} />}
      title="This area is locked for you"
      body="Your role doesn’t include access here. An administrator can open it up in Admin → Permissions."
    />
  )
}

function Gate({ flag, perm, children }) {
  const { can, flagOn } = useApp()
  if (flag && !flagOn(flag)) return <NoAccess />
  if (perm) {
    const perms = Array.isArray(perm) ? perm : [perm]
    if (!perms.some(can)) return <NoAccess />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/screen/:token" element={<Screen />} />
      <Route path="/board/:token" element={<Board />} />
      <Route path="/report/:token" element={<Report />} />
      <Route path="/track/:ptoken" element={<Track />} />

      <Route element={<Protected><Shell /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="calendar" element={<Gate flag="bookings" perm="bookings.view"><CalendarPage /></Gate>} />
        <Route path="bookings" element={<Gate flag="bookings" perm="bookings.view"><Bookings /></Gate>} />
        <Route path="bookings/:id" element={<Gate flag="bookings" perm="bookings.view"><BookingDetail /></Gate>} />
        <Route path="leads" element={<Gate flag="bookings" perm="bookings.leads"><Leads /></Gate>} />
        <Route path="billing" element={<Gate flag="bookings" perm="bookings.billing"><Billing /></Gate>} />
        <Route path="catering" element={<Gate flag="bookings" perm="bookings.catering"><Catering /></Gate>} />
        <Route path="accommodation" element={<Gate flag="accommodation" perm="accommodation.view"><Accommodation /></Gate>} />
        <Route path="tickets" element={<Gate flag="facilities" perm="tickets.view"><Tickets /></Gate>} />
        <Route path="tickets/qr-posters" element={<Gate flag="facilities" perm="tickets.view"><QrPosters /></Gate>} />
        <Route path="tickets/:id" element={<Gate flag="facilities" perm="tickets.view"><TicketDetail /></Gate>} />
        <Route path="tasks" element={<Gate flag="tasks" perm="tasks.view"><Tasks /></Gate>} />
        <Route path="gear" element={<Gate flag="gear" perm="gear.view"><Gear /></Gate>} />
        <Route path="budgets" element={<Gate flag="budgets" perm={['budgets.view', 'budgets.submit']}><Budgets /></Gate>} />
        <Route path="safety" element={<Gate flag="safety" perm={['incidents.view', 'incidents.report']}><Safety /></Gate>} />
        <Route path="lostfound" element={<Gate flag="lostfound" perm="lostfound.view"><LostFound /></Gate>} />
        <Route path="ai" element={<Gate flag="ai" perm="ai.use"><Ai /></Gate>} />
        <Route path="locations" element={<Gate flag="locations" perm="locations.view"><Locations /></Gate>} />
        <Route path="map" element={<Gate flag="map" perm="map.view"><MapPage /></Gate>} />
        <Route path="signout" element={<Gate flag="signout" perm={['signout.use', 'signout.board']}><SignOut /></Gate>} />
        <Route path="shopping" element={<Gate flag="shopping" perm="shopping.view"><Shopping /></Gate>} />
        <Route path="people" element={<Gate flag="people" perm="people.view"><People /></Gate>} />
        <Route path="people/:id" element={<Gate flag="people" perm="people.view"><PersonProfile /></Gate>} />
        <Route path="kudos" element={<Gate flag="people" perm="people.view"><Kudos /></Gate>} />
        <Route path="community" element={<Gate flag="community" perm="community.view"><Community /></Gate>} />
        <Route path="growth" element={<Gate flag="people" perm={['oneonones.use', 'goals.use', 'feedback.use']}><Growth /></Gate>} />
        <Route path="reports" element={<Gate flag="reports" perm={['reports.view', 'metrics.bookings', 'metrics.facilities', 'metrics.tasks', 'metrics.people', 'metrics.signout', 'metrics.shopping', 'metrics.gear', 'metrics.budgets', 'metrics.safety']}><Reports /></Gate>} />
        <Route path="admin" element={<Gate perm={['users.manage', 'roles.manage', 'settings.admin', 'audit.view', 'motd.manage', 'system.health']}><Admin /></Gate>} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={
          <EmptyState icon="🧭" title="Off the trail" body="That page doesn’t exist. The map module, however, does." />
        } />
      </Route>
    </Routes>
  )
}
