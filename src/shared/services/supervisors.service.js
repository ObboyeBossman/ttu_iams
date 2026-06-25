// =============================================================================
// IAMS — shared/services/supervisors.service.js
// =============================================================================
// Queries for school supervisor and company supervisor data.
// All write operations that touch zone_supervisors go through zones.js;
// this service is read-focused — dashboard stats, assigned students, etc.
// =============================================================================

import { supabase } from '../supabase-client.js';

/** Returns all profiles with role = 'school_supervisor', alphabetical. */
export async function listSupervisors() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, created_at')
    .eq('role', 'school_supervisor')
    .order('full_name');
  return { data: data ?? [], error };
}

/** Returns all profiles with role = 'company_supervisor', alphabetical. */
export async function listCompanySupervisors() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, created_at')
    .eq('role', 'company_supervisor')
    .order('full_name');
  return { data: data ?? [], error };
}

/**
 * Returns all placements in the signed-in supervisor's zones,
 * joined with student name and index number.
 * RLS "placements: supervisor reads assigned zone" scopes this automatically.
 */
export async function getSupervisorPlacements() {
  const { data, error } = await supabase
    .from('placements')
    .select(`
      id, company_name, nature_of_business, region, city_town,
      street_landmark, status, zone_id, start_date, end_date,
      location_source, latitude, longitude,
      profiles!placements_student_id_fkey ( id, full_name, phone ),
      students!placements_student_id_fkey ( index_number, department, programme, level ),
      zones ( name )
    `)
    .order('created_at', { ascending: false });
  return { data: data ?? [], error };
}

/**
 * Returns the student_profiles view rows for students whose placements
 * are in the signed-in supervisor's zones.
 * RLS "students: supervisor reads assigned" handles the scoping.
 */
export async function getSupervisorStudents() {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('*')
    .order('full_name');
  return { data: data ?? [], error };
}

/**
 * Returns zone assignments for the signed-in supervisor.
 * Used on the supervisor dashboard to show "Zones I cover".
 */
export async function getMyZones() {
  const { data, error } = await supabase
    .from('zone_supervisors')
    .select('zone_id, zones ( id, name, description )')
    .order('zone_id');
  return { data: data ?? [], error };
}

/**
 * Returns supervisor_visits for a placement (school supervisor view).
 * RLS scopes to supervisor's own visits.
 */
export async function listVisitsForPlacement(placementId) {
  const { data, error } = await supabase
    .from('supervisor_visits')
    .select('*')
    .eq('placement_id', placementId)
    .order('visit_date', { ascending: false });
  return { data: data ?? [], error };
}

/**
 * Logs a new supervisor site visit.
 */
export async function logVisit({ placementId, visitDate, observations, remarks, assessmentScore }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('supervisor_visits')
    .insert({
      placement_id:        placementId,
      school_supervisor_id: user?.id,
      visit_date:          visitDate,
      observations:        observations ?? null,
      remarks:             remarks ?? null,
      assessment_score:    assessmentScore ?? null,
    })
    .select()
    .single();
  return { data, error };
}
