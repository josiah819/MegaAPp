// The WoodsOS permission catalog.
// Access is resolved in three layers:
//   1. module_flags  — org-wide kill switch per module (off = hidden for everyone)
//   2. roles.permissions — the role matrix edited in Admin → Permissions
//   3. users.overrides  — per-person allow/deny that beats the role
// The admin role is hardcoded to every permission as lockout protection.
//
// Every feature ships behind its own key so departments (or individual people)
// can be granted exactly the slice of WoodsOS they need.

export const MODULES = [
  { key: 'bookings',      label: 'Bookings & Calendar',  description: 'Guest groups, leads, billing, catering, and the property calendar' },
  { key: 'accommodation', label: 'Accommodation',        description: 'Weekly lodging grid, room blocks, and the housekeeping board' },
  { key: 'facilities',    label: 'Facilities',           description: 'Maintenance tickets, guest reports, chat, and assets' },
  { key: 'tasks',         label: 'Tasks & Seasons',      description: 'Unified task board with seasonal phases, templates, and sub-tasks' },
  { key: 'locations',     label: 'Locations',            description: 'Property registry and housekeeping status' },
  { key: 'signout',       label: 'Sign-Out',             description: 'Off-property sign-out and the emergency board' },
  { key: 'shopping',      label: 'Shopping',             description: 'Shared shopping list and town runs' },
  { key: 'gear',          label: 'Gear & Equipment',     description: 'Camp equipment catalog, checkout, and returns' },
  { key: 'budgets',       label: 'Budgets',              description: 'Department budgets, expenses, and approvals' },
  { key: 'safety',        label: 'Safety & Incidents',   description: 'Incident reports, severity tracking, and follow-ups' },
  { key: 'lostfound',     label: 'Lost & Found',         description: 'Found-item log and lost-item reports' },
  { key: 'people',        label: 'People & Growth',      description: 'Directory, kudos, pulse, 1:1s, goals, feedback, certifications' },
  { key: 'community',     label: 'Community',            description: 'Announcements, posts, and staff events' },
  { key: 'map',           label: '3D Property Map',      description: 'Interactive virtual map of the property' },
  { key: 'screens',       label: 'Smart Screens',        description: 'Lobby displays with schedule and weather' },
  { key: 'reports',       label: 'Insights',             description: 'Per-module metrics dashboards and analytics' },
  { key: 'ai',            label: 'Claude & AI',          description: 'Connect Claude to WoodsOS — personal access tokens and AI tools' },
]

export const PERM_GROUPS = [
  {
    group: 'Operate', module: 'bookings',
    perms: [
      { key: 'bookings.view',     label: 'View bookings',     description: 'See guest groups and the calendar' },
      { key: 'bookings.edit',     label: 'Edit bookings',     description: 'Create and update groups, dates, headcounts' },
      { key: 'bookings.manage',   label: 'Manage bookings',   description: 'Delete bookings and edit booking settings' },
      { key: 'bookings.leads',    label: 'Leads pipeline',    description: 'Work the inquiry funnel and convert leads to bookings' },
      { key: 'bookings.billing',  label: 'Billing',           description: 'Invoices, payments, and revenue tracking' },
      { key: 'bookings.catering', label: 'Catering',          description: 'Meal services, the kitchen sheet, and dietary rollups' },
    ],
  },
  {
    group: 'Accommodation', module: 'accommodation',
    perms: [
      { key: 'accommodation.view', label: 'View lodging grid',  description: 'See the weekly accommodation board' },
      { key: 'accommodation.edit', label: 'Edit room blocks',   description: 'Assign groups to lodges and rooms' },
      { key: 'housekeeping.board', label: 'Housekeeping board', description: 'The daily turnover board — checkouts, arrivals, room readiness' },
    ],
  },
  {
    group: 'Facilities', module: 'facilities',
    perms: [
      { key: 'tickets.view',          label: 'View tickets',      description: 'See maintenance tickets and guest reports' },
      { key: 'tickets.edit',          label: 'Work tickets',      description: 'Create, respond, assign, change status' },
      { key: 'tickets.priority',      label: 'Set priority',      description: 'Assign or change ticket priority (incl. ASAP)' },
      { key: 'tickets.tag',           label: 'Tag tickets',       description: 'Add and remove tags on tickets' },
      { key: 'tickets.tags_manage',   label: 'Manage tags',       description: 'Create, recolor, and retire the tag catalog' },
      { key: 'tickets.chat',          label: 'Guest chat',        description: 'Message submitters on their tracking page and manage chat links' },
      { key: 'tickets.close',         label: 'Close tickets',     description: 'Resolve and close tickets directly' },
      { key: 'tickets.approve_close', label: 'Approve closures',  description: 'Approve or deny pending closure requests from staff' },
      { key: 'tickets.canned',        label: 'Canned responses',  description: 'Manage the saved-reply library' },
      { key: 'tickets.delete',        label: 'Delete tickets',    description: 'Hard-delete tickets and their history' },
      { key: 'tickets.schedule',      label: 'Recurring tickets', description: 'Manage scheduled / recurring tickets' },
      { key: 'tickets.export',        label: 'Export tickets',    description: 'Download the ticket register as CSV' },
      { key: 'assets.view',           label: 'View assets',       description: 'See the equipment registry and service history' },
      { key: 'assets.edit',           label: 'Edit assets',       description: 'Add equipment, log service, set next-service dates' },
    ],
  },
  {
    group: 'Tasks & Seasons', module: 'tasks',
    perms: [
      { key: 'tasks.view',      label: 'View tasks',      description: 'See the board, lists, and phases' },
      { key: 'tasks.edit',      label: 'Edit tasks',      description: 'Create, assign, move, and complete tasks and sub-tasks' },
      { key: 'tasks.templates', label: 'Task templates',  description: 'Create checklist templates and stamp them onto the board' },
      { key: 'tasks.manage',    label: 'Manage workflow', description: 'Edit status columns and seasonal phases' },
    ],
  },
  {
    group: 'Property', module: 'locations',
    perms: [
      { key: 'locations.view',   label: 'View locations',    description: 'See the property registry' },
      { key: 'locations.edit',   label: 'Update conditions', description: 'Change housekeeping condition and notes' },
      { key: 'locations.manage', label: 'Manage locations',  description: 'Add and edit locations and categories' },
    ],
  },
  {
    group: 'Sign-Out', module: 'signout',
    perms: [
      { key: 'signout.use',    label: 'Sign out',        description: 'Sign yourself (and companions) off property' },
      { key: 'signout.board',  label: 'View the board',  description: 'See who is off property right now' },
      { key: 'signout.manage', label: 'Manage sign-out', description: 'Edit trips and sign people back in' },
    ],
  },
  {
    group: 'Shopping', module: 'shopping',
    perms: [
      { key: 'shopping.view', label: 'View the list', description: 'See shopping items and town runs' },
      { key: 'shopping.edit', label: 'Edit the list', description: 'Add, check off, and remove items' },
      { key: 'shopping.run',  label: 'Run to town',   description: 'Start and finish town runs' },
    ],
  },
  {
    group: 'Gear & Equipment', module: 'gear',
    perms: [
      { key: 'gear.view',     label: 'View gear',     description: 'See the equipment catalog and who has what' },
      { key: 'gear.checkout', label: 'Check out gear', description: 'Sign equipment out and back in' },
      { key: 'gear.manage',   label: 'Manage gear',   description: 'Add items, adjust quantities, force-return, retire equipment' },
    ],
  },
  {
    group: 'Budgets', module: 'budgets',
    perms: [
      { key: 'budgets.view',    label: 'View budgets',     description: 'See budgets, burn rate, and expense history' },
      { key: 'budgets.submit',  label: 'Submit expenses',  description: 'Log spending against a budget (with receipts)' },
      { key: 'budgets.approve', label: 'Approve expenses', description: 'Approve or reject submitted expenses' },
      { key: 'budgets.manage',  label: 'Manage budgets',   description: 'Create budgets, set amounts and owners' },
    ],
  },
  {
    group: 'Safety & Incidents', module: 'safety',
    perms: [
      { key: 'incidents.report',       label: 'Report incidents',     description: 'File a new incident report' },
      { key: 'incidents.view',         label: 'View incidents',       description: 'See the incident log (except confidential entries)' },
      { key: 'incidents.manage',       label: 'Manage incidents',     description: 'Edit, add follow-ups, and close incidents' },
      { key: 'incidents.confidential', label: 'Confidential access',  description: 'See incidents marked confidential' },
    ],
  },
  {
    group: 'Lost & Found', module: 'lostfound',
    perms: [
      { key: 'lostfound.view',   label: 'View lost & found', description: 'Browse found items and lost reports' },
      { key: 'lostfound.manage', label: 'Manage lost & found', description: 'Log items, mark claimed / returned / donated' },
    ],
  },
  {
    group: 'People & Culture', module: 'people',
    perms: [
      { key: 'people.view',   label: 'View directory', description: 'See the staff directory, profiles, and org chart' },
      { key: 'people.certs',  label: 'Certifications', description: 'Track staff certifications and expiry warnings' },
      { key: 'kudos.give',    label: 'Give kudos',     description: 'Post recognition tied to org values' },
      { key: 'pulse.results', label: 'Pulse results',  description: 'See aggregated team mood and eNPS' },
    ],
  },
  {
    group: 'Growth', module: 'people',
    perms: [
      { key: 'oneonones.use', label: '1:1 meetings',  description: 'Private 1:1 agendas, talking points, and action items' },
      { key: 'goals.use',     label: 'Goals',         description: 'Personal and team goals with check-ins' },
      { key: 'feedback.use',  label: 'Feedback',      description: 'Request and give praise / growth feedback' },
    ],
  },
  {
    group: 'Community', module: 'community',
    perms: [
      { key: 'community.view',     label: 'View community', description: 'Read the community board and events' },
      { key: 'community.post',     label: 'Post',           description: 'Share posts, prayers & praise' },
      { key: 'community.announce', label: 'Announce',       description: 'Publish announcements and events' },
      { key: 'community.moderate', label: 'Moderate',       description: 'Pin and remove any post or comment' },
    ],
  },
  {
    group: 'Map & Screens', module: null,
    perms: [
      { key: 'map.view',       label: 'View 3D map',    description: 'Open the virtual property map', module: 'map' },
      { key: 'screens.manage', label: 'Manage screens', description: 'Configure the lobby smart screens', module: 'screens' },
    ],
  },
  {
    group: 'Claude & AI', module: 'ai',
    perms: [
      { key: 'ai.use',    label: 'Connect Claude',   description: 'Mint personal access tokens and use WoodsOS from Claude (read tools)' },
      { key: 'ai.write',  label: 'AI can write',     description: 'Allow Claude to create and update records on your behalf' },
      { key: 'ai.manage', label: 'Manage AI access', description: 'See and revoke anyone’s tokens, review the AI activity log' },
    ],
  },
  {
    group: 'Insights & Metrics', module: 'reports',
    perms: [
      { key: 'reports.view',      label: 'Overview',           description: 'The cross-module snapshot dashboard' },
      { key: 'metrics.bookings',  label: 'Booking metrics',    description: 'Occupancy, revenue, segments, and the lead funnel' },
      { key: 'metrics.facilities',label: 'Facilities metrics', description: 'Ticket flow, response times, hotspots, guest ratings' },
      { key: 'metrics.tasks',     label: 'Task metrics',       description: 'Velocity, workload, and phase progress' },
      { key: 'metrics.people',    label: 'People metrics',     description: 'Pulse trend, eNPS, kudos and feedback volume' },
      { key: 'metrics.signout',   label: 'Sign-out metrics',   description: 'Trip volume, durations, and overdue incidents' },
      { key: 'metrics.shopping',  label: 'Shopping metrics',   description: 'Run cadence, items, and town breakdown' },
      { key: 'metrics.gear',      label: 'Gear metrics',       description: 'Utilization, overdue loans, and condition mix' },
      { key: 'metrics.budgets',   label: 'Budget metrics',     description: 'Burn rate, category spend, and approval queue' },
      { key: 'metrics.safety',    label: 'Safety metrics',     description: 'Incident trends by type, severity, and location' },
    ],
  },
  {
    group: 'Administration', module: null,
    perms: [
      { key: 'audit.view',     label: 'Audit log',        description: 'Review the change history' },
      { key: 'users.manage',   label: 'Manage people',    description: 'Invite, edit, deactivate accounts' },
      { key: 'roles.manage',   label: 'Edit permissions', description: 'Change roles and the permission matrix' },
      { key: 'settings.admin', label: 'Org settings',     description: 'Organization-wide configuration' },
      { key: 'motd.manage',    label: 'Message of the day', description: 'Post sign-in announcements everyone sees once' },
      { key: 'system.health',  label: 'System health',    description: 'Uptime, traffic, error and rate-limit counters' },
    ],
  },
]

export const ALL_PERMS = PERM_GROUPS.flatMap(g => g.perms.map(p => p.key))

const grant = keys => Object.fromEntries(keys.map(k => [k, true]))
const allView = ALL_PERMS.filter(k => k.endsWith('.view') || k === 'signout.board')
const ALL_METRICS = ALL_PERMS.filter(k => k.startsWith('metrics.'))

export const SYSTEM_ROLES = [
  {
    key: 'admin', label: 'Administrator', rank: 100, is_system: true,
    description: 'Full access to everything, always. This role cannot be edited — it is the lockout safety net.',
    permissions: grant(ALL_PERMS),
  },
  {
    key: 'director', label: 'Director', rank: 80, is_system: true,
    description: 'Org-wide operations and people leadership. Everything except account and permission administration.',
    permissions: grant(ALL_PERMS.filter(k => !['users.manage', 'roles.manage', 'settings.admin'].includes(k))),
  },
  {
    key: 'manager', label: 'Manager', rank: 60, is_system: true,
    description: 'Runs the day-to-day: bookings, billing, facilities, gear, budgets, safety, and metrics.',
    permissions: grant([
      ...allView,
      'bookings.edit', 'bookings.manage', 'bookings.leads', 'bookings.billing', 'bookings.catering',
      'accommodation.edit', 'housekeeping.board',
      'tickets.edit', 'tickets.priority', 'tickets.tag', 'tickets.tags_manage', 'tickets.chat',
      'tickets.close', 'tickets.approve_close', 'tickets.canned', 'tickets.schedule', 'tickets.export', 'assets.edit',
      'tasks.edit', 'tasks.templates', 'tasks.manage', 'locations.edit', 'locations.manage',
      'signout.use', 'signout.manage', 'shopping.edit', 'shopping.run',
      'gear.checkout', 'gear.manage',
      'budgets.submit', 'budgets.approve', 'budgets.manage',
      'incidents.report', 'incidents.manage',
      'lostfound.manage', 'people.certs',
      'kudos.give', 'pulse.results', 'oneonones.use', 'goals.use', 'feedback.use',
      'community.post', 'community.announce',
      'screens.manage', 'ai.use', 'ai.write', ...ALL_METRICS,
    ]),
  },
  {
    key: 'staff', label: 'Staff', rank: 40, is_system: true,
    description: 'Everyday camp staff: work tickets and tasks, check out gear, log expenses, report incidents, grow.',
    permissions: grant([
      'bookings.view', 'accommodation.view', 'housekeeping.board',
      'tickets.view', 'tickets.edit', 'tickets.tag', 'tickets.chat', 'assets.view',
      'tasks.view', 'tasks.edit', 'locations.view', 'locations.edit', 'map.view',
      'signout.use', 'signout.board', 'shopping.view', 'shopping.edit', 'shopping.run',
      'gear.view', 'gear.checkout', 'budgets.submit',
      'incidents.report', 'lostfound.view',
      'people.view', 'kudos.give', 'oneonones.use', 'goals.use', 'feedback.use',
      'community.view', 'community.post', 'ai.use',
    ]),
  },
  {
    key: 'viewer', label: 'Viewer', rank: 10, is_system: true,
    description: 'Read-only access to the basics. Good default for seasonal or external accounts.',
    permissions: grant(['bookings.view', 'accommodation.view', 'tickets.view', 'tasks.view',
      'locations.view', 'map.view', 'signout.board', 'people.view', 'community.view', 'gear.view', 'lostfound.view']),
  },
]

// Effective permission set for a user row + its role row.
export function effectivePerms(user, role) {
  if (user.role_key === 'admin') return grant(ALL_PERMS)
  const out = {}
  const base = (role && role.permissions) || {}
  const over = user.overrides || {}
  for (const key of ALL_PERMS) {
    const o = over[key]
    out[key] = typeof o === 'boolean' ? o : !!base[key]
  }
  return out
}
