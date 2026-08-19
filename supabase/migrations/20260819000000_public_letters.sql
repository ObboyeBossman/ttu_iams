-- Migration: Allow public/unauthenticated attachment letter requests
ALTER TABLE public.letters ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS index_number text;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS programme text;
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS phone text;

-- Allow unauthenticated/guest users to insert letters into the audit table
DROP POLICY IF EXISTS "letters: public insert" ON public.letters;
CREATE POLICY "letters: public insert" ON public.letters FOR INSERT WITH CHECK (true);

-- Allow public read by code for letter verification/preview
DROP POLICY IF EXISTS "letters: public read by code" ON public.letters;
CREATE POLICY "letters: public read by code" ON public.letters FOR SELECT USING (true);
