-- =============================================================================
-- Migration: 20260627000003_attendance_biometrics.sql
-- IAMS Phase 2 — Add biometric verification fields to attendance logs
-- =============================================================================

ALTER TABLE public.students
ADD COLUMN passport_picture_url text,
ADD COLUMN fingerprint_hash text;

DROP VIEW IF EXISTS public.student_profiles;
CREATE VIEW public.student_profiles AS
  SELECT p.id, p.full_name, p.phone, p.created_at,
         s.index_number, s.department, s.programme, s.level,
         s.passport_picture_url, s.fingerprint_hash
  FROM public.profiles p
  JOIN public.students s ON s.id = p.id;

ALTER TABLE public.attendance_logs
ADD COLUMN biometric_method text CHECK (biometric_method IN ('face', 'fingerprint', 'none')),
ADD COLUMN biometric_verified boolean DEFAULT false;
