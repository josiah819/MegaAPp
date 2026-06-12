// Demo workspace seeded on first boot. Every name is a real Muskoka Woods
// place (sourced from OSM + the official 2024 property map) so the demo reads
// true to anyone who knows the camp.
import { q, one } from './db.js'
import { hash } from './auth.js'
import { todayISO, addDays, isoWeek, token } from './lib.js'

const pick = arr => arr[Math.floor(Math.random() * arr.length)]

const BRAND_COLORS = ['#1E5A64', '#1F6331', '#30A059', '#C26628', '#1B5470', '#1087A3', '#1B4849', '#5B8A3C']

const LOCATIONS = [
  // Lodging
  { name: 'Royal Muskoka',     category: 'lodge', zone: 'South Campus', beds: 96, capacity: 96, map_ref: 'royal' },
  { name: 'Havington',         category: 'lodge', zone: 'South Campus', beds: 64, capacity: 64, map_ref: 'havington' },
  { name: 'The Chalets',       category: 'lodge', zone: 'Waterfront',   beds: 48, capacity: 48, map_ref: 'chalets' },
  { name: 'Hillside Inn',      category: 'lodge', zone: 'West Hill',    beds: 40, capacity: 40, map_ref: 'hillside' },
  { name: 'Timbergrove Lodge', category: 'lodge', zone: 'West Slope',   beds: 36, capacity: 36, map_ref: 'timberviews' },
  { name: 'Treetops 1–4',      category: 'lodge', zone: 'North Hill',   beds: 40, capacity: 40, map_ref: 'treetops' },
  { name: 'Treetops 5–8',      category: 'lodge', zone: 'North Hill',   beds: 40, capacity: 40, map_ref: 'treetops' },
  { name: 'Treetops 9–12',     category: 'lodge', zone: 'North Hill',   beds: 40, capacity: 40, map_ref: 'treetops' },
  { name: 'The Village',       category: 'lodge', zone: 'North Campus', beds: 84, capacity: 84, map_ref: 'village', notes: 'Frontier main street — Ironworks, General Store, Town Hall, Lost Creek Hotel and friends.' },
  { name: 'Sprucewood',        category: 'lodge', zone: 'Woods End', beds: 12, capacity: 12, map_ref: 'woodsend' },
  { name: 'Cedarwood',         category: 'lodge', zone: 'Woods End', beds: 12, capacity: 12, map_ref: 'woodsend' },
  { name: 'Elmwood',           category: 'lodge', zone: 'Woods End', beds: 12, capacity: 12, map_ref: 'woodsend' },
  { name: 'Beechwood',         category: 'lodge', zone: 'Woods End', beds: 12, capacity: 12, map_ref: 'woodsend' },
  { name: 'Redwood',           category: 'lodge', zone: 'Woods End', beds: 12, capacity: 12, map_ref: 'woodsend' },
  { name: 'Birchwood',         category: 'lodge', zone: 'Woods End', beds: 12, capacity: 12, map_ref: 'woodsend' },
  { name: 'Oakwood',           category: 'lodge', zone: 'Woods End', beds: 12, capacity: 12, map_ref: 'woodsend' },
  { name: 'Willowwood',        category: 'lodge', zone: 'Woods End', beds: 12, capacity: 12, map_ref: 'woodsend' },
  // Venues
  { name: 'Music Hall',        category: 'venue', zone: 'Centre Camp',  capacity: 300, map_ref: 'musichall', exclude: true },
  { name: 'The Hangar',        category: 'venue', zone: 'South Campus', capacity: 1200, map_ref: 'hangar', exclude: true, notes: 'Largest venue — full stage, 28-ft screen, concert sound.' },
  { name: 'The Backyard',      category: 'venue', zone: 'South Campus', capacity: 250, map_ref: 'backyard', exclude: true },
  { name: 'The Fieldhouse',    category: 'venue', zone: 'Front Gate',   capacity: 700, map_ref: 'fieldhouse', exclude: true, notes: '15,000 sq ft of hardwood, conference rooms, indoor climbing wall.' },
  { name: 'The Boathouse',     category: 'venue', zone: 'The Point',    capacity: 150, map_ref: 'boathouse', exclude: true },
  { name: 'Leadership Studio', category: 'venue', zone: 'Waterfront',   capacity: 120, map_ref: 'studio', exclude: true },
  { name: 'CEO Lodge',         category: 'venue', zone: 'North Campus', capacity: 150, map_ref: 'ceolodge', exclude: true },
  { name: 'Heritage 1979',     category: 'venue', zone: 'North Campus', capacity: 90,  map_ref: 'heritage', exclude: true },
  { name: 'The MAC',           category: 'venue', zone: 'Centre Camp',  capacity: 40,  map_ref: 'mac', exclude: true, notes: "Mackenzie's Art Corner." },
  { name: 'Main Office',       category: 'venue', zone: 'South Campus', map_ref: 'mainoffice', exclude: true },
  { name: 'Imprint Studio',    category: 'venue', zone: 'West Side',    capacity: 30, map_ref: 'imprint', exclude: true },
  { name: "Ian's Place",       category: 'venue', zone: 'North Campus', capacity: 60, map_ref: 'ian', exclude: true },
  // Dining
  { name: 'Dining Hall',       category: 'dining', zone: 'Centre Camp', capacity: 600, map_ref: 'dining', exclude: true },
  // Sports
  { name: 'The Park · Action Sports', category: 'sports', zone: 'West Side', map_ref: 'thepark', exclude: true, notes: '80,000 sq ft of skate, scooter and BMX terrain + indoor pump track.' },
  { name: 'Tennis & Pickleball',      category: 'sports', zone: 'East Side', map_ref: 'tennis', exclude: true },
  { name: 'Leisure Sports Court',     category: 'sports', zone: 'East Side', map_ref: 'leisure', exclude: true },
  { name: 'Broomball Rink',           category: 'sports', zone: 'Front Field', map_ref: 'broomball', exclude: true },
  { name: 'Playing Field',            category: 'sports', zone: 'Centre Camp', map_ref: 'field', exclude: true },
  { name: 'Beach Volleyball',         category: 'sports', zone: 'Waterfront', map_ref: 'vball', exclude: true },
  { name: 'Driving Range',            category: 'sports', zone: 'West Meadow', map_ref: 'range', exclude: true },
  { name: 'Disc Golf Course',         category: 'sports', zone: 'Southwest Meadows', map_ref: 'discgolf', exclude: true },
  // Adventure
  { name: 'Upper Zipline',  category: 'adventure', zone: 'West Meadow', map_ref: 'upperzip', exclude: true, notes: '1,000 feet of flight.' },
  { name: 'Lower Zipline',  category: 'adventure', zone: 'East Woods',  map_ref: 'lowerzip', exclude: true },
  { name: 'High Ropes',     category: 'adventure', zone: 'East Woods',  map_ref: 'highropes', exclude: true, notes: 'Largest and highest ropes course in Canada.' },
  { name: 'Low Ropes',      category: 'adventure', zone: 'Northwest Meadow', map_ref: 'lowropes', exclude: true },
  { name: 'Giant Swing',    category: 'adventure', zone: 'Centre Camp', map_ref: 'giantswing', exclude: true },
  { name: 'Archery Range',  category: 'adventure', zone: 'The Park',    map_ref: 'archery', exclude: true },
  // Waterfront
  { name: 'Main Beach',            category: 'waterfront', zone: 'Waterfront', exclude: true },
  { name: 'KrakenRACER Waterslide',category: 'waterfront', zone: 'Waterfront', exclude: true, notes: 'Six lanes of summer.' },
  { name: 'Wibit Waterpark',       category: 'waterfront', zone: 'Waterfront', exclude: true },
  { name: 'Waterfront Docks',      category: 'waterfront', zone: 'Waterfront', exclude: true },
  { name: 'Marina & Boat Launch',  category: 'waterfront', zone: 'Waterfront', exclude: true },
  // Grounds
  { name: 'Maintenance Shop', category: 'grounds', zone: 'Back Forty', exclude: true },
  { name: 'Welcome Centre',   category: 'grounds', zone: 'Front Gate', exclude: true },
]

const PEOPLE = [
  ['sarah@muskokawoods.com',  'Sarah Mitchell',  'director', 'Office',         'Director of Operations'],
  ['dave@muskokawoods.com',   'Dave Kowalski',   'manager',  'Facilities',     'Facilities Manager'],
  ['emma@muskokawoods.com',   'Emma Tremblay',   'manager',  'Guest Services', 'Guest Services Manager'],
  ['cole@muskokawoods.com',   'Cole Harrison',   'manager',  'Waterfront',     'Waterfront Director'],
  ['hannah@muskokawoods.com', 'Hannah MacLean',  'manager',  'Leadership',     'People & Culture Lead'],
  ['liam@muskokawoods.com',   'Liam O’Brien','staff',   'Facilities',     'Maintenance Lead'],
  ['noah@muskokawoods.com',   'Noah Fitzgerald', 'staff',    'Facilities',     'Maintenance'],
  ['ava@muskokawoods.com',    'Ava Beaumont',    'staff',    'Housekeeping',   'Housekeeping Lead'],
  ['maya@muskokawoods.com',   'Maya Singh',      'staff',    'Housekeeping',   'Housekeeping'],
  ['jess@muskokawoods.com',   'Jess Lapointe',   'staff',    'Waterfront',     'Lifeguard'],
  ['tyler@muskokawoods.com',  'Tyler Nguyen',    'staff',    'Program',        'Program Coordinator'],
  ['grace@muskokawoods.com',  'Grace Adeyemi',   'staff',    'Program',        'Program Staff'],
  ['marcus@muskokawoods.com', 'Marcus Webb',     'staff',    'Food Services',  'Head Chef'],
  ['sophie@muskokawoods.com', 'Sophie Caron',    'staff',    'Food Services',  'Kitchen'],
  ['ben@muskokawoods.com',    'Ben Whitfield',   'staff',    'Office',         'IT & AV'],
  ['cindy@muskokawoods.com',  'Cindy Roberts',   'staff',    'Guest Services', 'Guest Experience'],
  ['olivia@muskokawoods.com', 'Olivia Strand',   'frontdesk','Guest Services', 'Front Desk'],
  ['ravi@muskokawoods.com',   'Ravi Patel',      'viewer',   'Health Centre',  'Camp Nurse'],
]

export async function seedDemo() {
  const today = todayISO()
  const pwd = await hash(process.env.ADMIN_PASSWORD || 'WoodsOS!demo')

  // A custom non-system role, so the permissions editor shows one out of the box
  await q(
    `INSERT INTO roles (key, label, description, rank, is_system, permissions)
     VALUES ('frontdesk', 'Front Desk', 'Welcome Centre crew — bookings at a glance, sign-out board, community.', 20, false, $1)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({
      'bookings.view': true, 'accommodation.view': true, 'locations.view': true,
      'signout.use': true, 'signout.board': true, 'signout.manage': true,
      'people.view': true, 'kudos.give': true, 'community.view': true, 'community.post': true, 'map.view': true,
    })]
  )

  // People
  const uid = {}
  for (let i = 0; i < PEOPLE.length; i++) {
    const [email, name, role, dept, title] = PEOPLE[i]
    const r = await one(
      `INSERT INTO users (email, name, password_hash, role_key, dept, title, color, birthday, start_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [email, name, pwd, role, dept, title, BRAND_COLORS[i % BRAND_COLORS.length],
        addDays(today, 20 + i * 17 - 365), addDays(today, -(200 + i * 53))]
    )
    uid[name.split(' ')[0]] = r.id
  }
  const adminRow = await one(`SELECT id FROM users WHERE role_key = 'admin' ORDER BY id LIMIT 1`)
  const adminId = adminRow?.id || 1

  // Locations
  const lid = {}
  let sort = 0
  for (const L of LOCATIONS) {
    const r = await one(
      `INSERT INTO locations (name, category, zone, capacity, beds, map_ref, notes, exclude_from_accom, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [L.name, L.category, L.zone || '', L.capacity || null, L.beds || null, L.map_ref || '', L.notes || '', !!L.exclude, sort++]
    )
    lid[L.name] = r.id
  }
  // a few live housekeeping conditions
  await q(`UPDATE locations SET condition='dirty', condition_note='Group departs at 10:00 — full turnover', condition_updated_at=now(), condition_updated_by='Ava Beaumont' WHERE id = $1`, [lid['Treetops 1–4']])
  await q(`UPDATE locations SET condition='maintenance', condition_note='Hot water tank replacement in progress', condition_updated_at=now(), condition_updated_by='Dave Kowalski' WHERE id = $1`, [lid['Cedarwood']])
  await q(`UPDATE locations SET condition='closed', condition_note='Opens with summer season', condition_updated_at=now(), condition_updated_by='Dave Kowalski' WHERE id = $1`, [lid['Hillside Inn']])

  // Customers + bookings
  const customers = {}
  for (const [name, type, email] of [
    ['Ridgeview Collegiate', 'school', 'trips@ridgeviewci.ca'],
    ['St. Andrew’s Church', 'church', 'office@standrews.on.ca'],
    ['TechNorth Inc.', 'corporate', 'people@technorth.io'],
    ['Maple District School Board', 'school', 'outdoored@mapledsb.ca'],
    ['Crestwood Youth Alliance', 'nonprofit', 'hello@crestwoodyouth.org'],
    ['Harvest Community Church', 'church', 'admin@harvestcc.ca'],
  ]) {
    const r = await one(`INSERT INTO customers (name, type, email) VALUES ($1,$2,$3) RETURNING id`, [name, type, email])
    customers[name] = r.id
  }

  const bookings = [
    ['BK-1037', 'Spring Birding Retreat', 'Crestwood Youth Alliance', 'completed', 'retreat', -32, -30, 42, 18900],
    ['BK-1038', 'Lakeside Marriage Course', 'Harvest Community Church', 'completed', 'retreat', -18, -16, 38, 16400],
    ['BK-1041', 'Ridgeview Collegiate — Grade 8 Trip', 'Ridgeview Collegiate', 'in_progress', 'school_trip', -3, 1, 145, 61200],
    ['BK-1042', 'St. Andrew’s Men’s Retreat', 'St. Andrew’s Church', 'confirmed', 'retreat', 1, 3, 60, 27800],
    ['BK-1043', 'TechNorth Leadership Offsite', 'TechNorth Inc.', 'in_progress', 'corporate', -1, 1, 28, 21500],
    ['BK-1044', 'Crestwood Youth Weekend', 'Crestwood Youth Alliance', 'tentative', 'retreat', 8, 10, 80, 34200],
    ['BK-1045', 'Maple DSB Outdoor Ed Week', 'Maple District School Board', 'confirmed', 'school_trip', 4, 7, 120, 51800],
    ['BK-1046', 'Harvest Family Camp', 'Harvest Community Church', 'tentative', 'retreat', 15, 17, 95, 39600],
    ['BK-1047', 'Summer Staff Training Week', null, 'confirmed', 'internal', 10, 15, 180, 0],
  ]
  const bid = {}
  for (const [code, name, cust, status, segment, s, e, headcount, value] of bookings) {
    const r = await one(
      `INSERT INTO bookings (code, name, customer_id, status, segment, start_date, end_date, headcount, value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [code, name, cust ? customers[cust] : null, status, segment, addDays(today, s), addDays(today, e), headcount, value, adminId]
    )
    bid[code] = r.id
  }

  const blocks = [
    ['BK-1041', ['Treetops 1–4', 'Treetops 5–8', 'Treetops 9–12', 'The Village'], -3, 1],
    ['BK-1042', ['Royal Muskoka'], 1, 3],
    ['BK-1043', ['The Chalets'], -1, 1],
    ['BK-1045', ['Sprucewood', 'Cedarwood', 'Elmwood', 'Beechwood', 'Redwood', 'Birchwood'], 4, 7],
    ['BK-1044', ['Havington'], 8, 10],
    ['BK-1046', ['Royal Muskoka', 'Havington'], 15, 17],
    ['BK-1047', ['Timbergrove Lodge', 'Woods End', 'Oakwood', 'Willowwood'], 10, 15],
  ]
  for (const [code, locs, s, e] of blocks) {
    for (const ln of locs) {
      if (!lid[ln]) continue
      await q(`INSERT INTO booking_rooms (booking_id, location_id, date_from, date_to) VALUES ($1,$2,$3,$4)`,
        [bid[code], lid[ln], addDays(today, s), addDays(today, e)])
    }
  }

  // Facilities — tickets
  const tickets = [
    ['MW-10212', 'Loose railing on Boathouse stairs', 'Top two spindles wobble badly — flagged during evening rounds. Roped off for now.', 'in_progress', 3, 'safety', 'The Boathouse', 'Liam', 'staff', -1],
    ['MW-10214', 'Hot water out in Cedarwood', 'No hot water since Tuesday. Tank is 11 years old — replacing rather than repairing.', 'in_progress', 2, 'maintenance', 'Cedarwood', 'Dave', 'staff', -2],
    ['MW-10216', 'Projector lamp dying in Music Hall', 'Image is dim and pink-ish. Spare lamp is in the AV cage, shelf B.', 'open', 1, 'it', 'Music Hall', 'Ben', 'staff', -1],
    ['MW-10217', 'Wasp nest by Dining Hall side door', 'Under the eave, right above the compost bins. Guests use this door at every meal.', 'open', 2, 'safety', 'Dining Hall', null, 'guest', 0],
    ['MW-10218', 'Dock cleat snapped at Marina', 'Middle cleat on the fuel dock sheared off. Boats rafting two-deep meanwhile.', 'open', 1, 'maintenance', 'Marina & Boat Launch', 'Noah', 'staff', 0],
    ['MW-10219', 'Wi-Fi dead in Leadership Studio', 'AP shows solid amber. Tried power cycling at the switch, no luck.', 'open', 2, 'it', 'Leadership Studio', 'Ben', 'guest', 0],
    ['MW-10220', 'Squeaky floorboard, Royal Muskoka hallway', 'Second floor by room 207. Guests mention it every week.', 'open', 0, 'maintenance', 'Royal Muskoka', null, 'guest', null],
    ['MW-10221', 'Replace burnt-out floods at Playing Field', 'Two of six are out on the north mast.', 'open', 1, 'maintenance', 'Playing Field', 'Liam', 'staff', 2],
    ['MW-10205', 'Broomball rink boards — loose section', 'North corner section flexes on impact.', 'closed', 1, 'maintenance', 'Broomball Rink', 'Noah', 'staff', -6],
    ['MW-10198', 'Deep clean after roof leak — Heritage 1979', 'Carpet dried, baseboards wiped, dehumidifier returned to the shop.', 'closed', 2, 'housekeeping', 'Heritage 1979', 'Ava', 'staff', -9],
    ['MW-10222', 'KrakenRACER pump pressure low', 'Lane 3 and 4 noticeably slower. Pre-season inspection booked.', 'on_hold', 2, 'maintenance', 'KrakenRACER Waterslide', 'Cole', 'staff', 5],
    ['MW-10223', 'Paper towel dispenser empty — Fieldhouse', 'Main gym washrooms, both sides.', 'closed', 0, 'housekeeping', 'The Fieldhouse', 'Maya', 'guest', -1],
  ]
  const tid = {}
  for (const [code, title, details, status, priority, category, loc, assignee, source, dueOff] of tickets) {
    const r = await one(
      `INSERT INTO tickets (code, title, details, status, priority, category, location_id, assignee_id, source, created_by, due_date, submitter_name, closed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() - interval '1 day' * $14) RETURNING id`,
      [code, title, details, status, priority, category, lid[loc] || null, assignee ? uid[assignee] : null, source,
        source === 'staff' ? adminId : null, dueOff === null ? null : addDays(today, dueOff),
        source === 'guest' ? pick(['Guest — Treetops', 'Group leader, Ridgeview', 'TechNorth attendee', 'Guest — Royal Muskoka']) : '',
        status === 'closed' ? new Date() : null, Math.abs(dueOff || 1) + 1]
    )
    tid[code] = r.id
  }
  await q(`INSERT INTO ticket_responses (ticket_id, user_id, author_name, body, is_internal) VALUES
    ($1,$2,'Liam O’Brien','Roped off and signed. New spindles cut this afternoon, install tomorrow morning.',false),
    ($1,$3,'Sarah Mitchell','Thanks — keep the rope up until Dave signs off.',true),
    ($4,$5,'Dave Kowalski','Tank ordered from Bracebridge Home Hardware, ETA Thursday.',false)`,
    [tid['MW-10212'], uid['Liam'], uid['Sarah'], tid['MW-10214'], uid['Dave']])

  // Scheduled tickets
  for (const [title, details, category, freq, nextOff, loc] of [
    ['Pool & waterfront chemical check', 'Test and log chlorine + pH at the waterfront stations.', 'maintenance', 'weekly', 1, 'Main Beach'],
    ['Fire extinguisher walk-through', 'Check gauges and tags in every building, log exceptions.', 'safety', 'monthly', 6, null],
    ['Zipline cable + harness inspection', 'Full inspection per manufacturer checklist before weekend use.', 'safety', 'weekly', 2, 'Upper Zipline'],
    ['Grease trap service — Dining Hall', 'Scheduled service with Muskoka Sanitation.', 'maintenance', 'monthly', 12, 'Dining Hall'],
  ]) {
    await q(`INSERT INTO scheduled_tickets (title, details, category, frequency, next_run, location_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [title, details, category, freq, addDays(today, nextOff), loc ? lid[loc] : null])
  }

  // Assets
  for (const [name, category, loc, status, serial] of [
    ['Rescue boat — Zodiac 420', 'waterfront', 'Marina & Boat Launch', 'operational', 'ZD-2019-114'],
    ['Ski boat — Malibu 23 LSV', 'waterfront', 'Marina & Boat Launch', 'operational', 'MB-2022-871'],
    ['Kubota RTV-X1100', 'vehicle', 'Maintenance Shop', 'needs_service', 'KB-1100-203'],
    ['John Deere 5075E tractor', 'vehicle', 'Maintenance Shop', 'operational', 'JD-5075-090'],
    ['Hangar sound console — DiGiCo S21', 'av', 'The Hangar', 'operational', 'DG-S21-4471'],
    ['Music Hall projector — Epson L630', 'av', 'Music Hall', 'needs_service', 'EP-L630-118'],
    ['Golf cart fleet (6)', 'vehicle', 'Welcome Centre', 'operational', ''],
    ['Industrial washer #2', 'building', 'Royal Muskoka', 'out_of_service', 'WH-220-02'],
  ]) {
    await q(`INSERT INTO assets (name, category, location_id, status, serial) VALUES ($1,$2,$3,$4,$5)`,
      [name, category, lid[loc] || null, status, serial])
  }

  // Task workflow + phases
  const st = {}
  for (const [name, color, kind, ord] of [
    ['To Do', 'lake', 'open', 0], ['In Progress', 'gold', 'active', 1],
    ['Blocked', 'ember', 'blocked', 2], ['Done', 'pine', 'done', 3],
  ]) {
    const r = await one(`INSERT INTO task_statuses (name, color, kind, ord) VALUES ($1,$2,$3,$4) RETURNING id`, [name, color, kind, ord])
    st[name] = r.id
  }
  const ph = {}
  for (const [name, color, s, e, ord] of [
    ['Spring Opening', 'moss', -55, 9, 0],
    ['Summer Season', 'gold', 10, 95, 1],
    ['Fall Closing', 'ember', 96, 140, 2],
  ]) {
    const r = await one(`INSERT INTO phases (name, color, starts, ends, ord) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, color, addDays(today, s), addDays(today, e), ord])
    ph[name] = r.id
  }

  const tasks = [
    ['Docks in — main waterfront', 'Done', 'Spring Opening', 'Waterfront Docks', ['Cole', 'Jess'], -12, 2, ['waterfront']],
    ['Anchor and inflate the Wibit', 'Done', 'Spring Opening', 'Wibit Waterpark', ['Cole', 'Jess'], -8, 2, ['waterfront']],
    ['KrakenRACER pre-season inspection', 'Blocked', 'Spring Opening', 'KrakenRACER Waterslide', ['Cole'], 4, 3, ['waterfront', 'safety'], 'Waiting on pump pressure ticket MW-10222.'],
    ['Deep clean Treetops row after Ridgeview', 'To Do', 'Spring Opening', 'Treetops 1–4', ['Ava', 'Maya'], 1, 2, ['housekeeping'], '', [['Strip linens', true], ['Bathrooms', false], ['Floors', false], ['Restock', false]]],
    ['Turn over Royal Muskoka for St. Andrew’s', 'To Do', 'Spring Opening', 'Royal Muskoka', ['Ava'], 1, 3, ['housekeeping']],
    ['Hang summer staff photos in Main Office', 'To Do', 'Summer Season', 'Main Office', ['Cindy'], 9, 0, ['office']],
    ['Re-string archery nets', 'In Progress', 'Spring Opening', 'Archery Range', ['Tyler'], 2, 1, ['program']],
    ['High Ropes course certification visit', 'In Progress', 'Spring Opening', 'High Ropes', ['Tyler', 'Grace'], 3, 3, ['safety', 'program']],
    ['Mow and line the Playing Field', 'To Do', 'Spring Opening', 'Playing Field', ['Noah'], 1, 1, ['grounds']],
    ['Stage The Hangar for staff training', 'To Do', 'Summer Season', 'The Hangar', ['Ben', 'Grace'], 9, 2, ['av', 'program'], '', [['Stage risers', false], ['Sound check', false], ['Projection', false], ['Chairs x180', false]]],
    ['Flip Dining Hall to summer menu boards', 'To Do', 'Summer Season', 'Dining Hall', ['Marcus', 'Sophie'], 8, 1, ['kitchen']],
    ['Beach volleyball courts — fresh sand', 'Done', 'Spring Opening', 'Beach Volleyball', ['Noah'], -4, 1, ['grounds']],
    ['Pressure-wash The Backyard stage', 'To Do', 'Spring Opening', 'The Backyard', ['Liam'], 5, 0, ['grounds']],
    ['Inventory lifejackets and paddles', 'In Progress', 'Spring Opening', 'The Boathouse', ['Jess'], 2, 1, ['waterfront'], '', [['Count PFDs', true], ['Check buckles', false], ['Tag retirements', false]]],
    ['Welcome Centre planters and signage', 'Done', 'Spring Opening', 'Welcome Centre', ['Cindy'], -2, 0, ['guest-experience']],
    ['Order propane for summer kitchens', 'To Do', 'Summer Season', 'Maintenance Shop', ['Dave'], 6, 2, ['kitchen', 'order']],
    ['Disc golf baskets 7–9 leveling', 'To Do', 'Spring Opening', 'Disc Golf Course', ['Noah'], 7, 0, ['grounds']],
    ['CEO Lodge fireplace inspection', 'Done', 'Spring Opening', 'CEO Lodge', ['Dave'], -6, 1, ['safety']],
  ]
  let ord = 1
  const taskIds = {}
  for (const [title, status, phase, loc, people, dueOff, priority, tags, notes = '', checklist = []] of tasks) {
    const r = await one(
      `INSERT INTO tasks (title, notes, status_id, priority, phase_id, location_id, due, tags, checklist, ord, assignees, created_by, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [title, notes, st[status], priority, ph[phase], lid[loc] || null, addDays(today, dueOff), tags,
        JSON.stringify(checklist.map(([text, done], i) => ({ id: `c${i}`, text, done }))),
        ord++, people.map(p => uid[p]).filter(Boolean), adminId,
        status === 'Done' ? new Date() : null]
    )
    taskIds[title] = r.id
  }

  // Sign-out trips: live board + history
  const now = Date.now()
  const H = 3600 * 1000
  await q(`INSERT INTO trips (user_id, signed_out_at, destination, expected_return, vehicle, companions) VALUES
    ($1, to_timestamp($2), 'Bracebridge — dump run', to_timestamp($3), 'Kubota + trailer', ''),
    ($4, to_timestamp($5), 'Port Carling — parts pickup', to_timestamp($6), 'Camp van 2', 'Noah Fitzgerald'),
    ($7, to_timestamp($8), 'Rosseau — bank + post office', to_timestamp($9), '', '')`,
    [uid['Dave'], (now - 2.2 * H) / 1000, (now + 1.8 * H) / 1000,
     uid['Jess'], (now - 0.7 * H) / 1000, (now + 1.3 * H) / 1000,
     uid['Tyler'], (now - 3.1 * H) / 1000, (now - 0.6 * H) / 1000]) // Tyler is overdue

  const destinations = ['Rosseau', 'Port Carling', 'Bracebridge', 'Huntsville', 'Parry Sound', 'Dump run']
  const tripUsers = ['Liam', 'Noah', 'Ava', 'Maya', 'Grace', 'Marcus', 'Sophie', 'Ben', 'Cindy', 'Olivia', 'Emma', 'Cole']
  for (let i = 0; i < 26; i++) {
    const u = uid[pick(tripUsers)]
    const out = now - (i * 9 + 6 + Math.random() * 4) * H
    const dur = (0.5 + Math.random() * 4) * H
    await q(`INSERT INTO trips (user_id, signed_out_at, signed_in_at, destination, expected_return) VALUES
      ($1, to_timestamp($2), to_timestamp($3), $4, to_timestamp($5))`,
      [u, out / 1000, (out + dur) / 1000, pick(destinations), (out + dur * 0.9) / 1000])
  }

  // Shopping
  const towns = {}
  for (const t of ['Bracebridge', 'Huntsville', 'Port Carling']) {
    const r = await one(`INSERT INTO towns (name) VALUES ($1) RETURNING id`, [t])
    towns[t] = r.id
  }
  for (const [text, category, town, qty, by, done] of [
    ['2" deck screws', 'Hardware', 'Bracebridge', '4 boxes', 'Dave', false],
    ['Hot water tank fittings — 3/4 NPT', 'Hardware', 'Bracebridge', '', 'Dave', false],
    ['Marine rope, 12mm', 'Hardware', 'Huntsville', '50 m', 'Cole', false],
    ['Pool test strips', 'Hardware', 'Huntsville', '3 tubs', 'Cole', false],
    ['Flour — all purpose', 'Grocery', 'Bracebridge', '8 × 10 kg', 'Marcus', false],
    ['Maple syrup (real, obviously)', 'Grocery', 'Port Carling', '12 L', 'Marcus', false],
    ['Coffee — dark roast', 'Grocery', 'Bracebridge', '6 × 1 kg', 'Sophie', true],
    ['Sidewalk chalk + bubbles', 'Program', 'Huntsville', 'lots', 'Grace', false],
    ['Foam arrows (Archery Tag)', 'Program', 'Huntsville', '24', 'Tyler', true],
    ['HDMI cables — 25 ft', 'Office', 'Bracebridge', '4', 'Ben', false],
    ['Laminating pouches', 'Office', 'Bracebridge', '2 boxes', 'Cindy', true],
    ['Paper towel — case', 'Kitchen', 'Bracebridge', '6 cases', 'Ava', false],
    ['Toilet paper — case', 'Kitchen', 'Bracebridge', '8 cases', 'Ava', false],
    ['Propane exchange', 'Hardware', 'Port Carling', '4 tanks', 'Dave', false],
  ]) {
    await q(
      `INSERT INTO shopping_items (text, category, town_id, qty, added_by, completed, completed_at, completed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [text, category, towns[town], qty, uid[by], done, done ? new Date() : null, done ? uid[by] : null]
    )
  }
  await q(`INSERT INTO town_runs (town_id, user_id, started_at, ended_at, items_purchased) VALUES
    ($1, $2, now() - interval '3 days', now() - interval '3 days' + interval '2.5 hours', 9)`,
    [towns['Bracebridge'], uid['Olivia']])

  // Kudos
  for (const [from, to, value, message] of [
    ['Sarah', 'Ava', 'protect', 'Treetops flip after the school group was flawless — 38 beds in under three hours. Unreal.'],
    ['Cole', 'Jess', 'lead', 'Ran the whole dock-in day like a pro while I was off property. Crew followed her lead all day.'],
    ['Emma', 'Cindy', 'invite', 'A nervous first-time group leader left saying it was the best welcome they have had anywhere.'],
    ['Dave', 'Noah', 'challenge', 'Taught himself the new irrigation controller over a weekend and saved us a service call.'],
    ['Hannah', 'Marcus', 'celebrate', 'Surprise birthday cake for a camper with a dairy allergy — mom cried. Chef magic.'],
    ['Tyler', 'Grace', 'accept', 'Noticed a camper sitting out and had them leading the cheer by dinner.'],
    ['Olivia', 'Ben', 'protect', 'Stayed late to get the Health Centre network back before the weekend rush.'],
    ['Grace', 'Sophie', 'celebrate', 'Cinnamon buns at the staff meeting. That is all. That is the kudos.'],
  ]) {
    await q(`INSERT INTO kudos (from_id, to_id, value_key, message, reactions, created_at)
      VALUES ($1,$2,$3,$4,$5, now() - interval '1 hour' * floor(random()*120))`,
      [uid[from], uid[to], value, message, JSON.stringify({ '👏': [uid['Sarah']], '🔥': [uid['Hannah'], uid['Emma']] })])
  }

  // Pulse — this week
  const week = isoWeek()
  const moods = [4, 5, 4, 3, 5, 4, 4, 5, 3, 4, 5, 4]
  const pulseUsers = ['Sarah', 'Dave', 'Emma', 'Cole', 'Hannah', 'Liam', 'Ava', 'Jess', 'Tyler', 'Grace', 'Marcus', 'Ben']
  for (let i = 0; i < pulseUsers.length; i++) {
    await q(`INSERT INTO pulse (week, user_id, mood, enps, comment) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [week, uid[pulseUsers[i]], moods[i], 6 + (moods[i] >= 4 ? 3 : 0), i === 3 ? 'Long week with back-to-back groups, but the team is carrying it well.' : ''])
  }

  // Community
  await q(`INSERT INTO posts (kind, author_id, title, body, pinned, reactions, created_at) VALUES
    ('announcement', $1, 'Staff BBQ — Friday at The Backyard', 'Burgers on at 6:00 pm, games at 7:00. Bring a lawn chair and your loudest camp shirt. Kitchen crew gets first dibs — they earned it this week.', true, $2, now() - interval '26 hours'),
    ('announcement', $3, 'Summer staff arrive June 21', 'Training week schedule is posted in WoodsOS → Bookings (BK-1047). Department leads: your breakout rooms are confirmed.', false, '{}', now() - interval '2 days'),
    ('praise', $4, '', 'Huge shout-out to the waterfront crew — docks in, Wibit up, and not a single missing bolt this year. Smoothest spring on record.', false, $5, now() - interval '20 hours'),
    ('prayer', $6, '', 'My dad goes in for knee surgery Thursday — would appreciate prayers for a smooth recovery.', false, $7, now() - interval '9 hours'),
    ('post', $8, '', 'Loon pair is back in the north bay! Spotted them at 6:15 this morning from the Boathouse point. Summer is officially allowed to start.', false, $9, now() - interval '4 hours')`,
    [uid['Hannah'], JSON.stringify({ '🎉': [uid['Grace'], uid['Tyler'], uid['Sophie']] }),
     uid['Sarah'],
     uid['Cole'], JSON.stringify({ '👏': [uid['Sarah'], uid['Hannah'], uid['Dave'], uid['Emma']], '🔥': [uid['Jess']] }),
     uid['Ravi'], JSON.stringify({ '🙏': [uid['Hannah'], uid['Cindy'], uid['Olivia'], uid['Sarah'], uid['Grace']] }),
     uid['Grace'], JSON.stringify({ '❤️': [uid['Jess'], uid['Cindy'], uid['Hannah']], '🌲': [uid['Cole']] })])

  const lastPost = await one(`SELECT id FROM posts WHERE kind='prayer' LIMIT 1`)
  if (lastPost) {
    await q(`INSERT INTO post_comments (post_id, author_id, body) VALUES ($1,$2,'Praying — keep us posted, Ravi.')`,
      [lastPost.id, uid['Hannah']])
  }

  for (const [title, dateOff, loc, emoji, descr] of [
    ['Staff BBQ & yard games', 1, 'The Backyard', '🍔', 'Food at 6, games at 7. All staff.'],
    ['Canoe race — staff vs. leads', 5, 'Main Beach', '🛶', 'Winners get first parking row for the summer.'],
    ['Worship night', 7, 'The Boathouse', '🎸', 'Casual, all welcome, snacks after.'],
    ['Summer staff training kickoff', 10, 'The Hangar', '🌲', 'Day one of training week — full team.'],
  ]) {
    await q(`INSERT INTO events (title, date, location, emoji, descr) VALUES ($1,$2,$3,$4,$5)`,
      [title, addDays(today, dateOff), loc, emoji, descr])
  }

  /* ======================= expansion features ======================= */

  // Org chart + bios
  const managerOf = {
    Sarah: adminId, Dave: uid['Sarah'], Emma: uid['Sarah'], Cole: uid['Sarah'], Hannah: uid['Sarah'],
    Liam: uid['Dave'], Noah: uid['Dave'], Ava: uid['Emma'], Maya: uid['Emma'], Jess: uid['Cole'],
    Tyler: uid['Hannah'], Grace: uid['Hannah'], Marcus: uid['Sarah'], Sophie: uid['Marcus'],
    Ben: uid['Sarah'], Cindy: uid['Emma'], Olivia: uid['Emma'], Ravi: uid['Sarah'],
  }
  for (const [first, mgr] of Object.entries(managerOf)) {
    if (uid[first] && mgr) await q(`UPDATE users SET manager_id = $2 WHERE id = $1`, [uid[first], mgr])
  }
  await q(`UPDATE users SET bio = $2 WHERE id = $1`, [uid['Dave'], 'Eleven summers keeping the lights on and the water hot. If it has a motor, I have probably fixed it twice.'])
  await q(`UPDATE users SET bio = $2 WHERE id = $1`, [uid['Grace'], 'Wide games, campfires, and an unreasonable number of friendship bracelets.'])
  await q(`UPDATE users SET bio = $2 WHERE id = $1`, [uid['Jess'], 'NLS lifeguard. Will race you to the swim raft.'])

  // Ticket lifecycle backfill: events mirror each ticket's real history
  await q(`INSERT INTO ticket_events (ticket_id, kind, detail, created_at)
           SELECT id, 'created', jsonb_build_object('source', source), created_at FROM tickets`)
  await q(`INSERT INTO ticket_events (ticket_id, kind, detail, user_name, created_at)
           SELECT id, 'status', jsonb_build_object('from','open','to',status), 'Dave Kowalski', created_at + interval '2 hours'
           FROM tickets WHERE status IN ('in_progress','on_hold','closed')`)
  await q(`UPDATE tickets SET first_response_at = created_at + interval '1 hour' * (1 + random()*5)
           WHERE id IN (SELECT DISTINCT ticket_id FROM ticket_responses) OR status = 'closed'`)
  await q(`UPDATE tickets SET on_hold_at = now() - interval '26 hours' WHERE status = 'on_hold'`)

  // Two-way guest chat: live thread on the Wi-Fi report, rated thread on the closed one
  const wifiTok = token(12), waspTok = token(12), towelTok = token(12)
  await q(`UPDATE tickets SET public_token = $2 WHERE id = $1`, [tid['MW-10219'], wifiTok])
  await q(`UPDATE tickets SET public_token = $2 WHERE id = $1`, [tid['MW-10217'], waspTok])
  await q(`UPDATE tickets SET public_token = $2, rating = 5, rating_comment = 'Fixed before our afternoon session — impressive!' WHERE id = $1`,
    [tid['MW-10223'], towelTok])
  await q(`INSERT INTO ticket_responses (ticket_id, user_id, author_name, body, is_internal, is_guest, created_at) VALUES
    ($1, $2, 'Ben Whitfield', 'Thanks for the report! Swapping the access point this afternoon — should be back before your 4:00 session.', false, false, now() - interval '3 hours'),
    ($1, NULL, 'Group leader, Ridgeview', 'Amazing, thank you. The router light is orange if that helps — we’re in the Studio until 4.', false, true, now() - interval '40 minutes')`,
    [tid['MW-10219'], uid['Ben']])
  await q(`UPDATE tickets SET guest_unread = true WHERE id = $1`, [tid['MW-10219']])
  await q(`INSERT INTO ticket_events (ticket_id, kind, detail, created_at) VALUES ($1,'guest_message','{}', now() - interval '40 minutes')`,
    [tid['MW-10219']])

  // Leads pipeline
  const leads = [
    ['Birchmount Scouts — Fall Camporee', 'Scouts Canada · Birchmount', 'Karen Doyle', 'kdoyle@scouts.ca', 'new', 90, 110, 38000, 'Dave', 'Looking at two October weekends, ~90 youth plus leaders.', 4],
    ['Lakefield College — Outdoor Ed', 'Lakefield College School', 'Marc Bisson', 'mbisson@lakefieldcs.ca', 'contacted', 75, 95, 32000, 'Emma', 'Grade 9 program, 3 nights. Asked about climbing + canoeing certs.', 6],
    ['Northern Lights Worship Weekend', 'Northern Lights Church', 'Pastor Amy Cho', 'amy@nlchurch.ca', 'tour', 140, 150, 58000, 'Emma', 'Touring Saturday 10am — wants The Hangar and lakeside chapel.', 11],
    ['Cedarview Teachers’ Retreat', 'Cedarview District', 'J. Okafor', 'jokafor@cedarview.ca', 'proposal', 45, 60, 21000, 'Sarah', 'Proposal sent — waiting on board approval, decision by month end.', 19],
    ['Bayfield Hockey Camp', 'Bayfield Minor Hockey', 'Rick Tremblay', 'rick@bayfieldhockey.ca', 'lost', 60, 0, 24000, 'Dave', 'Went with a rink-side venue — ice time mattered more than the lake.', 30],
    ['True North Leadership Summit', 'True North Co.', 'Dana Whyte', 'dana@truenorth.co', 'won', 55, 70, 41000, 'Sarah', 'Confirmed for late summer — converted to booking.', 24],
  ]
  let lord = 0
  for (const [name, organization, contact, email, stage, hc, , value, owner, message, ageDays] of leads) {
    await q(
      `INSERT INTO leads (name, organization, contact_name, email, stage, expected_headcount, preferred_start, preferred_end,
         value_estimate, owner_id, message, lost_reason, source, ord, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now() - interval '1 day' * $15, now() - interval '1 day' * $16)`,
      [name, organization, contact, email, stage, hc, addDays(today, 40 + lord * 9), addDays(today, 42 + lord * 9),
        value, uid[owner], message, stage === 'lost' ? 'Chose a venue with on-site ice time' : '', lord < 2 ? 'website' : 'manual',
        lord++, ageDays, Math.max(0, ageDays - 3)]
    )
  }

  // Billing — invoices across every state, with payments
  const inv = async (number, code, status, issueOff, dueOff, items, notes = '') => {
    const r = await one(
      `INSERT INTO invoices (number, booking_id, customer_id, status, issue_date, due_date, tax_rate, items, notes, created_by)
       VALUES ($1,$2,(SELECT customer_id FROM bookings WHERE id = $2),$3,$4,$5,13,$6,$7,$8) RETURNING id`,
      [number, bid[code], status, addDays(today, issueOff), addDays(today, dueOff), JSON.stringify(items), notes, adminId])
    return r.id
  }
  const i1 = await inv('INV-1041', 'BK-1037', 'sent', -34, -4, [
    { description: 'Accommodation — 42 guests × 2 nights', qty: 84, unit_price: 95 },
    { description: 'Meals — full board', qty: 42, unit_price: 110 },
    { description: 'Program facilitation', qty: 1, unit_price: 2400 },
  ])
  await q(`INSERT INTO payments (invoice_id, date, amount, method, reference, created_by) VALUES
    ($1, $2, 16500.00, 'e-transfer', 'ETR-88412', $3)`, [i1, addDays(today, -20), adminId])
  const i2 = await inv('INV-1042', 'BK-1038', 'sent', -15, 15, [
    { description: 'Accommodation — Royal Muskoka block', qty: 38, unit_price: 180 },
    { description: 'Meals — full board', qty: 38, unit_price: 105 },
    { description: 'Boathouse venue + AV', qty: 1, unit_price: 1200 },
  ])
  await q(`INSERT INTO payments (invoice_id, date, amount, method, reference, created_by) VALUES
    ($1, $2, 5000.00, 'cheque', 'CHQ 2241', $3)`, [i2, addDays(today, -8), adminId])
  const i3 = await inv('INV-1043', 'BK-1041', 'sent', -2, 28, [
    { description: 'School trip package — 145 students × 4 nights', qty: 145, unit_price: 385 },
    { description: 'High ropes + zipline add-on', qty: 145, unit_price: 28 },
  ])
  const i4 = await inv('INV-1044', 'BK-1043', 'sent', -1, 29, [
    { description: 'Corporate offsite — Chalets, 28 guests', qty: 28, unit_price: 420 },
    { description: 'Leadership Studio + facilitation day', qty: 1, unit_price: 3000 },
  ])
  await q(`INSERT INTO payments (invoice_id, date, amount, method, reference, created_by) VALUES
    ($1, $2, 14760.00, 'e-transfer', 'ETR-90133', $3)`, [i4, addDays(today, -1), adminId])
  await inv('INV-1045', 'BK-1042', 'draft', 0, 30, [
    { description: 'Men’s retreat — 60 guests × 2 nights', qty: 60, unit_price: 230 },
  ], 'Waiting on final headcount before sending.')

  // Catering — meal services + group dietary notes
  await q(`UPDATE bookings SET dietary = $2 WHERE id = $1`,
    [bid['BK-1041'], '14 vegetarian · 3 gluten-free · 1 severe peanut allergy (EpiPen with teacher — table 6)'])
  await q(`UPDATE bookings SET dietary = $2 WHERE id = $1`, [bid['BK-1043'], '2 vegan · 1 lactose-free'])
  await q(`UPDATE bookings SET dietary = $2 WHERE id = $1`, [bid['BK-1045'], '6 halal · 4 vegetarian'])
  const meals = [
    ['BK-1041', 0, 'breakfast', '8:00', 145, 'Pancakes, sausage, fruit bar', 'Dining Hall'],
    ['BK-1041', 0, 'lunch', '12:30', 145, 'Build-your-own sandwich bar', 'Dining Hall'],
    ['BK-1041', 0, 'dinner', '17:45', 148, 'Taco night', 'Dining Hall'],
    ['BK-1041', 1, 'breakfast', '8:00', 145, 'Eggs + bacon, oatmeal bar', 'Dining Hall'],
    ['BK-1041', 1, 'lunch', '12:00', 145, 'Departure boxed lunch', 'Dining Hall'],
    ['BK-1043', 0, 'lunch', '12:30', 28, 'Harvest bowl catering', 'Leadership Studio'],
    ['BK-1043', 0, 'dinner', '18:30', 30, 'Lakeside BBQ — chef on site', 'The Boathouse'],
    ['BK-1043', 1, 'breakfast', '7:30', 28, 'Continental + espresso cart', 'Leadership Studio'],
    ['BK-1042', 1, 'dinner', '18:00', 60, 'Roast chicken, root veg', 'Dining Hall'],
    ['BK-1042', 2, 'breakfast', '8:00', 60, 'Classic camp breakfast', 'Dining Hall'],
    ['BK-1042', 2, 'dinner', '18:00', 60, 'Steak night', 'Dining Hall'],
    ['BK-1045', 4, 'dinner', '17:30', 120, 'Spaghetti + garlic bread (halal sauce separate)', 'Dining Hall'],
  ]
  for (const [code, off, meal, time, hc, menu, loc] of meals) {
    await q(`INSERT INTO meal_services (booking_id, date, meal, time, headcount, menu, location_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [bid[code], addDays(today, off), meal, time, hc, menu, lid[loc] || null])
  }

  // Growth — 1:1s with rolled agendas
  const oo1 = await one(
    `INSERT INTO one_on_ones (a_id, b_id, date, recurrence, created_by) VALUES ($1,$2, now() + interval '2 days', 'biweekly', $1) RETURNING id`,
    [uid['Sarah'], uid['Dave']])
  await q(`INSERT INTO oo_items (meeting_id, author_id, text, kind, done, ord) VALUES
    ($1,$2,'Summer budget — where does the hot water tank overage land?', 'talking', false, 1),
    ($1,$3,'Coverage plan while Liam is at small-engine course', 'talking', false, 2),
    ($1,$2,'Book KrakenRACER inspector before June 20', 'action', false, 3),
    ($1,$3,'Send Sarah the asset replacement shortlist', 'action', true, 4)`,
    [oo1.id, uid['Sarah'], uid['Dave']])
  const oo2 = await one(
    `INSERT INTO one_on_ones (a_id, b_id, date, recurrence, status, shared_notes, summary, created_by, ended_at)
     VALUES ($1,$2, now() - interval '9 days', 'biweekly', 'done',
       'Talked through training week breakouts and the new wide-game rotation.',
       'Grace owns the Tuesday evening program block for training week. Hannah to clear budget for supplies.',
       $1, now() - interval '9 days') RETURNING id`,
    [uid['Hannah'], uid['Grace']])
  await q(`INSERT INTO oo_items (meeting_id, author_id, text, kind, done, ord) VALUES
    ($1,$2,'Training week evening program draft', 'talking', true, 1),
    ($1,$3,'Price out supplies for 3 new wide games', 'action', true, 2)`,
    [oo2.id, uid['Hannah'], uid['Grace']])
  await q(`INSERT INTO one_on_ones (a_id, b_id, date, recurrence, created_by) VALUES ($1,$2, now() + interval '5 days', 'weekly', $1)`,
    [uid['Dave'], uid['Liam']])

  // Growth — goals + check-ins
  const g1 = await one(`INSERT INTO goals (title, descr, type, owner_id, dept, due, status, progress, krs) VALUES
    ('Every guest group leaves at 9/10 or better', 'Post-stay survey average across the summer season.', 'org', $1, '', $2, 'on', 72,
     '[{"text":"Survey every departing group","done":true},{"text":"48-hour follow-up on every flag","done":false},{"text":"Summer average ≥ 9.0","done":false}]') RETURNING id`,
    [uid['Sarah'], addDays(today, 100)])
  await q(`INSERT INTO goal_checkins (goal_id, by_id, progress, status, comment, created_at) VALUES
    ($1,$2,72,'on','Spring groups averaging 9.2 — keep the streak through training week.', now() - interval '3 days')`,
    [g1.id, uid['Sarah']])
  const g2 = await one(`INSERT INTO goals (title, descr, type, owner_id, dept, due, status, progress) VALUES
    ('Zero overdue safety inspections all season', 'Ropes, waterfront, fire — every scheduled inspection done on or before its date.', 'team', $1, 'Facilities', $2, 'on', 85) RETURNING id`,
    [uid['Dave'], addDays(today, 120)])
  await q(`INSERT INTO goal_checkins (goal_id, by_id, progress, status, comment, created_at) VALUES
    ($1,$2,85,'on','High ropes cert visit this week closes the spring list.', now() - interval '1 day')`,
    [g2.id, uid['Dave']])
  await q(`INSERT INTO goals (title, descr, type, owner_id, dept, due, status, progress) VALUES
    ('Summer staff fully trained by July 1', 'All 180 summer staff through the full training program with sign-offs.', 'team', $1, 'Leadership', $2, 'behind', 40),
    ('Small-engine certification', 'Evening course in Bracebridge — covers the mower fleet and outboards.', 'individual', $3, 'Facilities', $4, 'on', 30),
    ('NLS recertification', 'Renew before waterfront opens to summer camps.', 'individual', $5, 'Waterfront', $6, 'on', 90),
    ('Design 3 new wide games for summer', 'Tested with staff before campers arrive.', 'individual', $7, 'Program', $8, 'done', 100)`,
    [uid['Hannah'], addDays(today, 20), uid['Liam'], addDays(today, 35), uid['Jess'], addDays(today, 12), uid['Grace'], addDays(today, 8)])

  // Growth — feedback
  await q(`INSERT INTO feedback (kind, requester_id, responder_id, prompt, status, created_at) VALUES
    ('request', $1, $2, 'What should I stop / start / continue as training week lead?', 'pending', now() - interval '1 day')`,
    [uid['Hannah'], uid['Dave']])
  await q(`INSERT INTO feedback (kind, requester_id, responder_id, prompt, status, response, responded_at, created_at) VALUES
    ('request', $1, $2, 'How did the archery rotation land with your group?', 'answered',
     'Pacing was great — the kids never stood around. Only note: the safety talk ran long, could be a printed card.', now() - interval '2 days', now() - interval '4 days')`,
    [uid['Grace'], uid['Tyler']])
  await q(`INSERT INTO feedback (kind, from_id, to_id, fb_type, message, status, created_at) VALUES
    ('given', $1, $2, 'praise', 'The way you handled the double-booked Fieldhouse on Tuesday was textbook — both groups left happy and neither knew there was ever a problem.', 'answered', now() - interval '2 days'),
    ('given', $3, $4, 'growth', 'You’re fast — sometimes faster than your radio updates. Call the job closed in the channel before you roll to the next one and the board stays true.', 'answered', now() - interval '5 days')`,
    [uid['Sarah'], uid['Emma'], uid['Dave'], uid['Noah']])

  // Asset service history + next-service dates
  const aid = {}
  for (const r of (await q(`SELECT id, name FROM assets`)).rows) aid[r.name] = r.id
  await q(`INSERT INTO asset_logs (asset_id, kind, notes, cost, date, by_id) VALUES
    ($1,'service','600-hour service — oil, filters, brake check.', 240.00, $2, $3),
    ($4,'inspection','Spring launch inspection — hull, fuel lines, kill switch. Passed.', NULL, $5, $6),
    ($7,'repair','Drum bearing replaced. Listed for end-of-season replacement.', 410.00, $8, $9),
    ($10,'service','Lamp swapped + filter cleaned.', 185.00, $11, $12)`,
    [aid['Kubota RTV-X1100'], addDays(today, -12), uid['Liam'],
     aid['Rescue boat — Zodiac 420'], addDays(today, -30), uid['Cole'],
     aid['Industrial washer #2'], addDays(today, -5), uid['Dave'],
     aid['Music Hall projector — Epson L630'], addDays(today, -2), uid['Ben']])
  await q(`UPDATE assets SET next_service = $2, purchase_date = '2021-04-12', value = 28500 WHERE id = $1`, [aid['Kubota RTV-X1100'], addDays(today, 20)])
  await q(`UPDATE assets SET next_service = $2 WHERE id = $1`, [aid['Industrial washer #2'], addDays(today, -2)])
  await q(`UPDATE assets SET next_service = $2, purchase_date = '2019-05-01', value = 12400 WHERE id = $1`, [aid['Rescue boat — Zodiac 420'], addDays(today, 300)])

  // Task templates + a dependency example
  await q(`INSERT INTO task_templates (name, descr, items, created_by) VALUES
    ('Lodge turnover', 'Standard between-groups flip for any lodge.', $1, $2),
    ('Waterfront opening day', 'Everything between ice-out and the first canoe.', $3, $2)`,
    [JSON.stringify([
      { title: 'Strip linens + start laundry', priority: 2, offset_days: 0, tags: ['housekeeping'] },
      { title: 'Bathrooms — full clean', priority: 2, offset_days: 0, tags: ['housekeeping'] },
      { title: 'Floors, windows, touch points', priority: 1, offset_days: 0, tags: ['housekeeping'] },
      { title: 'Restock + welcome setup', priority: 1, offset_days: 0, tags: ['housekeeping'], checklist: [{ id: 'c0', text: 'Soap + paper', done: false }, { id: 'c1', text: 'Welcome card', done: false }] },
      { title: 'Maintenance walk-through', priority: 1, offset_days: 1, tags: ['maintenance'] },
      { title: 'Final inspection + mark Ready', priority: 2, offset_days: 1, tags: ['housekeeping'] },
    ]), adminId,
    JSON.stringify([
      { title: 'Docks in + anchored', priority: 3, offset_days: 0, tags: ['waterfront'] },
      { title: 'Buoy lines set', priority: 2, offset_days: 1, tags: ['waterfront'] },
      { title: 'Lifeguard chairs + boards out', priority: 1, offset_days: 1, tags: ['waterfront'] },
      { title: 'Rescue boat launched + fueled', priority: 3, offset_days: 2, tags: ['waterfront', 'safety'] },
      { title: 'First water-quality test logged', priority: 2, offset_days: 2, tags: ['waterfront', 'safety'] },
    ])])
  const dep = await one(
    `INSERT INTO tasks (title, notes, status_id, priority, phase_id, location_id, due, tags, ord, assignees, created_by, blocked_by)
     VALUES ('Set up Treetops welcome baskets', 'For the St. Andrew’s arrival — baskets are in the Welcome Centre back room.',
       $1, 1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [st['To Do'], ph['Spring Opening'], lid['Treetops 1–4'], addDays(today, 1), ['guest-experience'], ord++,
      [uid['Cindy']].filter(Boolean), adminId, [taskIds['Deep clean Treetops row after Ridgeview']]])
  void dep

  // Smart screens: turn the kudos panel on
  await q(`UPDATE app_settings SET value = jsonb_set(value, '{panels,kudos}', 'true') WHERE key = 'screens'`)

  /* ============================ round 3 ============================ */
  const allTickets = (await q(`SELECT id, code, status, priority FROM tickets ORDER BY id`)).rows
  const openTix = allTickets.filter(t => t.status !== 'closed')

  // Ticket tags (FTF) — a small, colorful catalog with real usage
  const tag = {}
  for (const [name, color] of [
    ['plumbing', '#1087A3'], ['electrical', '#C9A227'], ['guest-impact', '#C26628'],
    ['safety', '#B3422F'], ['seasonal', '#1F6331'], ['parts-ordered', '#5B5EA6'],
  ]) {
    const r = await one(`INSERT INTO tags (name, color) VALUES ($1,$2) RETURNING id`, [name, color])
    tag[name] = r.id
  }
  const tagPairs = [
    [openTix[0]?.id, tag['guest-impact']], [openTix[0]?.id, tag['electrical']],
    [openTix[1]?.id, tag['plumbing']], [openTix[2]?.id, tag['seasonal']],
    [openTix[3]?.id, tag['parts-ordered']], [openTix[1]?.id, tag['guest-impact']],
  ].filter(([a, b]) => a && b)
  for (const [t, g] of tagPairs) {
    await q(`INSERT INTO ticket_tags (ticket_id, tag_id, by_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [t, g, uid['Dave']])
  }

  // Canned responses (FTF saved replies)
  await q(`INSERT INTO canned_responses (title, body, created_by) VALUES
    ('On our way', 'Thanks for letting us know — someone from our team is on the way now. We''ll update you here as soon as it''s sorted.', $1),
    ('Parts ordered', 'Quick update: we found the issue and the replacement part is on order. We''ll have it fixed as soon as it arrives — thanks for your patience!', $1),
    ('Resolved — please confirm', 'We believe this is fixed now. Could you take a quick look and let us know it''s working on your end? Thanks for flagging it!', $1),
    ('Need a bit more info', 'Thanks for the report! Could you tell us a little more — exactly where is this, and is it affecting your group right now?', $1)`,
    [uid['Emma']])

  // Watchers + a pending closure request (the approval workflow, live)
  const watchPairs = [
    [openTix[0]?.id, uid['Ben']], [openTix[0]?.id, uid['Emma']],
    [openTix[1]?.id, uid['Dave']], [openTix[2]?.id, uid['Ava']],
  ].filter(([a, b]) => a && b)
  for (const [t, u] of watchPairs) {
    await q(`INSERT INTO ticket_watchers (ticket_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t, u])
  }
  const reqTik = openTix.find(t => t.status === 'in_progress') || openTix[0]
  if (reqTik) {
    await q(`INSERT INTO closure_requests (ticket_id, requested_by, reason, previous_status, created_at)
             VALUES ($1,$2,'Re-caulked and tested twice — dry overnight. Photos attached on the thread.',$3, now() - interval '5 hours')`,
      [reqTik.id, uid['Noah'], reqTik.status])
    await q(`UPDATE tickets SET status = 'pending_close', pending_close_by = $2 WHERE id = $1`, [reqTik.id, uid['Noah']])
    await q(`INSERT INTO ticket_events (ticket_id, kind, detail, user_id, user_name) VALUES
      ($1,'close_requested','{"reason":"Re-caulked and tested twice — dry overnight."}',$2,'Noah Fitzgerald')`,
      [reqTik.id, uid['Noah']])
  }

  // Due dates + one already-past SLA (the sweep escalates it on first tick),
  // one ASAP priority, and a customer-damage note (FTF field)
  const dueTix = openTix.filter(t => t.id !== reqTik?.id)
  if (dueTix[0]) await q(`UPDATE tickets SET due_date = $2, priority = 4 WHERE id = $1`, [dueTix[0].id, today])
  if (dueTix[1]) await q(`UPDATE tickets SET due_date = $2 WHERE id = $1`, [dueTix[1].id, addDays(today, -1)])
  if (dueTix[2]) await q(`UPDATE tickets SET due_date = $2 WHERE id = $1`, [dueTix[2].id, addDays(today, 3)])
  if (dueTix[3]) await q(`UPDATE tickets SET damage_note = 'Bunk ladder snapped — group leader confirmed campers were jumping from it. Flag for the damage deposit conversation.' WHERE id = $1`, [dueTix[3].id])

  // Message of the day
  await q(`INSERT INTO motd_messages (title, body, created_by) VALUES
    ('WoodsOS 3: Claude is on staff now 🤖🌲',
     'WoodsOS is now AI-native. Grab a personal token under Claude & AI and you can ask Claude for the daily brief, file tickets, check budgets, or sign out gear — everything respects your permissions. Also new: gear checkout, budgets, incidents, lost & found, and the housekeeping board.', $1)`,
    [adminId])

  // ---- Gear & equipment ----
  const gearItems = [
    ['Kayak — single', 'Waterfront', 12, 'The Boathouse'],
    ['Canoe — 3 seat', 'Waterfront', 8, 'The Boathouse'],
    ['SUP board', 'Waterfront', 10, 'The Boathouse'],
    ['PFD — adult', 'Waterfront', 40, 'The Boathouse'],
    ['Climbing harness', 'Outdoor Ed', 24, 'The Hangar'],
    ['Compass + map set', 'Outdoor Ed', 15, 'The Hangar'],
    ['4-person tent', 'Outdoor Ed', 6, 'The Hangar'],
    ['GoPro Hero 12', 'AV & Tech', 4, 'Leadership Studio'],
    ['Walkie-talkie 6-pack', 'AV & Tech', 8, 'Welcome Centre'],
    ['Portable PA system', 'AV & Tech', 3, 'Music Hall'],
    ['Projector — travel', 'AV & Tech', 2, 'Leadership Studio'],
    ['Gaga ball set', 'Program', 5, 'The Fieldhouse'],
    ['Archery kit (6 bows)', 'Program', 4, 'The Hangar'],
    ['Coffee urn — 100 cup', 'Kitchen', 3, 'Dining Hall'],
  ]
  const gid = {}
  for (const [name, category, qty, locName] of gearItems) {
    const r = await one(
      `INSERT INTO gear_items (name, category, qty_total, location_id, requires_training) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, category, qty, lid[locName] || null, name.includes('Climbing') || name.includes('Archery')])
    gid[name] = r.id
  }
  // Open loans — one overdue GoPro (the watcher pings on first tick)
  await q(`INSERT INTO gear_loans (item_id, qty, borrower_id, due_at, out_by, out_at, notes) VALUES
    ($1, 1, $2, now() - interval '26 hours', $3, now() - interval '3 days', 'Filming the Ridgeview highlight reel'),
    ($4, 6, $5, now() + interval '6 hours', $3, now() - interval '2 hours', 'Staff radios for the school trip'),
    ($6, 2, $7, now() + interval '1 day', $8, now() - interval '4 hours', '')`,
    [gid['GoPro Hero 12'], uid['Tyler'], uid['Ben'],
     gid['Walkie-talkie 6-pack'], uid['Emma'],
     gid['SUP board'], uid['Jess'], uid['Cole']])
  await q(`INSERT INTO gear_loans (item_id, qty, borrower_name, booking_id, due_at, out_by, out_at, notes) VALUES
    ($1, 8, 'Ridgeview — Mr. Patterson', $2, now() + interval '8 hours', $3, now() - interval '5 hours', 'Grade 8 paddling rotation'),
    ($4, 20, 'Ridgeview — Mr. Patterson', $2, now() + interval '8 hours', $3, now() - interval '5 hours', 'Sized at the Boathouse')`,
    [gid['Canoe — 3 seat'], bid['BK-1041'], uid['Cole'], gid['PFD — adult']])
  // A little history
  await q(`INSERT INTO gear_loans (item_id, qty, borrower_id, due_at, returned_at, out_by, in_by, out_at, condition_in) VALUES
    ($1, 1, $2, now() - interval '6 days', now() - interval '6 days', $3, $3, now() - interval '7 days', 'good'),
    ($4, 2, $5, now() - interval '12 days', now() - interval '11 days', $6, $6, now() - interval '13 days', 'worn'),
    ($7, 1, $8, now() - interval '20 days', now() - interval '19 days', $3, $6, now() - interval '21 days', 'good')`,
    [gid['Portable PA system'], uid['Grace'], uid['Ben'],
     gid['4-person tent'], uid['Tyler'], uid['Cole'],
     gid['Projector — travel'], uid['Hannah']])

  // ---- Budgets & expenses ----
  const mkBudget = async (name, dept, amount, owner, notes = '') => (await one(
    `INSERT INTO budgets (name, dept, period_start, period_end, amount, owner_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [name, dept, addDays(today, -70), addDays(today, 110), amount, owner, notes])).id
  const bFac = await mkBudget('Facilities — Summer', 'Facilities', 25000, uid['Dave'], 'Repairs, parts, and small tools through Labour Day.')
  const bKit = await mkBudget('Kitchen — Q2', 'Food Services', 40000, uid['Marcus'], 'Food costs excluding contracted bulk orders.')
  const bProg = await mkBudget('Program — Summer', 'Program', 18000, uid['Tyler'], 'Activity supplies, wide games, rainy-day kits.')
  const bMkt = await mkBudget('Guest Experience', 'Guest Services', 3800, uid['Emma'], 'Welcome baskets, signage, lobby touches.')
  const exp = async (b, daysAgo, vendor, descr, amount, category, by, status = 'approved') => {
    await q(
      `INSERT INTO expenses (budget_id, date, vendor, descr, amount, category, status, submitted_by, decided_by, decided_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         CASE WHEN $7 = 'pending' THEN NULL ELSE now() - ($10 || ' days')::interval + interval '6 hours' END,
         now() - ($10 || ' days')::interval)`,
      [b, addDays(today, -daysAgo), vendor, descr, amount, category, status, by,
        status === 'pending' ? null : uid['Sarah'], daysAgo])
  }
  await exp(bFac, 38, 'Home Hardware — Bracebridge', 'Deck screws, joist hangers, stain for Boathouse ramp', 642.18, 'parts', uid['Liam'])
  await exp(bFac, 30, 'Muskoka Plumbing Supply', 'Hot water tank — Cedarwood replacement', 1890.00, 'parts', uid['Dave'])
  await exp(bFac, 21, 'NAPA Auto Parts', 'Kubota 600-hour service kit', 240.00, 'fleet', uid['Liam'])
  await exp(bFac, 12, 'Rona', 'Treated lumber — dock repairs ×3', 1124.50, 'parts', uid['Noah'])
  await exp(bFac, 6, 'Bracebridge Rental', 'Floor sander weekend rental — Music Hall', 380.00, 'rentals', uid['Noah'])
  await exp(bFac, 1, 'Home Hardware — Bracebridge', 'Caulking, sealant, shower hardware', 218.74, 'parts', uid['Noah'], 'pending')
  await exp(bKit, 33, 'Sysco', 'Weekly dry goods order', 6214.80, 'food', uid['Marcus'])
  await exp(bKit, 26, 'Flanagan Foodservice', 'Proteins + dairy', 7430.22, 'food', uid['Marcus'])
  await exp(bKit, 19, 'Sysco', 'Weekly dry goods order', 5980.46, 'food', uid['Marcus'])
  await exp(bKit, 12, 'Local farms co-op', 'Spring produce', 2218.00, 'food', uid['Sophie'])
  await exp(bKit, 5, 'Flanagan Foodservice', 'Proteins + dairy', 6890.10, 'food', uid['Marcus'])
  await exp(bKit, 2, 'Costco Business', 'Allergy-safe alternatives for Maple DSB week', 412.66, 'food', uid['Sophie'], 'pending')
  await exp(bProg, 28, 'Canadian Tire', 'Gaga ball lumber + paint', 386.40, 'supplies', uid['Tyler'])
  await exp(bProg, 14, 'Michaels', 'Craft cabin restock', 612.33, 'supplies', uid['Grace'])
  await exp(bProg, 7, 'Amazon Business', 'Wide-game pinnies, cones, foam dice', 489.90, 'supplies', uid['Tyler'])
  await exp(bMkt, 24, 'Vistaprint', 'Welcome signage refresh', 740.00, 'signage', uid['Emma'])
  await exp(bMkt, 16, 'Muskoka North Goods', 'Welcome baskets ×40', 1980.00, 'guest', uid['Cindy'])
  await exp(bMkt, 9, 'Vistaprint', 'QR report-form posters for every building', 312.50, 'signage', uid['Ben'])
  await exp(bMkt, 3, 'Muskoka North Goods', 'Director’s lounge coffee bar', 486.20, 'guest', uid['Cindy'])
  // Guest Experience is now ~94% spent — the burn watcher fires on first tick
  await exp(bMkt, 0, 'Dollarama', 'Lost & found storage bins + labels', 64.75, 'supplies', uid['Olivia'], 'pending')

  // ---- Incidents (safety log) ----
  const mkIncident = async (code, title, type, sev, daysAgo, locName, descr, actions, status, by, confidential = false) => {
    await q(
      `INSERT INTO incidents (code, title, type, severity, occurred_at, location_id, description, actions_taken, status, confidential, reported_by, closed_at, created_at)
       VALUES ($1,$2,$3,$4, now() - ($5 || ' days')::interval, $6,$7,$8,$9,$10,$11,
         CASE WHEN $9 = 'closed' THEN now() - ($5 || ' days')::interval + interval '2 days' ELSE NULL END,
         now() - ($5 || ' days')::interval)`,
      [code, title, type, sev, daysAgo, lid[locName] || null, descr, actions, status, confidential, by])
  }
  await mkIncident('INC-1001', 'Wasp sting — mild allergic reaction', 'medical', 2, 21, 'The Park · Action Sports',
    'Camper stung twice near the climbing wall. Localized swelling, no anaphylaxis. Parents called.',
    'Ice + antihistamine at Health Centre, monitored 45 min, returned to program. Nest located and removed same day.',
    'closed', uid['Ravi'])
  await mkIncident('INC-1002', 'Loose board on main dock', 'safety', 3, 9, 'The Boathouse',
    'Guest caught a sandal edge on a lifted plank near the swim ladder. No fall, no injury — flagged by lifeguard.',
    'Section roped off immediately; maintenance replaced 3 planks within 2 hours. Full dock walk-through added to weekly checks.',
    'closed', uid['Jess'])
  await mkIncident('INC-1003', 'Kitchen burn — minor', 'medical', 2, 6, 'Dining Hall',
    'Staff member splashed hot oil on forearm during dinner prep. First-degree, ~3cm.',
    'Cooled 20 min, dressed at Health Centre. Reviewed fryer station spacing at next shift huddle.',
    'review', uid['Marcus'])
  await mkIncident('INC-1004', 'Behavioral — homesick camper escalation', 'behavioral', 1, 4, 'Sprucewood',
    'Camper distressed at lights-out two nights running.',
    'Buddy system + morning check-ins with cabin leader. Parents emailed an update.',
    'open', uid['Hannah'], true)
  await mkIncident('INC-1005', 'Slip on wet stairs — Music Hall', 'safety', 2, 2, 'Music Hall',
    'Guest slipped on entrance stairs during rain. Caught the rail, no injury reported.',
    'Wet-floor signage placed; absorbent mats ordered for both entrances.',
    'open', uid['Olivia'])
  await mkIncident('INC-1006', 'Propane smell near kitchen loading door', 'property', 3, 1, 'Dining Hall',
    'Faint propane odour reported by morning delivery driver.',
    'Supply valve closed, supplier emergency line called — fitting tightened and leak-tested by tech before lunch service.',
    'review', uid['Marcus'])

  // ---- Lost & found ----
  const lf = async (kind, daysAgo, locName, category, descr, stored, status = 'open', resolution = '') => {
    await q(
      `INSERT INTO lf_items (kind, date, location_id, category, description, stored_at, status, resolution_note, resolved_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $7 != 'open' THEN now() ELSE NULL END, $9)`,
      [kind, addDays(today, -daysAgo), lid[locName] || null, category, descr, stored, status, resolution, uid['Olivia']])
  }
  await lf('found', 9, 'The Hangar', 'electronics', 'AirPods Pro in a blue case — initials "JT" in sharpie', 'Front Desk — drawer 2')
  await lf('found', 6, 'Dining Hall', 'clothing', 'Kids’ grey Roots hoodie, size M', 'Front Desk — lost & found rack')
  await lf('found', 5, 'The Boathouse', 'other', 'Single car key on a red carabiner (Toyota)', 'Front Desk — drawer 2')
  await lf('found', 3, 'The Fieldhouse', 'jewelry', 'Thin gold chain bracelet', 'Office safe', 'claimed', 'Matched to Ridgeview parent — picked up at checkout.')
  await lf('found', 2, 'Sprucewood', 'toys', 'Stuffed moose, very loved, answers to "Bruce"', 'Front Desk — lost & found rack')
  await lf('found', 1, 'Music Hall', 'electronics', 'Black iPhone 13, cracked screen protector, case has a carabiner clip', 'Office safe')
  await lf('lost', 4, 'The Park · Action Sports', 'electronics', 'GUEST REPORT: Garmin Forerunner watch, lost during wide game Tuesday evening', '', 'open')
  await lf('lost', 2, 'Treetops 1–4', 'clothing', 'GUEST REPORT: Child’s red rain jacket (Gap, size 8) — left on porch hooks', '', 'open')
  await lf('found', 14, 'Welcome Centre', 'documents', 'Reading glasses, tortoiseshell, in a soft case', 'Front Desk — drawer 2', 'donated', 'Held 10 days, no claim — donated with the spring batch.')

  // ---- Staff certifications ----
  const cert = async (who, name, issuer, monthsAgo, monthsLeft, notes = '') => {
    await q(`INSERT INTO user_certs (user_id, name, issuer, issued, expires, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [uid[who], name, issuer, addDays(today, -monthsAgo * 30), monthsLeft == null ? null : addDays(today, monthsLeft * 30), notes])
  }
  await cert('Jess', 'National Lifeguard (NL) — Waterfront', 'Lifesaving Society', 23, 0.7, 'Recert booked in Huntsville — confirm date')
  await cert('Cole', 'National Lifeguard (NL) — Waterfront', 'Lifesaving Society', 9, 15)
  await cert('Cole', 'Pleasure Craft Operator Card', 'Transport Canada', 60, null, 'No expiry')
  await cert('Jess', 'Standard First Aid + CPR-C', 'Canadian Red Cross', 12, 24)
  await cert('Liam', 'Standard First Aid + CPR-C', 'Canadian Red Cross', 37, -1, 'EXPIRED — booked on the June 21 course')
  await cert('Noah', 'Standard First Aid + CPR-C', 'Canadian Red Cross', 6, 30)
  await cert('Grace', 'High Five PHCD', 'Parks & Recreation Ontario', 11, 25)
  await cert('Tyler', 'Challenge Course Practitioner — Level 2', 'ACCT', 10, 14)
  await cert('Marcus', 'Food Handler Certification', 'TrainCan', 20, 4)
  await cert('Sophie', 'Food Handler Certification', 'TrainCan', 2, 34)
  await cert('Ravi', 'RN — College of Nurses of Ontario', 'CNO', 5, 7)

  // ---- Sub-tasks (FTF jobs nesting) on the welcome-baskets task ----
  for (const [i, subTitle] of ['Collect baskets from Welcome Centre', 'Stock: snacks, maps, welcome cards', 'Deliver to each Treetops unit'].entries()) {
    await q(
      `INSERT INTO tasks (title, status_id, priority, parent_id, ord, assignees, created_by)
       VALUES ($1, $2, 1, $3, $4, $5, $6)`,
      [subTitle, i === 0 ? st['Done'] : st['To Do'], dep.id, ord++, [uid['Cindy']].filter(Boolean), adminId])
  }

  // A few notifications for the admin so the bell has life on first login
  for (const [icon, title, body, link] of [
    ['🛟', 'Tyler Nguyen is overdue', 'Expected back 36 minutes ago from Rosseau.', '/signout'],
    ['💬', 'Guest replied on MW-10219', 'Group leader, Ridgeview: “The router light is orange…”', '/tickets'],
    ['🎫', 'New guest report — Wi-Fi dead in Leadership Studio', 'Submitted from the QR form and triaged as Tech & AV.', '/tickets'],
    ['🎉', 'New kudos on the wall', 'Grace → Sophie: “Cinnamon buns at the staff meeting.”', '/kudos'],
  ]) {
    await q(`INSERT INTO notifications (user_id, icon, title, body, link) VALUES ($1,$2,$3,$4,$5)`,
      [adminId, icon, title, body, link])
  }
}
