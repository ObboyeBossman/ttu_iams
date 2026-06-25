// =============================================================================
// IAMS — shared/utils.js
// =============================================================================
// Shared validation, date helpers, and formatting utilities (per Section 10
// of the project structure). No Supabase calls here and no DOM/UI work —
// this file is imported by services/*.js (validation before a write) and,
// later, by page scripts (formatting for display). Keeping it framework-free
// and side-effect-free means it works identically in both places.
// =============================================================================

// -----------------------------------------------------------------------
// Date helpers
// -----------------------------------------------------------------------

/** Today's date as 'YYYY-MM-DD', matching Postgres `date` column format. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** True if `dateStr` ('YYYY-MM-DD') falls within [startStr, endStr], inclusive. */
export function isDateWithin(dateStr, startStr, endStr) {
  return dateStr >= startStr && dateStr <= endStr;
}

/**
 * Formats an ISO date or timestamp string for display, e.g. '2026-06-21' ->
 * '21 Jun 2026'. Returns '—' for null/undefined so callers can drop this
 * straight into a template without a null check at every call site.
 */
export function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Formats an ISO timestamp for display with time, e.g. '21 Jun 2026, 14:30'. */
export function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  const datePart = formatDate(isoStr);
  const timePart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart}, ${timePart}`;
}

/** Relative "time ago" string for recent timestamps, e.g. '3 minutes ago'. Falls back to formatDate for anything over a week old. */
export function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const then = new Date(isoStr).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return formatDate(isoStr);
}

// -----------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------
// Client-side validation mirrors (not a replacement for) the database
// constraints in schema.sql — NFR6 requires invalid data never reach a
// save attempt, but the database is still the source of truth. Each
// function here is named after the constraint it mirrors so the two stay
// easy to cross-check by eye.

const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;
const VERIFICATION_CODE_RE = /^[A-Z0-9]{8}$/;

/** True if `value` is present and not just whitespace. */
export function isRequired(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

/** Loose phone format check — accepts digits, spaces, +, -, (). Not a strict E.164 validator; matches what the seed data and a Ghanaian phone number actually look like. */
export function isValidPhone(value) {
  return typeof value === 'string' && PHONE_RE.test(value.trim());
}

/** Basic email shape check. Real verification happens via Supabase Auth, not here. */
export function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Mirrors constraint letters_verification_code_format: ^[A-Z0-9]{8}$ */
export function isValidVerificationCode(value) {
  return typeof value === 'string' && VERIFICATION_CODE_RE.test(value.trim());
}

/** Mirrors constraint seasons_dates_ordered: start_date <= end_date */
export function isDateRangeOrdered(startStr, endStr) {
  return Boolean(startStr) && Boolean(endStr) && startStr <= endStr;
}

/**
 * Mirrors constraint seasons_window_within_season: the placement window
 * must fall fully inside the season's own date range, and the window's
 * own start must not be after its end.
 */
export function isWindowWithinSeason({ start_date, end_date, placement_window_start, placement_window_end }) {
  return (
    placement_window_start >= start_date &&
    placement_window_end <= end_date &&
    placement_window_start <= placement_window_end
  );
}

/**
 * Mirrors constraint placements_location_consistency: a placement is either
 * 'manual' with no coordinates, or 'gps' with both coordinates set — no
 * third state. Mirrors the Rev. 8 tightening in the spec (Section 11).
 */
export function isLocationConsistent({ latitude, longitude, location_source }) {
  const noCoords = latitude === null && longitude === null;
  const hasCoords = latitude !== null && longitude !== null && latitude !== undefined && longitude !== undefined;
  return (noCoords && location_source === 'manual') || (hasCoords && location_source === 'gps');
}

/**
 * Validates the structured address fields required by FR2 and FR3 alike
 * (region, city/town, street/landmark). Returns an array of field names
 * that are missing/invalid — empty array means valid. Returning a list
 * rather than a boolean lets a form highlight every bad field at once
 * instead of one validation pass per field.
 */
export function validateAddressFields({ region, city_town, street_landmark }) {
  const problems = [];
  if (!isRequired(region)) problems.push('region');
  if (!isRequired(city_town)) problems.push('city_town');
  if (!isRequired(street_landmark)) problems.push('street_landmark');
  return problems;
}

// -----------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------

const STATUS_LABELS = {
  // placements.status
  submitted: 'Submitted',
  flagged: 'Flagged',
  rejected: 'Rejected',
  assigned: 'Assigned',
  // seasons.status
  upcoming: 'Upcoming',
  open: 'Open',
  closed: 'Closed',
  archived: 'Archived',
};

/** Human-readable label for a placement/season status code. Falls back to the raw value for anything unrecognized rather than throwing. */
export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status ?? '—';
}

/** Title-cases a role code for display, e.g. 'school_supervisor' -> 'School Supervisor'. */
export function roleLabel(role) {
  if (!role) return '—';
  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Formats a full address from the three structured fields used on both placements and letters. */
export function formatAddress({ street_landmark, city_town, region }) {
  return [street_landmark, city_town, region].filter(Boolean).join(', ');
}

/**
 * Returns a CSS-friendly severity tier for an escalating count display
 * (FR2: the student's letter count visually escalates neutral -> amber ->
 * red as it rises, with no hard limit). Thresholds are a UI nudge only —
 * there is no enforcement or admin alert tied to these values.
 */
export function letterCountTier(count) {
  if (count >= 8) return 'danger';
  if (count >= 4) return 'warning';
  return 'neutral';
}

// -----------------------------------------------------------------------
// Misc
// -----------------------------------------------------------------------

/** Generates a client-side UUID for draft_id / idempotency-key style fields. Thin wrapper so callers don't reach for crypto.randomUUID() directly all over the codebase. */
export function generateUuid() {
  return crypto.randomUUID();
}

/** True if `error` is the shape returned by the Supabase/mock client ({ message }), for narrowing in catch blocks and service error handling. */
export function isSupabaseError(error) {
  return Boolean(error) && typeof error === 'object' && typeof error.message === 'string';
}

/** Generates an 8-character uppercase alphanumeric code for letter verification. */
export function generateVerificationCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/** 
 * Displays a toast notification. 
 * Requires Toastify JS to be loaded (which is in index.html and shell.js typically) 
 * or falls back to alert if not available.
 */
export function showToast(message, type = 'info') {
  if (typeof window.Toastify === 'function') {
    let background = '#3A5CB0'; // info
    if (type === 'success') background = '#1A7A4A';
    if (type === 'warning') background = '#E67E22';
    if (type === 'error') background = '#C0392B';

    window.Toastify({
      text: message,
      duration: 3000,
      close: true,
      gravity: 'bottom',
      position: 'right',
      style: { background, borderRadius: '4px' },
      className: 'toastify'
    }).showToast();
  } else {
    // Fallback if Toastify isn't loaded
    console.log(`[Toast ${type.toUpperCase()}] ${message}`);
    if (type === 'error') alert(`Error: ${message}`);
  }
}
