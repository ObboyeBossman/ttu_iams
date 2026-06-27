// =============================================================================
// IAMS — shared/services/attendance.service.js  (Phase 2)
// =============================================================================
// Attendance logs, GPS check-in / check-out, absence logging, and flag reads.
// Tables created in migration 20260622000003_phase2_schema.sql +
//   20260626000002_attendance_absence_reason.sql
// All writes are student-only (RLS); admins and supervisors read.
// =============================================================================

import { supabase } from '../supabase-client.js';

/**
 * Returns today's attendance log for the signed-in student, or null if none.
 * Used to decide whether to show CHECK IN or CHECK OUT on the attendance page.
 *
 * @param {string} studentId
 * @param {string|null} [seasonId] - Optional: scoped to a season for safety
 */
export async function getTodayLog(studentId, seasonId) {
  const today = new Date().toISOString().split('T')[0];
  let query = supabase
    .from('attendance_logs')
    .select('*')
    .eq('student_id', studentId)
    .eq('log_date', today);

  if (seasonId) query = query.eq('season_id', seasonId);

  const { data, error } = await query.maybeSingle();
  return { data, error };
}

/**
 * Records a check-in for today. Inserts a new attendance_log row.
 * `locationSource` is 'gps' | 'manual'.
 * `distanceM` is Haversine distance from placement coords in metres (or null).
 *
 * Check-in distance threshold: > 500m → flagged_location status.
 */
export async function checkIn({ studentId, placementId, seasonId, lat, lon, locationSource, distanceM }) {
  const now   = new Date().toISOString();
  const today = now.split('T')[0];
  const status = distanceM !== null && distanceM > 500 ? 'flagged_location' : 'present';

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
 * Logs a voluntary absence for today with a documented reason.
 * Inserts a row with status = 'absent' and no check-in/check-out timestamps.
 *
 * @param {object} opts
 * @param {string} opts.studentId
 * @param {string} opts.placementId
 * @param {string} opts.seasonId
 * @param {string} opts.reason  - One of the predefined absence reason strings
 */
export async function logAbsence({ studentId, placementId, seasonId, reason }) {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('attendance_logs')
    .insert({
      student_id:     studentId,
      placement_id:   placementId,
      season_id:      seasonId,
      log_date:       today,
      status:         'absent',
      absence_reason: reason,
    })
    .select()
    .single();
  return { data, error };
}

/**
 * Returns all attendance logs for a student in a given season,
 * most recent first. Used for the attendance history calendar + list.
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
 * Used on the student attendance page and admin anomaly panel.
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
