-- =============================================================================
-- IAMS — Logbook Schema Verification Fixes
-- =============================================================================

-- 1. Add student_id to logbook_daily_entries
ALTER TABLE public.logbook_daily_entries 
ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.profiles(id) DEFAULT auth.uid();

-- Backfill student_id for existing rows
UPDATE public.logbook_daily_entries d
SET student_id = w.student_id
FROM public.logbook_weeks w
WHERE d.week_id = w.id
  AND (d.student_id IS NULL OR d.student_id != w.student_id);

-- Make it NOT NULL after backfill
ALTER TABLE public.logbook_daily_entries 
ALTER COLUMN student_id SET NOT NULL;

-- 2. Update logbook_daily_entries policies
DROP POLICY IF EXISTS "logbook_daily_entries: student selects own" ON public.logbook_daily_entries;
DROP POLICY IF EXISTS "logbook_daily_entries: student inserts on draft week" ON public.logbook_daily_entries;
DROP POLICY IF EXISTS "logbook_daily_entries: student updates on draft week" ON public.logbook_daily_entries;

CREATE POLICY "logbook_daily_entries: student selects own"
  ON public.logbook_daily_entries
  FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "logbook_daily_entries: student inserts on draft week"
  ON public.logbook_daily_entries
  FOR INSERT
  WITH CHECK (
    student_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.logbook_weeks
      WHERE id = week_id AND status = 'draft'
    )
  );

CREATE POLICY "logbook_daily_entries: student updates on draft week"
  ON public.logbook_daily_entries
  FOR UPDATE
  USING (
    student_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.logbook_weeks
      WHERE id = week_id AND status = 'draft'
    )
  );

-- 3. Rename company_supervisor_assessment to supervisor_feedback
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name='logbook_monthly_summaries' AND column_name='company_supervisor_assessment') THEN
    ALTER TABLE public.logbook_monthly_summaries RENAME COLUMN company_supervisor_assessment TO supervisor_feedback;
  END IF;
END $$;
