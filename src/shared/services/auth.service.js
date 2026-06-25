// =============================================================================
// IAMS — shared/services/auth.service.js
// =============================================================================
// Auth-related Supabase calls. Page scripts import from here, not directly
// from supabase-client.js (NFR7: services layer is the only Supabase caller).
// =============================================================================

import { supabase } from '../supabase-client.js';

/** Sign in with email and password. Returns { data, error }. */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

/** Sign out the current user. */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

/** Get the currently authenticated user object (from auth, not profiles). */
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  return { data: user, error };
}

/**
 * Send a password-reset email. Redirects to login page after reset.
 * Uses Supabase's built-in email flow (NFR13: no admin API on client).
 */
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/src/modules/auth/login.html`,
  });
  return { error };
}

/**
 * Fetch the full profile row for any user id.
 * Students see their own; admins see all (RLS).
 */
export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, phone, created_at')
    .eq('id', userId)
    .maybeSingle();
  return { data, error };
}

/**
 * Fetch profile + student-specific fields for the signed-in student.
 * Uses the student_profiles view defined in schema.sql.
 */
export async function getStudentProfile(userId) {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return { data, error };
}
