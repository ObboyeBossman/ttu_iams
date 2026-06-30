// =============================================================================
// IAMS — shared/services/profile.service.js  (Phase 2)
// =============================================================================
// Profile reads + updates for the student portal Profile page, plus a
// role-agnostic own-profile read for other portals' Account settings.
// All writes are role-own-only (RLS: profiles id = auth.uid()).
// getProfile joins profiles + students via the student_profiles view for a
// single call; getOwnProfile reads profiles alone for non-student roles.
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

/**
 * Returns the bare `profiles` row (id, role, full_name, phone, created_at)
 * for any authenticated user reading their own row — admin, school_supervisor,
 * or company_supervisor. Unlike getProfile() above, this does NOT join the
 * student_profiles view, since that view only exists for the student role
 * (admins/supervisors have no row in `students` at all). Use this on the
 * Admin Settings → Account tab and future supervisor settings pages;
 * use getProfile() only when academic fields are actually needed.
 *
 * @param {string} userId - auth.uid()
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function getOwnProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, phone, created_at')
    .eq('id', userId)
    .maybeSingle();
  return { data, error };
}

/**
 * Updates full_name and/or phone on the caller's own profiles row. Both
 * fields are optional in the patch — pass only what's changing. Mirrors
 * updatePhone()'s validation (non-empty after trim) for any field present,
 * but does both fields in a single round-trip rather than requiring two
 * sequential calls when both change at once.
 *
 * RLS ("profiles: user updates own row") explicitly covers both full_name
 * and phone for any role. updatePhone() only ever covered one of the two;
 * this is the missing complement. Keep using updatePhone() from student-side
 * code that already calls it — this function is for any "edit my profile"
 * UI that needs both fields.
 *
 * @param {string} userId - auth.uid()
 * @param {{ full_name?: string, phone?: string }} patch
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function updateOwnProfile(userId, patch) {
  const cleanPatch = {};

  if (patch.full_name !== undefined) {
    if (!patch.full_name || !patch.full_name.trim()) {
      return { data: null, error: { message: 'Full name cannot be empty.' } };
    }
    cleanPatch.full_name = patch.full_name.trim();
  }

  if (patch.phone !== undefined) {
    if (!patch.phone || !patch.phone.trim()) {
      return { data: null, error: { message: 'Phone number cannot be empty.' } };
    }
    cleanPatch.phone = patch.phone.trim();
  }

  if (Object.keys(cleanPatch).length === 0) {
    return { data: null, error: { message: 'Nothing to update.' } };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(cleanPatch)
    .eq('id', userId)
    .select('id, full_name, phone, created_at')
    .single();
  return { data, error };
}
