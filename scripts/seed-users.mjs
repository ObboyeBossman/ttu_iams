// =============================================================================
// IAMS — scripts/seed-users.mjs
// Complete test-data seeder using the Supabase Admin API.
// =============================================================================
// WHY THIS EXISTS:
//   Direct SQL inserts into auth.users break every time a Supabase project is
//   recreated (the internal GoTrue JWT secret changes and those raw rows are
//   not recognised as valid login accounts). The Admin API creates users
//   correctly regardless of the project's internal state.
//
// WHAT IT SEEDS:
//   Auth users → profiles → students → zone_supervisors → placements
//   (seasons + zones come from supabase/seed.sql via `supabase db push`)
//
// USAGE:
//   export SUPABASE_URL=https://your-ref.supabase.co
//   export SUPABASE_SERVICE_KEY=eyJ...your-service-role-key...
//   node scripts/seed-users.mjs
//
//   Or inline:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed-users.mjs
//
//   SUPABASE_URL can be the same value as VITE_SUPABASE_URL — both are checked.
//
// SAFE TO RE-RUN: all upserts are idempotent. Running twice won't duplicate data.
//
// ⚠️  NEVER commit SUPABASE_SERVICE_KEY to git. It has full DB access.
// =============================================================================

import { createClient } from '@supabase/supabase-js';

// ── Env ───────────────────────────────────────────────────────────────────────
const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(`
❌  Missing environment variables.

    Export them before running:
      export SUPABASE_URL=https://your-ref.supabase.co
      export SUPABASE_SERVICE_KEY=eyJ...your-service-role-key...

    Or inline:
      SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed-users.mjs

    Get your service_role key from:
      Supabase Dashboard → Project Settings → API → service_role (secret key)
`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'Password123!';

// ── Fixed UUIDs — match seed.sql reference data ───────────────────────────────
const ZONE_IDS = {
  takoradi_central: 'f6000000-0000-0000-0000-000000000001',
  sekondi:          'f6000000-0000-0000-0000-000000000002',
  efia_kuma:        'f6000000-0000-0000-0000-000000000003',
  agona_nkwanta:    'f6000000-0000-0000-0000-000000000004',
  tarkwa:           'f6000000-0000-0000-0000-000000000005',
};

const SEASON_OPEN_ID = 'e5000000-0000-0000-0000-000000000002';

// ── User definitions ──────────────────────────────────────────────────────────
const USERS = [
  // ── Admins ──────────────────────────────────────────────────────────────────
  { email: 'admin.kwame@ttu.edu.gh',  role: 'admin', full_name: 'Kwame Osei Bonsu',    phone: '+233201234501' },
  { email: 'admin.ama@ttu.edu.gh',    role: 'admin', full_name: 'Ama Serwaa Asante',   phone: '+233201234502' },
  { email: 'admin.kofi@ttu.edu.gh',   role: 'admin', full_name: 'Kofi Mensah Aidoo',   phone: '+233201234503' },
  { email: 'admin.akua@ttu.edu.gh',   role: 'admin', full_name: 'Akua Boateng Frema',  phone: '+233201234504' },
  { email: 'admin.yaw@ttu.edu.gh',    role: 'admin', full_name: 'Yaw Darko Poku',      phone: '+233201234505' },

  // ── School Supervisors ───────────────────────────────────────────────────────
  { email: 'sup.mensah@ttu.edu.gh',   role: 'school_supervisor', full_name: 'Dr. Emmanuel Mensah',    phone: '+233244100001', zone: ZONE_IDS.takoradi_central },
  { email: 'sup.asante@ttu.edu.gh',   role: 'school_supervisor', full_name: 'Mrs. Joyce Asante',      phone: '+233244100002', zone: ZONE_IDS.sekondi },
  { email: 'sup.boateng@ttu.edu.gh',  role: 'school_supervisor', full_name: 'Mr. Isaac Boateng',      phone: '+233244100003', zone: ZONE_IDS.efia_kuma },
  { email: 'sup.agyemang@ttu.edu.gh', role: 'school_supervisor', full_name: 'Dr. Priscilla Agyemang', phone: '+233244100004', zone: ZONE_IDS.agona_nkwanta },
  { email: 'sup.darko@ttu.edu.gh',    role: 'school_supervisor', full_name: 'Mr. Samuel Darko',       phone: '+233244100005', zone: ZONE_IDS.tarkwa },

  // ── Company Supervisors ──────────────────────────────────────────────────────
  { email: 'csup.hammond@gmail.com',  role: 'company_supervisor', full_name: 'George Hammond',  phone: '+233555200001' },
  { email: 'csup.frimpong@gmail.com', role: 'company_supervisor', full_name: 'Alice Frimpong',  phone: '+233555200002' },
  { email: 'csup.appiah@gmail.com',   role: 'company_supervisor', full_name: 'Michael Appiah',  phone: '+233555200003' },
  { email: 'csup.yankah@gmail.com',   role: 'company_supervisor', full_name: 'Sandra Yankah',   phone: '+233555200004' },
  { email: 'csup.quaye@gmail.com',    role: 'company_supervisor', full_name: 'Bernard Quaye',   phone: '+233555200005' },

  // ── Students ─────────────────────────────────────────────────────────────────
  {
    email: 'std.abena@student.ttu.edu.gh', role: 'student',
    full_name: 'Abena Osei Mensah',   phone: '+233277300001',
    student: { index_number: 'TTU/CSC/23/001', department: 'Computer Science',       programme: 'HND Computer Science',       level: 'HND 2' },
    placement: {
      id: '07000000-0000-0000-0000-000000000001',
      draft_id: 'dd000000-0000-0000-0001-000000000001',
      company_name: 'Ghana Ports & Harbours Authority', nature_of_business: 'Port Operations',
      city_town: 'Takoradi', street_landmark: 'Harbour Road, Takoradi Port',
      contact_person: 'Mr. Joseph Appiah', company_contact_phone: '+233302012345',
      latitude: 4.897490, longitude: -1.755412, location_source: 'gps',
      start_date: '2025-09-15', end_date: '2026-01-15', status: 'assigned',
      zone_id: ZONE_IDS.takoradi_central, region: 'Western Region',
    },
  },
  {
    email: 'std.kweku@student.ttu.edu.gh', role: 'student',
    full_name: 'Kweku Atta Boateng',  phone: '+233277300002',
    student: { index_number: 'TTU/EEE/23/002', department: 'Electrical Engineering', programme: 'HND Electrical Engineering',  level: 'HND 2' },
    placement: {
      id: '07000000-0000-0000-0000-000000000002',
      draft_id: 'dd000000-0000-0000-0001-000000000002',
      company_name: 'Volta River Authority', nature_of_business: 'Power Generation',
      city_town: 'Sekondi', street_landmark: 'VRA Compound, Sekondi',
      contact_person: 'Eng. Patricia Owusu', company_contact_phone: '+233302023456',
      latitude: 4.940000, longitude: -1.704000, location_source: 'gps',
      start_date: '2025-09-15', end_date: '2026-01-15', status: 'assigned',
      zone_id: ZONE_IDS.sekondi, region: 'Western Region',
    },
  },
  {
    email: 'std.efua@student.ttu.edu.gh',  role: 'student',
    full_name: 'Efua Sarkodie Asare',  phone: '+233277300003',
    student: { index_number: 'TTU/MEC/23/003', department: 'Mechanical Engineering', programme: 'HND Mechanical Engineering',  level: 'HND 1' },
    placement: {
      id: '07000000-0000-0000-0000-000000000003',
      draft_id: 'dd000000-0000-0000-0001-000000000003',
      company_name: 'Takoradi Technical Works Ltd', nature_of_business: 'Mechanical Fabrication',
      city_town: 'Effia Kuma', street_landmark: '12 Industrial Ave, Effia Kuma',
      contact_person: 'Mr. Charles Ato', company_contact_phone: '+233302034567',
      latitude: null, longitude: null, location_source: 'manual',
      start_date: '2025-09-15', end_date: '2026-01-15', status: 'submitted',
      zone_id: null, region: 'Western Region',
    },
  },
  {
    email: 'std.nana@student.ttu.edu.gh',  role: 'student',
    full_name: 'Nana Kwame Adjei',    phone: '+233277300004',
    student: { index_number: 'TTU/BUS/23/004', department: 'Business Studies',       programme: 'HND Accounting & Finance',   level: 'HND 2' },
    placement: {
      id: '07000000-0000-0000-0000-000000000004',
      draft_id: 'dd000000-0000-0000-0001-000000000004',
      company_name: 'GCB Bank Ltd', nature_of_business: 'Banking & Finance',
      city_town: 'Agona Nkwanta', street_landmark: 'Main Street, Agona Nkwanta',
      contact_person: 'Mrs. Florence Asare', company_contact_phone: '+233302045678',
      latitude: 4.870000, longitude: -1.780000, location_source: 'gps',
      start_date: '2025-09-15', end_date: '2026-01-15', status: 'flagged',
      zone_id: ZONE_IDS.agona_nkwanta, region: 'Western Region',
    },
  },
  {
    email: 'std.kojo@student.ttu.edu.gh',  role: 'student',
    full_name: 'Kojo Antwi Duah',     phone: '+233277300005',
    student: { index_number: 'TTU/ICT/23/005', department: 'Information Technology', programme: 'HND Information Technology', level: 'HND 1' },
    placement: {
      id: '07000000-0000-0000-0000-000000000005',
      draft_id: 'dd000000-0000-0000-0001-000000000005',
      company_name: 'AngloGold Ashanti Iduapriem', nature_of_business: 'Gold Mining',
      city_town: 'Tarkwa', street_landmark: 'Iduapriem Mine, Tarkwa',
      contact_person: 'Eng. Kwame Yeboah', company_contact_phone: '+233302056789',
      latitude: 5.300000, longitude: -1.994000, location_source: 'gps',
      start_date: '2025-09-15', end_date: '2026-01-15', status: 'assigned',
      zone_id: ZONE_IDS.tarkwa, region: 'Western Region',
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok  = (msg) => console.log(`   ✓  ${msg}`);
const err = (msg) => console.log(`   ❌  ${msg}`);
const h   = (msg) => console.log(`\n${msg}`);

async function resolveUserId(email) {
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  return list?.users?.find(u => u.email === email)?.id ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀  IAMS Seeder — ${SUPABASE_URL}\n`);

  const ids = {}; // email → uuid

  // ── Step 1: Auth users ────────────────────────────────────────────────────
  h('👤  Creating auth users …');
  for (const u of USERS) {
    process.stdout.write(`   ${u.email.padEnd(46)}`);

    const { data, error } = await supabase.auth.admin.createUser({
      email:         u.email,
      password:      PASSWORD,
      email_confirm: true,       // skip email confirmation
      user_metadata: {
        role:      u.role,
        full_name: u.full_name,
        phone:     u.phone,
      },
    });

    if (error) {
      if (error.status === 422 || error.message?.includes('already')) {
        const existing = await resolveUserId(u.email);
        if (existing) { ids[u.email] = existing; console.log('already exists ✓'); continue; }
      }
      console.log(`❌ ${error.message}`);
      continue;
    }

    ids[u.email] = data.user.id;
    console.log(`created ✓`);
  }

  // ── Step 2: Profiles ──────────────────────────────────────────────────────
  h('📋  Upserting profiles …');
  for (const u of USERS) {
    const id = ids[u.email];
    if (!id) { err(`SKIP ${u.email} — no id`); continue; }
    const { error } = await supabase
      .from('profiles')
      .upsert({ id, role: u.role, full_name: u.full_name, phone: u.phone }, { onConflict: 'id' });
    if (error) err(`Profile ${u.email}: ${error.message}`);
    else       ok(`${u.role.padEnd(22)} ${u.full_name}`);
  }

  // ── Step 3: Students ──────────────────────────────────────────────────────
  const students = USERS.filter(u => u.student);
  if (students.length) {
    h('🎓  Upserting students …');
    for (const u of students) {
      const id = ids[u.email];
      if (!id) continue;
      const { error } = await supabase
        .from('students')
        .upsert({ id, ...u.student }, { onConflict: 'id' });
      if (error) err(`Student ${u.email}: ${error.message}`);
      else       ok(`${u.student.index_number}  ${u.full_name}`);
    }
  }

  // ── Step 4: Zone supervisors ──────────────────────────────────────────────
  const supervisors = USERS.filter(u => u.role === 'school_supervisor' && u.zone);
  if (supervisors.length) {
    h('🗺️   Upserting zone_supervisors …');
    for (const u of supervisors) {
      const id = ids[u.email];
      if (!id) continue;
      const { error } = await supabase
        .from('zone_supervisors')
        .upsert({ zone_id: u.zone, school_supervisor_id: id }, { onConflict: 'zone_id,school_supervisor_id' });
      if (error) err(`Zone supervisor ${u.email}: ${error.message}`);
      else       ok(`${u.full_name} → zone ${u.zone.slice(-4)}`);
    }
  }

  // ── Step 5: Placements ────────────────────────────────────────────────────
  const withPlacements = USERS.filter(u => u.placement);
  if (withPlacements.length) {
    h('🏢  Upserting placements …');
    for (const u of withPlacements) {
      const studentId = ids[u.email];
      if (!studentId) continue;

      const p = u.placement;
      const { error } = await supabase.from('placements').upsert({
        id:                    p.id,
        draft_id:              p.draft_id,
        student_id:            studentId,
        season_id:             SEASON_OPEN_ID,
        company_name:          p.company_name,
        nature_of_business:    p.nature_of_business,
        region:                p.region,
        city_town:             p.city_town,
        street_landmark:       p.street_landmark,
        contact_person:        p.contact_person,
        company_contact_phone: p.company_contact_phone,
        latitude:              p.latitude,
        longitude:             p.longitude,
        location_source:       p.location_source,
        start_date:            p.start_date,
        end_date:              p.end_date,
        status:                p.status,
        zone_id:               p.zone_id,
      }, { onConflict: 'id' });

      if (error) err(`Placement for ${u.email}: ${error.message}`);
      else       ok(`${u.full_name.padEnd(24)} → ${p.company_name} [${p.status}]`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`
✅  Seed complete!

🔑  Test credentials  (password for ALL accounts: ${PASSWORD})

   Role                    Email
   ─────────────────────   ──────────────────────────────────────
   Admin                   admin.kwame@ttu.edu.gh
   School Supervisor       sup.mensah@ttu.edu.gh
   Company Supervisor      csup.hammond@gmail.com
   Student                 std.abena@student.ttu.edu.gh
`);
}

main().catch(e => { console.error(e); process.exit(1); });