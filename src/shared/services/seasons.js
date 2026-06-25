// =============================================================================
// IAMS — shared/services/seasons.js
// =============================================================================
// All Supabase calls for attachment seasons. Pages never call supabase
// directly (Section 10) — they call functions exported here instead.
//
// Business rules this service is aware of but does NOT itself enforce —
// the database is the source of truth for all of them; this file's job is
// to surface a clean error to the caller, not to re-implement RLS:
//   - at most one season may be 'open' at a time (seasons_one_open partial
//     unique index, schema.sql)
//   - placement_window must fall within [start_date, end_date]
//     (seasons_window_within_season constraint)
//   - start_date <= end_date (seasons_dates_ordered constraint)
//   - only admin may insert/update (RLS policies "seasons: admin inserts" /
//     "seasons: admin updates")
// =============================================================================

import { supabase } from '../supabase-client.js';
import { isDateRangeOrdered, isWindowWithinSeason } from '../utils.js';

/** Returns every season, most recently started first. All authenticated roles may read (FR1, "seasons: all authenticated users read"). */
export async function listSeasons() {
  const { data, error } = await supabase.from('seasons').select('*').order('start_date', { ascending: false });
  return { data, error };
}

/** Returns the single season currently marked 'open', or null if none is open (a valid state — e.g. between seasons). */
export async function getOpenSeason() {
  const { data, error } = await supabase.from('seasons').select('*').eq('status', 'open').maybeSingle();
  return { data, error };
}

/** Returns one season by id, or null if not found. */
export async function getSeasonById(seasonId) {
  const { data, error } = await supabase.from('seasons').select('*').eq('id', seasonId).maybeSingle();
  return { data, error };
}

/**
 * True if `season` currently has its placement submission window open —
 * i.e. status is 'open' AND today falls within
 * [placement_window_start, placement_window_end]. Mirrors the condition
 * in RLS policy "placements: student inserts own" so the UI can show/hide
 * the registration form in step with what the server would actually
 * accept, rather than only finding out after a failed insert.
 */
export function isPlacementWindowOpen(season) {
  if (!season || season.status !== 'open') return false;
  const today = new Date().toISOString().slice(0, 10);
  return today >= season.placement_window_start && today <= season.placement_window_end;
}

/**
 * Creates a new season. `status` defaults to 'upcoming' if not provided,
 * matching the schema.sql column default — an admin typically creates a
 * season before opening it, rather than opening it at creation time.
 *
 * Performs the same client-side checks the database constraints encode
 * (date ordering, window-within-season) before sending, so the admin gets
 * an immediate, specific error rather than a generic constraint-violation
 * message from a round trip. The insert can still fail server-side (e.g.
 * the single-open-season unique index, or a race with another admin
 * session) — callers must still check the returned `error`.
 */
export async function createSeason({ name, start_date, end_date, placement_window_start, placement_window_end, status }) {
  const row = { name, start_date, end_date, placement_window_start, placement_window_end };
  if (status) row.status = status;

  if (!isDateRangeOrdered(start_date, end_date)) {
    return { data: null, error: { message: 'Season start date must be on or before the end date.' } };
  }
  if (!isWindowWithinSeason(row)) {
    return {
      data: null,
      error: { message: 'Placement window must fall within the season dates, and window start must be on or before window end.' },
    };
  }

  const { data, error } = await supabase.from('seasons').insert(row).select().single();
  return { data, error };
}

/**
 * Updates a season's editable fields. Use openSeason()/closeSeason()/
 * archiveSeason() below for status-only transitions — this is for editing
 * name/dates/window on a season that isn't being transitioned.
 */
export async function updateSeason(seasonId, patch) {
  const merged = { ...patch };
  if (merged.start_date && merged.end_date && !isDateRangeOrdered(merged.start_date, merged.end_date)) {
    return { data: null, error: { message: 'Season start date must be on or before the end date.' } };
  }

  const { data, error } = await supabase.from('seasons').update(patch).eq('id', seasonId).select().single();
  return { data, error };
}

/**
 * Transitions a season to 'open'. The database's seasons_one_open partial
 * unique index is the real enforcement (schema.sql) — this will fail with
 * a constraint-violation error if another season is already open. The
 * admin UI is expected to close/archive the current open season first
 * (Section 9.7: "Admin UI prevents opening a second season while one is
 * already open").
 */
export async function openSeason(seasonId) {
  const { data, error } = await supabase.from('seasons').update({ status: 'open' }).eq('id', seasonId).select().single();
  return { data, error };
}

/** Transitions a season to 'closed' — the placement submission window has ended and the admin is about to begin batch review (FR6). */
export async function closeSeason(seasonId) {
  const { data, error } = await supabase.from('seasons').update({ status: 'closed' }).eq('id', seasonId).select().single();
  return { data, error };
}

/** Transitions a season to 'archived' — fully resolved, kept for institutional record (Objective 8). */
export async function archiveSeason(seasonId) {
  const { data, error } = await supabase.from('seasons').update({ status: 'archived' }).eq('id', seasonId).select().single();
  return { data, error };
}
