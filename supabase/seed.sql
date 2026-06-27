-- =============================================================================
-- IAMS — Industrial Attachment Management System
-- Phase 1 & 2 Dev Seed Data (Idempotent Safe Seeding)
-- Takoradi Technical University
-- =============================================================================
-- Run AFTER schema.sql AND rls-policies.sql.
-- FOR DEVELOPMENT / TESTING ONLY — do not run against production.
-- =============================================================================

do $$
declare
  v_admin_id       uuid := 'ea68174a-f2d4-4596-a023-93cb030a1d86';
  v_student1_id    uuid := '56d02c9f-f428-4310-a8c5-144423bdb726';
  v_student2_id    uuid := '3ae6f784-6390-4a85-b017-279e3d6045a1';
  v_supervisor_id  uuid := '2fd8cce6-c0ee-41bc-807a-268b6f49b43a';

  v_season_id      uuid;
  v_zone1_id       uuid;
  v_zone2_id       uuid;
  v_placement1_id  uuid;
  v_placement2_id  uuid;
  v_week1_id       uuid;
  v_week2_id       uuid;
begin

  -- -------------------------------------------------------------------------
  -- profiles
  -- -------------------------------------------------------------------------

  insert into public.profiles (id, role, full_name, phone) values
    (v_admin_id,      'admin',             'Industrial Liaison Officer',  '0244000001'),
    (v_student1_id,   'student',           'Kwame Asante',                '0244000002'),
    (v_student2_id,   'student',           'Ama Mensah',                  '0244000003'),
    (v_supervisor_id, 'school_supervisor', 'Dr. Kofi Boateng',            '0244000004')
  on conflict (id) do nothing;


  -- -------------------------------------------------------------------------
  -- students  (academic identity rows for the two student profiles)
  -- -------------------------------------------------------------------------

  insert into public.students (id, index_number, department, programme, level) values
    (v_student1_id, 'TTU/CSC/23/001', 'Computer Science', 'HND Computer Science',        'HND 2'),
    (v_student2_id, 'TTU/CSC/23/002', 'Computer Science', 'B-Tech Information Technology', 'B-Tech 3')
  on conflict (id) do nothing;


  -- -------------------------------------------------------------------------
  -- seasons  (one open season with an active placement window)
  -- -------------------------------------------------------------------------

  select id into v_season_id from public.seasons where name = '2025/2026 Semester 2';
  if v_season_id is null then
    v_season_id := gen_random_uuid();
    insert into public.seasons (
      id, name, start_date, end_date, status,
      placement_window_start, placement_window_end
    ) values (
      v_season_id,
      '2025/2026 Semester 2',
      '2026-01-06', '2026-06-27',
      'open',
      '2026-06-01', '2026-06-27'
    );
  end if;


  -- -------------------------------------------------------------------------
  -- zones
  -- -------------------------------------------------------------------------

  select id into v_zone1_id from public.zones where name = 'Takoradi Central';
  if v_zone1_id is null then
    v_zone1_id := gen_random_uuid();
    insert into public.zones (id, name, description)
    values (v_zone1_id, 'Takoradi Central', 'Covers the Takoradi CBD, Harbour Area, and Effia-Nkwanta.');
  end if;

  select id into v_zone2_id from public.zones where name = 'Sekondi-Takoradi West';
  if v_zone2_id is null then
    v_zone2_id := gen_random_uuid();
    insert into public.zones (id, name, description)
    values (v_zone2_id, 'Sekondi-Takoradi West', 'Covers Sekondi, Kojokrom, and New Takoradi.');
  end if;


  -- -------------------------------------------------------------------------
  -- zone_supervisors  (Dr. Boateng covers both zones in this seed)
  -- -------------------------------------------------------------------------

  insert into public.zone_supervisors (zone_id, school_supervisor_id) values
    (v_zone1_id, v_supervisor_id),
    (v_zone2_id, v_supervisor_id)
  on conflict do nothing;


  -- -------------------------------------------------------------------------
  -- placements
  -- -------------------------------------------------------------------------

  select id into v_placement1_id from public.placements where student_id = v_student1_id and season_id = v_season_id;
  if v_placement1_id is null then
    v_placement1_id := gen_random_uuid();
    insert into public.placements (
      id, draft_id,
      student_id, season_id,
      company_name, nature_of_business,
      region, city_town, street_landmark,
      contact_person, company_contact_phone,
      latitude, longitude, location_source,
      start_date, end_date,
      status, zone_id
    ) values (
      v_placement1_id,
      gen_random_uuid(),
      v_student1_id, v_season_id,
      'Ghana Ports and Harbours Authority', 'Port Operations & Logistics',
      'Western Region', 'Takoradi', 'Harbour Road, off Commercial Street',
      'Mr. Ebo Turkson', '0312000100',
      4.897895, -1.755132, 'gps',
      '2026-01-06', '2026-06-27',
      'assigned', v_zone1_id
    );
  end if;

  select id into v_placement2_id from public.placements where student_id = v_student2_id and season_id = v_season_id;
  if v_placement2_id is null then
    v_placement2_id := gen_random_uuid();
    insert into public.placements (
      id, draft_id,
      student_id, season_id,
      company_name, nature_of_business,
      region, city_town, street_landmark,
      contact_person, company_contact_phone,
      latitude, longitude, location_source,
      start_date, end_date,
      status, zone_id
    ) values (
      v_placement2_id,
      gen_random_uuid(),
      v_student2_id, v_season_id,
      'Tullow Oil Ghana Limited', 'Oil and Gas Exploration',
      'Western Region', 'Takoradi', 'Airport Ridge, Jubilee House',
      'Ms. Abena Quansah', '0312000200',
      null, null, 'manual',
      '2026-01-06', '2026-06-27',
      'submitted', null
    );
  end if;


  -- -------------------------------------------------------------------------
  -- letters
  -- -------------------------------------------------------------------------

  insert into public.letters (
    student_id, season_id,
    company_name, region, city_town, street_landmark,
    contact_person, company_contact_phone,
    verification_code
  ) values
  (
    v_student1_id, v_season_id,
    'Ghana Ports and Harbours Authority',
    'Western Region', 'Takoradi', 'Harbour Road, off Commercial Street',
    'Mr. Ebo Turkson', '0312000100',
    'A3F9B1C2'
  ),
  (
    v_student1_id, v_season_id,
    'Volta River Authority',
    'Western Region', 'Takoradi', 'Liberation Road',
    'Mr. Yaw Darko', '0312000300',
    'B7K2C4D8'
  )
  on conflict (verification_code) do nothing;


  -- -------------------------------------------------------------------------
  -- logbook_weeks
  -- -------------------------------------------------------------------------

  select id into v_week1_id from public.logbook_weeks where student_id = v_student1_id and season_id = v_season_id and week_number = 1;
  if v_week1_id is null then
    v_week1_id := gen_random_uuid();
    insert into public.logbook_weeks (
      id, student_id, placement_id, season_id, week_number, week_start, week_end, department_section, student_remarks, status
    ) values (
      v_week1_id, v_student1_id, v_placement1_id, v_season_id, 1, '2026-01-06', '2026-01-12', 'IT Department', 'Great start, learned network basics.', 'certified'
    );
  end if;

  select id into v_week2_id from public.logbook_weeks where student_id = v_student1_id and season_id = v_season_id and week_number = 2;
  if v_week2_id is null then
    v_week2_id := gen_random_uuid();
    insert into public.logbook_weeks (
      id, student_id, placement_id, season_id, week_number, week_start, week_end, department_section, student_remarks, status
    ) values (
      v_week2_id, v_student1_id, v_placement1_id, v_season_id, 2, '2026-01-13', '2026-01-19', 'Network Operations', 'Worked on routers and switches.', 'certified'
    );
  end if;


  -- -------------------------------------------------------------------------
  -- logbook_daily_entries
  -- -------------------------------------------------------------------------

  insert into public.logbook_daily_entries (
    week_id, log_date, activities
  ) values
  (v_week1_id, '2026-01-06', 'Orientation and introduction to local area network topology.'),
  (v_week1_id, '2026-01-07', 'Configuring DNS settings and troubleshooting client IP addresses.'),
  (v_week1_id, '2026-01-08', 'Assisting with structural cabling in the server room.'),
  (v_week1_id, '2026-01-09', 'Configuring Cisco switches and patching panel connections.'),
  (v_week1_id, '2026-01-10', 'Documenting IP address allocations and departmental asset tracking.'),
  (v_week2_id, '2026-01-13', 'Introduction to network security firewalls and active directory configuration.'),
  (v_week2_id, '2026-01-14', 'Configuring virtual networks (VLANs) for different divisions.'),
  (v_week2_id, '2026-01-15', 'Setting up backup server replication and storage access control list.'),
  (v_week2_id, '2026-01-16', 'Monitoring network traffic anomalies using Wireshark.'),
  (v_week2_id, '2026-01-17', 'Configuring VPN endpoints for remote staff logins.')
  on conflict (week_id, log_date) do update 
  set activities = EXCLUDED.activities;


  -- -------------------------------------------------------------------------
  -- logbook_monthly_summaries
  -- -------------------------------------------------------------------------

  insert into public.logbook_monthly_summaries (
    student_id, placement_id, season_id, month_number, student_summary, company_supervisor_assessment, company_supervisor_rating, company_supervisor_name, status
  ) values
  (
    v_student1_id, v_placement1_id, v_season_id, 1, 'My first month focused on network configuration, DNS setups, and cabling. Developed solid practical knowledge of hardware switches.', 'Kwame has shown high dedication and quickly adapted to our networking configurations.', 5, 'Mr. Ebo Turkson', 'assessed'
  )
  on conflict (student_id, season_id, month_number) do update 
  set status = EXCLUDED.status,
      student_summary = EXCLUDED.student_summary,
      company_supervisor_assessment = EXCLUDED.company_supervisor_assessment,
      company_supervisor_rating = EXCLUDED.company_supervisor_rating,
      company_supervisor_name = EXCLUDED.company_supervisor_name;


  -- -------------------------------------------------------------------------
  -- supervisor_visits
  -- -------------------------------------------------------------------------

  insert into public.supervisor_visits (
    placement_id, school_supervisor_id, visit_date, observations, remarks, assessment_score
  ) values
  (
    v_placement1_id, v_supervisor_id, '2026-01-20', 'Kwame was found on duty in the IT center configuring a rack switch. He demonstrated good knowledge of TCP/IP parameters.', 'Excellent progress, logs are well documented.', 85
  )
  on conflict do nothing;

end $$;
