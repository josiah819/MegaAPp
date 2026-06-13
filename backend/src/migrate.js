import { q, one } from './db.js'
import { hash } from './auth.js'
import { MODULES, SYSTEM_ROLES } from './permissions.js'
import { token } from './lib.js'
import { seedDemo } from './seed.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT DEFAULT '',
  rank INT DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  permissions JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_key TEXT NOT NULL DEFAULT 'staff' REFERENCES roles(key),
  dept TEXT DEFAULT 'General',
  title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  color TEXT DEFAULT '#1E5A64',
  birthday DATE,
  start_date DATE,
  overrides JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS module_flags (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT DEFAULT '',
  enabled BOOLEAN DEFAULT true,
  sort INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INT,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT DEFAULT '',
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  icon TEXT DEFAULT '🔔',
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, read);

CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INT REFERENCES locations(id) ON DELETE SET NULL,
  category TEXT DEFAULT 'general',
  zone TEXT DEFAULT '',
  capacity INT,
  beds INT,
  condition TEXT DEFAULT 'clean',
  condition_note TEXT DEFAULT '',
  condition_updated_at TIMESTAMPTZ,
  condition_updated_by TEXT DEFAULT '',
  occupancy_override TEXT DEFAULT '',
  exclude_from_accom BOOLEAN DEFAULT false,
  map_ref TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  sort INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_locations_cat ON locations (category);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'organization',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'tentative',
  segment TEXT DEFAULT 'retreat',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  headcount INT DEFAULT 0,
  value NUMERIC(12,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);

CREATE TABLE IF NOT EXISTS booking_rooms (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_br_booking ON booking_rooms (booking_id);
CREATE INDEX IF NOT EXISTS idx_br_location ON booking_rooms (location_id, date_from);

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  details TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  priority INT DEFAULT 1,
  category TEXT DEFAULT 'maintenance',
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  asset_id INT,
  submitter_name TEXT DEFAULT '',
  submitter_email TEXT DEFAULT '',
  source TEXT DEFAULT 'staff',
  assignee_id INT,
  created_by INT,
  due_date DATE,
  triage JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_loc ON tickets (location_id);

CREATE TABLE IF NOT EXISTS ticket_responses (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INT,
  author_name TEXT DEFAULT '',
  body TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tr_ticket ON ticket_responses (ticket_id);

CREATE TABLE IF NOT EXISTS scheduled_tickets (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  details TEXT DEFAULT '',
  category TEXT DEFAULT 'maintenance',
  priority INT DEFAULT 1,
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  frequency TEXT DEFAULT 'weekly',
  next_run DATE,
  last_run DATE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'equipment',
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'operational',
  serial TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_statuses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT 'lake',
  kind TEXT DEFAULT 'open',
  ord INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS phases (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT 'pine',
  starts DATE,
  ends DATE,
  ord INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  status_id INT REFERENCES task_statuses(id) ON DELETE SET NULL,
  priority INT DEFAULT 1,
  phase_id INT REFERENCES phases(id) ON DELETE SET NULL,
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  booking_id INT REFERENCES bookings(id) ON DELETE SET NULL,
  ticket_id INT REFERENCES tickets(id) ON DELETE SET NULL,
  due DATE,
  tags TEXT[] DEFAULT '{}',
  checklist JSONB DEFAULT '[]',
  ord DOUBLE PRECISION DEFAULT 0,
  assignees INT[] DEFAULT '{}',
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks (due);

CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signed_out_at TIMESTAMPTZ DEFAULT now(),
  signed_in_at TIMESTAMPTZ,
  destination TEXT DEFAULT '',
  expected_return TIMESTAMPTZ,
  companions TEXT DEFAULT '',
  vehicle TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  overdue_notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_one_open ON trips (user_id) WHERE signed_in_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trips_out ON trips (signed_out_at DESC);

CREATE TABLE IF NOT EXISTS towns (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS shopping_items (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  notes TEXT DEFAULT '',
  category TEXT DEFAULT 'general',
  town_id INT REFERENCES towns(id) ON DELETE SET NULL,
  qty TEXT DEFAULT '',
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by INT,
  added_by INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS town_runs (
  id SERIAL PRIMARY KEY,
  town_id INT REFERENCES towns(id) ON DELETE SET NULL,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  items_purchased INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kudos (
  id SERIAL PRIMARY KEY,
  from_id INT REFERENCES users(id) ON DELETE SET NULL,
  to_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value_key TEXT DEFAULT '',
  message TEXT NOT NULL,
  reactions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pulse (
  id SERIAL PRIMARY KEY,
  week TEXT NOT NULL,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood INT NOT NULL,
  enps INT,
  comment TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (week, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  kind TEXT DEFAULT 'post',
  author_id INT REFERENCES users(id) ON DELETE SET NULL,
  anonymous BOOLEAN DEFAULT false,
  title TEXT DEFAULT '',
  body TEXT NOT NULL,
  pinned BOOLEAN DEFAULT false,
  reactions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_comments (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  date DATE NOT NULL,
  end_date DATE,
  location TEXT DEFAULT '',
  emoji TEXT DEFAULT '🌲',
  descr TEXT DEFAULT ''
);

-- ---- expansion: two-way ticket comms, attachments, history ----
CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail JSONB DEFAULT '{}',
  user_id INT,
  user_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tev_ticket ON ticket_events (ticket_id);
CREATE INDEX IF NOT EXISTS idx_tev_created ON ticket_events (created_at);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  size INT DEFAULT 0,
  uploaded_by INT,
  guest BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tatt_ticket ON ticket_attachments (ticket_id);

-- ---- expansion: leads pipeline ----
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  segment TEXT DEFAULT 'retreat',
  stage TEXT DEFAULT 'new',
  expected_headcount INT,
  preferred_start DATE,
  preferred_end DATE,
  message TEXT DEFAULT '',
  value_estimate NUMERIC(12,2) DEFAULT 0,
  source TEXT DEFAULT 'manual',
  owner_id INT,
  customer_id INT,
  booking_id INT,
  lost_reason TEXT DEFAULT '',
  ord DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads (stage);

-- ---- expansion: billing ----
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  booking_id INT REFERENCES bookings(id) ON DELETE SET NULL,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'draft',
  issue_date DATE,
  due_date DATE,
  tax_rate NUMERIC(5,2) DEFAULT 13,
  items JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  date DATE,
  amount NUMERIC(12,2) NOT NULL,
  method TEXT DEFAULT 'e-transfer',
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id);

-- ---- expansion: catering ----
CREATE TABLE IF NOT EXISTS meal_services (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal TEXT DEFAULT 'dinner',
  time TEXT DEFAULT '',
  headcount INT DEFAULT 0,
  menu TEXT DEFAULT '',
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  dietary TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_meals_date ON meal_services (date);

-- ---- expansion: growth (1:1s, goals, feedback) ----
CREATE TABLE IF NOT EXISTS one_on_ones (
  id SERIAL PRIMARY KEY,
  a_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ,
  recurrence TEXT DEFAULT 'biweekly',
  status TEXT DEFAULT 'open',
  shared_notes TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oo_people ON one_on_ones (a_id, b_id);

CREATE TABLE IF NOT EXISTS oo_items (
  id SERIAL PRIMARY KEY,
  meeting_id INT NOT NULL REFERENCES one_on_ones(id) ON DELETE CASCADE,
  author_id INT,
  text TEXT NOT NULL,
  kind TEXT DEFAULT 'talking',
  done BOOLEAN DEFAULT false,
  ord DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ooi_meeting ON oo_items (meeting_id);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  descr TEXT DEFAULT '',
  type TEXT DEFAULT 'individual',
  owner_id INT REFERENCES users(id) ON DELETE SET NULL,
  dept TEXT DEFAULT '',
  parent_id INT,
  due DATE,
  status TEXT DEFAULT 'on',
  progress INT DEFAULT 0,
  krs JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goal_checkins (
  id SERIAL PRIMARY KEY,
  goal_id INT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  by_id INT,
  progress INT,
  status TEXT,
  comment TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  requester_id INT,
  responder_id INT,
  from_id INT,
  to_id INT,
  prompt TEXT DEFAULT '',
  message TEXT DEFAULT '',
  fb_type TEXT DEFAULT 'praise',
  visibility TEXT DEFAULT 'private',
  status TEXT DEFAULT 'pending',
  response TEXT DEFAULT '',
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---- expansion: asset service history ----
CREATE TABLE IF NOT EXISTS asset_logs (
  id SERIAL PRIMARY KEY,
  asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'service',
  notes TEXT DEFAULT '',
  cost NUMERIC(10,2),
  date DATE,
  by_id INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alog_asset ON asset_logs (asset_id);

-- ---- expansion: task templates ----
CREATE TABLE IF NOT EXISTS task_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  descr TEXT DEFAULT '',
  items JSONB DEFAULT '[]',
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---- round 3: AI access (personal tokens for the MCP endpoint) ----
CREATE TABLE IF NOT EXISTS pats (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'Claude',
  token_hash TEXT UNIQUE NOT NULL,
  prefix TEXT DEFAULT '',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pats_user ON pats (user_id);

-- ---- AI access via OAuth 2.1 (Claude.ai chat + Cowork connectors) ----
-- Public clients self-register (Dynamic Client Registration); auth is PKCE.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT DEFAULT '',
  redirect_uris JSONB DEFAULT '[]',
  grant_types JSONB DEFAULT '["authorization_code","refresh_token"]',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT DEFAULT '',
  scope TEXT DEFAULT '',
  resource TEXT DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id SERIAL PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  refresh_hash TEXT UNIQUE,
  client_id TEXT DEFAULT '',
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT DEFAULT '',
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN DEFAULT false,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens (user_id);

-- ---- round 3: ticket tags, canned replies, watchers, reads, closure approval ----
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#5B8A92',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ticket_tags (
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag_id INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  by_id INT,
  PRIMARY KEY (ticket_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_ttags_tag ON ticket_tags (tag_id);

CREATE TABLE IF NOT EXISTS canned_responses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_watchers (
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS ticket_reads (
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_treads_user ON ticket_reads (user_id);

CREATE TABLE IF NOT EXISTS closure_requests (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  requested_by INT NOT NULL,
  reason TEXT DEFAULT '',
  previous_status TEXT DEFAULT 'open',
  status TEXT DEFAULT 'pending',
  decided_by INT,
  decision_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_creq_ticket ON closure_requests (ticket_id);

CREATE TABLE IF NOT EXISTS saved_views (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page TEXT DEFAULT 'tickets',
  name TEXT NOT NULL,
  params JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, page, name)
);

-- ---- round 3: message of the day ----
CREATE TABLE IF NOT EXISTS motd_messages (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  active BOOLEAN DEFAULT true,
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS motd_dismissals (
  message_id INT NOT NULL REFERENCES motd_messages(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- ---- round 3: web push ----
CREATE TABLE IF NOT EXISTS push_subs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

-- ---- round 3: gear & equipment checkout ----
CREATE TABLE IF NOT EXISTS gear_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  qty_total INT DEFAULT 1,
  condition TEXT DEFAULT 'good',
  requires_training BOOLEAN DEFAULT false,
  notes TEXT DEFAULT '',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gear_loans (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES gear_items(id) ON DELETE CASCADE,
  qty INT DEFAULT 1,
  borrower_id INT REFERENCES users(id) ON DELETE SET NULL,
  borrower_name TEXT DEFAULT '',
  booking_id INT REFERENCES bookings(id) ON DELETE SET NULL,
  out_at TIMESTAMPTZ DEFAULT now(),
  due_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  out_by INT,
  in_by INT,
  condition_in TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  overdue_notified BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_gloans_item ON gear_loans (item_id);
CREATE INDEX IF NOT EXISTS idx_gloans_open ON gear_loans (returned_at) WHERE returned_at IS NULL;

-- ---- round 3: budgets & expenses ----
CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT DEFAULT '',
  period_start DATE,
  period_end DATE,
  amount NUMERIC(12,2) DEFAULT 0,
  owner_id INT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  active BOOLEAN DEFAULT true,
  alert_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  budget_id INT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  date DATE,
  vendor TEXT DEFAULT '',
  descr TEXT DEFAULT '',
  amount NUMERIC(12,2) NOT NULL,
  category TEXT DEFAULT 'general',
  receipt TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  submitted_by INT,
  decided_by INT,
  decided_at TIMESTAMPTZ,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exp_budget ON expenses (budget_id);
CREATE INDEX IF NOT EXISTS idx_exp_status ON expenses (status);

-- ---- round 3: incidents (safety log) ----
CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'safety',
  severity INT DEFAULT 2,
  occurred_at TIMESTAMPTZ DEFAULT now(),
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  description TEXT DEFAULT '',
  people_involved TEXT DEFAULT '',
  actions_taken TEXT DEFAULT '',
  followup TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  confidential BOOLEAN DEFAULT false,
  reported_by INT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inc_status ON incidents (status);

-- ---- round 3: lost & found ----
CREATE TABLE IF NOT EXISTS lf_items (
  id SERIAL PRIMARY KEY,
  kind TEXT DEFAULT 'found',
  date DATE,
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  category TEXT DEFAULT 'other',
  description TEXT NOT NULL,
  photo TEXT DEFAULT '',
  stored_at TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  resolution_note TEXT DEFAULT '',
  resolved_at TIMESTAMPTZ,
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lf_status ON lf_items (status);

-- ---- round 4: personal external calendar overlays (Google/Outlook iCal) ----
CREATE TABLE IF NOT EXISTS user_calendar_feeds (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  color TEXT DEFAULT '#7D5BA6',
  enabled BOOLEAN DEFAULT true,
  cache JSONB DEFAULT '[]',
  fetched_at TIMESTAMPTZ,
  fetch_status TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ucf_user ON user_calendar_feeds (user_id);

-- ---- round 3: staff certifications ----
CREATE TABLE IF NOT EXISTS user_certs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  issuer TEXT DEFAULT '',
  issued DATE,
  expires DATE,
  notes TEXT DEFAULT '',
  expiry_notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_certs_user ON user_certs (user_id);
`

// Columns added to existing tables after first release — each guarded, safe to re-run.
const ALTERS = `
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS public_token TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS guest_unread BOOLEAN DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS on_hold_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS hold_seconds INT DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rating INT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rating_comment TEXT DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_ptoken ON tickets (public_token) WHERE public_token IS NOT NULL;
ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dietary TEXT DEFAULT '';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS next_service DATE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS purchase_date DATE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS value NUMERIC(12,2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_by INT[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs JSONB DEFAULT '{}';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pending_close_by INT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS damage_note TEXT DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_id) WHERE parent_id IS NOT NULL;
`

const DEFAULT_SETTINGS = {
  org: {
    name: 'Muskoka Woods',
    app_name: 'WoodsOS',
    tagline: 'Every part of camp. One place.',
    timezone: 'America/Toronto',
    emergency_contact_name: 'Front Desk',
    emergency_contact_phone: '(705) 732-4373',
    departments: ['Guest Services', 'Waterfront', 'Program', 'Food Services', 'Housekeeping', 'Facilities', 'Health Centre', 'Leadership', 'Office'],
    values: [
      { key: 'lead',      emoji: '🧭', name: 'Lead the way' },
      { key: 'accept',    emoji: '🤝', name: 'Accept everyone' },
      { key: 'protect',   emoji: '🛡️', name: 'Protect each other' },
      { key: 'invite',    emoji: '🏕️', name: 'Invite people in' },
      { key: 'challenge', emoji: '⛰️', name: 'Challenge growth' },
      { key: 'celebrate', emoji: '🎉', name: 'Celebrate the wins' },
    ],
  },
  signout: {
    destinations: ['Rosseau', 'Port Carling', 'Bracebridge', 'Huntsville', 'Parry Sound', 'Dump run'],
    durations: ['1 h', '2 h', '3 h', 'Half day', 'Overnight'],
    curfew: '23:00',
    webhook_url: '',
  },
  screens: {
    rotate_seconds: 12,
    welcome_message: 'Welcome to Muskoka Woods — wonder awaits on Lake Rosseau.',
    panels: { welcome: true, schedule: true, weather: true, whosout: false, announcements: true, lodging: true },
    lat: 45.2492,
    lon: -79.617,
  },
  report: {
    intro: 'Spotted something that needs attention? Tell us in 30 seconds — we are on it.',
    categories: [
      { key: 'maintenance',  label: 'Maintenance & repairs' },
      { key: 'housekeeping', label: 'Housekeeping' },
      { key: 'safety',       label: 'Safety concern' },
      { key: 'it',           label: 'Tech & AV' },
      { key: 'other',        label: 'Something else' },
    ],
  },
  locations_meta: {
    categories: [
      { key: 'lodge',      label: 'Lodges & Cabins', icon: '🛏️', color: 'lake' },
      { key: 'venue',      label: 'Venues',          icon: '🏛️', color: 'pine' },
      { key: 'dining',     label: 'Dining',          icon: '🍽️', color: 'gold' },
      { key: 'sports',     label: 'Sports',          icon: '🏀', color: 'ember' },
      { key: 'adventure',  label: 'Adventure',       icon: '🧗', color: 'plum' },
      { key: 'waterfront', label: 'Waterfront',      icon: '🛶', color: 'teal' },
      { key: 'grounds',    label: 'Grounds & Infra', icon: '🌲', color: 'moss' },
    ],
    conditions: [
      { key: 'clean',       label: 'Ready',              color: 'green',  blocking: false },
      { key: 'dirty',       label: 'Needs housekeeping', color: 'gold',   blocking: false },
      { key: 'maintenance', label: 'Maintenance hold',   color: 'ember',  blocking: true },
      { key: 'closed',      label: 'Closed for season',  color: 'stone',  blocking: true },
    ],
  },
  shopping: { categories: ['Hardware', 'Grocery', 'Kitchen', 'Program', 'Office', 'Other'] },
  billing: {
    tax_rate: 13,
    tax_label: 'HST',
    invoice_prefix: 'INV-',
    currency: 'CAD',
    payment_instructions: 'E-transfer to accounts@muskokawoods.com or cheque payable to Muskoka Woods.',
  },
  sla: {
    // Hours until a ticket is considered due, by priority (4=ASAP … 1=low).
    hours: { 4: 4, 3: 24, 2: 72, 1: 168 },
    escalate: true,
  },
  ai: {
    enabled: true,
    note: 'Personal access tokens let staff connect Claude to WoodsOS. Tools mirror each person’s permissions exactly.',
  },
  gear_meta: {
    categories: ['Waterfront', 'Program', 'AV & Tech', 'Outdoor Ed', 'Kitchen', 'General'],
  },
}

export async function migrate() {
  await q(SCHEMA)
  await q(ALTERS)

  // System roles — insert if missing, leave admin's perms pinned on every boot
  for (const r of SYSTEM_ROLES) {
    await q(
      `INSERT INTO roles (key, label, description, rank, is_system, permissions)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING`,
      [r.key, r.label, r.description, r.rank, r.is_system, JSON.stringify(r.permissions)]
    )
  }
  const admin = SYSTEM_ROLES.find(r => r.key === 'admin')
  await q(`UPDATE roles SET permissions = $1 WHERE key = 'admin'`, [JSON.stringify(admin.permissions)])

  // When the catalog grows, system roles inherit the defaults for keys an admin
  // has never touched — explicit grants/denials in the matrix are preserved.
  for (const r of SYSTEM_ROLES) {
    if (r.key === 'admin') continue
    const row = await one(`SELECT permissions FROM roles WHERE key = $1`, [r.key])
    if (!row) continue
    const stored = row.permissions || {}
    const missing = Object.fromEntries(
      Object.entries(r.permissions).filter(([k]) => !(k in stored)))
    if (Object.keys(missing).length) {
      await q(`UPDATE roles SET permissions = permissions || $2::jsonb WHERE key = $1`,
        [r.key, JSON.stringify(missing)])
    }
  }

  // Module flags
  let i = 0
  for (const m of MODULES) {
    await q(
      `INSERT INTO module_flags (key, label, description, enabled, sort)
       VALUES ($1,$2,$3,true,$4) ON CONFLICT (key) DO NOTHING`,
      [m.key, m.label, m.description, i++]
    )
  }

  // Settings (including one-time public tokens)
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await q(`INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)])
  }
  await q(`INSERT INTO app_settings (key, value) VALUES ('tokens', $1) ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({ screen: token(), board: token(), report: token(), ical: token() })])
  // Tokens added after first release slot in without disturbing existing links
  const tok = await one(`SELECT value FROM app_settings WHERE key = 'tokens'`)
  if (tok && !tok.value.ical) {
    await q(`UPDATE app_settings SET value = value || $1::jsonb WHERE key = 'tokens'`,
      [JSON.stringify({ ical: token() })])
  }

  // Web-push VAPID keypair — minted once, kept forever (rotating breaks subscriptions)
  const push = await one(`SELECT value FROM app_settings WHERE key = 'push'`)
  if (!push) {
    const { createECDH } = await import('crypto')
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    await q(`INSERT INTO app_settings (key, value) VALUES ('push', $1)`, [JSON.stringify({
      vapid_public: ecdh.getPublicKey('base64url'),
      vapid_private: ecdh.getPrivateKey('base64url'),
      subject: 'mailto:admin@muskokawoods.com',
    })])
  }

  // First-boot admin
  const count = await one(`SELECT COUNT(*)::int AS n FROM users`)
  if (count.n === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@muskokawoods.com').toLowerCase()
    const pwd = process.env.ADMIN_PASSWORD || 'WoodsOS!demo'
    await q(
      `INSERT INTO users (email, name, password_hash, role_key, dept, title, color)
       VALUES ($1, 'Josiah Admin', $2, 'admin', 'Office', 'Platform Admin', '#1B4849')`,
      [email, await hash(pwd)]
    )
    console.log(`Created first-boot admin: ${email}`)
  }

  // Demo workspace (only when the org is empty apart from the admin)
  if ((process.env.SEED_DEMO_DATA || 'true') === 'true') {
    const people = await one(`SELECT COUNT(*)::int AS n FROM users`)
    const locs = await one(`SELECT COUNT(*)::int AS n FROM locations`)
    if (people.n <= 1 && locs.n === 0) {
      console.log('Seeding demo workspace…')
      await seedDemo()
      console.log('Demo workspace ready.')
    }
  }
}
