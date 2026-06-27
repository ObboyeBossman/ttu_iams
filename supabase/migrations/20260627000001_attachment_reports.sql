-- =============================================================================
-- IAMS — 20260627000001_attachment_reports.sql
-- Migration to create attachment report and payment tables.
-- =============================================================================

-- Create attachment_payments table
CREATE TABLE IF NOT EXISTS public.attachment_payments (
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_reference TEXT UNIQUE,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (student_id, season_id)
);

-- Create attachment_reports table
CREATE TABLE IF NOT EXISTS public.attachment_reports (
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
    path_type TEXT NOT NULL DEFAULT 'ai',
    input_form JSONB NOT NULL DEFAULT '{}'::jsonb,
    report_sections JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft',
    pdf_url TEXT,
    review_feedback TEXT,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (student_id, season_id)
);

-- Enable RLS
ALTER TABLE public.attachment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_reports ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies for attachment_payments ─────────────────────────────────────
CREATE POLICY "attachment_payments: student selects own"
    ON public.attachment_payments FOR SELECT
    USING (auth.uid() = student_id);

CREATE POLICY "attachment_payments: student inserts own"
    ON public.attachment_payments FOR INSERT
    WITH CHECK (auth.uid() = student_id);

CREATE POLICY "attachment_payments: student updates own"
    ON public.attachment_payments FOR UPDATE
    USING (auth.uid() = student_id);

CREATE POLICY "attachment_payments: admin reads all"
    ON public.attachment_payments FOR SELECT
    USING (public.is_admin());

CREATE POLICY "attachment_payments: admin updates all"
    ON public.attachment_payments FOR UPDATE
    USING (public.is_admin());

-- ── RLS Policies for attachment_reports ──────────────────────────────────────
CREATE POLICY "attachment_reports: student selects own"
    ON public.attachment_reports FOR SELECT
    USING (auth.uid() = student_id);

CREATE POLICY "attachment_reports: student inserts own"
    ON public.attachment_reports FOR INSERT
    WITH CHECK (auth.uid() = student_id);

CREATE POLICY "attachment_reports: student updates own"
    ON public.attachment_reports FOR UPDATE
    USING (auth.uid() = student_id);

CREATE POLICY "attachment_reports: admin reads all"
    ON public.attachment_reports FOR SELECT
    USING (public.is_admin());

CREATE POLICY "attachment_reports: admin updates all"
    ON public.attachment_reports FOR UPDATE
    USING (public.is_admin());

-- Triggers for touch_updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'attachment_reports_touch_updated_at'
  ) THEN
    CREATE TRIGGER attachment_reports_touch_updated_at
      BEFORE UPDATE ON public.attachment_reports
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS attachment_payments_student_idx ON public.attachment_payments (student_id);
CREATE INDEX IF NOT EXISTS attachment_payments_season_idx ON public.attachment_payments (season_id);
CREATE INDEX IF NOT EXISTS attachment_reports_student_idx ON public.attachment_reports (student_id);
CREATE INDEX IF NOT EXISTS attachment_reports_season_idx ON public.attachment_reports (season_id);
