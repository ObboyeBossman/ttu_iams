// =============================================================================
// IAMS — shared/services/placements.js
// =============================================================================
// All Supabase calls for placements: CRUD + status transitions (per Section
// 10's file tree comment). This is the server-facing half of FR3 — the
// actual offline draft queue (Dexie, auto-save, Background Sync) is a
// separate concern living in shared/sync/offline-queue.js, which calls into
// syncPlacement() below only once it has a complete row ready to send.
//
// Status lifecycle (FR6, schema.sql validate_placement_status_transition):
//   submitted -> assigned | flagged | rejected
//   flagged   -> assigned | rejected
//   assigned / rejected are terminal. No reversion to submitted.
// Enforced server-side by a trigger — checkPlacementStatusTransition()
// below is a client-side mirror so a doomed transition can be rejected in
// the UI before a round trip, not a replacement for the trigger.
// =============================================================================

import { supabase } from '../supabase-client.js';
import { isDateRangeOrdered, isLocationConsistent, validateAddressFields } from '../utils.js';

// -----------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------

/** Returns every placement visible to the caller (RLS-scoped: student sees own, admin sees all, school supervisor sees their assigned zones — see "placements: supervisor reads assigned zone"). */
export async function listPlacements() {
  const { data, error } = await supabase.from('placements').select('*').order('created_at', { ascending: false });
  return { data, error };
}

/** Returns placements for a single season — the shape the admin's batch-review screen (FR6) works from once a submission window closes. */
export async function listPlacementsBySeason(seasonId) {
  const { data, error } = await supabase
    .from('placements')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false });
  return { data, error };
}

/** Returns placements with a given status, optionally scoped to one season. Used for the admin dashboard's "grouped by status" view (FR7) and the batch-assignment screen's "submitted, awaiting review" queue. */
export async function listPlacementsByStatus(status, seasonId = null) {
  let query = supabase.from('placements').select('*').eq('status', status);
  if (seasonId) query = query.eq('season_id', seasonId);
  const { data, error } = await query.order('created_at', { ascending: false });
  return { data, error };
}

/** Returns the signed-in student's own placement for a given season, or null if they haven't registered one yet. A student has at most one placement per season (placements_one_per_student_per_season constraint, Section 8: "each student is attached to one company per attachment season"). */
export async function getOwnPlacementForSeason(studentId, seasonId) {
  const { data, error } = await supabase
    .from('placements')
    .select('*')
    .eq('student_id', studentId)
    .eq('season_id', seasonId)
    .maybeSingle();
  return { data, error };
}

/** Returns one placement by id, or null if not found / not visible to the caller. */
export async function getPlacementById(placementId) {
  const { data, error } = await supabase.from('placements').select('*').eq('id', placementId).maybeSingle();
  return { data, error };
}

/**
 * Returns the current supervisor(s) for a placement via the
 * placement_supervisors view, which derives this live from zone_id +
 * zone_supervisors rather than a stored column (Rev. 8, Section 11: the
 * removed placements.school_supervisor_id). May return more than one row
 * if the placement's zone has multiple supervisors assigned.
 */
export async function getSupervisorsForPlacement(placementId) {
  const { data, error } = await supabase.from('placement_supervisors').select('*').eq('placement_id', placementId);
  return { data, error };
}

// -----------------------------------------------------------------------
// Client-side validation mirrors
// -----------------------------------------------------------------------
// Same rationale as seasons.js: these mirror DB constraints so a student
// gets immediate, specific feedback instead of a round-trip error. The
// database constraints (schema.sql) remain the actual enforcement.

/**
 * Validates a placement row shape before insert/update, mirroring
 * placements_dates_ordered, placements_location_consistency, and the
 * structured-address requirement from FR3. Returns an array of problem
 * messages — empty array means the row looks insertable. Does NOT check
 * placements_one_per_student_per_season or draft_id uniqueness, since
 * those require a round trip against existing rows; the server is the
 * right place to surface those.
 */
export function validatePlacementRow(row) {
  const problems = [];

  const addressProblems = validateAddressFields(row);
  if (addressProblems.length > 0) {
    problems.push(`Missing required address field(s): ${addressProblems.join(', ')}`);
  }
  if (!row.company_name?.trim()) problems.push('Company name is required.');
  if (!row.nature_of_business?.trim()) problems.push('Nature of business is required.');

  if (row.start_date && row.end_date && !isDateRangeOrdered(row.start_date, row.end_date)) {
    problems.push('Start date must be on or before the end date.');
  }
  if (!isLocationConsistent(row)) {
    problems.push('Location data is inconsistent — this should not happen from the registration form; clear GPS state and retry.');
  }

  return problems;
}

// -----------------------------------------------------------------------
// Writes — student-facing (FR3)
// -----------------------------------------------------------------------

/**
 * Submits a placement (insert). `row` must already include `draft_id`
 * (the client-generated UUID created when the draft was first opened —
 * see FR3) and `student_id`. `status` is always forced to 'submitted'
 * here regardless of what's passed in — a placement only ever *enters*
 * the system this way; every later status change is a separate admin
 * action via transitionPlacementStatus() below.
 *
 * This is the function offline-queue.js calls once connectivity is
 * available and a queued draft is ready to send. Per FR3's idempotency
 * guarantee, the mock/server treats a duplicate draft_id as a no-op
 * success (existing row returned) rather than an error — so a retry from
 * the offline queue after a connection drop mid-flight is always safe to
 * call again with the same draft_id.
 */
export async function syncPlacement(row) {
  const problems = validatePlacementRow(row);
  if (problems.length > 0) {
    return { data: null, error: { message: problems.join(' ') } };
  }
  if (!row.draft_id) {
    return { data: null, error: { message: 'draft_id is required — placement was not created through the draft flow.' } };
  }

  const payload = { ...row, status: 'submitted' };
  const { data, error } = await supabase.from('placements').insert(payload).select().single();
  
  if (error && error.code === '23505' && error.message.includes('placements_draft_id_key')) {
    const { data: existing, error: fetchErr } = await supabase.from('placements').select('*').eq('draft_id', row.draft_id).single();
    if (!fetchErr && existing && existing.latitude && existing.longitude) {
      // Fire and forget
      supabase.functions.invoke('geocode-placement', { body: { record: existing } }).catch(console.error);
    }
    return { data: existing, error: fetchErr };
  }
  
  if (!error && data && data.latitude && data.longitude) {
    // Fire and forget geocoding
    supabase.functions.invoke('geocode-placement', { body: { record: data } }).catch(console.error);
  }

  return { data, error };
}

/**
 * Updates the signed-in student's own placement while it is still
 * 'submitted'. RLS ("placements: student updates own while submitted")
 * only allows this while status = 'submitted', and a trigger
 * (lock_admin_only_placement_fields) silently reverts zone_id and
 * synced_at to their prior values regardless of what's sent — so this
 * function does not attempt to set either field; the server drops them if
 * present rather than erroring, matching the trigger's documented
 * behavior ("silent revert, not a throw").
 */
export async function updateOwnPlacement(placementId, patch) {
  const { zone_id, synced_at, status, student_id, ...safePatch } = patch;

  // Validate only the fields actually present in this partial update —
  // explicit per-field checks rather than re-running validatePlacementRow()
  // (which expects a full row) and trying to guess which of its messages
  // are "relevant" to this call. A partial update of just company_name
  // shouldn't fail because start_date/end_date weren't included.
  const problems = [];
  const touchedAddressFields = ['region', 'city_town', 'street_landmark'].filter((f) => f in safePatch);
  if (touchedAddressFields.some((f) => !safePatch[f]?.trim())) {
    problems.push(`Missing required address field(s): ${touchedAddressFields.filter((f) => !safePatch[f]?.trim()).join(', ')}`);
  }
  if ('company_name' in safePatch && !safePatch.company_name?.trim()) {
    problems.push('Company name is required.');
  }
  if ('nature_of_business' in safePatch && !safePatch.nature_of_business?.trim()) {
    problems.push('Nature of business is required.');
  }
  if ('start_date' in safePatch && 'end_date' in safePatch && !isDateRangeOrdered(safePatch.start_date, safePatch.end_date)) {
    problems.push('Start date must be on or before the end date.');
  }
  if (('latitude' in safePatch || 'longitude' in safePatch || 'location_source' in safePatch)) {
    // location fields only make sense validated together — if the caller
    // is touching any one of them, all three should be present.
    const hasAll = 'latitude' in safePatch && 'longitude' in safePatch && 'location_source' in safePatch;
    if (!hasAll || !isLocationConsistent(safePatch)) {
      problems.push('Location data is inconsistent — all of latitude, longitude, and location_source must be updated together and agree.');
    }
  }

  if (problems.length > 0) {
    return { data: null, error: { message: problems.join(' ') } };
  }

  const { data, error } = await supabase.from('placements').update(safePatch).eq('id', placementId).select().single();
  
  if (!error && data && ('latitude' in safePatch || 'longitude' in safePatch) && data.latitude && data.longitude) {
    // Fire and forget geocoding if location was updated
    supabase.functions.invoke('geocode-placement', { body: { record: data } }).catch(console.error);
  }

  return { data, error };
}

// -----------------------------------------------------------------------
// Writes — admin-facing batch review (FR6)
// -----------------------------------------------------------------------

/** Mirrors validate_placement_status_transition (schema.sql): submitted -> assigned/flagged/rejected; flagged -> assigned/rejected. Client-side check so a doomed transition is caught before the round trip. */
export function isValidStatusTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const allowed = { submitted: ['assigned', 'flagged', 'rejected'], flagged: ['assigned', 'rejected'] };
  return Boolean(allowed[fromStatus]?.includes(toStatus));
}

/**
 * Assigns a placement to a zone, transitioning its status to 'assigned'.
 * The supervisor is never set directly — it's derived from zone_id via
 * zone_supervisors at query time (placement_supervisors view, Rev. 8).
 * Admin-only at the RLS layer ("placements: admin updates all").
 */
export async function assignPlacementToZone(placementId, zoneId) {
  const { data, error } = await supabase
    .from('placements')
    .update({ status: 'assigned', zone_id: zoneId })
    .eq('id', placementId)
    .select()
    .single();
  return { data, error };
}

/** Marks a placement 'flagged' — needs clarification from the student, resolved outside the system in Phase 1 (FR6: "the Admin contacts the student directly"). */
export async function flagPlacement(placementId) {
  const { data, error } = await supabase.from('placements').update({ status: 'flagged' }).eq('id', placementId).select().single();
  return { data, error };
}

/** Marks a placement 'rejected' — invalid or fraudulent, terminal in Phase 1 (no in-system resubmission). */
export async function rejectPlacement(placementId) {
  const { data, error } = await supabase.from('placements').update({ status: 'rejected' }).eq('id', placementId).select().single();
  return { data, error };
}

/**
 * Batch-assigns multiple placements to the same zone in one pass — the
 * primary admin workflow described in FR6 ("Assignment happens in batch,
 * after the Liaison Office has full visibility of every student's
 * company"). Runs each assignment independently and collects per-row
 * results rather than wrapping all of them in a single all-or-nothing
 * operation, since the mock/Supabase REST surface here has no multi-row
 * transactional update primitive exposed to the client — one bad row
 * (e.g. an already-terminal placement) shouldn't block the rest of the
 * batch from succeeding.
 */
export async function batchAssignToZone(placementIds, zoneId) {
  const results = await Promise.all(
    placementIds.map(async (id) => {
      const { data, error } = await assignPlacementToZone(id, zoneId);
      return { placementId: id, data, error };
    })
  );
  const succeeded = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  return { succeeded, failed };
}
