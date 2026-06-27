-- =============================================================================
-- IAMS — 20260626000002_attendance_absence_reason.sql
-- Adds absence_reason to attendance_logs and completes attendance RLS
-- =============================================================================

-- ─── 1. Add absence_reason column ────────────────────────────────────────────
-- Stores the reason when a student voluntarily logs an absence.
-- NULL for present/flagged records; populated for status = 'absent'.
ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS absence_reason text;

-- Update the status CHECK to include 'absent' if it doesn't already
-- (Phase 2 schema only had 'present', 'absent', 'flagged_location' — check is idempotent)
ALTER TABLE public.attendance_logs
  DROP CONSTRAINT IF EXISTS attendance_logs_status_check;

ALTER TABLE public.attendance_logs
  ADD CONSTRAINT attendance_logs_status_check
  CHECK (status IN ('present', 'absent', 'flagged_location'));

-- ─── 2. Allow students to insert absence records (log_date = today only) ─────
-- The Phase 2 schema already created "attendance_logs: student inserts own"
-- using only auth.uid() = student_id. We refine it here to also allow
-- inserting with status='absent' today (check_in_time is null for absences).
-- Because RLS is additive on INSERT (OR semantics per policy), the existing
-- policy already covers this — the column change is the only structural need.

-- ─── 3. Supervisor: read attendance_flags for their zone ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'attendance_flags'
      AND policyname = 'attendance_flags: supervisor reads assigned'
  ) THEN
    CREATE POLICY "attendance_flags: supervisor reads assigned"
      ON public.attendance_flags
      FOR SELECT
      USING (
        public.is_school_supervisor()
        AND EXISTS (
          SELECT 1
          FROM public.attendance_logs al
          JOIN public.placement_supervisors ps ON ps.placement_id = al.placement_id
          WHERE al.id = attendance_flags.attendance_log_id
            AND ps.school_supervisor_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ─── 4. Admin can insert attendance flags (auto-flag trigger below) ───────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'attendance_flags'
      AND policyname = 'attendance_flags: admin inserts'
  ) THEN
    CREATE POLICY "attendance_flags: admin inserts"
      ON public.attendance_flags
      FOR INSERT
      WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ─── 5. Auto-flag trigger — insert a flag row when a log is flagged_location ──
-- Runs AFTER INSERT on attendance_logs so we have the new row's id.
CREATE OR REPLACE FUNCTION public.auto_create_attendance_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'flagged_location' THEN
    INSERT INTO public.attendance_flags (
      student_id,
      season_id,
      attendance_log_id,
      flag_reason
    ) VALUES (
      NEW.student_id,
      NEW.season_id,
      NEW.id,
      'Location mismatch — checked in more than 500m from registered placement address'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_logs_auto_flag ON public.attendance_logs;

CREATE TRIGGER attendance_logs_auto_flag
  AFTER INSERT ON public.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_attendance_flag();

-- ─── 6. Index on absence_reason for admin dashboards ─────────────────────────
CREATE INDEX IF NOT EXISTS attendance_absence_reason_idx
  ON public.attendance_logs (student_id, season_id)
  WHERE status = 'absent';
