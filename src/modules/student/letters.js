// =============================================================================
// IAMS — src/modules/student/letters.js
// FR2: Attachment Letter Generation
// =============================================================================

import { requireRole, getCurrentUserId } from '/modules/auth/auth-guard.js';
import { initShell } from '/shell/nav.js';
import { getOpenSeason, isPlacementWindowOpen } from '/shared/services/seasons.js';
import { listLetters, getLetterCountForSeason } from '/shared/services/letters.js';
import { getStudentProfile } from '/shared/services/auth.service.js';
import { generateAndDownloadLetter } from '/shared/pdf/generate-letter.js';
import { showToast, formatDate, letterCountTier, isValidPhone, isRequired } from '/shared/utils.js';

// ── State ─────────────────────────────────────────────────────────────────────
let currentSeason   = null;
let currentUserId   = null;
let studentProfile  = null;
let letterCount     = 0;
let isSubmitting    = false;

// ── DOM ───────────────────────────────────────────────────────────────────────
const pageLoading         = document.getElementById('page-loading');
const seasonBanner        = document.getElementById('season-closed-banner');
const seasonMsg           = document.getElementById('season-closed-msg');
const letterCountBadge    = document.getElementById('letter-count-badge');
const letterCountLabel    = document.getElementById('letter-count-label');
const letterForm          = document.getElementById('letter-form');
const submitBtn           = document.getElementById('submit-btn');
const submitSpinner       = document.getElementById('submit-spinner');
const submitIcon          = document.getElementById('submit-icon');
const formError           = document.getElementById('form-error');
const formErrorMsg        = document.getElementById('form-error-msg');
const lettersSkeleton     = document.getElementById('letters-skeleton');
const lettersEmpty        = document.getElementById('letters-empty');
const lettersTableWrap    = document.getElementById('letters-table-wrap');
const lettersTbody        = document.getElementById('letters-tbody');

// ── Required fields config ────────────────────────────────────────────────────
const FIELDS = [
  { id: 'company_name',          label: 'Company name',      validate: (v) => isRequired(v) },
  { id: 'region',                label: 'Region',            validate: (v) => isRequired(v) },
  { id: 'city_town',             label: 'City / Town',       validate: (v) => isRequired(v) },
  { id: 'street_landmark',       label: 'Street / Landmark', validate: (v) => isRequired(v) },
  { id: 'contact_person',        label: 'Contact person',    validate: (v) => isRequired(v) },
  { id: 'company_contact_phone', label: 'Company phone',     validate: (v) => isValidPhone(v) },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function setLoading(on) {
  if (pageLoading) pageLoading.style.display = on ? 'flex' : 'none';
}

function setSubmitting(on) {
  isSubmitting = on;
  submitBtn.disabled       = on;
  submitSpinner.style.display = on ? 'inline-block' : 'none';
  submitIcon.style.display    = on ? 'none'         : '';
}

function showFieldError(id, msg) {
  const errEl = document.getElementById(`err-${id}`);
  const input = document.getElementById(id);
  if (errEl) { errEl.textContent = msg; errEl.style.display = msg ? 'block' : 'none'; }
  if (input)  input.classList.toggle('field-input--error', Boolean(msg));
}

function clearFieldError(id) { showFieldError(id, ''); }

function validateAll() {
  let valid = true;
  for (const f of FIELDS) {
    const el  = document.getElementById(f.id);
    const val = el?.value ?? '';
    if (!f.validate(val)) {
      showFieldError(f.id, `${f.label} is required and must be valid.`);
      valid = false;
    } else {
      clearFieldError(f.id);
    }
  }
  return valid;
}

function updateSubmitState() {
  if (isSubmitting) return;
  const allFilled = FIELDS.every((f) => {
    const el = document.getElementById(f.id);
    return f.validate(el?.value ?? '');
  });
  submitBtn.disabled = !allFilled || !currentSeason;
}

// ── Letter count badge ────────────────────────────────────────────────────────
function renderCountBadge(count) {
  letterCountBadge.style.display = 'flex';
  const tier = letterCountTier(count);
  letterCountBadge.className = `letter-count-badge letter-count-badge--${tier}`;
  letterCountLabel.textContent = `${count} letter${count === 1 ? '' : 's'} this season`;
}

// ── Letter history table ──────────────────────────────────────────────────────
function renderLetterHistory(letters) {
  lettersSkeleton.style.display = 'none';

  if (!letters || letters.length === 0) {
    lettersEmpty.style.display     = 'flex';
    lettersTableWrap.style.display = 'none';
    return;
  }

  lettersEmpty.style.display     = 'none';
  lettersTableWrap.style.display = 'block';

  lettersTbody.innerHTML = letters.map((l) => `
    <tr>
      <td>${escHtml(l.company_name)}</td>
      <td>${formatDate(l.generated_at)}</td>
      <td><code class="code-pill">${escHtml(l.verification_code)}</code></td>
    </tr>
  `).join('');
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Load letters ──────────────────────────────────────────────────────────────
async function loadLetters() {
  lettersSkeleton.style.display = 'block';
  lettersEmpty.style.display    = 'none';
  lettersTableWrap.style.display = 'none';

  const { data, error } = await listLetters();
  if (error) {
    showToast('Could not load letter history: ' + error.message, 'error');
    lettersSkeleton.style.display = 'none';
    return;
  }

  // Filter to current season if one is open
  const seasonLetters = currentSeason
    ? (data ?? []).filter((l) => l.season_id === currentSeason.id)
    : (data ?? []);

  renderLetterHistory(seasonLetters);

  // Update count badge
  if (currentSeason) {
    const { count } = await getLetterCountForSeason(currentUserId, currentSeason.id);
    letterCount = count ?? 0;
    renderCountBadge(letterCount);
  }
}

// ── Form submit ───────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;

  formError.style.display = 'none';

  if (!validateAll()) {
    formErrorMsg.textContent = 'Please fix the errors above before generating the letter.';
    formError.style.display  = 'flex';
    return;
  }

  if (!currentSeason) {
    showToast('No active season — letter generation is unavailable.', 'error');
    return;
  }

  setSubmitting(true);

  try {
    const formData = {
      student_id:            currentUserId,
      season_id:             currentSeason.id,
      company_name:          document.getElementById('company_name').value.trim(),
      region:                document.getElementById('region').value,
      city_town:             document.getElementById('city_town').value.trim(),
      street_landmark:       document.getElementById('street_landmark').value.trim(),
      contact_person:        document.getElementById('contact_person').value.trim(),
      company_contact_phone: document.getElementById('company_contact_phone').value.trim(),
    };

    // Use generateAndDownloadLetter which does insertion and PDF generation
    const { data: result, error: genErr } = await generateAndDownloadLetter(formData, studentProfile?.full_name);
    
    if (genErr && !result?.letterRow) {
      formErrorMsg.textContent = genErr.message || 'Failed to generate the letter. Please try again.';
      formError.style.display  = 'flex';
      return;
    }
    
    if (genErr) {
      showToast('Letter saved but PDF generation failed. Please try again.', 'warning');
    } else {
      showToast('Letter generated and downloading!', 'success');
    }

    letterForm.reset();
    updateSubmitState();
    await loadLetters();

  } catch (err) {
    console.error('[letters] Unexpected error:', err);
    formErrorMsg.textContent = err.message || 'An unexpected error occurred.';
    formError.style.display  = 'flex';
  } finally {
    setSubmitting(false);
  }
}

// ── Blur validation ───────────────────────────────────────────────────────────
function attachFieldValidation() {
  for (const f of FIELDS) {
    const el = document.getElementById(f.id);
    if (!el) continue;
    el.addEventListener('blur', () => {
      if (!f.validate(el.value)) {
        showFieldError(f.id, `${f.label} is required and must be valid.`);
      } else {
        clearFieldError(f.id);
      }
      updateSubmitState();
    });
    el.addEventListener('input', () => {
      if (f.validate(el.value)) clearFieldError(f.id);
      updateSubmitState();
    });
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await requireRole(['student']);
  await initShell();

  setLoading(true);

  try {
    currentUserId = await getCurrentUserId();

    // Load season
    const { data: season, error: seasonErr } = await getOpenSeason();
    if (seasonErr) console.warn('[letters] Season error:', seasonErr);

    currentSeason = season ?? null;

    if (!currentSeason) {
      seasonBanner.style.display = 'flex';
      seasonMsg.textContent = 'No active season. Letter generation is available only during an open season.';
      submitBtn.disabled = true;
    }

    // Load student profile for PDF
    const { data: profile } = await getStudentProfile(currentUserId);
    studentProfile = profile;

    // Attach form events
    attachFieldValidation();
    letterForm.addEventListener('submit', handleSubmit);
    updateSubmitState();

    // Load letter history
    await loadLetters();

  } catch (err) {
    console.error('[letters] Init error:', err);
    showToast('Failed to load the page. Please refresh.', 'error');
  } finally {
    setLoading(false);
  }
}

init();
