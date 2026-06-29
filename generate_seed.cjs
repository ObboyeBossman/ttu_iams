const fs = require('fs');
const crypto = require('crypto');

function uuidv4() {
  return crypto.randomUUID();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const FIRST_NAMES = ["Kwame", "Ama", "Kofi", "Abena", "Kwasi", "Akosua", "Yaw", "Yaa", "Kwaku", "Afia", "Kwabena", "Abena", "Kweku", "Efua", "John", "Mary", "Samuel", "Grace", "Daniel", "Sarah", "Michael", "Esther", "David", "Ruth", "Emmanuel", "Joyce", "Joseph", "Martha", "Isaac", "Hannah"];
const LAST_NAMES = ["Asante", "Mensah", "Boateng", "Osei", "Appiah", "Owusu", "Nkrumah", "Agyeman", "Amoah", "Boakye", "Danquah", "Kusi", "Opoku", "Baidoo", "Acheampong", "Frimpong", "Sarpong", "Darko", "Addai", "Yeboah", "Agyapong", "Gyasi", "Ofori", "Adjei", "Tetteh", "Quansah", "Turkson", "Essien", "Gyan"];
const DEPARTMENTS = ["Computer Science", "Electrical Engineering", "Mechanical Engineering", "Civil Engineering", "Accounting", "Marketing", "Hospitality Management", "Fashion Design"];
const PROGRAMMES = ["HND", "B-Tech"];
const REGIONS = ["Greater Accra", "Ashanti", "Western", "Central", "Eastern"];
const TOWNS = ["Accra", "Kumasi", "Takoradi", "Cape Coast", "Koforidua", "Tema", "Obuasi", "Tarkwa"];
const COMPANIES = ["Ghana Ports and Harbours Authority", "Tullow Oil", "Volta River Authority", "MTN Ghana", "Vodafone Ghana", "Nestle Ghana", "Unilever", "GridCo", "ECG", "Ghana Water Company", "AngloGold Ashanti", "Karpowership"];

const ZONES = [
  { name: 'Takoradi Central', desc: 'Covers the Takoradi CBD, Harbour Area, and Effia-Nkwanta.' },
  { name: 'Sekondi-Takoradi West', desc: 'Covers Sekondi, Kojokrom, and New Takoradi.' },
  { name: 'Tarkwa Enclave', desc: 'Covers mining areas around Tarkwa and Bogoso.' },
  { name: 'Accra Metropolis', desc: 'Covers key industrial areas in Accra.' },
  { name: 'Tema Industrial', desc: 'Covers the Tema port and industrial zone.' }
];

let sql = `
-- =============================================================================
-- IAMS — Industrial Attachment Management System
-- Massive Seed Data (Generated)
-- =============================================================================

do $$
declare
  v_season_id uuid := gen_random_uuid();
begin

-- -------------------------------------------------------------------------
-- seasons
-- -------------------------------------------------------------------------
insert into public.seasons (id, name, start_date, end_date, status, placement_window_start, placement_window_end)
values (v_season_id, '2025/2026 Semester 2', '2026-01-06', '2026-06-27', 'open', '2026-06-01', '2026-06-27');

`;

function esc(str) {
  return str.replace(/'/g, "''");
}

let authUsers = [];
let authIdentities = [];
let profiles = [];
let students = [];
let zoneSql = [];
let zoneSups = [];
let placements = [];
let letters = [];
let logbookWeeks = [];
let logbookDailies = [];
let logbookSummaries = [];
let visits = [];

const zones = ZONES.map(z => ({ id: uuidv4(), name: z.name, desc: z.desc }));
zones.forEach(z => {
  zoneSql.push(`('${z.id}', '${esc(z.name)}', '${esc(z.desc)}')`);
});

function createUser(role, email, name, phone) {
  const id = uuidv4();
  const pass = "TestPass123!";
  authUsers.push(`('${id}', '${email}', crypt('${pass}', gen_salt('bf')), now())`);
  authIdentities.push(`('${id}', '${id}', format('{"sub":"%s","email":"%s"}', '${id}', '${email}')::jsonb, 'email', '${id}', now(), now(), now())`);
  profiles.push(`('${id}', '${role}', '${esc(name)}', '${phone}')`);
  return id;
}

// Admins
for (let i = 1; i <= 5; i++) {
  createUser('admin', `admin${i}@ttu.edu.gh`, `Admin ${i}`, `024400010${i}`);
}
// Add original admin for compatibility
createUser('admin', `admin@ttu.edu.gh`, `Main Admin`, `0244000100`);

// Supervisors
let supervisorIds = [];
for (let i = 1; i <= 30; i++) {
  const fn = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
  const ln = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
  const email = `dr.${ln.toLowerCase()}${i}@ttu.edu.gh`;
  const id = createUser('school_supervisor', email, `Dr. ${fn} ${ln}`, `0245000${i.toString().padStart(3, '0')}`);
  supervisorIds.push(id);
}
createUser('school_supervisor', `dr.boateng@ttu.edu.gh`, `Dr. Kofi Boateng`, `0244000004`);
supervisorIds.push(profiles[profiles.length - 1].split("'")[1]);

// Assign supervisors to zones
supervisorIds.forEach(sid => {
  const numZones = randomInt(1, 2);
  let zs = [...zones].sort(() => 0.5 - Math.random()).slice(0, numZones);
  zs.forEach(z => {
    zoneSups.push(`('${z.id}', '${sid}')`);
  });
});

// Students
for (let i = 1; i <= 200; i++) {
  const fn = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
  const ln = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
  let email;
  if (i === 1) email = 'kwame.asante@ttu.edu.gh';
  else if (i === 2) email = 'ama.mensah@ttu.edu.gh';
  else email = `student${i}@ttu.edu.gh`;

  const id = createUser('student', email, `${fn} ${ln}`, `054000${i.toString().padStart(4, '0')}`);
  
  const dept = DEPARTMENTS[randomInt(0, DEPARTMENTS.length - 1)];
  const prog = PROGRAMMES[randomInt(0, PROGRAMMES.length - 1)] + " " + dept;
  students.push(`('${id}', 'TTU/${dept.substring(0,3).toUpperCase()}/23/${i.toString().padStart(3,'0')}', '${esc(dept)}', '${esc(prog)}', 'Level 300')`);

  const placementId = uuidv4();
  const comp = COMPANIES[randomInt(0, COMPANIES.length - 1)];
  const reg = REGIONS[randomInt(0, REGIONS.length - 1)];
  const town = TOWNS[randomInt(0, TOWNS.length - 1)];
  const hasZone = Math.random() > 0.3;
  const z = hasZone ? zones[randomInt(0, zones.length - 1)].id : null;
  const status = z ? 'assigned' : (Math.random() > 0.5 ? 'submitted' : 'approved');

  placements.push(`('${placementId}', gen_random_uuid(), '${id}', v_season_id, '${esc(comp)}', 'Engineering & Operations', '${reg}', '${town}', 'Main Street', 'Mr. Manager', '0302000000', ${status === 'assigned' ? `'${z}'` : 'null'}, '${status}', '2026-01-06', '2026-06-27')`);

  letters.push(`('${id}', v_season_id, '${esc(comp)}', '${reg}', '${town}', 'Main Street', 'Mr. Manager', '0302000000', '${crypto.randomBytes(4).toString('hex').toUpperCase()}')`);

  if (status === 'assigned') {
    // Generate some logbook weeks
    for (let w = 1; w <= 4; w++) {
      const weekId = uuidv4();
      const wStatus = w < 4 ? 'certified' : 'draft';
      logbookWeeks.push(`('${weekId}', '${id}', '${placementId}', v_season_id, ${w}, '2026-01-06', '2026-01-12', 'IT Department', 'Great learning week ${w}.', '${wStatus}')`);
      
      for(let d=0; d<5; d++) {
        logbookDailies.push(`('${weekId}', '2026-01-${(6+d).toString().padStart(2, '0')}', 'Did some activities on day ${d+1} of week ${w}')`);
      }
    }

    logbookSummaries.push(`('${id}', '${placementId}', v_season_id, 1, 'Good month overall.', 'Student was exceptional', 5, 'Mr. Manager', 'assessed')`);

    if (Math.random() > 0.5) {
      const supid = supervisorIds[randomInt(0, supervisorIds.length - 1)];
      visits.push(`('${placementId}', '${supid}', '2026-02-15', 'Student was at post.', 'Good work', 85)`);
    }
  }
}

function chunkArray(myArray, chunk_size){
  let results = [];
  while (myArray.length) {
      results.push(myArray.splice(0, chunk_size));
  }
  return results;
}

function buildInsert(table, columns, data) {
  if (data.length === 0) return '';
  const chunks = chunkArray(data, 1000);
  let q = '';
  chunks.forEach(chunk => {
    q += `insert into ${table} (${columns}) values\n`;
    q += chunk.join(',\n');
    q += `\non conflict do nothing;\n\n`;
  });
  return q;
}

sql += buildInsert('auth.users', 'id, email, encrypted_password, email_confirmed_at', authUsers);
sql += buildInsert('auth.identities', 'id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at', authIdentities);
sql += buildInsert('public.profiles', 'id, role, full_name, phone', profiles);
sql += buildInsert('public.students', 'id, index_number, department, programme, level', students);
sql += buildInsert('public.zones', 'id, name, description', zoneSql);
sql += buildInsert('public.zone_supervisors', 'zone_id, school_supervisor_id', zoneSups);
sql += buildInsert('public.placements', 'id, draft_id, student_id, season_id, company_name, nature_of_business, region, city_town, street_landmark, contact_person, company_contact_phone, zone_id, status, start_date, end_date', placements);
sql += buildInsert('public.letters', 'student_id, season_id, company_name, region, city_town, street_landmark, contact_person, company_contact_phone, verification_code', letters);
sql += buildInsert('public.logbook_weeks', 'id, student_id, placement_id, season_id, week_number, week_start, week_end, department_section, student_remarks, status', logbookWeeks);
sql += buildInsert('public.logbook_daily_entries', 'week_id, log_date, activities', logbookDailies);
sql += buildInsert('public.logbook_monthly_summaries', 'student_id, placement_id, season_id, month_number, student_summary, company_supervisor_assessment, company_supervisor_rating, company_supervisor_name, status', logbookSummaries);
sql += buildInsert('public.supervisor_visits', 'placement_id, school_supervisor_id, visit_date, observations, remarks, assessment_score', visits);

sql += `\nend $$;\n`;

fs.writeFileSync('/home/obboye/dev/ttu_iams/supabase/seed.sql', sql);
console.log('Massive seed.sql generated successfully.');
