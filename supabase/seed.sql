-- =============================================================================
-- IAMS — Seed Data (FIXED & BULLETPROOF)
-- Takoradi Technical University
-- Run in Supabase SQL Editor after schema.sql and rls-policies.sql
-- Password for ALL test accounts: Password123!
-- =============================================================================
-- FIXES vs original seed.sql:
--   1. instance_id for sup.agyemang was wrong (had '...000000000004' instead
--      of all-zeros). Fixed to '00000000-0000-0000-0000-000000000000'.
--   2. auth.identities cleanup added — original only cleaned auth.users,
--      leaving orphaned identities that caused duplicate-key errors on reseed.
--   3. auth.identities insert scoped to ONLY the 20 seed UUIDs — never
--      accidentally copies identities for non-seed users.
--   4. placement_window dates updated so the 'open' season's window covers
--      today (2025-08-01 → 2026-08-31), allowing student insert RLS to pass.
--   5. Wrapped in a transaction so any error rolls everything back cleanly.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. CLEANUP — always safe to re-run
-- ---------------------------------------------------------------------------
DELETE FROM public.letters;
DELETE FROM public.placements;
DELETE FROM public.zone_supervisors;

-- Remove seed users (cascade deletes profiles + students via FK)
DELETE FROM auth.users
WHERE id IN (
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000004',
  'a1000000-0000-0000-0000-000000000005',
  'b2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000002',
  'b2000000-0000-0000-0000-000000000003',
  'b2000000-0000-0000-0000-000000000004',
  'b2000000-0000-0000-0000-000000000005',
  'c3000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000002',
  'c3000000-0000-0000-0000-000000000003',
  'c3000000-0000-0000-0000-000000000004',
  'c3000000-0000-0000-0000-000000000005',
  'd4000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000002',
  'd4000000-0000-0000-0000-000000000003',
  'd4000000-0000-0000-0000-000000000004',
  'd4000000-0000-0000-0000-000000000005'
);

-- Also clean identities for these UUIDs (in case a previous partial run left them)
DELETE FROM auth.identities
WHERE user_id IN (
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000004',
  'a1000000-0000-0000-0000-000000000005',
  'b2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000002',
  'b2000000-0000-0000-0000-000000000003',
  'b2000000-0000-0000-0000-000000000004',
  'b2000000-0000-0000-0000-000000000005',
  'c3000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000002',
  'c3000000-0000-0000-0000-000000000003',
  'c3000000-0000-0000-0000-000000000004',
  'c3000000-0000-0000-0000-000000000005',
  'd4000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000002',
  'd4000000-0000-0000-0000-000000000003',
  'd4000000-0000-0000-0000-000000000004',
  'd4000000-0000-0000-0000-000000000005'
);

DELETE FROM public.seasons;
DELETE FROM public.zones;


-- ---------------------------------------------------------------------------
-- 1. AUTH USERS
-- ALL instance_id values are the zero UUID — fixed sup.agyemang typo
-- ---------------------------------------------------------------------------

-- Admins (5)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role, is_super_admin)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'admin.kwame@ttu.edu.gh',  crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000002', 'admin.ama@ttu.edu.gh',    crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000003', 'admin.kofi@ttu.edu.gh',   crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000004', 'admin.akua@ttu.edu.gh',   crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000005', 'admin.yaw@ttu.edu.gh',    crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false);

-- School Supervisors (5)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role, is_super_admin)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 'sup.mensah@ttu.edu.gh',   crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000002', 'sup.asante@ttu.edu.gh',   crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000003', 'sup.boateng@ttu.edu.gh',  crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000004', 'sup.agyemang@ttu.edu.gh', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000005', 'sup.darko@ttu.edu.gh',    crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false);

-- Company Supervisors (5)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role, is_super_admin)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000001', 'csup.hammond@gmail.com',  crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000002', 'csup.frimpong@gmail.com', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000003', 'csup.appiah@gmail.com',   crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000004', 'csup.yankah@gmail.com',   crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000005', 'csup.quaye@gmail.com',    crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false);

-- Students (5)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role, is_super_admin)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000001', 'ttucsc23001@ttu.edu.gh', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000002', 'ttueee23002@ttu.edu.gh', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000003', 'ttumec23003@ttu.edu.gh',  crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000004', 'ttubus23004@ttu.edu.gh',  crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000005', 'ttuict23005@ttu.edu.gh',  crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false);


-- ---------------------------------------------------------------------------
-- 1b. AUTH IDENTITIES — scoped to only our 20 seed UUIDs (not all users!)
-- ---------------------------------------------------------------------------
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
SELECT
  gen_random_uuid(),
  id::text,
  id,
  jsonb_build_object('sub', id::text, 'email', email),
  'email',
  now(),
  now()
FROM auth.users
WHERE id IN (
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000004',
  'a1000000-0000-0000-0000-000000000005',
  'b2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000002',
  'b2000000-0000-0000-0000-000000000003',
  'b2000000-0000-0000-0000-000000000004',
  'b2000000-0000-0000-0000-000000000005',
  'c3000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000002',
  'c3000000-0000-0000-0000-000000000003',
  'c3000000-0000-0000-0000-000000000004',
  'c3000000-0000-0000-0000-000000000005',
  'd4000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000002',
  'd4000000-0000-0000-0000-000000000003',
  'd4000000-0000-0000-0000-000000000004',
  'd4000000-0000-0000-0000-000000000005'
);


-- ---------------------------------------------------------------------------
-- 1c. FIX TOKEN COLUMNS — GoTrue 500s if these are NULL on login
-- ---------------------------------------------------------------------------
UPDATE auth.users
SET
  confirmation_token     = COALESCE(confirmation_token, ''),
  recovery_token         = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change           = COALESCE(email_change, ''),
  phone_change           = COALESCE(phone_change, '')
WHERE id::text LIKE 'a1%'
   OR id::text LIKE 'b2%'
   OR id::text LIKE 'c3%'
   OR id::text LIKE 'd4%';


-- ---------------------------------------------------------------------------
-- 2. PROFILES
-- ---------------------------------------------------------------------------

INSERT INTO public.profiles (id, role, full_name, phone)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'admin', 'Kwame Osei Bonsu',    '+233201234501'),
  ('a1000000-0000-0000-0000-000000000002', 'admin', 'Ama Serwaa Asante',   '+233201234502'),
  ('a1000000-0000-0000-0000-000000000003', 'admin', 'Kofi Mensah Aidoo',   '+233201234503'),
  ('a1000000-0000-0000-0000-000000000004', 'admin', 'Akua Boateng Frema',  '+233201234504'),
  ('a1000000-0000-0000-0000-000000000005', 'admin', 'Yaw Darko Poku',      '+233201234505');

INSERT INTO public.profiles (id, role, full_name, phone)
VALUES
  ('b2000000-0000-0000-0000-000000000001', 'school_supervisor', 'Dr. Emmanuel Mensah',    '+233244100001'),
  ('b2000000-0000-0000-0000-000000000002', 'school_supervisor', 'Mrs. Joyce Asante',      '+233244100002'),
  ('b2000000-0000-0000-0000-000000000003', 'school_supervisor', 'Mr. Isaac Boateng',      '+233244100003'),
  ('b2000000-0000-0000-0000-000000000004', 'school_supervisor', 'Dr. Priscilla Agyemang', '+233244100004'),
  ('b2000000-0000-0000-0000-000000000005', 'school_supervisor', 'Mr. Samuel Darko',       '+233244100005');

INSERT INTO public.profiles (id, role, full_name, phone)
VALUES
  ('c3000000-0000-0000-0000-000000000001', 'company_supervisor', 'George Hammond',  '+233555200001'),
  ('c3000000-0000-0000-0000-000000000002', 'company_supervisor', 'Alice Frimpong',  '+233555200002'),
  ('c3000000-0000-0000-0000-000000000003', 'company_supervisor', 'Michael Appiah',  '+233555200003'),
  ('c3000000-0000-0000-0000-000000000004', 'company_supervisor', 'Sandra Yankah',   '+233555200004'),
  ('c3000000-0000-0000-0000-000000000005', 'company_supervisor', 'Bernard Quaye',   '+233555200005');

INSERT INTO public.profiles (id, role, full_name, phone)
VALUES
  ('d4000000-0000-0000-0000-000000000001', 'student', 'Abena Osei Mensah',   '+233277300001'),
  ('d4000000-0000-0000-0000-000000000002', 'student', 'Kweku Atta Boateng',  '+233277300002'),
  ('d4000000-0000-0000-0000-000000000003', 'student', 'Efua Sarkodie Asare', '+233277300003'),
  ('d4000000-0000-0000-0000-000000000004', 'student', 'Nana Kwame Adjei',    '+233277300004'),
  ('d4000000-0000-0000-0000-000000000005', 'student', 'Kojo Antwi Duah',     '+233277300005');


-- ---------------------------------------------------------------------------
-- 3. STUDENTS (academic details)
-- ---------------------------------------------------------------------------

INSERT INTO public.students (id, index_number, department, programme, level)
VALUES
  ('d4000000-0000-0000-0000-000000000001', 'TTU/CSC/23/001', 'Computer Science',       'HND Computer Science',        'HND 2'),
  ('d4000000-0000-0000-0000-000000000002', 'TTU/EEE/23/002', 'Electrical Engineering', 'HND Electrical Engineering',  'HND 2'),
  ('d4000000-0000-0000-0000-000000000003', 'TTU/MEC/23/003', 'Mechanical Engineering', 'HND Mechanical Engineering',  'HND 1'),
  ('d4000000-0000-0000-0000-000000000004', 'TTU/BUS/23/004', 'Business Studies',       'HND Accounting & Finance',    'HND 2'),
  ('d4000000-0000-0000-0000-000000000005', 'TTU/ICT/23/005', 'Information Technology', 'HND Information Technology',  'HND 1');


-- ---------------------------------------------------------------------------
-- 4. SEASONS
-- 'open' season window extended to cover today so student RLS passes
-- ---------------------------------------------------------------------------

INSERT INTO public.seasons (id, name, start_date, end_date, status, placement_window_start, placement_window_end)
VALUES
  ('e5000000-0000-0000-0000-000000000001',
   '2024/2025 Semester 1',
   '2024-08-01', '2025-01-31',
   'archived',
   '2024-08-01', '2024-08-31'),

  ('e5000000-0000-0000-0000-000000000002',
   '2025/2026 Semester 1',
   '2025-08-01', '2026-12-31',
   'open',
   '2025-08-01', '2026-12-31');   -- window covers today for demo purposes


-- ---------------------------------------------------------------------------
-- 5. ZONES
-- ---------------------------------------------------------------------------

INSERT INTO public.zones (id, name, description)
VALUES
  ('f6000000-0000-0000-0000-000000000001', 'Takoradi Central', 'Central Takoradi industrial belt'),
  ('f6000000-0000-0000-0000-000000000002', 'Sekondi',          'Sekondi harbour and fishing district'),
  ('f6000000-0000-0000-0000-000000000003', 'Efia Kuma',        'Effia-Kuma light industrial area'),
  ('f6000000-0000-0000-0000-000000000004', 'Agona Nkwanta',    'Agona Nkwanta commercial zone'),
  ('f6000000-0000-0000-0000-000000000005', 'Tarkwa',           'Tarkwa mining and engineering zone');


-- ---------------------------------------------------------------------------
-- 6. ZONE SUPERVISORS
-- ---------------------------------------------------------------------------

INSERT INTO public.zone_supervisors (zone_id, school_supervisor_id)
VALUES
  ('f6000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002'),
  ('f6000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000003'),
  ('f6000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000004'),
  ('f6000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000005');


-- ---------------------------------------------------------------------------
-- 7. PLACEMENTS
-- ---------------------------------------------------------------------------

INSERT INTO public.placements (
  id, draft_id, student_id, season_id,
  company_name, nature_of_business, region, city_town, street_landmark,
  contact_person, company_contact_phone,
  latitude, longitude, location_source,
  start_date, end_date, status, zone_id
)
VALUES
  ('07000000-0000-0000-0000-000000000001',
   'dd000000-0000-0000-0001-000000000001',
   'd4000000-0000-0000-0000-000000000001',
   'e5000000-0000-0000-0000-000000000002',
   'Ghana Ports & Harbours Authority', 'Port Operations',
   'Western Region', 'Takoradi', 'Harbour Road, Takoradi Port',
   'Mr. Joseph Appiah', '+233302012345',
   4.897490, -1.755412, 'gps',
   '2025-09-15', '2026-01-15', 'assigned',
   'f6000000-0000-0000-0000-000000000001'),

  ('07000000-0000-0000-0000-000000000002',
   'dd000000-0000-0000-0001-000000000002',
   'd4000000-0000-0000-0000-000000000002',
   'e5000000-0000-0000-0000-000000000002',
   'Volta River Authority', 'Power Generation',
   'Western Region', 'Sekondi', 'VRA Compound, Sekondi',
   'Eng. Patricia Owusu', '+233302023456',
   4.940000, -1.704000, 'gps',
   '2025-09-15', '2026-01-15', 'assigned',
   'f6000000-0000-0000-0000-000000000002'),

  ('07000000-0000-0000-0000-000000000003',
   'dd000000-0000-0000-0001-000000000003',
   'd4000000-0000-0000-0000-000000000003',
   'e5000000-0000-0000-0000-000000000002',
   'Takoradi Technical Works Ltd', 'Mechanical Fabrication',
   'Western Region', 'Effia Kuma', '12 Industrial Ave, Effia Kuma',
   'Mr. Charles Ato', '+233302034567',
   NULL, NULL, 'manual',
   '2025-09-15', '2026-01-15', 'submitted',
   NULL),

  ('07000000-0000-0000-0000-000000000004',
   'dd000000-0000-0000-0001-000000000004',
   'd4000000-0000-0000-0000-000000000004',
   'e5000000-0000-0000-0000-000000000002',
   'GCB Bank Ltd', 'Banking & Finance',
   'Western Region', 'Agona Nkwanta', 'Main Street, Agona Nkwanta',
   'Mrs. Florence Asare', '+233302045678',
   4.870000, -1.780000, 'gps',
   '2025-09-15', '2026-01-15', 'flagged',
   'f6000000-0000-0000-0000-000000000004'),

  ('07000000-0000-0000-0000-000000000005',
   'dd000000-0000-0000-0001-000000000005',
   'd4000000-0000-0000-0000-000000000005',
   'e5000000-0000-0000-0000-000000000002',
   'AngloGold Ashanti Iduapriem', 'Gold Mining',
   'Western Region', 'Tarkwa', 'Iduapriem Mine, Tarkwa',
   'Eng. Kwame Yeboah', '+233302056789',
   5.300000, -1.994000, 'gps',
   '2025-09-15', '2026-01-15', 'assigned',
   'f6000000-0000-0000-0000-000000000005');


-- ---------------------------------------------------------------------------
-- VERIFICATION — run these selects; every count should match expectations
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  u_count int; i_count int; p_count int; s_count int;
BEGIN
  SELECT COUNT(*) INTO u_count FROM auth.users
    WHERE id::text LIKE 'a1%' OR id::text LIKE 'b2%'
       OR id::text LIKE 'c3%' OR id::text LIKE 'd4%';
  SELECT COUNT(*) INTO i_count FROM auth.identities
    WHERE user_id::text LIKE 'a1%' OR user_id::text LIKE 'b2%'
       OR user_id::text LIKE 'c3%' OR user_id::text LIKE 'd4%';
  SELECT COUNT(*) INTO p_count FROM public.profiles;
  SELECT COUNT(*) INTO s_count FROM public.students;

  IF u_count <> 20 THEN RAISE EXCEPTION 'Expected 20 auth.users, got %', u_count; END IF;
  IF i_count <> 20 THEN RAISE EXCEPTION 'Expected 20 auth.identities, got %', i_count; END IF;
  IF p_count <> 20 THEN RAISE EXCEPTION 'Expected 20 profiles, got %', p_count; END IF;
  IF s_count <> 5  THEN RAISE EXCEPTION 'Expected 5 students, got %', s_count; END IF;

  RAISE NOTICE '✅ Seed verified: % users, % identities, % profiles, % students',
    u_count, i_count, p_count, s_count;
END $$;

COMMIT;