// =============================================================================
// IAMS — shared/services/zones.js
// =============================================================================
// All Supabase calls for zones and zone_supervisor assignments. Zones exist
// independently of any single season (FR6) — the admin defines them once
// and assigns school supervisors to one or more zones.
//
// Write access for both zones and zone_supervisors is admin-only at the RLS
// layer ("zones: admin inserts/updates/deletes", "zone_supervisors: admin
// inserts/deletes") — this service does not duplicate that check, it just
// surfaces whatever error the server returns to a non-admin caller.
// =============================================================================

import { supabase } from '../supabase-client.js';

/** Returns every zone, alphabetical by name. All authenticated roles may read (a student's assigned zone name needs to display on their placement). */
export async function listZones() {
  const { data, error } = await supabase.from('zones').select('*').order('name', { ascending: true });
  return { data, error };
}

/** Returns one zone by id, or null if not found. */
export async function getZoneById(zoneId) {
  const { data, error } = await supabase.from('zones').select('*').eq('id', zoneId).maybeSingle();
  return { data, error };
}

/** Creates a new zone. Fails server-side if the name isn't unique (mirrors the mock's uniqueness check on zones.name). */
export async function createZone({ name, description }) {
  const { data, error } = await supabase.from('zones').insert({ name, description }).select().single();
  return { data, error };
}

/** Updates a zone's name/description. */
export async function updateZone(zoneId, patch) {
  const { data, error } = await supabase.from('zones').update(patch).eq('id', zoneId).select().single();
  return { data, error };
}

/**
 * Deletes a zone. If placements or zone_supervisors still reference this
 * zone with a RESTRICT-style FK, deleting a zone that's still in use will
 * fail server-side — surface that error to the admin rather than masking it.
 */
export async function deleteZone(zoneId) {
  const { error } = await supabase.from('zones').delete().eq('id', zoneId);
  return { error };
}

// -----------------------------------------------------------------------
// zone_supervisors — junction table (zone_id, school_supervisor_id)
// -----------------------------------------------------------------------

/**
 * Returns every zone_supervisor assignment visible to the caller. Admins
 * see all; a school supervisor sees only their own assignments (RLS
 * "zone_supervisors: supervisor reads own"). There is no single query that
 * differentiates this for the caller — it's handled transparently by RLS,
 * same as every other read in this codebase.
 */
export async function listZoneSupervisors() {
  const { data, error } = await supabase.from('zone_supervisors').select('*');
  return { data, error };
}

/** Returns the zone_supervisor rows for a single zone — i.e. which supervisor(s) currently cover it. A zone may have zero (unsupervised, a known Phase 1 edge case) or more than one. */
export async function listSupervisorsForZone(zoneId) {
  const { data, error } = await supabase.from('zone_supervisors').select('*').eq('zone_id', zoneId);
  return { data, error };
}

/** Returns the zone_supervisor rows for a single supervisor — i.e. which zone(s) they cover. A supervisor may cover more than one zone (seed data exercises this). */
export async function listZonesForSupervisor(supervisorId) {
  const { data, error } = await supabase.from('zone_supervisors').select('*').eq('school_supervisor_id', supervisorId);
  return { data, error };
}

/**
 * Assigns a school supervisor to a zone. The referenced profile must have
 * role = 'school_supervisor' — enforced server-side by the
 * enforce_school_supervisor_role trigger (schema.sql); a mismatched role
 * surfaces as an error from this call rather than being checked here.
 */
export async function assignSupervisorToZone(zoneId, supervisorId) {
  const { data, error } = await supabase
    .from('zone_supervisors')
    .insert({ zone_id: zoneId, school_supervisor_id: supervisorId })
    .select()
    .single();
  return { data, error };
}

/** Removes a supervisor's assignment to a zone. Existing placements already assigned to that zone are unaffected — placement_supervisors is a live view, so they simply lose a supervisor at query time rather than being touched directly. */
export async function unassignSupervisorFromZone(zoneId, supervisorId) {
  const { error } = await supabase
    .from('zone_supervisors')
    .delete()
    .eq('zone_id', zoneId)
    .eq('school_supervisor_id', supervisorId);
  return { error };
}
