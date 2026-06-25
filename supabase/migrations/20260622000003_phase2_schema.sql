-- =============================================================================
-- IAMS — Phase 2 Schema additions
-- =============================================================================

-- =============================================================================
-- Logbook Module
-- =============================================================================

CREATE TABLE public.logbook_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  placement_id uuid NOT NULL REFERENCES public.placements(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  week_number int NOT NULL CHECK (week_number > 0),
  week_start date NOT NULL,
  week_end date NOT NULL CHECK (week_end >= week_start),
  department_section text,
  student_remarks text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'certified')),
  company_certified_by text,
  company_certified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, season_id, week_number)
);

CREATE TABLE public.logbook_daily_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id uuid NOT NULL REFERENCES public.logbook_weeks(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  activities text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_id, log_date)
);

CREATE TABLE public.logbook_monthly_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  placement_id uuid NOT NULL REFERENCES public.placements(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  month_number int NOT NULL CHECK (month_number > 0),
  student_summary text,
  company_supervisor_assessment text,
  company_supervisor_rating int CHECK (company_supervisor_rating >= 1 AND company_supervisor_rating <= 5),
  company_supervisor_name text,
  company_supervisor_assessed_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'assessed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, season_id, month_number)
);

-- =============================================================================
-- Attendance Module
-- =============================================================================

CREATE TABLE public.attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  placement_id uuid NOT NULL REFERENCES public.placements(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  check_in_time timestamptz,
  check_in_lat numeric,
  check_in_lon numeric,
  check_in_location_source text CHECK (check_in_location_source IN ('gps', 'manual')),
  check_out_time timestamptz,
  check_out_lat numeric,
  check_out_lon numeric,
  check_out_location_source text CHECK (check_out_location_source IN ('gps', 'manual')),
  distance_from_placement_m numeric,
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'flagged_location')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, log_date)
);

CREATE TABLE public.attendance_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  attendance_log_id uuid NOT NULL REFERENCES public.attendance_logs(id) ON DELETE CASCADE,
  flag_reason text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id)
);

-- =============================================================================
-- Visit Module
-- =============================================================================

CREATE TABLE public.supervisor_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES public.placements(id) ON DELETE CASCADE,
  school_supervisor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  visit_date date NOT NULL,
  observations text,
  remarks text,
  assessment_score int CHECK (assessment_score >= 0 AND assessment_score <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- RLS Policies (Stubs for Phase 2)
-- =============================================================================

ALTER TABLE public.logbook_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_daily_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_monthly_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logbook_weeks: student access own" ON public.logbook_weeks FOR ALL USING (auth.uid() = student_id);
CREATE POLICY "logbook_daily_entries: student access own" ON public.logbook_daily_entries FOR ALL USING (
  EXISTS (SELECT 1 FROM public.logbook_weeks WHERE id = logbook_daily_entries.week_id AND student_id = auth.uid())
);
CREATE POLICY "logbook_monthly_summaries: student access own" ON public.logbook_monthly_summaries FOR ALL USING (auth.uid() = student_id);

CREATE POLICY "attendance_logs: student inserts own" ON public.attendance_logs FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "attendance_logs: student reads own" ON public.attendance_logs FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "attendance_logs: student updates own" ON public.attendance_logs FOR UPDATE USING (auth.uid() = student_id);

CREATE POLICY "attendance_flags: admin reads all" ON public.attendance_flags FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "supervisor_visits: supervisor manages own" ON public.supervisor_visits FOR ALL USING (auth.uid() = school_supervisor_id);
