// =============================================================================
// IAMS — src/modules/student/placement.js
// FR3: Placement Registration — offline-capable with Dexie auto-save
// =============================================================================

import { requireRole, getCurrentUserId } from '/modules/auth/auth-guard.js';
import { initShell }                      from '/shell/nav.js';
import { getOpenSeason, isPlacementWindowOpen } from '/shared/services/seasons.js';
import { getOwnPlacementForSeason } from '/shared/services/placements.js';
import { initOfflineQueue, findDraftForStudent, createDraft, saveDraftField, attemptSync, captureGpsForDraft } from '/shared/sync/offline-queue.js';
import { showToast, formatDate, isRequired, isValidPhone, isDateRangeOrdered } from '/shared/utils.js';

// ── State ─────────────────────────────────────────────────────────────────────
let currentSeason  = null;
let currentUserId  = null;
let draftId        = null;
let isSubmitting   = false;
let isOffline      = !navigator.onLine;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const pageLoading       = document.getElementById('page-loading');
const incognitoBanner   = document.getElementById('incognito-banner');
const windowClosedBanner= document.getElementById('window-closed-banner');
const windowClosedMsg   = document.getElementById('window-closed-msg');
const pendingBadge      = document.getElementById('pending-badge');
const submittedState    = document.getElementById('submitted-state');
const submittedSummary  = document.getElementById('submitted-summary');
const formHeader        = document.getElementById('form-header');
const placementCard     = document.getElementById('placement-card');
const placementForm     = document.getElementById('placement-form');
const submitBtn         = document.getElementById('submit-btn');
const submitSpinner     = document.getElementById('submit-spinner');
const submitIcon        = document.getElementById('submit-icon');
const formError         = document.getElementById('form-error');
const formErrorMsg      = document.getElementById('form-error-msg');
const gpsStatus         = document.getElementById('gps-status');
const gpsStatusMsg      = document.getElementById('gps-status-msg');

// ── Field IDs ─────────────────────────────────────────────────────────────────
const FIELD_IDS = [
  'company_name','nature_of_business','region','city_town',
  'street_landmark','contact_person','company_contact_phone',
  'start_date','end_date'
];

const FIELD_VALIDATORS = {
  company_name:          (v) => isRequired(v),
  nature_of_business:    (v) => isRequired(v),
  region:                (v) => isRequired(v),
  city_town:             (v) => isRequired(v),
  street_landmark:       (v) => isRequired(v),
  contact_person:        (v) => isRequired(v),
  company_contact_phone: (v) => isValidPhone(v),
  start_date:            (v) => isRequired(v),
  end_date:              (v) => isRequired(v),
};

const FIELD_LABELS = {
  company_name:          'Company name',
  nature_of_business:    'Nature of business',
  region:                'Region',
  city_town:             'City / Town',
  street_landmark:       'Street / Landmark',
  contact_person:        'Contact person',
  company_contact_phone: 'Company phone',
  start_date:            'Start date',
  end_date:              'End date',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function setLoading(on) {
  if (pageLoading) pageLoading.style.display = on ? 'flex' : 'none';
}

function setSubmitting(on) {
  isSubmitting = on;
  submitBtn.disabled          = on;
  submitSpinner.style.display = on ? 'inline-block' : 'none';
  submitIcon.style.display    = on ? 'none' : '';
}

function getFieldValue(id) {
  return (document.getElementById(id)?.value ?? '').trim();
}

function showFieldError(id, msg) {
  const errEl = document.getElementById(`err-${id}`);
  const input = document.getElementById(id);
  if (errEl) { errEl.textContent = msg; errEl.style.display = msg ? 'block' : 'none'; }
  if (input) input.classList.toggle('field-input--error', Boolean(msg));
}

function validateAll() {
  let valid = true;
  for (const id of FIELD_IDS) {
    const val = getFieldValue(id);
    if (!FIELD_VALIDATORS[id](val)) {
      showFieldError(id, `${FIELD_LABELS[id]} is required and must be valid.`);
      valid = false;
    } else {
      showFieldError(id, '');
    }
  }
  // Cross-field date check
  const s = getFieldValue('start_date'), e = getFieldValue('end_date');
  if (s && e && !isDateRangeOrdered(s, e)) {
    showFieldError('end_date', 'End date must be on or after the start date.');
    valid = false;
  }
  return valid;
}

function updateSubmitState() {
  if (isSubmitting) return;
  const allFilled = FIELD_IDS.every((id) => FIELD_VALIDATORS[id](getFieldValue(id)));
  const s = getFieldValue('start_date'), e = getFieldValue('end_date');
  const datesOk = !s || !e || isDateRangeOrdered(s, e);
  submitBtn.disabled = !allFilled || !datesOk || !currentSeason;
}

// ── Draft helpers ─────────────────────────────────────────────────────────────
function populateForm(draft) {
  for (const id of FIELD_IDS) {
    const el = document.getElementById(id);
    if (el && draft[id] !== undefined) el.value = draft[id];
  }
  updateSubmitState();
}

async function autoSave() {
  if (!draftId) return;
  try {
    const patch = {};
    for (const id of FIELD_IDS) {
      patch[id] = getFieldValue(id);
    }
    await saveDraftField(draftId, patch);
  } catch (e) {
    console.warn('[placement] Auto-save error:', e);
  }
}

// ── Sync / submit ─────────────────────────────────────────────────────────────

function showSubmittedState(placement) {
  formHeader.style.display = 'none';
  placementCard.style.display = 'none';
  pendingBadge.style.display  = 'none';
  submittedState.style.display = 'block';

  submittedSummary.innerHTML = `
    <div class="summary-grid">
      <div><strong>Company</strong><span>${escHtml(placement?.company_name ?? '')}</span></div>
      <div><strong>Region</strong><span>${escHtml(placement?.region ?? '')}</span></div>
      <div><strong>City</strong><span>${escHtml(placement?.city_town ?? '')}</span></div>
      <div><strong>Start</strong><span>${formatDate(placement?.start_date)}</span></div>
      <div><strong>End</strong><span>${formatDate(placement?.end_date)}</span></div>
      <div><strong>GPS</strong><span>${placement?.location_source === 'gps' ? '✓ Captured' : '— Manual'}</span></div>
    </div>
  `;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Form submit ───────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;

  formError.style.display = 'none';

  if (!validateAll()) {
    formErrorMsg.textContent = 'Please fix the highlighted fields before submitting.';
    formError.style.display  = 'flex';
    return;
  }

  setSubmitting(true);

  try {
    // 1. Save all fields
    await autoSave();

    // 2. Capture GPS (non-blocking, sets location_source to manual on fail)
    gpsStatus.style.display = 'flex';
    gpsStatusMsg.textContent = 'Capturing GPS location…';
    
    await captureGpsForDraft(draftId, { timeoutMs: 15000 });
    
    gpsStatus.style.display = 'none';

    // 3. Sync
    const result = await attemptSync(draftId);

    if (result.alreadySubmitted) {
      showToast('Placement was already submitted.', 'info');
      // Wait a moment and then check server for the real data
      const { data: existing } = await getOwnPlacementForSeason(currentUserId, currentSeason.id);
      if (existing) showSubmittedState(existing);
      return;
    }

    if (result.offline) {
      pendingBadge.style.display = 'flex';
      showToast('You\'re offline. Your placement will sync automatically when you reconnect.', 'warning');
      return;
    }

    if (!result.ok) {
       throw new Error(result.error?.message || 'Sync failed');
    }

    showToast('Placement submitted successfully!', 'success');
    showSubmittedState(result.data);

  } catch (err) {
    console.error('[placement] Submit error:', err);
    formErrorMsg.textContent = err.message || 'Submission failed. Please check your connection and try again.';
    formError.style.display  = 'flex';
    pendingBadge.style.display = navigator.onLine ? 'none' : 'flex';
  } finally {
    setSubmitting(false);
  }
}

// ── Online listener (retry pending drafts) ────────────────────────────────────
window.addEventListener('online', async () => {
  isOffline = false;
  if (!currentSeason) return;
  
  // Wait a few seconds to let offline-queue BackgroundSync / flush complete
  setTimeout(async () => {
     const { data: existing } = await getOwnPlacementForSeason(currentUserId, currentSeason.id);
     if (existing && existing.status !== 'draft') {
        showToast('Placement synced successfully!', 'success');
        showSubmittedState(existing);
        pendingBadge.style.display = 'none';
     }
  }, 3000);
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await requireRole(['student']);
  await initShell();
  setLoading(true);

  try {
    currentUserId = await getCurrentUserId();

    // 1. Offline queue init (tests storage, starts sync listeners)
    const { storageAvailable } = await initOfflineQueue();
    if (!storageAvailable) {
      incognitoBanner.style.display = 'flex';
    }

    // 2. Load open season
    const { data: season } = await getOpenSeason();
    currentSeason = season ?? null;

    if (!currentSeason) {
      windowClosedBanner.style.display = 'flex';
      windowClosedMsg.textContent = 'No active season. Placement registration is currently unavailable.';
      submitBtn.disabled = true;
    } else if (!isPlacementWindowOpen(currentSeason)) {
      windowClosedBanner.style.display = 'flex';
      windowClosedMsg.textContent = `The placement window opens ${formatDate(currentSeason.placement_window_start)} and closes ${formatDate(currentSeason.placement_window_end)}.`;
      submitBtn.disabled = true;
    }

    // 3. Check if already submitted on server
    if (currentSeason) {
      const { data: existing } = await getOwnPlacementForSeason(currentUserId, currentSeason.id);
      if (existing) {
        showSubmittedState(existing);
        setLoading(false);
        return;
      }
    }

    // 4. Load draft from IndexedDB or create
    if (currentSeason) {
      const draft = await findDraftForStudent(currentUserId, currentSeason.id);
      if (draft) {
        draftId = draft.draft_id;
        populateForm(draft);
        if (draft.sync_status === 'pending_sync') {
          pendingBadge.style.display = 'flex';
        }
      } else {
        const newDraft = await createDraft({ studentId: currentUserId, seasonId: currentSeason.id });
        draftId = newDraft.draft_id;
      }
    }

    // 5. Attach events
    for (const id of FIELD_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('blur', () => {
        const val = getFieldValue(id);
        if (!FIELD_VALIDATORS[id](val)) {
          showFieldError(id, `${FIELD_LABELS[id]} is required and must be valid.`);
        } else {
          showFieldError(id, '');
        }
        updateSubmitState();
      });
      el.addEventListener('input', async () => {
        if (FIELD_VALIDATORS[id](getFieldValue(id))) showFieldError(id, '');
        updateSubmitState();
        await autoSave();
      });
    }

    placementForm.addEventListener('submit', handleSubmit);
    updateSubmitState();

  } catch (err) {
    console.error('[placement] Init error:', err);
    showToast('Failed to load the page. Please refresh.', 'error');
  } finally {
    setLoading(false);
  }
}

init();
