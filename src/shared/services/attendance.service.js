// =============================================================================
// IAMS — shared/services/attendance.service.js  (Phase 2)
// =============================================================================
// Attendance logs, GPS check-in / check-out, and anomaly flag reads.
// These tables are created in migration 20260622000003_phase2_schema.sql.
// All writes are student-only (RLS); admins and supervisors read.
// =============================================================================

import { supabase } from '../supabase-client.js';

/**
 * Returns today's attendance log for the signed-in student, or null if none.
 * Used to decide whether to show CHECK IN or CHECK OUT on the attendance page.
 */
export async function getTodayLog(studentId) {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('attendance_logs')
    .select('*')
    .eq('student_id', studentId)
    .eq('log_date', today)
    .maybeSingle();
  return { data, error };
}

/**
 * Records a check-in for today. Inserts a new attendance_log row.
 * `locationSource` is 'gps' | 'manual'.
 * `distanceM` is Haversine distance from placement coords in metres (or null).
 */
export async function checkIn({ studentId, placementId, seasonId, lat, lon, locationSource, distanceM }) {
  const now   = new Date().toISOString();
  const today = now.split('T')[0];
  const status = distanceM !== null && distanceM > 200 ? 'flagged_location' : 'present';

  const { data, error } = await supabase
    .from('attendance_logs')
    .insert({
      student_id:                 studentId,
      placement_id:               placementId,
      season_id:                  seasonId,
      log_date:                   today,
      check_in_time:              now,
      check_in_lat:               lat,
      check_in_lon:               lon,
      check_in_location_source:   locationSource,
      distance_from_placement_m:  distanceM,
      status,
    })
    .select()
    .single();
  return { data, error };
}

/**
 * Records a check-out for an existing log row (identified by logId).
 */
export async function checkOut({ logId, lat, lon, locationSource }) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('attendance_logs')
    .update({
      check_out_time:             now,
      check_out_lat:              lat,
      check_out_lon:              lon,
      check_out_location_source:  locationSource,
    })
    .eq('id', logId)
    .select()
    .single();
  return { data, error };
}

/**
 * Returns all attendance logs for a student in a given season,
 * most recent first. Used for the attendance history table.
 */
export async function listAttendanceLogs(studentId, seasonId) {
  const { data, error } = await supabase
    .from('attendance_logs')
    .select('*')
    .eq('student_id', studentId)
    .eq('season_id', seasonId)
    .order('log_date', { ascending: false });
  return { data: data ?? [], error };
}

/**
 * Returns unresolved attendance flags for a student in a season.
 * Used on the student dashboard and admin anomaly panel.
 */
export async function listAttendanceFlags(studentId, seasonId) {
  const { data, error } = await supabase
    .from('attendance_flags')
    .select('*')
    .eq('student_id', studentId)
    .eq('season_id', seasonId)
    .is('resolved_at', null)
    .order('triggered_at', { ascending: false });
  return { data: data ?? [], error };
}

/**
 * Returns all unresolved attendance flags for admin dashboard view.
 * Admin-only (RLS: "attendance_flags: admin reads all").
 */
export async function listAllAttendanceFlags(seasonId) {
  let query = supabase
    .from('attendance_flags')
    .select(`
      *,
      profiles!attendance_flags_student_id_fkey ( full_name ),
      students!attendance_flags_student_id_fkey ( index_number )
    `)
    .is('resolved_at', null)
    .order('triggered_at', { ascending: false });
  if (seasonId) query = query.eq('season_id', seasonId);
  const { data, error } = await query;
  return { data: data ?? [], error };
}

/**
 * Marks an attendance flag as resolved (admin action).
 */
export async function resolveAttendanceFlag(flagId) {
  const now = new Date().toISOString();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('attendance_flags')
    .update({ resolved_at: now, resolved_by: user?.id })
    .eq('id', flagId)
    .select()
    .single();
  return { data, error };
}
