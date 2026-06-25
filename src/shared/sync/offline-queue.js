// =============================================================================
// IAMS — shared/sync/offline-queue.js
// =============================================================================
// Four responsibilities, per Section 10's project structure:
//   1. Dexie.js draft store + auto-save logic
//   2. Sync-on-reconnect (via the `window online` event)
//   3. Background Sync API registration (via the service worker)
//   4. Incognito/private-browsing detection on page load
//
// This file owns the IndexedDB draft lifecycle for placement registration
// (FR3) end to end: open the draft, save every field change, attempt GPS
// at submit time, queue for sync, retry on reconnect, delete only on
// confirmed server success. It calls into
// shared/services/placements.js#syncPlacement() to actually talk to
// Supabase — this file never imports supabase-client.js directly, keeping
// "all Supabase calls go through services/*.js" (Section 10) true even
// for the offline path.
//
// Dexie is loaded via CDN/ESM per Section 9.1 ("no npm install or bundler
// required") — same pattern as supabase-client.js's esm.sh import for the
// non-mock branch.
// =============================================================================

import Dexie from 'https://esm.sh/dexie@4';
import { syncPlacement } from '../services/placements.js';
import { generateUuid } from '../utils.js';

// -----------------------------------------------------------------------
// Dexie database
// -----------------------------------------------------------------------
// One table, 'drafts', keyed by draft_id. Phase 1 only ever has one
// meaningful draft per student (Section 8: "each student is attached to
// one company per attachment season"), but the table itself isn't scoped
// to "one row total" — it's scoped to "one row per draft_id," same shape
// Phase 2's logbook entries will reuse (Section 9.5: "the same Dexie.js
// draft mechanism will be reused for offline logbook entries in Phase 2").
// student_id and season_id are indexed since findDraftForStudent() below
// queries by both.
const db = new Dexie('iams_offline_queue');
db.version(1).stores({
  drafts: 'draft_id, student_id, season_id, sync_status',
});

// -----------------------------------------------------------------------
// Sync status values for a draft row. Mirrors the three states FR3
// describes in prose ("Pending sync" / "Submitted") plus the implicit
// "still being edited, never attempted" state before first submission.
// -----------------------------------------------------------------------
export const DRAFT_STATUS = {
  LOCAL: 'local', // being edited, never attempted a sync
  PENDING_SYNC: 'pending_sync', // submit attempted while offline, or attempt failed mid-flight
  SUBMITTED: 'submitted', // server confirmed receipt — about to be deleted, see deletion note below
};

// -----------------------------------------------------------------------
// 4. Incognito / private-browsing detection
// -----------------------------------------------------------------------
// "On page load, the system attempts a small test write to IndexedDB to
// verify that local storage is available. If the test fails... a visible
// warning banner is displayed" (FR3). This function performs the test and
// returns a boolean — the actual banner is a page-script/UI concern, kept
// out of this file per the "leave out UI stuff" scoping for this pass.
const PRIVATE_BROWSING_TEST_TABLE = 'private_browsing_test';

export async function isStorageAvailable() {
  try {
    const testDb = new Dexie('iams_storage_test');
    testDb.version(1).stores({ [PRIVATE_BROWSING_TEST_TABLE]: 'id' });
    await testDb.open();
    await testDb.table(PRIVATE_BROWSING_TEST_TABLE).put({ id: 1, ts: Date.now() });
    await testDb.table(PRIVATE_BROWSING_TEST_TABLE).delete(1);
    testDb.close();
    return true;
  } catch (_err) {
    // Safari private mode, storage quota exhausted, or IndexedDB disabled
    // entirely all land here — FR3 doesn't distinguish the cause, just
    // "the test failed," so neither does this function.
    return false;
  }
}

// -----------------------------------------------------------------------
// 1. Draft store + auto-save
// -----------------------------------------------------------------------

/**
 * Finds the current student's existing draft for a season, if one exists.
 * Called on registration-page load per FR3: "the form immediately checks
 * for and restores any existing local draft." Returns null if none found
 * — a fresh draft should then be created via createDraft().
 */
export async function findDraftForStudent(studentId, seasonId) {
  const matches = await db.drafts.where({ student_id: studentId, season_id: seasonId }).toArray();
  // Should be at most one given the one-placement-per-student-per-season
  // rule (Section 8), but if more than one somehow exists (e.g. a
  // student switched devices and both wrote a draft before either
  // synced), return the most recently edited one — it's the version the
  // student was last actually looking at.
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.updated_at_local.localeCompare(a.updated_at_local));
  return matches[0];
}

/**
 * Creates a brand-new draft with a fresh client-generated draft_id (FR3:
 * "a client-generated UUID — is created and stored with the draft. This
 * ID persists for the entire lifetime of the draft"). Call this only
 * after findDraftForStudent() has confirmed none exists — calling it
 * again for the same student/season produces a second local draft row,
 * which is a bug in the calling page, not something this function guards
 * against (the registration page is expected to check first, exactly as
 * FR3 describes the load sequence).
 */
export async function createDraft({ studentId, seasonId }) {
  const now = new Date().toISOString();
  const draft = {
    draft_id: generateUuid(),
    student_id: studentId,
    season_id: seasonId,
    company_name: '',
    nature_of_business: '',
    region: '',
    city_town: '',
    street_landmark: '',
    contact_person: '',
    company_contact_phone: '',
    start_date: '',
    end_date: '',
    latitude: null,
    longitude: null,
    location_source: 'manual', // default until GPS capture succeeds at submit time
    sync_status: DRAFT_STATUS.LOCAL,
    created_at_local: now,
    updated_at_local: now,
  };
  await db.drafts.put(draft);
  return draft;
}

/**
 * Saves field-level changes to an existing draft. This is the function a
 * registration form calls on every meaningful field change (FR3: "the
 * form writes a local draft to IndexedDB... field by field, not only on
 * final submission"; Section 9.5: "the form writes a draft on every
 * meaningful field change"). Cheap and frequent by design — callers
 * should debounce keystroke-level calls themselves if needed; this
 * function does not debounce internally, since the right debounce
 * interval is a UI/UX decision this file shouldn't make on the form's
 * behalf.
 *
 * Refuses to touch a draft that's already 'submitted' — once the server
 * has confirmed receipt the local row is on its way out (see
 * attemptSync()'s deletion step) and shouldn't be resurrected by a stray
 * late field-change event.
 */
export async function saveDraftField(draftId, patch) {
  const existing = await db.drafts.get(draftId);
  if (!existing) {
    throw new Error(`offline-queue: no draft found for draft_id ${draftId} — call createDraft() first.`);
  }
  if (existing.sync_status === DRAFT_STATUS.SUBMITTED) {
    throw new Error('offline-queue: cannot edit a draft that has already been confirmed submitted.');
  }
  const updated = { ...existing, ...patch, updated_at_local: new Date().toISOString() };
  await db.drafts.put(updated);
  return updated;
}

/** Returns a draft by id, or undefined if not found. Thin pass-through so callers don't need to import Dexie's table API directly. */
export async function getDraft(draftId) {
  return db.drafts.get(draftId);
}

// -----------------------------------------------------------------------
// GPS capture (non-blocking) — FR3, Section 9.3
// -----------------------------------------------------------------------

/**
 * Attempts to capture GPS coordinates and writes the result into the
 * draft. Non-blocking by contract: this always resolves (never rejects)
 * within `timeoutMs`, with `{ captured: boolean }` describing what
 * happened — there is no error path a caller needs to catch, matching
 * FR3 ("the student is not blocked... If it fails or times out... the
 * placement proceeds on the structured text address alone").
 *
 * On success: draft.latitude/longitude are set and location_source
 * becomes 'gps'. On failure/timeout/unsupported browser: location_source
 * is explicitly set (back) to 'manual' with null coordinates — this
 * matters because a draft's default is already 'manual'/null (see
 * createDraft()), but calling this function makes that state a confirmed
 * outcome of an attempt rather than just "never tried," which is useful
 * for the page to distinguish if it wants to show "GPS unavailable" vs.
 * "GPS capture in progress."
 *
 * Does not surface a spinner/timeout/retry UI itself (NFR3) — that's a
 * page-script concern; this function's `timeoutMs` parameter is what a
 * retry button would call again with, not a UI element.
 */
export async function captureGpsForDraft(draftId, { timeoutMs = 10000 } = {}) {
  const draft = await db.drafts.get(draftId);
  if (!draft) {
    throw new Error(`offline-queue: no draft found for draft_id ${draftId}.`);
  }

  if (!('geolocation' in navigator)) {
    await saveDraftField(draftId, { latitude: null, longitude: null, location_source: 'manual' });
    return { captured: false, reason: 'unsupported' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await saveDraftField(draftId, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          location_source: 'gps',
        });
        finish({ captured: true });
      },
      async (_geoError) => {
        // Permission denied, position unavailable, etc. — all non-blocking per FR3.
        await saveDraftField(draftId, { latitude: null, longitude: null, location_source: 'manual' });
        finish({ captured: false, reason: 'denied_or_unavailable' });
      },
      { timeout: timeoutMs, maximumAge: 0, enableHighAccuracy: true }
    );
  });
}

// -----------------------------------------------------------------------
// Submission + sync
// -----------------------------------------------------------------------

/**
 * Attempts to submit a draft now. This is the single entry point both the
 * "Submit" button AND every automatic retry path (reconnect listener,
 * Background Sync relay) call — per FR3: "When synchronization eventually
 * fires, the most recent locally saved version is what gets submitted to
 * the server," so this function always reads the current Dexie row fresh
 * rather than accepting a row snapshot as a parameter, which would risk
 * submitting a stale version if the student kept editing while offline.
 *
 * Behavior:
 *  - offline right now -> marks the draft PENDING_SYNC and returns
 *    immediately without attempting a network call at all.
 *  - online, call fails (network drop mid-flight, server validation
 *    error, etc.) -> marks PENDING_SYNC, draft stays in IndexedDB intact,
 *    returns the error for the caller to display.
 *  - online, call succeeds -> per FR3 ("the local draft is deleted only
 *    after Supabase returns a confirmed success response"), marks
 *    SUBMITTED and deletes the local row, returns the server's placement
 *    row.
 *
 * Safe to call repeatedly for the same draft_id even after a previous
 * silent success — placements.syncPlacement() treats a duplicate draft_id
 * insert as a no-op success (mirrors the mock/DB UNIQUE constraint
 * behavior documented in FR3), so a Background Sync firing twice, or a
 * duplicate tab racing the reconnect listener, can't create a duplicate
 * placement row.
 */
export async function attemptSync(draftId) {
  const draft = await db.drafts.get(draftId);
  if (!draft) {
    return { ok: false, error: { message: `No local draft found for draft_id ${draftId}.` } };
  }
  if (draft.sync_status === DRAFT_STATUS.SUBMITTED) {
    // Already confirmed and should have been deleted — defensive no-op
    // rather than re-submitting.
    return { ok: true, data: null, alreadySubmitted: true };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await db.drafts.update(draftId, { sync_status: DRAFT_STATUS.PENDING_SYNC });
    registerBackgroundSync(); // best-effort — see registerBackgroundSync() below
    return { ok: false, offline: true };
  }

  const { draft_id, student_id, season_id, sync_status, created_at_local, updated_at_local, ...placementFields } = draft;
  const row = {
    draft_id,
    student_id,
    season_id,
    ...placementFields,
  };

  const { data, error } = await syncPlacement(row);

  if (error) {
    await db.drafts.update(draftId, { sync_status: DRAFT_STATUS.PENDING_SYNC });
    registerBackgroundSync();
    return { ok: false, error };
  }

  // Confirmed success — delete the local draft only now, per FR3's
  // explicit ordering requirement.
  await db.drafts.delete(draftId);
  return { ok: true, data };
}

// -----------------------------------------------------------------------
// 2. Sync-on-reconnect (`window online` listener)
// -----------------------------------------------------------------------

let _reconnectListenerAttached = false;

/**
 * Attaches the `window online` backstop listener (Section 9.5: "the
 * window online listener also runs as a backstop whenever the tab is
 * open, regardless of platform... where Background Sync is unavailable
 * entirely... that window online listener is the only mechanism"). Call
 * once at app/page startup. Idempotent — calling more than once does not
 * attach duplicate listeners.
 *
 * On 'online', sweeps every locally stored draft (not just one) and
 * attempts to sync each — in Phase 1 this is normally at most one row per
 * student, but the sweep itself doesn't assume that, since Phase 2 reuses
 * this same draft mechanism for logbook entries (Section 9.5) which won't
 * have a one-row-per-user limit.
 */
export function attachReconnectListener() {
  if (_reconnectListenerAttached) return;
  if (typeof window === 'undefined') return; // no-op outside a browser context
  window.addEventListener('online', () => {
    flushPendingDrafts();
  });
  _reconnectListenerAttached = true;
}

/** Attempts to sync every locally stored draft that isn't already confirmed submitted. Used both by the reconnect listener and by the Background Sync message relay below — both are "connectivity might be back, try everything" triggers. */
export async function flushPendingDrafts() {
  const allDrafts = await db.drafts.toArray();
  const results = [];
  for (const draft of allDrafts) {
    if (draft.sync_status === DRAFT_STATUS.SUBMITTED) continue;
    results.push(await attemptSync(draft.draft_id));
  }
  return results;
}

// -----------------------------------------------------------------------
// 3. Background Sync registration (via the service worker)
// -----------------------------------------------------------------------

const SYNC_TAG = 'iams-sync-placements';
let _swMessageListenerAttached = false;

/**
 * Registers a Background Sync request with the service worker (sw.js),
 * and wires up the message channel so that when sw.js's 'sync' event
 * handler relays back ("the event fired, try syncing"), this page calls
 * flushPendingDrafts() in response.
 *
 * Best-effort by design (Section 9.5: "even on Android Chrome, this is
 * best-effort rather than guaranteed"). Silently no-ops if the
 * Background Sync API isn't supported (Safari, Firefox) — the `window
 * online` listener above is the universal fallback in that case, exactly
 * as documented, so this function failing to register is an expected,
 * non-error outcome on those browsers, not something callers need to
 * handle specially.
 */
export async function registerBackgroundSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return { registered: false };

  try {
    const registration = await navigator.serviceWorker.ready;
    if (!('sync' in registration)) {
      // Background Sync unsupported on this browser — window online
      // listener is the only mechanism here, per Section 9.5.
      return { registered: false };
    }
    await registration.sync.register(SYNC_TAG);
    attachServiceWorkerMessageListener();
    return { registered: true };
  } catch (_err) {
    // Permission denied, registration failure, etc. — still non-fatal;
    // the reconnect listener remains the backstop.
    return { registered: false };
  }
}

/** Listens for the relay message sw.js's 'sync' handler posts to every open client, and triggers a flush in response. Idempotent — safe to call from multiple places (e.g. both registerBackgroundSync() and an explicit page-startup call) without double-attaching. */
export function attachServiceWorkerMessageListener() {
  if (_swMessageListenerAttached) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'IAMS_BACKGROUND_SYNC_FIRED') {
      flushPendingDrafts();
    }
  });
  _swMessageListenerAttached = true;
}

/**
 * Registers sw.js itself. Call once at app startup (any page, not just
 * the registration page — Section 9.5 describes the worker as caching
 * static assets generally, not a placement-registration-only concern).
 * No-ops outside a secure context / unsupported browser rather than
 * throwing, since service worker support is not guaranteed across every
 * target browser (Section 9.5 names Safari/Firefox as lacking Background
 * Sync specifically, and older browsers may lack service workers
 * entirely).
 */
export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return { registered: false };
  try {
    await navigator.serviceWorker.register('/sw.js');
    return { registered: true };
  } catch (_err) {
    return { registered: false };
  }
}

// -----------------------------------------------------------------------
// Convenience bootstrap
// -----------------------------------------------------------------------

/**
 * Call once from the registration page's startup sequence. Wires up
 * everything except the actual form/draft creation, which is page-specific:
 *   - registers the service worker
 *   - attaches the window-online reconnect listener
 *   - attaches the Background Sync message relay listener
 *   - immediately attempts a flush, in case drafts were left PENDING_SYNC
 *     from a previous session that's now back online
 * Returns the result of isStorageAvailable() so the calling page can show
 * the private-browsing warning banner (FR3) without a second call.
 */
export async function initOfflineQueue() {
  const storageOk = await isStorageAvailable();
  attachReconnectListener();
  attachServiceWorkerMessageListener();
  await registerServiceWorker();
  if (storageOk && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    await flushPendingDrafts();
  }
  return { storageAvailable: storageOk };
}