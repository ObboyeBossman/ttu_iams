// =============================================================================
// IAMS — shared/services/settings.js
// =============================================================================
// "read/update stamp, signature, letterhead paths" — per Section 10's
// one-line summary. `settings` is a single-row table (CHECK (id = 1),
// schema.sql) seeded at migration time, so this service only ever UPDATEs,
// never INSERTs — the mock client enforces this too (mock-client.js: "no
// INSERT policy exists — the single row is seeded once and only ever
// updated").
//
// This file also owns turning a stored asset path into a usable signed URL
// (NFR2: short-lived signed URLs, not a public bucket) — generate-letter.js
// calls getSignedAssetUrl() for each of the three assets at the moment of
// PDF assembly rather than holding a long-lived URL.
// =============================================================================

import { supabase } from '../supabase-client.js';

const BUCKET = 'branding';
const DEFAULT_EXPIRY_SECONDS = 60;

/** Returns the single settings row (letterhead_path, stamp_path, signature_path, updated_at, updated_by). All authenticated roles may read ("settings: all authenticated users read") — every student's letter generation needs these paths. */
export async function getSettings() {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  return { data, error };
}

/**
 * Updates one or more asset paths. Admin-only at the RLS layer ("settings:
 * admin updates"). Only pass the fields actually changing — e.g.
 * `{ stamp_path: 'branding/new-stamp.png' }` — since this is always an
 * UPDATE against the fixed id = 1 row, never a full-row replace.
 */
export async function updateSettings(patch) {
  const { data, error } = await supabase.from('settings').update(patch).eq('id', 1).select().single();
  return { data, error };
}

/**
 * Resolves a stored asset path (e.g. settings.stamp_path) to a short-lived
 * signed URL ready to drop into an <img> or jsPDF's addImage(). Wraps
 * supabase.storage.from(bucket).createSignedUrl() — every Phase 1 asset
 * lives in the same 'branding' bucket (see mock-storage.js's
 * PLACEHOLDER_ASSETS keys), so callers don't need to know or pass the
 * bucket name themselves.
 *
 * Returns null data (with an error) if `path` is falsy, so a settings row
 * with an unset asset (e.g. before the admin has uploaded a signature yet)
 * fails predictably rather than calling createSignedUrl(bucket, undefined).
 */
export async function getSignedAssetUrl(path, expiresInSeconds = DEFAULT_EXPIRY_SECONDS) {
  if (!path) {
    return { data: null, error: { message: 'No asset path set for this field.' } };
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  return { data, error };
}

/**
 * Convenience wrapper: resolves signed URLs for all three branding assets
 * (letterhead, stamp, signature) in one call, given an already-fetched
 * settings row. generate-letter.js calls this once per letter generation
 * rather than three separate getSignedAssetUrl() calls scattered through
 * the PDF assembly code.
 */
export async function getSignedAssetUrlsForLetter(settingsRow) {
  const [letterhead, stamp, signature] = await Promise.all([
    getSignedAssetUrl(settingsRow.letterhead_path),
    getSignedAssetUrl(settingsRow.stamp_path),
    getSignedAssetUrl(settingsRow.signature_path),
  ]);

  const errors = [letterhead, stamp, signature].filter((r) => r.error).map((r) => r.error.message);
  if (errors.length > 0) {
    return { data: null, error: { message: errors.join(' ') } };
  }

  return {
    data: {
      letterheadUrl: letterhead.data.signedUrl,
      stampUrl: stamp.data.signedUrl,
      signatureUrl: signature.data.signedUrl,
    },
    error: null,
  };
}
