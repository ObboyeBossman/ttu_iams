-- =============================================================================
-- Migration: add footer_path to settings
-- =============================================================================
-- The get-letter-assets Edge Function and generate-letter.js now require a
-- footer branding asset (ttu_footer.png) in addition to the existing
-- letterhead and stamp. This migration adds the footer_path column to the
-- single-row settings table so the admin can configure it.
-- =============================================================================

alter table public.settings
  add column if not exists footer_path text;   -- storage path for TTU footer image

comment on column public.settings.footer_path is
  'Storage path for the TTU footer bar image (ttu_footer.png in the letter-assets bucket).';
