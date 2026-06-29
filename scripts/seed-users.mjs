// =============================================================================
// IAMS — scripts/seed-users.mjs
// Seeds all test users via Supabase Admin API (correct approach).
// Direct auth.users SQL inserts break when the project is recreated.
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_KEY=eyJ...service-role-key... \
//   node scripts/seed-users.mjs
//
// SUPABASE_URL can also be VITE_SUPABASE_URL (same value, both are checked).
// NEVER commit the service key to git.
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(`
❌  Missing environment variables.

Export them before running:
  export SUPABASE_URL=https://your-ref.supabase.co
  export SUPABASE_SERVICE_KEY=eyJ...your-service-role-key...

Or inline:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed-users.mjs
`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'Password123!';

const USERS = [
  // ── Admins ────────────────────────────────────────────────────────────────
  { email: 'admin.kwame@ttu.edu.gh',  role: 'admin', full_name: 'Kwame Osei Bonsu',    phone: '+233201234501' },
  { email: 'admin.ama@ttu.edu.gh',    role: 'admin', full_name: 'Ama Serwaa Asante',   phone: '+233201234502' },
  { email: 'admin.kofi@ttu.edu.gh',   role: 'admin', full_name: 'Kofi Mensah Aidoo',   phone: '+233201234503' },
  { email: 'admin.akua@ttu.edu.gh',   role: 'admin', full_name: 'Akua Boateng Frema',  phone: '+233201234504' },
  { email: 'admin.yaw@ttu.edu.gh',    role: 'admin', full_name: 'Yaw Darko Poku',      phone: '+233201234505' },

  // ── School Supervisors ───────────────────────────────────────────────────
  { email: 'sup.mensah@ttu.edu.gh',   role: 'school_supervisor', full_name: 'Dr. Emmanuel Mensah',    phone: '+233244100001' },
  { email: 'sup.asante@ttu.edu.gh',   role: 'school_supervisor', full_name: 'Mrs. Joyce Asante',      phone: '+233244100002' },
  { email: 'sup.boateng@ttu.edu.gh',  role: 'school_supervisor', full_name: 'Mr. Isaac Boateng',      phone: '+233244100003' },
  { email: 'sup.agyemang@ttu.edu.gh', role: 'school_supervisor', full_name: 'Dr. Priscilla Agyemang', phone: '+233244100004' },
  { email: 'sup.darko@ttu.edu.gh',    role: 'school_supervisor', full_name: 'Mr. Samuel Darko',       phone: '+233244100005' },

  // ── Company Supervisors ──────────────────────────────────────────────────
  { email: 'csup.hammond@gmail.com',  role: 'company_supervisor', full_name: 'George Hammond',  phone: '+233555200001' },
  { email: 'csup.frimpong@gmail.com', role: 'company_supervisor', full_name: 'Alice Frimpong',  phone: '+233555200002' },
  { email: 'csup.appiah@gmail.com',   role: 'company_supervisor', full_name: 'Michael Appiah',  phone: '+233555200003' },
  { email: 'csup.yankah@gmail.com',   role: 'company_supervisor', full_name: 'Sandra Yankah',   phone: '+233555200004' },
  { email: 'csup.quaye@gmail.com',    role: 'company_supervisor', full_name: 'Bernard Quaye',   phone: '+233555200005' },

  // ── Students ──────────────────────────────────────────────────────────────
  {
    email: 'std.abena@student.ttu.edu.gh', role: 'student',
    full_name: 'Abena Osei Mensah',  phone: '+233277300001',
    student: { index_number: 'TTU/CSC/23/001', department: 'Computer Science',       programme: 'HND Computer Science',       level: 'HND 2' },
  },
  {
    email: 'std.kweku@student.ttu.edu.gh', role: 'student',
    full_name: 'Kweku Atta Boateng', phone: '+233277300002',
    student: { index_number: 'TTU/EEE/23/002', department: 'Electrical Engineering', programme: 'HND Electrical Engineering',  level: 'HND 2' },
  },
  {
    email: 'std.efua@student.ttu.edu.gh',  role: 'student',
    full_name: 'Efua Sarkodie Asare', phone: '+233277300003',
    student: { index_number: 'TTU/MEC/23/003', department: 'Mechanical Engineering', programme: 'HND Mechanical Engineering',  level: 'HND 1' },
  },
  {
    email: 'std.nana@student.ttu.edu.gh',  role: 'student',
    full_name: 'Nana Kwame Adjei',   phone: '+233277300004',
    student: { index_number: 'TTU/BUS/23/004', department: 'Business Studies',       programme: 'HND Accounting & Finance',   level: 'HND 2' },
  },
  {
    email: 'std.kojo@student.ttu.edu.gh',  role: 'student',
    full_name: 'Kojo Antwi Duah',    phone: '+233277300005',
    student: { index_number: 'TTU/ICT/23/005', department: 'Information Technology', programme: 'HND Information Technology', level: 'HND 1' },
  },
];

function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }

async function main() {
  log('🚀', `Seeding ${USERS.length} users → ${SUPABASE_URL}\n`);

  const ids = {}; // email → uuid

  // ── Step 1: Create auth users ──────────────────────────────────────────────
  log('👤', 'Creating auth users …');
  for (const u of USERS) {
    process.stdout.write(`   ${u.email.padEnd(45)} `);

    const { data, error } = await supabase.auth.admin.createUser({
      email:         u.email,
      password:      PASSWORD,
      email_confirm: true,
      user_metadata: { role: u.role, full_name: u.full_name, phone: u.phone },
    });

    if (error) {
      if (error.status === 422 || error.message?.includes('already')) {
        // User already exists — look up their id
        const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const existing = list?.users?.find(x => x.email === u.email);
        if (existing) {
          ids[u.email] = existing.id;
          console.log('already exists ✓');
          continue;
        }
      }
      console.log(`❌ ${error.message}`);
      continue;
    }

    ids[u.email] = data.user.id;
    console.log(`created ✓  (${data.user.id})`);
  }

  console.log('');

  // ── Step 2: Upsert profiles ───────────────────────────────────────────────
  log('📋', 'Upserting profiles …');
  for (const u of USERS) {
    const id = ids[u.email];
    if (!id) { console.log(`   SKIP ${u.email} (no id)`); continue; }

    const { error } = await supabase
      .from('profiles')
      .upsert({ id, role: u.role, full_name: u.full_name, phone: u.phone }, { onConflict: 'id' });

    if (error) console.log(`   ❌ Profile ${u.email}: ${error.message}`);
    else       console.log(`   ✓  ${u.role.padEnd(20)} ${u.full_name}`);
  }

  console.log('');

  // ── Step 3: Upsert student rows ───────────────────────────────────────────
  const students = USERS.filter(u => u.student);
  if (students.length) {
    log('🎓', 'Upserting student records …');
    for (const u of students) {
      const id = ids[u.email];
      if (!id) continue;
      const { error } = await supabase
        .from('students')
        .upsert({ id, ...u.student }, { onConflict: 'id' });
      if (error) console.log(`   ❌ Student ${u.email}: ${error.message}`);
      else       console.log(`   ✓  ${u.student.index_number}  ${u.full_name}`);
    }
    console.log('');
  }

  // ── Step 4: Reference data — seasons ─────────────────────────────────────
  log('📅', 'Upserting seasons …');
  const { error: sErr } = await supabase.from('seasons').upsert([
    {
      id: 'e5000000-0000-0000-0000-000000000001',
      name: '2024/2025 Semester 1',
      start_date: '2024-08-01', end_date: '2025-01-31',
      status: 'archived',
      placement_window_start: '2024-08-01', placement_window_end: '2024-08-31',
    },
    {
      id: 'e5000000-0000-0000-0000-000000000002',
      name: '2025/2026 Semester 1',
      start_date: '2025-08-01', end_date: '2026-01-31',
      status: 'open',
      placement_window_start: '2025-08-01', placement_window_end: '2025-08-31',
    },
  ], { onConflict: 'id' });
  if (sErr) console.log(`   ❌ Seasons: ${sErr.message}`);
  else      console.log('   ✓  2 seasons');

  // ── Step 5: Reference data — zones ───────────────────────────────────────
  log('🗺️ ', 'Upserting zones …');
  const { error: zErr } = await supabase.from('zones').upsert([
    { id: 'f6000000-0000-0000-0000-000000000001', name: 'Takoradi Central', description: 'Central Takoradi industrial belt' },
    { id: 'f6000000-0000-0000-0000-000000000002', name: 'Sekondi',          description: 'Sekondi harbour and fishing district' },
    { id: 'f6000000-0000-0000-0000-000000000003', name: 'Efia Kuma',        description: 'Effia-Kuma light industrial area' },
    { id: 'f6000000-0000-0000-0000-000000000004', name: 'Agona Nkwanta',    description: 'Agona Nkwanta commercial zone' },
    { id: 'f6000000-0000-0000-0000-000000000005', name: 'Tarkwa',           description: 'Tarkwa mining and engineering zone' },
  ], { onConflict: 'id' });
  if (zErr) console.log(`   ❌ Zones: ${zErr.message}`);
  else      console.log('   ✓  5 zones');

  console.log('');
  log('✅', 'Seed complete!\n');

  console.log('🔑  Test credentials (password for all accounts: Password123!)');
  console.log('');
  console.log('   Role                  Email');
  console.log('   ─────────────────     ──────────────────────────────────────');
  console.log('   Admin                 admin.kwame@ttu.edu.gh');
  console.log('   School Supervisor     sup.mensah@ttu.edu.gh');
  console.log('   Company Supervisor    csup.hammond@gmail.com');
  console.log('   Student               std.abena@student.ttu.edu.gh');
}

main().catch(e => { console.error(e); process.exit(1); });
