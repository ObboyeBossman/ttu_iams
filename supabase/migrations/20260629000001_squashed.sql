-- =============================================================================
-- IAMS — Squashed Migration (Hardened)
-- Takoradi Technical University
-- Squashes: 20260622000001 → 20260629000002
-- =============================================================================
-- HARDENING CHANGES vs individual migrations:
--   1. handle_new_user wrapped in EXCEPTION WHEN OTHERS so it can NEVER
--      crash GoTrue — auth always succeeds even if profile insert fails
--   2. All policy DROP/CREATE pairs deduplicated — no more "already exists" errors
--   3. phase2_schema stubs replaced with final RLS policies directly
--   4. logbook_fixes column renames applied inline — no ALTER needed
--   5. attendance_biometrics view rebuild consolidated
--   6. placement_geocoding region column made nullable from the start
--   7. All IF NOT EXISTS / OR REPLACE guards on every object
-- =============================================================================


-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('student','admin','school_supervisor','company_supervisor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE season_status AS ENUM ('upcoming','open','closed','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE placement_status AS ENUM ('submitted','flagged','rejected','assigned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE location_source AS ENUM ('gps','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- TABLES — Core (Phase 1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       user_role   NOT NULL,
  full_name  text        NOT NULL,
  phone      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.profiles IS
  'Common identity record for every user. Role-specific data is in role-specific tables.';

CREATE TABLE IF NOT EXISTS public.students (
  id                   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  index_number         text NOT NULL UNIQUE,
  department           text NOT NULL,
  programme            text NOT NULL,
  level                text NOT NULL,
  passport_picture_url text,
  fingerprint_hash     text
);
COMMENT ON TABLE public.students IS
  'Student-specific academic identity. Only exists when profiles.role = ''student''.';

CREATE TABLE IF NOT EXISTS public.seasons (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text          NOT NULL,
  start_date             date          NOT NULL,
  end_date               date          NOT NULL,
  status                 season_status NOT NULL DEFAULT 'upcoming',
  placement_window_start date          NOT NULL,
  placement_window_end   date          NOT NULL,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz,
  updated_by             uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT seasons_window_within_season CHECK (
    placement_window_start >= start_date AND
    placement_window_end   <= end_date   AND
    placement_window_start <= placement_window_end
  ),
  CONSTRAINT seasons_dates_ordered CHECK (start_date <= end_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_open ON public.seasons(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.zones (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz,
  updated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.zone_supervisors (
  zone_id              uuid NOT NULL REFERENCES public.zones(id)    ON DELETE CASCADE,
  school_supervisor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (zone_id, school_supervisor_id)
);

CREATE TABLE IF NOT EXISTS public.placements (
  id                    uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id              uuid             NOT NULL UNIQUE,
  student_id            uuid             NOT NULL REFERENCES public.profiles(id)  ON DELETE RESTRICT,
  season_id             uuid             NOT NULL REFERENCES public.seasons(id)   ON DELETE RESTRICT,
  company_name          text             NOT NULL,
  nature_of_business    text             NOT NULL,
  -- region is nullable to allow pending geocodes
  region                text,
  city_town             text             NOT NULL,
  street_landmark       text             NOT NULL,
  contact_person        text             NOT NULL,
  company_contact_phone text             NOT NULL,
  district              text,
  town                  text,
  geocode_status        text             DEFAULT 'pending',
  geocoded_at           timestamptz,
  latitude              numeric(9,6),
  longitude             numeric(9,6),
  location_source       location_source  NOT NULL,
  start_date            date             NOT NULL,
  end_date              date             NOT NULL,
  status                placement_status NOT NULL DEFAULT 'submitted',
  zone_id               uuid             REFERENCES public.zones(id) ON DELETE SET NULL,
  synced_at             timestamptz,
  created_at            timestamptz      NOT NULL DEFAULT now(),
  updated_at            timestamptz,
  updated_by            uuid             REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT placements_dates_ordered CHECK (start_date <= end_date),
  CONSTRAINT placements_one_per_student_per_season UNIQUE (student_id, season_id),
  CONSTRAINT placements_location_consistency CHECK (
    (latitude IS NULL AND longitude IS NULL AND location_source = 'manual') OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND location_source = 'gps')
  )
);

CREATE TABLE IF NOT EXISTS public.letters (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  season_id             uuid        NOT NULL REFERENCES public.seasons(id)  ON DELETE RESTRICT,
  company_name          text        NOT NULL,
  region                text        NOT NULL,
  city_town             text        NOT NULL,
  street_landmark       text        NOT NULL,
  contact_person        text        NOT NULL,
  company_contact_phone text        NOT NULL,
  verification_code     text        NOT NULL UNIQUE,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT letters_verification_code_format CHECK (verification_code ~ '^[A-Z0-9]{8}$')
);

CREATE TABLE IF NOT EXISTS public.settings (
  id              int         PRIMARY KEY DEFAULT 1,
  letterhead_path text,
  stamp_path      text,
  signature_path  text,
  footer_path     text,
  updated_at      timestamptz,
  updated_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT settings_single_row CHECK (id = 1)
);
COMMENT ON COLUMN public.settings.footer_path IS
  'Storage path for the TTU footer bar image (ttu_footer.png in the letter-assets bucket).';

INSERT INTO public.settings (id) VALUES (1) ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- TABLES — Phase 2 (Logbook, Attendance, Visits, Reports, Payments)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.logbook_weeks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           uuid NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  placement_id         uuid NOT NULL REFERENCES public.placements(id)  ON DELETE CASCADE,
  season_id            uuid NOT NULL REFERENCES public.seasons(id)     ON DELETE CASCADE,
  week_number          int  NOT NULL CHECK (week_number > 0),
  week_start           date NOT NULL,
  week_end             date NOT NULL CHECK (week_end >= week_start),
  department_section   text,
  student_remarks      text,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','certified')),
  company_certified_by text,
  company_certified_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, season_id, week_number)
);

CREATE TABLE IF NOT EXISTS public.logbook_daily_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id    uuid NOT NULL REFERENCES public.logbook_weeks(id) ON DELETE CASCADE,
  -- student_id denormalised here for simpler RLS (from logbook_fixes migration)
  student_id uuid NOT NULL REFERENCES public.profiles(id),
  log_date   date NOT NULL,
  activities text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_id, log_date)
);

CREATE TABLE IF NOT EXISTS public.logbook_monthly_summaries (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                     uuid NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  placement_id                   uuid NOT NULL REFERENCES public.placements(id) ON DELETE CASCADE,
  season_id                      uuid NOT NULL REFERENCES public.seasons(id)    ON DELETE CASCADE,
  month_number                   int  NOT NULL CHECK (month_number > 0),
  student_summary                text,
  -- renamed from company_supervisor_assessment (logbook_fixes)
  supervisor_feedback            text,
  company_supervisor_rating      int  CHECK (company_supervisor_rating BETWEEN 1 AND 5),
  company_supervisor_name        text,
  company_supervisor_assessed_at timestamptz,
  status                         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','assessed')),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, season_id, month_number)
);

CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                uuid NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  placement_id              uuid NOT NULL REFERENCES public.placements(id) ON DELETE CASCADE,
  season_id                 uuid NOT NULL REFERENCES public.seasons(id)    ON DELETE CASCADE,
  log_date                  date NOT NULL,
  check_in_time             timestamptz,
  check_in_lat              numeric,
  check_in_lon              numeric,
  check_in_location_source  text CHECK (check_in_location_source  IN ('gps','manual')),
  check_out_time            timestamptz,
  check_out_lat             numeric,
  check_out_lon             numeric,
  check_out_location_source text CHECK (check_out_location_source IN ('gps','manual')),
  distance_from_placement_m numeric,
  absence_reason            text,
  biometric_method          text CHECK (biometric_method IN ('face','fingerprint','none')),
  biometric_verified        boolean DEFAULT false,
  status                    text NOT NULL DEFAULT 'present'
    CHECK (status IN ('present','absent','flagged_location')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, log_date)
);

CREATE TABLE IF NOT EXISTS public.attendance_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        uuid NOT NULL REFERENCES public.profiles(id)        ON DELETE CASCADE,
  season_id         uuid NOT NULL REFERENCES public.seasons(id)         ON DELETE CASCADE,
  attendance_log_id uuid NOT NULL REFERENCES public.attendance_logs(id) ON DELETE CASCADE,
  flag_reason       text NOT NULL,
  triggered_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.supervisor_visits (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id         uuid NOT NULL REFERENCES public.placements(id)  ON DELETE CASCADE,
  school_supervisor_id uuid NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  visit_date           date NOT NULL,
  observations         text,
  remarks              text,
  assessment_score     int  CHECK (assessment_score BETWEEN 0 AND 100),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attachment_payments (
  student_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_id         uuid NOT NULL REFERENCES public.seasons(id)  ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending',
  payment_reference text UNIQUE,
  confirmed_at      timestamptz,
  created_at        timestamptz DEFAULT now(),
  PRIMARY KEY (student_id, season_id)
);

CREATE TABLE IF NOT EXISTS public.attachment_reports (
  student_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_id       uuid NOT NULL REFERENCES public.seasons(id)  ON DELETE CASCADE,
  path_type       text NOT NULL DEFAULT 'ai',
  input_form      jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'draft',
  pdf_url         text,
  review_feedback text,
  submitted_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  PRIMARY KEY (student_id, season_id)
);


-- ---------------------------------------------------------------------------
-- TRIGGER FUNCTIONS
-- ---------------------------------------------------------------------------

-- Auto-create profile on new auth user.
-- HARDENED: wrapped in EXCEPTION WHEN OTHERS so this trigger can NEVER
-- crash GoTrue. A profile insert failure will be silently swallowed and
-- auth will proceed normally. The seed inserts profiles separately.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, phone)
  VALUES (
    new.id,
    COALESCE((new.raw_user_meta_data->>'role')::user_role, 'student'),
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    COALESCE(new.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
EXCEPTION WHEN OTHERS THEN
  -- Never block auth due to a profile insert failure
  RAISE WARNING '[handle_new_user] profile insert failed for %: % %', new.id, SQLSTATE, SQLERRM;
  RETURN new;
END;
$$;
COMMENT ON FUNCTION public.handle_new_user IS
  'Auto-creates a public.profiles row on new auth user. Hardened with EXCEPTION
   handler so it never blocks GoTrue even if the insert fails.';

CREATE OR REPLACE FUNCTION public.enforce_student_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = new.id) IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'students.id (%) must reference a profile with role = student', new.id;
  END IF;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_school_supervisor_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = new.school_supervisor_id)
     IS DISTINCT FROM 'school_supervisor' THEN
    RAISE EXCEPTION 'zone_supervisors.school_supervisor_id (%) must be a school_supervisor',
      new.school_supervisor_id;
  END IF;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_synced_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.synced_at := now(); RETURN new; END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.updated_at := now(); RETURN new; END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_updated_by()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN new.updated_by := auth.uid(); RETURN new; END;
$$;

CREATE OR REPLACE FUNCTION public.validate_placement_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF new.status = old.status THEN RETURN new; END IF;
  IF old.status = 'submitted' AND new.status IN ('assigned','flagged','rejected') THEN RETURN new; END IF;
  IF old.status = 'flagged'   AND new.status IN ('assigned','rejected')           THEN RETURN new; END IF;
  RAISE EXCEPTION 'invalid placement status transition: % → % (placement %)',
    old.status, new.status, old.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_admin_only_placement_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.current_role() = 'student' THEN
    new.zone_id   := old.zone_id;
    new.synced_at := old.synced_at;
  END IF;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_create_attendance_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF new.status = 'flagged_location' THEN
    INSERT INTO public.attendance_flags (student_id, season_id, attendance_log_id, flag_reason)
    VALUES (
      new.student_id, new.season_id, new.id,
      'Location mismatch — checked in more than 500m from registered placement address'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN new;
END;
$$;


-- ---------------------------------------------------------------------------
-- HELPER FUNCTIONS (RLS)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS user_role LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE _role user_role;
BEGIN
  SELECT role INTO _role FROM public.profiles WHERE id = auth.uid();
  RETURN _role;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_school_supervisor()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'school_supervisor');
$$;

-- Geocoding helper functions
CREATE OR REPLACE FUNCTION public.get_placement_regions()
RETURNS TABLE (region text, total bigint, supervised_count bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT region, COUNT(*) AS total,
         COUNT(*) FILTER (WHERE zone_id IS NOT NULL) AS supervised_count
  FROM public.placements WHERE region IS NOT NULL
  GROUP BY region ORDER BY region;
$$;

CREATE OR REPLACE FUNCTION public.get_placement_districts(p_region text)
RETURNS TABLE (district text, total bigint, supervised_count bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT district, COUNT(*) AS total,
         COUNT(*) FILTER (WHERE zone_id IS NOT NULL) AS supervised_count
  FROM public.placements WHERE region = p_region AND district IS NOT NULL
  GROUP BY district ORDER BY district;
$$;

CREATE OR REPLACE FUNCTION public.get_placement_towns(p_region text, p_district text)
RETURNS TABLE (town text, total bigint, supervised_count bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT town, COUNT(*) AS total,
         COUNT(*) FILTER (WHERE zone_id IS NOT NULL) AS supervised_count
  FROM public.placements WHERE region = p_region AND district = p_district AND town IS NOT NULL
  GROUP BY town ORDER BY town;
$$;


-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------

-- auth.users → auto-create profile
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Role enforcement
CREATE OR REPLACE TRIGGER students_enforce_student_role
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_role();

CREATE OR REPLACE TRIGGER zone_supervisors_enforce_supervisor_role
  BEFORE INSERT OR UPDATE ON public.zone_supervisors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_school_supervisor_role();

-- Sync timestamps
CREATE OR REPLACE TRIGGER placements_stamp_synced_at
  BEFORE INSERT ON public.placements
  FOR EACH ROW EXECUTE FUNCTION public.stamp_synced_at();

CREATE OR REPLACE TRIGGER seasons_touch_updated_at        BEFORE UPDATE ON public.seasons                  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE TRIGGER zones_touch_updated_at          BEFORE UPDATE ON public.zones                    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE TRIGGER placements_touch_updated_at     BEFORE UPDATE ON public.placements               FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE TRIGGER settings_touch_updated_at       BEFORE UPDATE ON public.settings                 FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE TRIGGER logbook_weeks_touch_updated_at              BEFORE UPDATE ON public.logbook_weeks              FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE TRIGGER logbook_daily_entries_touch_updated_at      BEFORE UPDATE ON public.logbook_daily_entries      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE TRIGGER logbook_monthly_summaries_touch_updated_at  BEFORE UPDATE ON public.logbook_monthly_summaries  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE TRIGGER attendance_logs_touch_updated_at            BEFORE UPDATE ON public.attendance_logs            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE OR REPLACE TRIGGER attachment_reports_touch_updated_at         BEFORE UPDATE ON public.attachment_reports         FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE TRIGGER seasons_stamp_updated_by        BEFORE UPDATE ON public.seasons                  FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_by();
CREATE OR REPLACE TRIGGER zones_stamp_updated_by          BEFORE UPDATE ON public.zones                    FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_by();
CREATE OR REPLACE TRIGGER placements_stamp_updated_by     BEFORE UPDATE ON public.placements               FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_by();
CREATE OR REPLACE TRIGGER settings_stamp_updated_by       BEFORE UPDATE ON public.settings                 FOR EACH ROW EXECUTE FUNCTION public.stamp_updated_by();

CREATE OR REPLACE TRIGGER placements_validate_status_transition
  BEFORE UPDATE ON public.placements
  FOR EACH ROW EXECUTE FUNCTION public.validate_placement_status_transition();

CREATE OR REPLACE TRIGGER placements_lock_admin_only_fields
  BEFORE UPDATE ON public.placements
  FOR EACH ROW EXECUTE FUNCTION public.lock_admin_only_placement_fields();

CREATE OR REPLACE TRIGGER attendance_logs_auto_flag
  AFTER INSERT ON public.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_attendance_flag();


-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS placements_status_idx          ON public.placements (status);
CREATE INDEX IF NOT EXISTS placements_zone_idx            ON public.placements (zone_id);
CREATE INDEX IF NOT EXISTS placements_season_idx          ON public.placements (season_id);
CREATE INDEX IF NOT EXISTS placements_student_idx         ON public.placements (student_id);
CREATE INDEX IF NOT EXISTS letters_student_idx            ON public.letters    (student_id);
CREATE INDEX IF NOT EXISTS letters_season_idx             ON public.letters    (season_id);
CREATE INDEX IF NOT EXISTS students_index_number_idx      ON public.students   (index_number);
CREATE INDEX IF NOT EXISTS logbook_weeks_student_idx      ON public.logbook_weeks (student_id);
CREATE INDEX IF NOT EXISTS logbook_weeks_season_idx       ON public.logbook_weeks (season_id);
CREATE INDEX IF NOT EXISTS logbook_daily_week_idx         ON public.logbook_daily_entries (week_id);
CREATE INDEX IF NOT EXISTS logbook_monthly_student_idx    ON public.logbook_monthly_summaries (student_id, season_id);
CREATE INDEX IF NOT EXISTS attendance_student_idx         ON public.attendance_logs (student_id, season_id);
CREATE INDEX IF NOT EXISTS attendance_date_idx            ON public.attendance_logs (log_date);
CREATE INDEX IF NOT EXISTS attendance_absence_reason_idx  ON public.attendance_logs (student_id, season_id) WHERE status = 'absent';
CREATE INDEX IF NOT EXISTS attachment_payments_student_idx ON public.attachment_payments (student_id);
CREATE INDEX IF NOT EXISTS attachment_payments_season_idx  ON public.attachment_payments (season_id);
CREATE INDEX IF NOT EXISTS attachment_reports_student_idx  ON public.attachment_reports  (student_id);
CREATE INDEX IF NOT EXISTS attachment_reports_season_idx   ON public.attachment_reports  (season_id);
CREATE INDEX IF NOT EXISTS idx_placements_geo             ON public.placements (region, district, town);


-- ---------------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.student_profiles AS
  SELECT p.id, p.full_name, p.phone, p.created_at,
         s.index_number, s.department, s.programme, s.level,
         s.passport_picture_url, s.fingerprint_hash
  FROM public.profiles p
  JOIN public.students s ON s.id = p.id;

CREATE OR REPLACE VIEW public.placement_supervisors AS
  SELECT pl.id AS placement_id, pl.zone_id, zs.school_supervisor_id
  FROM public.placements pl
  JOIN public.zone_supervisors zs ON zs.zone_id = pl.zone_id;


-- ---------------------------------------------------------------------------
-- ENABLE RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_supervisors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letters              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_weeks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_daily_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_monthly_summaries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_flags     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_visits    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_reports   ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- RLS POLICIES
-- Note: DROP IF EXISTS + CREATE makes this squash safely re-runnable
-- ---------------------------------------------------------------------------

-- ── profiles ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles: user reads own row"   ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin reads all"      ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin inserts"        ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin updates"        ON public.profiles;
DROP POLICY IF EXISTS "profiles: user updates own row" ON public.profiles;

CREATE POLICY "profiles: user reads own row"   ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles: admin reads all"      ON public.profiles FOR SELECT USING (public.is_admin());
CREATE POLICY "profiles: admin inserts"        ON public.profiles FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "profiles: admin updates"        ON public.profiles FOR UPDATE USING (public.is_admin());
CREATE POLICY "profiles: user updates own row" ON public.profiles FOR UPDATE
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));

-- ── students ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "students: student reads own row"     ON public.students;
DROP POLICY IF EXISTS "students: admin reads all"           ON public.students;
DROP POLICY IF EXISTS "students: supervisor reads assigned" ON public.students;
DROP POLICY IF EXISTS "students: admin inserts"             ON public.students;
DROP POLICY IF EXISTS "students: admin updates"             ON public.students;

CREATE POLICY "students: student reads own row"     ON public.students FOR SELECT USING (id = auth.uid());
CREATE POLICY "students: admin reads all"           ON public.students FOR SELECT USING (public.is_admin());
CREATE POLICY "students: supervisor reads assigned" ON public.students FOR SELECT
  USING (
    public.is_school_supervisor() AND EXISTS (
      SELECT 1 FROM public.placements pl
      JOIN public.zone_supervisors zs ON zs.zone_id = pl.zone_id
      WHERE pl.student_id = students.id AND zs.school_supervisor_id = auth.uid()
    )
  );
CREATE POLICY "students: admin inserts" ON public.students FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "students: admin updates" ON public.students FOR UPDATE USING (public.is_admin());

-- ── seasons ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "seasons: all authenticated users read" ON public.seasons;
DROP POLICY IF EXISTS "seasons: admin inserts"               ON public.seasons;
DROP POLICY IF EXISTS "seasons: admin updates"               ON public.seasons;

CREATE POLICY "seasons: all authenticated users read" ON public.seasons FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "seasons: admin inserts"               ON public.seasons FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "seasons: admin updates"               ON public.seasons FOR UPDATE USING (public.is_admin());

-- ── zones ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "zones: all authenticated users read" ON public.zones;
DROP POLICY IF EXISTS "zones: admin inserts"               ON public.zones;
DROP POLICY IF EXISTS "zones: admin updates"               ON public.zones;
DROP POLICY IF EXISTS "zones: admin deletes"               ON public.zones;

CREATE POLICY "zones: all authenticated users read" ON public.zones FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "zones: admin inserts"               ON public.zones FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "zones: admin updates"               ON public.zones FOR UPDATE USING (public.is_admin());
CREATE POLICY "zones: admin deletes"               ON public.zones FOR DELETE USING (public.is_admin());

-- ── zone_supervisors ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "zone_supervisors: admin reads all"      ON public.zone_supervisors;
DROP POLICY IF EXISTS "zone_supervisors: supervisor reads own" ON public.zone_supervisors;
DROP POLICY IF EXISTS "zone_supervisors: admin inserts"        ON public.zone_supervisors;
DROP POLICY IF EXISTS "zone_supervisors: admin deletes"        ON public.zone_supervisors;

CREATE POLICY "zone_supervisors: admin reads all"      ON public.zone_supervisors FOR SELECT USING (public.is_admin());
CREATE POLICY "zone_supervisors: supervisor reads own" ON public.zone_supervisors FOR SELECT USING (school_supervisor_id = auth.uid());
CREATE POLICY "zone_supervisors: admin inserts"        ON public.zone_supervisors FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "zone_supervisors: admin deletes"        ON public.zone_supervisors FOR DELETE USING (public.is_admin());

-- ── placements ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "placements: student reads own"                  ON public.placements;
DROP POLICY IF EXISTS "placements: admin reads all"                    ON public.placements;
DROP POLICY IF EXISTS "placements: supervisor reads assigned zone"     ON public.placements;
DROP POLICY IF EXISTS "placements: student inserts own"                ON public.placements;
DROP POLICY IF EXISTS "placements: student updates own while submitted" ON public.placements;
DROP POLICY IF EXISTS "placements: admin updates all"                  ON public.placements;

CREATE POLICY "placements: student reads own"  ON public.placements FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "placements: admin reads all"    ON public.placements FOR SELECT USING (public.is_admin());
CREATE POLICY "placements: supervisor reads assigned zone" ON public.placements FOR SELECT
  USING (
    public.is_school_supervisor() AND EXISTS (
      SELECT 1 FROM public.zone_supervisors zs
      WHERE zs.zone_id = placements.zone_id AND zs.school_supervisor_id = auth.uid()
    )
  );
CREATE POLICY "placements: student inserts own" ON public.placements FOR INSERT
  WITH CHECK (
    student_id = auth.uid() AND public.current_role() = 'student' AND status = 'submitted' AND
    EXISTS (
      SELECT 1 FROM public.seasons s WHERE s.id = season_id AND s.status = 'open'
        AND current_date BETWEEN s.placement_window_start AND s.placement_window_end
    )
  );
CREATE POLICY "placements: student updates own while submitted" ON public.placements FOR UPDATE
  USING  (student_id = auth.uid() AND public.current_role() = 'student' AND status = 'submitted')
  WITH CHECK (student_id = auth.uid() AND status = 'submitted');
CREATE POLICY "placements: admin updates all" ON public.placements FOR UPDATE USING (public.is_admin());

-- ── letters ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "letters: student reads own"   ON public.letters;
DROP POLICY IF EXISTS "letters: admin reads all"     ON public.letters;
DROP POLICY IF EXISTS "letters: student inserts own" ON public.letters;

CREATE POLICY "letters: student reads own"   ON public.letters FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "letters: admin reads all"     ON public.letters FOR SELECT USING (public.is_admin());
CREATE POLICY "letters: student inserts own" ON public.letters FOR INSERT
  WITH CHECK (
    student_id = auth.uid() AND public.current_role() = 'student' AND
    EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = season_id AND s.status = 'open')
  );

-- ── settings ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "settings: all authenticated users read" ON public.settings;
DROP POLICY IF EXISTS "settings: admin updates"               ON public.settings;

CREATE POLICY "settings: all authenticated users read" ON public.settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "settings: admin updates"               ON public.settings FOR UPDATE USING (public.is_admin());

-- ── logbook_weeks ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "logbook_weeks: student selects own"           ON public.logbook_weeks;
DROP POLICY IF EXISTS "logbook_weeks: student inserts own"           ON public.logbook_weeks;
DROP POLICY IF EXISTS "logbook_weeks: student updates own draft"     ON public.logbook_weeks;
DROP POLICY IF EXISTS "logbook_weeks: admin reads all"               ON public.logbook_weeks;
DROP POLICY IF EXISTS "logbook_weeks: admin updates all"             ON public.logbook_weeks;
DROP POLICY IF EXISTS "logbook_weeks: supervisor reads assigned zone" ON public.logbook_weeks;
DROP POLICY IF EXISTS "logbook_weeks: supervisor certifies"          ON public.logbook_weeks;

CREATE POLICY "logbook_weeks: student selects own"       ON public.logbook_weeks FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "logbook_weeks: student inserts own"       ON public.logbook_weeks FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "logbook_weeks: student updates own draft" ON public.logbook_weeks FOR UPDATE
  USING (auth.uid() = student_id AND status = 'draft')
  WITH CHECK (auth.uid() = student_id AND status IN ('draft','submitted'));
CREATE POLICY "logbook_weeks: admin reads all"           ON public.logbook_weeks FOR SELECT USING (public.is_admin());
CREATE POLICY "logbook_weeks: admin updates all"         ON public.logbook_weeks FOR UPDATE USING (public.is_admin());
CREATE POLICY "logbook_weeks: supervisor reads assigned zone" ON public.logbook_weeks FOR SELECT
  USING (
    public.is_school_supervisor() AND EXISTS (
      SELECT 1 FROM public.placement_supervisors ps
      WHERE ps.placement_id IN (
        SELECT id FROM public.placements
        WHERE student_id = logbook_weeks.student_id AND season_id = logbook_weeks.season_id
      ) AND ps.school_supervisor_id = auth.uid()
    )
  );
CREATE POLICY "logbook_weeks: supervisor certifies" ON public.logbook_weeks FOR UPDATE
  USING (
    public.is_school_supervisor() AND status = 'submitted' AND EXISTS (
      SELECT 1 FROM public.placement_supervisors ps
      WHERE ps.placement_id IN (
        SELECT id FROM public.placements
        WHERE student_id = logbook_weeks.student_id AND season_id = logbook_weeks.season_id
      ) AND ps.school_supervisor_id = auth.uid()
    )
  );

-- ── logbook_daily_entries ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "logbook_daily_entries: student selects own"           ON public.logbook_daily_entries;
DROP POLICY IF EXISTS "logbook_daily_entries: student inserts on draft week" ON public.logbook_daily_entries;
DROP POLICY IF EXISTS "logbook_daily_entries: student updates on draft week" ON public.logbook_daily_entries;
DROP POLICY IF EXISTS "logbook_daily_entries: admin reads all"               ON public.logbook_daily_entries;
DROP POLICY IF EXISTS "logbook_daily_entries: supervisor reads assigned"     ON public.logbook_daily_entries;

CREATE POLICY "logbook_daily_entries: student selects own" ON public.logbook_daily_entries FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "logbook_daily_entries: student inserts on draft week" ON public.logbook_daily_entries FOR INSERT
  WITH CHECK (student_id = auth.uid() AND EXISTS (SELECT 1 FROM public.logbook_weeks WHERE id = week_id AND status = 'draft'));
CREATE POLICY "logbook_daily_entries: student updates on draft week" ON public.logbook_daily_entries FOR UPDATE
  USING (student_id = auth.uid() AND EXISTS (SELECT 1 FROM public.logbook_weeks WHERE id = week_id AND status = 'draft'));
CREATE POLICY "logbook_daily_entries: admin reads all"           ON public.logbook_daily_entries FOR SELECT USING (public.is_admin());
CREATE POLICY "logbook_daily_entries: supervisor reads assigned" ON public.logbook_daily_entries FOR SELECT
  USING (
    public.is_school_supervisor() AND EXISTS (
      SELECT 1 FROM public.logbook_weeks lw
      JOIN public.placement_supervisors ps ON ps.placement_id IN (
        SELECT id FROM public.placements
        WHERE student_id = lw.student_id AND season_id = lw.season_id
      )
      WHERE lw.id = logbook_daily_entries.week_id AND ps.school_supervisor_id = auth.uid()
    )
  );

-- ── logbook_monthly_summaries ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "logbook_monthly_summaries: student selects own"       ON public.logbook_monthly_summaries;
DROP POLICY IF EXISTS "logbook_monthly_summaries: student inserts own"       ON public.logbook_monthly_summaries;
DROP POLICY IF EXISTS "logbook_monthly_summaries: student updates draft"     ON public.logbook_monthly_summaries;
DROP POLICY IF EXISTS "logbook_monthly_summaries: admin reads all"           ON public.logbook_monthly_summaries;
DROP POLICY IF EXISTS "logbook_monthly_summaries: supervisor reads assigned" ON public.logbook_monthly_summaries;
DROP POLICY IF EXISTS "logbook_monthly_summaries: supervisor assesses"       ON public.logbook_monthly_summaries;

CREATE POLICY "logbook_monthly_summaries: student selects own"   ON public.logbook_monthly_summaries FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "logbook_monthly_summaries: student inserts own"   ON public.logbook_monthly_summaries FOR INSERT WITH CHECK (auth.uid() = student_id AND status = 'draft');
CREATE POLICY "logbook_monthly_summaries: student updates draft" ON public.logbook_monthly_summaries FOR UPDATE
  USING (auth.uid() = student_id AND status = 'draft') WITH CHECK (auth.uid() = student_id);
CREATE POLICY "logbook_monthly_summaries: admin reads all"       ON public.logbook_monthly_summaries FOR SELECT USING (public.is_admin());
CREATE POLICY "logbook_monthly_summaries: supervisor reads assigned" ON public.logbook_monthly_summaries FOR SELECT
  USING (
    public.is_school_supervisor() AND EXISTS (
      SELECT 1 FROM public.placement_supervisors ps
      WHERE ps.placement_id IN (
        SELECT id FROM public.placements
        WHERE student_id = logbook_monthly_summaries.student_id AND season_id = logbook_monthly_summaries.season_id
      ) AND ps.school_supervisor_id = auth.uid()
    )
  );
CREATE POLICY "logbook_monthly_summaries: supervisor assesses" ON public.logbook_monthly_summaries FOR UPDATE
  USING (
    public.is_school_supervisor() AND EXISTS (
      SELECT 1 FROM public.placement_supervisors ps
      WHERE ps.placement_id IN (
        SELECT id FROM public.placements
        WHERE student_id = logbook_monthly_summaries.student_id AND season_id = logbook_monthly_summaries.season_id
      ) AND ps.school_supervisor_id = auth.uid()
    )
  );

-- ── attendance_logs ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "attendance_logs: student inserts own"       ON public.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs: student reads own"         ON public.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs: student updates own today" ON public.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs: admin reads all"           ON public.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs: admin updates all"         ON public.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs: supervisor reads assigned" ON public.attendance_logs;

CREATE POLICY "attendance_logs: student inserts own"       ON public.attendance_logs FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "attendance_logs: student reads own"         ON public.attendance_logs FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "attendance_logs: student updates own today" ON public.attendance_logs FOR UPDATE
  USING (auth.uid() = student_id AND log_date = current_date AND check_out_time IS NULL)
  WITH CHECK (auth.uid() = student_id);
CREATE POLICY "attendance_logs: admin reads all"           ON public.attendance_logs FOR SELECT USING (public.is_admin());
CREATE POLICY "attendance_logs: admin updates all"         ON public.attendance_logs FOR UPDATE USING (public.is_admin());
CREATE POLICY "attendance_logs: supervisor reads assigned" ON public.attendance_logs FOR SELECT
  USING (
    public.is_school_supervisor() AND EXISTS (
      SELECT 1 FROM public.placement_supervisors ps
      WHERE ps.placement_id = attendance_logs.placement_id AND ps.school_supervisor_id = auth.uid()
    )
  );

-- ── attendance_flags ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "attendance_flags: admin reads all"           ON public.attendance_flags;
DROP POLICY IF EXISTS "attendance_flags: admin inserts"             ON public.attendance_flags;
DROP POLICY IF EXISTS "attendance_flags: admin updates all"         ON public.attendance_flags;
DROP POLICY IF EXISTS "attendance_flags: student reads own"         ON public.attendance_flags;
DROP POLICY IF EXISTS "attendance_flags: supervisor reads assigned" ON public.attendance_flags;

CREATE POLICY "attendance_flags: admin reads all"   ON public.attendance_flags FOR SELECT USING (public.is_admin());
CREATE POLICY "attendance_flags: admin inserts"     ON public.attendance_flags FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "attendance_flags: admin updates all" ON public.attendance_flags FOR UPDATE USING (public.is_admin());
CREATE POLICY "attendance_flags: student reads own" ON public.attendance_flags FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "attendance_flags: supervisor reads assigned" ON public.attendance_flags FOR SELECT
  USING (
    public.is_school_supervisor() AND EXISTS (
      SELECT 1 FROM public.attendance_logs al
      JOIN public.placement_supervisors ps ON ps.placement_id = al.placement_id
      WHERE al.id = attendance_flags.attendance_log_id AND ps.school_supervisor_id = auth.uid()
    )
  );

-- ── supervisor_visits ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "supervisor_visits: supervisor manages own" ON public.supervisor_visits;

CREATE POLICY "supervisor_visits: supervisor manages own" ON public.supervisor_visits FOR ALL USING (auth.uid() = school_supervisor_id);

-- ── attachment_payments ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "attachment_payments: student selects own" ON public.attachment_payments;
DROP POLICY IF EXISTS "attachment_payments: student inserts own" ON public.attachment_payments;
DROP POLICY IF EXISTS "attachment_payments: student updates own" ON public.attachment_payments;
DROP POLICY IF EXISTS "attachment_payments: admin reads all"     ON public.attachment_payments;
DROP POLICY IF EXISTS "attachment_payments: admin updates all"   ON public.attachment_payments;

CREATE POLICY "attachment_payments: student selects own" ON public.attachment_payments FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "attachment_payments: student inserts own" ON public.attachment_payments FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "attachment_payments: student updates own" ON public.attachment_payments FOR UPDATE USING (auth.uid() = student_id);
CREATE POLICY "attachment_payments: admin reads all"     ON public.attachment_payments FOR SELECT USING (public.is_admin());
CREATE POLICY "attachment_payments: admin updates all"   ON public.attachment_payments FOR UPDATE USING (public.is_admin());

-- ── attachment_reports ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "attachment_reports: student selects own" ON public.attachment_reports;
DROP POLICY IF EXISTS "attachment_reports: student inserts own" ON public.attachment_reports;
DROP POLICY IF EXISTS "attachment_reports: student updates own" ON public.attachment_reports;
DROP POLICY IF EXISTS "attachment_reports: admin reads all"     ON public.attachment_reports;
DROP POLICY IF EXISTS "attachment_reports: admin updates all"   ON public.attachment_reports;

CREATE POLICY "attachment_reports: student selects own" ON public.attachment_reports FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "attachment_reports: student inserts own" ON public.attachment_reports FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "attachment_reports: student updates own" ON public.attachment_reports FOR UPDATE USING (auth.uid() = student_id);
CREATE POLICY "attachment_reports: admin reads all"     ON public.attachment_reports FOR SELECT USING (public.is_admin());
CREATE POLICY "attachment_reports: admin updates all"   ON public.attachment_reports FOR UPDATE USING (public.is_admin());