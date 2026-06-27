// =============================================================================
// IAMS — shared/services/logbook.service.js  (Phase 2)
// =============================================================================
// Digital logbook: weekly entries, daily activities, monthly summaries,
// and company supervisor certification. Tables in migration 000003.
// =============================================================================

import { supabase } from '../supabase-client.js';

// ── Convenience wrappers (Phase 2 UI interface) ───────────────────────────────

/**
 * Gets or creates the logbook week record for a student/season/week-number.
 * On first call for a given week, creates a draft row. Returns the row.
 * Uses the placement_id from the student's active placement for the season.
 *
 * @param {string} studentId
 * @param {string} seasonId
 * @param {string} placementId
 * @param {number} weekNumber  1-based week index
 * @param {Date}   weekStart   Monday of that week
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function getOrCreateWeek(studentId, seasonId, placementId, weekNumber, weekStart) {
  const monday = weekStart instanceof Date ? weekStart : new Date(weekStart);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  return upsertLogbookWeek({
    studentId,
    placementId,
    seasonId,
    weekNumber,
    weekStart:  monday.toISOString().split('T')[0],
    weekEnd:    sunday.toISOString().split('T')[0],
  });
}

/**
 * Updates the meta fields (dept_section, student_remarks) on a week row.
 * Only valid while status = 'draft' (enforced by RLS policy).
 *
 * @param {string} weekId
 * @param {{ dept_section?: string, student_remarks?: string }} meta
 */
export async function upsertWeekMeta(weekId, { dept_section, student_remarks } = {}) {
  const patch = {};
  if (dept_section    !== undefined) patch.department_section = dept_section;
  if (student_remarks !== undefined) patch.student_remarks    = student_remarks;

  const { data, error } = await supabase
    .from('logbook_weeks')
    .update(patch)
    .eq('id', weekId)
    .select()
    .single();
  return { data, error };
}

/**
 * Returns all daily entries for a given week, keyed by log_date.
 * Convenience wrapper around the existing supabase query.
 *
 * @param {string} weekId
 * @returns {Promise<{ data: object[], error: object|null }>}
 */
export async function getDailyEntriesForWeek(weekId) {
  const { data, error } = await supabase
    .from('logbook_daily_entries')
    .select('*')
    .eq('week_id', weekId)
    .order('log_date');
  return { data: data ?? [], error };
}

/**
 * Alias: submitWeek — matches the interface name in the build prompt.
 * Same as submitLogbookWeek.
 */
export { submitLogbookWeek as submitWeek };

// ── Weekly logbook ────────────────────────────────────────────────────────────

/**
 * Returns all logbook weeks for a student in a season, with their
 * daily entries nested. Ordered by week number.
 */
export async function listLogbookWeeks(studentId, seasonId) {
  const { data, error } = await supabase
    .from('logbook_weeks')
    .select('*, logbook_daily_entries(*)')
    .eq('student_id', studentId)
    .eq('season_id', seasonId)
    .order('week_number');
  return { data: data ?? [], error };
}

/** Returns a single logbook week by id. */
export async function getLogbookWeek(weekId) {
  const { data, error } = await supabase
    .from('logbook_weeks')
    .select('*, logbook_daily_entries(*)')
    .eq('id', weekId)
    .maybeSingle();
  return { data, error };
}

/**
 * Creates or updates a logbook week (upsert on student_id + season_id + week_number).
 * Only allowed while status is 'draft' (RLS + trigger).
 */
export async function upsertLogbookWeek({ studentId, placementId, seasonId, weekNumber, weekStart, weekEnd, departmentSection, studentRemarks }) {
  const { data, error } = await supabase
    .from('logbook_weeks')
    .upsert({
      student_id:         studentId,
      placement_id:       placementId,
      season_id:          seasonId,
      week_number:        weekNumber,
      week_start:         weekStart,
      week_end:           weekEnd,
      department_section: departmentSection ?? null,
      student_remarks:    studentRemarks ?? null,
    }, { onConflict: 'student_id,season_id,week_number' })
    .select()
    .single();
  return { data, error };
}

/**
 * Transitions a week from 'draft' to 'submitted'.
 * Company supervisor must then certify to move it to 'certified'.
 */
export async function submitLogbookWeek(weekId) {
  const { data, error } = await supabase
    .from('logbook_weeks')
    .update({ status: 'submitted' })
    .eq('id', weekId)
    .select()
    .single();
  return { data, error };
}

/**
 * Company supervisor certifies a submitted week.
 * Only the company_supervisor role may do this (RLS).
 */
export async function certifyLogbookWeek(weekId, certifiedByName) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('logbook_weeks')
    .update({
      status:                'certified',
      company_certified_by:  certifiedByName,
      company_certified_at:  now,
    })
    .eq('id', weekId)
    .select()
    .single();
  return { data, error };
}

// ── Daily entries ─────────────────────────────────────────────────────────────

/**
 * Saves or updates a single daily entry (upsert on week_id + log_date).
 * Only allowed while the parent week is in 'draft' status (RLS).
 */
export async function upsertDailyEntry({ weekId, logDate, activities }) {
  const { data, error } = await supabase
    .from('logbook_daily_entries')
    .upsert({ week_id: weekId, log_date: logDate, activities: activities ?? '' },
             { onConflict: 'week_id,log_date' })
    .select()
    .single();
  return { data, error };
}

// ── Monthly summaries ─────────────────────────────────────────────────────────

/**
 * Returns all monthly summaries for a student in a season.
 */
export async function listMonthlySummaries(studentId, seasonId) {
  const { data, error } = await supabase
    .from('logbook_monthly_summaries')
    .select('*')
    .eq('student_id', studentId)
    .eq('season_id', seasonId)
    .order('month_number');
  return { data: data ?? [], error };
}

/**
 * Upserts a monthly summary (student writes their own summary).
 */
export async function upsertMonthlySummary({ studentId, placementId, seasonId, monthNumber, studentSummary }) {
  const { data, error } = await supabase
    .from('logbook_monthly_summaries')
    .upsert({
      student_id:      studentId,
      placement_id:    placementId,
      season_id:       seasonId,
      month_number:    monthNumber,
      student_summary: studentSummary ?? null,
    }, { onConflict: 'student_id,season_id,month_number' })
    .select()
    .single();
  return { data, error };
}

/**
 * Company supervisor submits assessment for a monthly summary.
 */
export async function assessMonthlySummary(summaryId, { assessment, rating, supervisorName }) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('logbook_monthly_summaries')
    .update({
      supervisor_feedback:  assessment,
      company_supervisor_rating:      rating,
      company_supervisor_name:        supervisorName,
      company_supervisor_assessed_at: now,
      status: 'assessed',
    })
    .eq('id', summaryId)
    .select()
    .single();
  return { data, error };
}

/**
 * Returns weeks pending certification for the signed-in company supervisor.
 * Company supervisor sees logbooks for placements at their company
 * (joined via company_supervisors table, Phase 2).
 */
export async function listWeeksPendingCertification() {
  const { data, error } = await supabase
    .from('logbook_weeks')
    .select(`
      *, 
      profiles!logbook_weeks_student_id_fkey ( full_name ),
      students!logbook_weeks_student_id_fkey ( index_number )
    `)
    .eq('status', 'submitted')
    .order('week_start');
  return { data: data ?? [], error };
}
