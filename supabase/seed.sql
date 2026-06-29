-- =============================================================================
-- IAMS — Seed Data
-- Takoradi Technical University
-- 5 profiles per role: admin, school_supervisor, company_supervisor, student
-- =============================================================================
-- NOTE: This seed uses Supabase's auth.users insert approach.
--       All test accounts use the password: Password123!
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. CLEANUP EXISTING SEED DATA
-- ---------------------------------------------------------------------------
-- Delete dependent tables with RESTRICT foreign keys first
DELETE FROM public.letters;
DELETE FROM public.placements;
DELETE FROM public.zone_supervisors;
-- Now we can safely delete from auth.users, which cascades to profiles, students
DELETE FROM auth.users WHERE email LIKE '%@ttu.edu.gh' OR email LIKE '%@gmail.com' OR email LIKE '%@student.ttu.edu.gh';
DELETE FROM public.seasons;
DELETE FROM public.zones;


-- ---------------------------------------------------------------------------
-- 1. AUTH USERS
-- ---------------------------------------------------------------------------

-- Admins (5)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role, is_super_admin)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'admin.kwame@ttu.edu.gh',   extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000002', 'admin.ama@ttu.edu.gh',     extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000003', 'admin.kofi@ttu.edu.gh',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000004', 'admin.akua@ttu.edu.gh',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000005', 'admin.yaw@ttu.edu.gh',     extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false);

-- School Supervisors (5)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role, is_super_admin)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 'sup.mensah@ttu.edu.gh',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000002', 'sup.asante@ttu.edu.gh',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000003', 'sup.boateng@ttu.edu.gh',   extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000004', 'sup.agyemang@ttu.edu.gh',  extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000005', 'sup.darko@ttu.edu.gh',     extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false);

-- Company Supervisors (5)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role, is_super_admin)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000001', 'csup.hammond@gmail.com',   extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000002', 'csup.frimpong@gmail.com',  extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000003', 'csup.appiah@gmail.com',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000004', 'csup.yankah@gmail.com',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-000000000005', 'csup.quaye@gmail.com',     extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false);

-- Students (5)
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role, is_super_admin)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000001', 'std.abena@student.ttu.edu.gh',   extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000002', 'std.kweku@student.ttu.edu.gh',   extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000003', 'std.efua@student.ttu.edu.gh',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000004', 'std.nana@student.ttu.edu.gh',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false),
  ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-0000-0000-000000000005', 'std.kojo@student.ttu.edu.gh',    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated', false);


-- ---------------------------------------------------------------------------
-- 1b. AUTH IDENTITIES
-- ---------------------------------------------------------------------------
-- Required for Supabase GoTrue to allow login

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
SELECT
  gen_random_uuid(),
  id::text,
  id,
  jsonb_build_object('sub', id, 'email', email),
  'email',
  now(),
  now()
FROM auth.users;



-- ---------------------------------------------------------------------------
-- 2. PROFILES
-- ---------------------------------------------------------------------------

-- Admin profiles
INSERT INTO public.profiles (id, role, full_name, phone)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'admin', 'Kwame Osei Bonsu',    '+233201234501'),
  ('a1000000-0000-0000-0000-000000000002', 'admin', 'Ama Serwaa Asante',   '+233201234502'),
  ('a1000000-0000-0000-0000-000000000003', 'admin', 'Kofi Mensah Aidoo',   '+233201234503'),
  ('a1000000-0000-0000-0000-000000000004', 'admin', 'Akua Boateng Frema',  '+233201234504'),
  ('a1000000-0000-0000-0000-000000000005', 'admin', 'Yaw Darko Poku',      '+233201234505');

-- School Supervisor profiles
INSERT INTO public.profiles (id, role, full_name, phone)
VALUES
  ('b2000000-0000-0000-0000-000000000001', 'school_supervisor', 'Dr. Emmanuel Mensah',    '+233244100001'),
  ('b2000000-0000-0000-0000-000000000002', 'school_supervisor', 'Mrs. Joyce Asante',      '+233244100002'),
  ('b2000000-0000-0000-0000-000000000003', 'school_supervisor', 'Mr. Isaac Boateng',      '+233244100003'),
  ('b2000000-0000-0000-0000-000000000004', 'school_supervisor', 'Dr. Priscilla Agyemang', '+233244100004'),
  ('b2000000-0000-0000-0000-000000000005', 'school_supervisor', 'Mr. Samuel Darko',       '+233244100005');

-- Company Supervisor profiles
INSERT INTO public.profiles (id, role, full_name, phone)
VALUES
  ('c3000000-0000-0000-0000-000000000001', 'company_supervisor', 'George Hammond',   '+233555200001'),
  ('c3000000-0000-0000-0000-000000000002', 'company_supervisor', 'Alice Frimpong',   '+233555200002'),
  ('c3000000-0000-0000-0000-000000000003', 'company_supervisor', 'Michael Appiah',   '+233555200003'),
  ('c3000000-0000-0000-0000-000000000004', 'company_supervisor', 'Sandra Yankah',    '+233555200004'),
  ('c3000000-0000-0000-0000-000000000005', 'company_supervisor', 'Bernard Quaye',    '+233555200005');

-- Student profiles
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
  ('d4000000-0000-0000-0000-000000000001', 'TTU/CSC/23/001', 'Computer Science',      'HND Computer Science',             'HND 2'),
  ('d4000000-0000-0000-0000-000000000002', 'TTU/EEE/23/002', 'Electrical Engineering','HND Electrical Engineering',        'HND 2'),
  ('d4000000-0000-0000-0000-000000000003', 'TTU/MEC/23/003', 'Mechanical Engineering','HND Mechanical Engineering',        'HND 1'),
  ('d4000000-0000-0000-0000-000000000004', 'TTU/BUS/23/004', 'Business Studies',      'HND Accounting & Finance',         'HND 2'),
  ('d4000000-0000-0000-0000-000000000005', 'TTU/ICT/23/005', 'Information Technology','HND Information Technology',        'HND 1');


-- ---------------------------------------------------------------------------
-- 4. SEASONS
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
   '2025-08-01', '2026-01-31',
   'open',
   '2025-08-01', '2025-08-31');


-- ---------------------------------------------------------------------------
-- 5. ZONES
-- ---------------------------------------------------------------------------

INSERT INTO public.zones (id, name, description)
VALUES
  ('f6000000-0000-0000-0000-000000000001', 'Takoradi Central',  'Central Takoradi industrial belt'),
  ('f6000000-0000-0000-0000-000000000002', 'Sekondi',           'Sekondi harbour and fishing district'),
  ('f6000000-0000-0000-0000-000000000003', 'Efia Kuma',         'Effia-Kuma light industrial area'),
  ('f6000000-0000-0000-0000-000000000004', 'Agona Nkwanta',     'Agona Nkwanta commercial zone'),
  ('f6000000-0000-0000-0000-000000000005', 'Tarkwa',            'Tarkwa mining and engineering zone');


-- ---------------------------------------------------------------------------
-- 6. ZONE SUPERVISORS (assign school supervisors to zones)
-- ---------------------------------------------------------------------------

INSERT INTO public.zone_supervisors (zone_id, school_supervisor_id)
VALUES
  ('f6000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002'),
  ('f6000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000003'),
  ('f6000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000004'),
  ('f6000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000005');


-- ---------------------------------------------------------------------------
-- 7. PLACEMENTS (one per student for the open season)
-- ---------------------------------------------------------------------------
-- NOTE: placements_stamp_synced_at trigger fills synced_at automatically.
-- draft_id is a stable client UUID; we generate fixed ones here for reproducibility.

INSERT INTO public.placements (
  id, draft_id, student_id, season_id,
  company_name, nature_of_business, region, city_town, street_landmark,
  contact_person, company_contact_phone,
  latitude, longitude, location_source,
  start_date, end_date, status, zone_id
)
VALUES
  -- Student 1 → Zone 1 (assigned)
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

  -- Student 2 → Zone 2 (assigned)
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

  -- Student 3 → Zone 3 (submitted)
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

  -- Student 4 → Zone 4 (flagged)
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

  -- Student 5 → Zone 5 (assigned)
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
