-- =============================================================================
-- IAMS — Industrial Attachment Management System
-- Phase 1 Dev Seed Data
-- Takoradi Technical University
-- =============================================================================
-- Run AFTER schema.sql AND rls-policies.sql.
-- FOR DEVELOPMENT / TESTING ONLY — do not run against production.
--
-- This file inserts realistic but fictional test data so every role and
-- status path can be exercised immediately after a fresh migration.
--
-- IDs are hard-coded UUIDs so re-runs produce consistent, predictable data.
-- All auth.users rows must be created via Supabase Auth (Dashboard or CLI)
-- before these profile rows can be inserted — the id values below must
-- match the user IDs that Supabase Auth assigns.
--
-- Recommended: create the auth users via `supabase db seed` or the
-- Supabase Dashboard, note the generated UUIDs, then update the
-- --PLACEHOLDER-- blocks below with the real IDs.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- USAGE GUIDE
-- ---------------------------------------------------------------------------
-- 1. Create the four test auth.users in the Supabase Dashboard:
--       admin@ttu.edu.gh        / TestPass123!
--       kwame.asante@ttu.edu.gh / TestPass123!
--       ama.mensah@ttu.edu.gh   / TestPass123!
--       dr.boateng@ttu.edu.gh   / TestPass123!
--    Copy the generated UUIDs into the variables below.
--
-- 2. Run this file in the Supabase SQL Editor or via:
--       supabase db reset   (runs schema + rls + seed in one step)
--
-- 3. Log in as each role to verify the dashboards, RLS, and letter flow.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- CONFIGURABLE IDs — replace with real Supabase Auth user UUIDs
-- ---------------------------------------------------------------------------

do $$
declare
  v_admin_id       uuid := 'ea68174a-f2d4-4596-a023-93cb030a1d86';
  v_student1_id    uuid := '56d02c9f-f428-4310-a8c5-144423bdb726';
  v_student2_id    uuid := '3ae6f784-6390-4a85-b017-279e3d6045a1';
  v_supervisor_id  uuid := '2fd8cce6-c0ee-41bc-807a-268b6f49b43a';

  v_season_id      uuid := gen_random_uuid();
  v_zone1_id       uuid := gen_random_uuid();
  v_zone2_id       uuid := gen_random_uuid();
  v_placement1_id  uuid := gen_random_uuid();
  v_placement2_id  uuid := gen_random_uuid();
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

  insert into public.seasons (
    id, name, start_date, end_date, status,
    placement_window_start, placement_window_end
  ) values (
    v_season_id,
    '2025/2026 Semester 2',
    '2026-01-06', '2026-06-27',
    'open',
    '2026-06-01', '2026-06-27'
  )
  on conflict do nothing;


  -- -------------------------------------------------------------------------
  -- zones
  -- -------------------------------------------------------------------------

  insert into public.zones (id, name, description) values
    (v_zone1_id, 'Takoradi Central',
      'Covers the Takoradi CBD, Harbour Area, and Effia-Nkwanta.'),
    (v_zone2_id, 'Sekondi-Takoradi West',
      'Covers Sekondi, Kojokrom, and New Takoradi.')
  on conflict (name) do nothing;


  -- -------------------------------------------------------------------------
  -- zone_supervisors  (Dr. Boateng covers both zones in this seed)
  -- -------------------------------------------------------------------------

  insert into public.zone_supervisors (zone_id, school_supervisor_id) values
    (v_zone1_id, v_supervisor_id),
    (v_zone2_id, v_supervisor_id)
  on conflict do nothing;


  -- -------------------------------------------------------------------------
  -- placements
  --
  -- placement1 — Kwame, status: assigned (zone set, terminal)
  -- placement2 — Ama,   status: submitted (pending admin batch review)
  -- -------------------------------------------------------------------------

  insert into public.placements (
    id, draft_id,
    student_id, season_id,
    company_name, nature_of_business,
    region, city_town, street_landmark,
    contact_person, company_contact_phone,
    latitude, longitude, location_source,
    start_date, end_date,
    status, zone_id
  ) values
  (
    v_placement1_id,
    gen_random_uuid(),  -- draft_id (would be client UUID in real use)
    v_student1_id, v_season_id,
    'Ghana Ports and Harbours Authority', 'Port Operations & Logistics',
    'Western Region', 'Takoradi', 'Harbour Road, off Commercial Street',
    'Mr. Ebo Turkson', '0312000100',
    4.897895, -1.755132, 'gps',
    '2026-01-06', '2026-06-27',
    'assigned', v_zone1_id
  ),
  (
    v_placement2_id,
    gen_random_uuid(),
    v_student2_id, v_season_id,
    'Tullow Oil Ghana Limited', 'Oil and Gas Exploration',
    'Western Region', 'Takoradi', 'Airport Ridge, Jubilee House',
    'Ms. Abena Quansah', '0312000200',
    null, null, 'manual',
    '2026-01-06', '2026-06-27',
    'submitted', null
  )
  on conflict (draft_id) do nothing;


  -- -------------------------------------------------------------------------
  -- letters  (two letters generated by Kwame in the current season)
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
    'A3F9B1C2'  -- 8-char uppercase alphanumeric; satisfies CHECK constraint
  ),
  (
    v_student1_id, v_season_id,
    'Volta River Authority',
    'Western Region', 'Takoradi', 'Liberation Road',
    'Mr. Yaw Darko', '0312000300',
    'B7K2C4D8'
  )
  on conflict (verification_code) do nothing;

end $$;
