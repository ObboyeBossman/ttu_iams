// =============================================================================
// IAMS — shared/services/profile.service.js  (Phase 2)
// =============================================================================
// Profile reads + updates for the student portal Profile page.
// All writes are student-own-only (RLS: "profiles: student updates own role-
// immutable fields"). getProfile joins profiles + students via the
// student_profiles view for a single call.
// =============================================================================

import { supabase } from '../supabase-client.js';

/**
 * Returns the combined profile + student record for a given userId.
 * Uses the student_profiles view (profiles ⋈ students) so callers get
 * academic fields (index_number, department, programme, level) alongside
 * identity fields (full_name, phone, created_at) in one query.
 *
 * @param {string} userId - auth.uid()
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return { data, error };
}

/**
 * Updates the phone number on the profiles table for a student's own row.
 * RLS ensures students can only update their own profile, and the
 * role field is immutable (enforced server-side).
 *
 * @param {string} userId  - auth.uid()
 * @param {string} phone   - New phone number (non-empty string)
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function updatePhone(userId, phone) {
  if (!phone || !phone.trim()) {
    return { data: null, error: { message: 'Phone number cannot be empty.' } };
  }
  const { data, error } = await supabase
    .from('profiles')
    .update({ phone: phone.trim() })
    .eq('id', userId)
    .select('id, full_name, phone, created_at')
    .single();
  return { data, error };
}

/**
 * Returns the authenticated user's auth record (email, created_at).
 * Used on the Settings → Account tab.
 *
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function getAuthUser() {
  const { data, error } = await supabase.auth.getUser();
  return { data: data?.user ?? null, error };
}
