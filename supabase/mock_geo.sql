-- Seed mock geocoding data to existing placements
UPDATE public.placements
SET region = 'Western Region',
    district = 'Sekondi Takoradi Metropolitan',
    town = 'Takoradi',
    geocode_status = 'success',
    geocoded_at = now()
WHERE company_name = 'Ghana Ports and Harbours Authority';

UPDATE public.placements
SET region = 'Western Region',
    district = 'Sekondi Takoradi Metropolitan',
    town = 'Sekondi',
    geocode_status = 'success',
    geocoded_at = now()
WHERE company_name = 'Tullow Oil Ghana Limited';

-- Insert some extra dummy placements for other regions to demonstrate the drill-down
DO $$
DECLARE
  v_admin_id       uuid := 'ea68174a-f2d4-4596-a023-93cb030a1d86';
  v_season_id      uuid;
  v_student3_id    uuid := gen_random_uuid();
  v_student4_id    uuid := gen_random_uuid();
  v_student5_id    uuid := gen_random_uuid();
  v_student6_id    uuid := gen_random_uuid();
  v_student7_id    uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_season_id FROM public.seasons WHERE name = '2025/2026 Semester 2' LIMIT 1;
  
  -- Create dummy auth users
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
    (v_student3_id, 'abigail@test.com', 'dummy', now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Abigail Owusu"}', 'authenticated', 'authenticated'),
    (v_student4_id, 'samuel@test.com', 'dummy', now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Samuel Osei"}', 'authenticated', 'authenticated'),
    (v_student5_id, 'grace@test.com', 'dummy', now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Grace Addo"}', 'authenticated', 'authenticated'),
    (v_student6_id, 'david@test.com', 'dummy', now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "David Kumi"}', 'authenticated', 'authenticated'),
    (v_student7_id, 'erica@test.com', 'dummy', now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Erica Ansah"}', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  -- Create dummy profiles
  INSERT INTO public.profiles (id, role, full_name, phone) VALUES
    (v_student3_id, 'student', 'Abigail Owusu', '0244000103'),
    (v_student4_id, 'student', 'Samuel Osei', '0244000104'),
    (v_student5_id, 'student', 'Grace Addo', '0244000105'),
    (v_student6_id, 'student', 'David Kumi', '0244000106'),
    (v_student7_id, 'student', 'Erica Ansah', '0244000107')
  ON CONFLICT (id) DO NOTHING;

  -- Create dummy students
  INSERT INTO public.students (id, index_number, department, programme, level) VALUES
    (v_student3_id, 'TTU/CSC/23/003', 'Computer Science', 'HND Computer Science', 'HND 2'),
    (v_student4_id, 'TTU/CSC/23/004', 'Electrical Engineering', 'HND Electrical', 'HND 2'),
    (v_student5_id, 'TTU/CSC/23/005', 'Civil Engineering', 'B-Tech Civil', 'B-Tech 3'),
    (v_student6_id, 'TTU/CSC/23/006', 'Business', 'HND Accounting', 'HND 2'),
    (v_student7_id, 'TTU/CSC/23/007', 'Graphic Design', 'HND Graphics', 'HND 2')
  ON CONFLICT (id) DO NOTHING;

  -- Insert dummy placements
  INSERT INTO public.placements (
    draft_id, student_id, season_id, company_name, nature_of_business,
    region, city_town, street_landmark, contact_person, company_contact_phone,
    latitude, longitude, location_source, start_date, end_date, status,
    district, town, geocode_status, geocoded_at
  ) VALUES 
  (
    gen_random_uuid(), v_student3_id, v_season_id, 'GNPC', 'Oil & Gas',
    'Greater Accra Region', 'Accra', 'Airport City', 'Kofi Mensah', '0302000001',
    5.6037, -0.1870, 'gps', '2026-01-06', '2026-06-27', 'submitted',
    'Ayawaso West Municipal', 'Airport City', 'success', now()
  ),
  (
    gen_random_uuid(), v_student4_id, v_season_id, 'MTN Ghana', 'Telecommunications',
    'Greater Accra Region', 'Accra', 'Ridge', 'Sarah Osei', '0302000002',
    5.5560, -0.1969, 'gps', '2026-01-06', '2026-06-27', 'submitted',
    'Korle Klottey Municipal', 'Ridge', 'success', now()
  ),
  (
    gen_random_uuid(), v_student5_id, v_season_id, 'Vodafone Ghana', 'Telecommunications',
    'Greater Accra Region', 'Accra', 'Cantonments', 'John Doe', '0302000003',
    5.5786, -0.1705, 'gps', '2026-01-06', '2026-06-27', 'submitted',
    'La Dade Kotopon Municipal', 'Cantonments', 'success', now()
  ),
  (
    gen_random_uuid(), v_student6_id, v_season_id, 'Anglogold Ashanti', 'Mining',
    'Ashanti Region', 'Obuasi', 'Estate', 'Yaw Boakye', '0322000001',
    6.2057, -1.6833, 'gps', '2026-01-06', '2026-06-27', 'submitted',
    'Obuasi Municipal', 'Obuasi', 'success', now()
  ),
  (
    gen_random_uuid(), v_student7_id, v_season_id, 'Northern Electricity', 'Energy',
    'Northern Region', 'Tamale', 'VRA Road', 'Ali Mohammed', '0372000001',
    9.4008, -0.8393, 'gps', '2026-01-06', '2026-06-27', 'submitted',
    'Tamale Metropolitan', 'Tamale', 'success', now()
  )
  ON CONFLICT (student_id, season_id) DO NOTHING;

  -- Add one unresolved placement for testing the 'Unresolved Locations' section
  INSERT INTO public.placements (
    draft_id, student_id, season_id, company_name, nature_of_business,
    region, city_town, street_landmark, contact_person, company_contact_phone,
    latitude, longitude, location_source, start_date, end_date, status,
    geocode_status
  ) VALUES 
  (
    gen_random_uuid(), '56d02c9f-f428-4310-a8c5-144423bdb726', v_season_id, 'Mystery Corp', 'Unknown',
    'Unknown Region', 'Unknown', 'Unknown', 'Unknown', '0000000000',
    null, null, 'manual', '2026-01-06', '2026-06-27', 'submitted',
    'failed'
  )
  ON CONFLICT (student_id, season_id) DO NOTHING;
END $$;
