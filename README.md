# WoodsOS

**Every part of camp. One place.**

WoodsOS is the unified operations platform for Muskoka Woods — the merger of every
app in the fable-tests family into one full-stack product:

| Absorbed project | What it became in WoodsOS |
|---|---|
| **Woods360** (venue ops) | Bookings, Calendar, Accommodation grid, Locations registry, Smart Screens, role-permission matrix — plus the deep cuts: **Leads pipeline**, **Billing** (invoices + payments + derived statuses), **Catering** (kitchen sheet + dietary rollups), **iCal feed**, asset maintenance logs |
| **Woods360** (sign-out kiosk) | Sign-Out module — one-tap off-property tracking, overdue watcher, emergency board |
| **WoodsVoice** (guest feedback) | Public guest report form (`/report/<token>`) with keyword triage + optional Claude refinement — now with **guest tracking pages, status timeline, and CSAT star ratings** |
| **FTF-APP-fullstack** (GitHub) | Facilities tickets (threads, internal notes, assignment), recurring tickets, **two-way guest chat with private `/track/<token>` links**, **photo/PDF attachments**, **status-history timeline**, **hold-time tracking**, first-response stamps, the **per-area metrics hub** — and in round three, the rest of the original: **ticket tags**, **watchers**, **closure-approval workflow** (request → approve/deny), **read/unread tracking**, **ASAP staff priority** (its own permission), **saved replies (canned responses)**, **saved views**, **SLA due dates with one-shot escalation**, **customer-damage notes**, **CSV export**, **per-location QR posters**, **message of the day**, **web push notifications**, **system-health panel**, **sub-tasks (the FTF jobs nesting)**, and the personal **My Dashboard** widget board |
| **Portage / leadrMW** | People directory + **org chart**, Kudos wall, weekly Pulse (k-anonymous), Community board + celebrations — plus the **Growth module: private 1:1s with rolling agendas, goals & check-ins, request/give feedback** |
| **Equinox / seasonaltransition** | Unified Tasks board with seasonal phases, custom statuses, checklists — now with **task templates**, **dependencies (blocked-by)**, and a **My Week** view |
| **muskoka-woods-map** | The 3D property map, embedded as a module with click-through to Locations |
| **mwmainwebsite** | The brand system — official palette, League Gothic / Montserrat / Nunito Sans, logos and photography |
| **Industry research** (HotSOS, Quore, ALICE, UltraCamp, CampWise) | The hospitality-stack staples WoodsOS was missing: **Gear & equipment checkout** (quantities, due-backs, overdue watcher), **Budgets & expenses** (approval queue, receipts, burn alerts), **Safety incidents** (severity 1–4, confidential entries), **Lost & Found**, the **Housekeeping turnover board**, and **staff certifications** with expiry warnings |

Redundant overlaps were consolidated rather than duplicated: four task systems became
one Tasks module, three location databases became one registry, two accommodation
calendars became one grid, and tickets + guest reports + maintenance share one queue.

**Every feature above ships behind its own permission switch** — 81 permissions across
18 groups and 17 module kill-switches — so a kitchen lead can run the Catering sheet
without ever seeing revenue, and a bookings coordinator can work the lead funnel
without touching facilities.

## AI-native: connect plain Claude (no API keys)

WoodsOS ships a built-in **MCP server** at `POST /api/mcp` (streamable HTTP,
stateless JSON-RPC). Staff mint a **personal access token** under **Claude & AI**
and connect ordinary Claude Code in one command:

```bash
claude mcp add --transport http woodsos http://localhost:8800/api/mcp \
  --header "Authorization: Bearer wos_pat_…"
```

- **The token is the person.** ~30 tools mirror the holder's live permissions:
  `tools/list` only returns what they may do, write tools additionally require the
  `ai.write` permission, and module kill-switches apply.
- Read tools: `whoami`, `daily_brief` (the morning huddle in one call), `search`,
  bookings/tickets/tasks/gear/budgets/incidents/lost-found listings,
  `get_metrics`, and `export_dataset` (whole datasets as JSON or CSV).
- Write tools: open/reply/move tickets, create tasks and leads, check gear in and
  out, log expenses, file incidents, log found items, bulk-add shopping, give kudos
  — every write is **audited** under the person's name.
- Tokens are SHA-256-hashed at rest, shown once, revocable (self-serve or by an
  `ai.manage` holder), optionally expiring; org-wide master switch in Settings.
- Machine-readable front door at [`/llms.txt`](frontend/public/llms.txt).

### Claude.ai chat & Cowork (OAuth connector)

Claude Code uses the pasted token above. **Claude.ai chat and Cowork** connect to
remote MCP servers through a **custom connector** that does an OAuth handshake, so
the MCP endpoint also implements **OAuth 2.1** (public clients, PKCE S256, dynamic
client registration). The endpoint returns `401` with a `WWW-Authenticate` pointer;
discovery lives at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`; the flow runs through
`/api/oauth/{register,authorize,token}`. The person signs in on a branded consent
page and the issued access token resolves to their WoodsOS account — same
"token is the person, scoped to permissions, every write audited" model.

To connect: in Claude, open **Customize → Connectors**, click **+ → Add custom
connector**, paste `<origin>/api/mcp`, hit **Add**, then sign in and approve.
Enable it in a conversation from the **+ menu (lower left) → Connectors**. On
Team/Enterprise plans an owner adds the same URL under **Organization settings
→ Connectors** (Add → Custom → Web) and members just click **Connect**.

This requires WoodsOS to be on a **public HTTPS origin** (a tunnel like Cloudflare
Tunnel, or a deploy) so Anthropic's cloud can reach it. On the local network,
Claude Code is the way in.

## Security

Round three hardens the box: tiered **rate limiting** (auth, public, MCP, API,
uploads — 429 + `Retry-After`), **login lockout** (5 misses → 15 minutes, audited),
**JWT token versioning** (password change signs out other devices), bcrypt-12,
**security headers + a strict CSP** at nginx (the 3D-map document gets its own
relaxed policy), hashed AI tokens, capability-URL uploads, and a **System health**
panel (uptime, req/min, 5xx, rate-limit hits, DB latency) grantable to IT without
the rest of admin.

## Run it

```bash
cd MegaProject
docker compose up -d --build
# → http://localhost:8800
```

**Demo sign-in** (all seeded users share the password `WoodsOS!demo`):

| Account | Role |
|---|---|
| `admin@muskokawoods.com` | Administrator (locked full access) |
| `sarah@muskokawoods.com` | Director |
| `dave@muskokawoods.com` | Manager |
| `liam@muskokawoods.com` | Staff |
| `olivia@muskokawoods.com` | Front Desk (custom role) |
| `ravi@muskokawoods.com` | Viewer |

Config lives in `.env` (copy from `.env.example`). Set `SEED_DEMO_DATA=false` for a
clean production boot. `ANTHROPIC_API_KEY` is optional — guest reports fall back to
keyword triage without it.

## Stack

- **Backend** — Node 20 + Express, PostgreSQL 16 (`backend/`). Idempotent migrations
  on boot, JWT auth, 10-minute scheduler (recurring tickets + overdue sign-outs +
  optional webhook), Open-Meteo weather (no key needed).
- **Frontend** — React 18 + Vite + Tailwind + Framer Motion (`frontend/`), served by
  nginx which also proxies `/api` to the backend. Single exposed port (default 8800).
- **Database** — one PostgreSQL instance, volume `woodsos_dbdata`.

## Permissions — the three layers

1. **Module switches** (Admin → Modules): org-wide kill switch per module. Off means
   gone — nav, pages and API — for everyone.
2. **Role matrix** (Admin → Permissions): 81 permissions across 18 groups × any
   number of roles. Five system roles ship by default plus a custom “Front Desk”
   example; create more with one click (clone from any existing role).
   **Administrator is hardcoded to everything** as lockout protection.
3. **Per-person overrides** (Admin → People): allow/deny exceptions that beat the
   role — e.g. give one staff member `tickets.close` without promoting them.

Every mutation requires the matching permission server-side (`requirePerm`), the UI
hides what you can’t touch, and changes land in the audit log. When the catalog grows
in an update, system roles absorb the new defaults without overwriting anything an
admin has explicitly changed.

### Insights — metrics by permission

The Insights hub (`/reports`) is tabbed per area, and **each tab is its own
permission**: `metrics.bookings` (occupancy, revenue, funnel, top customers),
`metrics.facilities` (created-vs-closed flow, response/resolution times, hotspots,
guest ratings), `metrics.tasks` (velocity, workload, phase progress),
`metrics.people` (pulse trend, eNPS, kudos — k-anonymity ≥ 3 intact),
`metrics.signout`, `metrics.shopping`, `metrics.gear` (utilization, overdue,
condition mix), `metrics.budgets` (burn, category spend, approval queue), and
`metrics.safety` (incident trends by type/severity/location). `reports.view`
covers the cross-module overview, and **✦ My Dashboard** is a personal widget
board (FTF-style): pick from 15 widgets across every area you can see, reorder
them, and the layout follows your account.

### Two-way guest chat (the FTF flow)

Every guest report mints a private tracking link (`/track/<token>`). Guests see a
status timeline, chat with staff, add photos, and rate the fix 1–5 stars once it’s
resolved. Staff reply from the ticket (public reply vs 🔒 internal note), see a
“💬 guest waiting” badge when there’s a new message, and can mint or revoke chat
links on any ticket (`tickets.chat` permission).

## Public token pages (no sign-in)

| Page | Purpose |
|---|---|
| `/screen/<token>` | Rotating lobby display — welcome, today’s groups, live weather, lodging, kudos wall, announcements ticker |
| `/board/<token>` | “Who’s On” weekly lodging board — printable, auto-refreshing |
| `/report/<token>` | Guest facility-report form — 30 seconds, QR-friendly, triaged into Facilities |
| `/track/<token>` | Per-ticket guest tracking + chat + CSAT rating |
| `/api/public/ical/<token>` | iCal feed of bookings — subscribe from Google/Outlook/Apple Calendar |

Links (and rotation, if one leaks) live in Admin → Settings → Public links.

## Mobile

Fully responsive: bottom tab bar with badges + “More” sheet on phones, bottom-sheet
modals, 44 px touch targets, 16 px inputs (no iOS focus-zoom), `100dvh` layouts and
`safe-area-inset` padding for iPhone notches and home indicators. Installable as a
PWA — `manifest.webmanifest` with 192/512/maskable icons plus a service worker
(`sw.js`): network-first navigations with an offline shell fallback,
stale-while-revalidate static assets, API never cached.

File uploads (ticket photos/PDFs, guest chat photos) land on the `uploads` Docker
volume with unguessable names, served at `/api/files/*`.

## Development

```bash
# backend (needs a Postgres; easiest: keep the docker db running)
cd backend && npm install && npm run dev

# frontend (proxies /api to the docker stack on :8800)
cd frontend && npm install && npm run dev   # → http://localhost:5800
```
