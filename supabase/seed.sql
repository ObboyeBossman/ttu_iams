-- =============================================================================
-- IAMS — Reference Data Seed
-- Takoradi Technical University
-- =============================================================================
-- ⚠️  THIS FILE CONTAINS ONLY REFERENCE DATA (seasons, zones).
--
-- Auth users (profiles, students, etc.) are created via the Admin API seeder:
--     node scripts/seed-users.mjs
--
-- WHY: Direct auth.users SQL inserts break whenever a Supabase project is
-- recreated because the internal GoTrue JWT secret changes. The Admin API
-- creates users correctly regardless of the project's internal state.
--
-- Run order:
--   1. supabase db push          ← applies migrations/20260629000001_squashed.sql
--   2. node scripts/seed-users.mjs ← creates all auth users + profiles + students
--   (This file is applied automatically by `supabase db push` after migrations)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SEASONS
-- ---------------------------------------------------------------------------

INSERT INTO public.seasons (
  id, name, start_date, end_date, status,
  placement_window_start, placement_window_end
) VALUES
  (
    'e5000000-0000-0000-0000-000000000001',
    '2024/2025 Semester 1',
    '2024-08-01', '2025-01-31',
    'archived',
    '2024-08-01', '2024-08-31'
  ),
  (
    'e5000000-0000-0000-0000-000000000002',
    '2025/2026 Semester 1',
    '2025-08-01', '2026-01-31',
    'open',
    '2025-08-01', '2025-08-31'
  )
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- ZONES
-- ---------------------------------------------------------------------------

INSERT INTO public.zones (id, name, description) VALUES
  ('f6000000-0000-0000-0000-000000000001', 'Takoradi Central', 'Central Takoradi industrial belt'),
  ('f6000000-0000-0000-0000-000000000002', 'Sekondi',          'Sekondi harbour and fishing district'),
  ('f6000000-0000-0000-0000-000000000003', 'Efia Kuma',        'Effia-Kuma light industrial area'),
  ('f6000000-0000-0000-0000-000000000004', 'Agona Nkwanta',    'Agona Nkwanta commercial zone'),
  ('f6000000-0000-0000-0000-000000000005', 'Tarkwa',           'Tarkwa mining and engineering zone')
ON CONFLICT (id) DO NOTHING;