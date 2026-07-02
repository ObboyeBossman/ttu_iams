-- =============================================================================
-- IAMS — Migration: Super Admin Role + Institutional Structure
-- 20260703000001_super_admin_and_structure.sql
--
-- NOTE: The 'super_admin' enum value is added in the preceding migration
-- (20260703000000_add_super_admin_role.sql) so it is committed before this
-- file runs — satisfying the Postgres "no new enum value in same tx" rule.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 2. INSTITUTIONAL STRUCTURE TABLES
-- ---------------------------------------------------------------------------

CREATE TABLE public.faculties (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  code        text        NOT NULL UNIQUE,   -- e.g. 'FAS', 'FENG'
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.faculties IS
  'Top-level institutional units at TTU. Managed exclusively by super_admin.';

CREATE TABLE public.departments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id  uuid        NOT NULL REFERENCES public.faculties (id) ON DELETE RESTRICT,
  name        text        NOT NULL,
  code        text        NOT NULL,          -- e.g. 'CSC', 'EEE'
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  UNIQUE (faculty_id, name),
  UNIQUE (faculty_id, code)
);

COMMENT ON TABLE public.departments IS
  'Academic departments belonging to a faculty. Managed exclusively by super_admin.';

CREATE TABLE public.programmes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   uuid        NOT NULL REFERENCES public.departments (id) ON DELETE RESTRICT,
  name            text        NOT NULL,
  type            text        NOT NULL
    CHECK (type IN ('BSc', 'HND', 'Diploma', 'B-Tech', 'MSc', 'PhD')),
  duration_years  integer     NOT NULL CHECK (duration_years > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  UNIQUE (department_id, name, type)
);

COMMENT ON TABLE public.programmes IS
  'Academic programmes within a department. Students are linked to a programme via students.programme_id.';

-- ---------------------------------------------------------------------------
-- 3. MIGRATE STUDENTS TABLE — add programme_id FK
-- ---------------------------------------------------------------------------

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS programme_id uuid REFERENCES public.programmes (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.students.department IS
  'DEPRECATED — replaced by programme_id → programmes → departments. Will be dropped after data migration.';
COMMENT ON COLUMN public.students.programme IS
  'DEPRECATED — replaced by programme_id → programmes. Will be dropped after data migration.';

-- ---------------------------------------------------------------------------
-- 4. ADD is_active TO profiles
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.is_active IS
  'Set to false by super_admin to deactivate an account without hard-deleting it.';

-- ---------------------------------------------------------------------------
-- 5. SUPER ADMIN AUDIT LOG
-- ---------------------------------------------------------------------------

CREATE TABLE public.super_admin_audit (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  action      text        NOT NULL,
  target_type text,
  target_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.super_admin_audit IS
  'Append-only log of every destructive or privileged action taken by a super_admin.';

-- ---------------------------------------------------------------------------
-- 6. UPDATE student_profiles VIEW
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.student_profiles;

CREATE OR REPLACE VIEW public.student_profiles AS
  SELECT
    p.id,
    p.full_name,
    p.phone,
    p.is_active,
    p.created_at,
    s.index_number,
    s.level,
    s.programme_id,
    -- Deprecated text fields kept temporarily for backward compat
    s.department,
    s.programme,
    -- Joined institutional names (NULL when programme_id not yet set)
    pr.name        AS programme_name,
    pr.type        AS programme_type,
    d.id           AS department_id,
    d.name         AS department_name,
    d.code         AS department_code,
    f.id           AS faculty_id,
    f.name         AS faculty_name,
    f.code         AS faculty_code
  FROM public.profiles p
  JOIN public.students s  ON s.id = p.id
  LEFT JOIN public.programmes  pr ON pr.id = s.programme_id
  LEFT JOIN public.departments d  ON d.id  = pr.department_id
  LEFT JOIN public.faculties   f  ON f.id  = d.faculty_id;

-- ---------------------------------------------------------------------------
-- 7. RLS — ENABLE ON NEW TABLES
-- ---------------------------------------------------------------------------

ALTER TABLE public.faculties          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programmes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_audit  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 8. RLS POLICIES — INSTITUTIONAL STRUCTURE
-- ---------------------------------------------------------------------------

-- faculties
CREATE POLICY "faculties: authenticated read"
  ON public.faculties FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "faculties: super_admin insert"
  ON public.faculties FOR INSERT
  WITH CHECK (public.current_role() = 'super_admin');

CREATE POLICY "faculties: super_admin update"
  ON public.faculties FOR UPDATE
  USING (public.current_role() = 'super_admin');

CREATE POLICY "faculties: super_admin delete"
  ON public.faculties FOR DELETE
  USING (public.current_role() = 'super_admin');

-- departments
CREATE POLICY "departments: authenticated read"
  ON public.departments FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "departments: super_admin insert"
  ON public.departments FOR INSERT
  WITH CHECK (public.current_role() = 'super_admin');

CREATE POLICY "departments: super_admin update"
  ON public.departments FOR UPDATE
  USING (public.current_role() = 'super_admin');

CREATE POLICY "departments: super_admin delete"
  ON public.departments FOR DELETE
  USING (public.current_role() = 'super_admin');

-- programmes
CREATE POLICY "programmes: authenticated read"
  ON public.programmes FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "programmes: super_admin insert"
  ON public.programmes FOR INSERT
  WITH CHECK (public.current_role() = 'super_admin');

CREATE POLICY "programmes: super_admin update"
  ON public.programmes FOR UPDATE
  USING (public.current_role() = 'super_admin');

CREATE POLICY "programmes: super_admin delete"
  ON public.programmes FOR DELETE
  USING (public.current_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- 9. RLS POLICIES — SUPER ADMIN READS/WRITES EXISTING TABLES
-- ---------------------------------------------------------------------------

-- profiles
CREATE POLICY "profiles: super_admin reads all"
  ON public.profiles FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "profiles: super_admin inserts"
  ON public.profiles FOR INSERT
  WITH CHECK (public.current_role() = 'super_admin');

CREATE POLICY "profiles: super_admin updates all"
  ON public.profiles FOR UPDATE
  USING (public.current_role() = 'super_admin');

-- students
CREATE POLICY "students: super_admin reads all"
  ON public.students FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "students: super_admin inserts"
  ON public.students FOR INSERT
  WITH CHECK (public.current_role() = 'super_admin');

CREATE POLICY "students: super_admin updates"
  ON public.students FOR UPDATE
  USING (public.current_role() = 'super_admin');

-- other tables (read-only for super_admin — writes via admin role)
CREATE POLICY "seasons: super_admin reads all"
  ON public.seasons FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "seasons: super_admin updates"
  ON public.seasons FOR UPDATE
  USING (public.current_role() = 'super_admin');

CREATE POLICY "zones: super_admin reads all"
  ON public.zones FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "zone_supervisors: super_admin reads all"
  ON public.zone_supervisors FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "placements: super_admin reads all"
  ON public.placements FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "letters: super_admin reads all"
  ON public.letters FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "settings: super_admin reads all"
  ON public.settings FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "settings: super_admin updates"
  ON public.settings FOR UPDATE
  USING (public.current_role() = 'super_admin');

CREATE POLICY "payments: super_admin reads all"
  ON public.payments FOR SELECT
  USING (public.current_role() = 'super_admin');

-- audit log
CREATE POLICY "super_admin_audit: super_admin reads all"
  ON public.super_admin_audit FOR SELECT
  USING (public.current_role() = 'super_admin');

CREATE POLICY "super_admin_audit: super_admin inserts"
  ON public.super_admin_audit FOR INSERT
  WITH CHECK (public.current_role() = 'super_admin');
