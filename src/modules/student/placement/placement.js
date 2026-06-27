// =============================================================================
// IAMS — Placement Registration Wizard Logic Script
// Extracted from Prototype
// =============================================================================

import { syncPlacement, updateOwnPlacement } from '/shared/services/placements.js';
import { generateUuid } from '/shared/utils.js';
import { showToast } from '/shell/nav.js';
import { isPlacementWindowOpen } from '/shared/services/seasons.js';

let _userId = null;
let _season = null;
let _existingPlacement = null;
let _studentProfile = null;

// The central state object synced with localstorage for offline recovery
let draft = {
  draft_id: generateUuid(),
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
  location_source: 'pending', // 'pending', 'gps', 'manual'
  sync_status: 'draft',       // 'draft', 'pending', 'submitted', 'error'
  lastErrorMessage: ''
};

// UI State
let currentStage = '1';
let gpsAttempts = 0;
const GPS_MAX_ATTEMPTS = 4;
let gpsState = 'idle'; // idle, locating, success, failed, manual
let lastGpsErrorMessage = '';

// Edit rules (simulated constraints)
const EDIT_DEADLINE = new Date();
EDIT_DEADLINE.setDate(EDIT_DEADLINE.getDate() + 14); 
let submissionLocked = false; 

export async function initPlacement(userId, season, existingPlacement, studentProfile) {
  _userId = userId;
  _season = season;
  _existingPlacement = existingPlacement;
  _studentProfile = studentProfile;

  // Render initial student name
  document.getElementById('p-student-name').textContent = _studentProfile?.full_name || 'Student';

  // Check window
  const windowOpen = isPlacementWindowOpen(_season);
  
  if (_existingPlacement) {
    // Merge existing placement into draft
    draft = { ...draft, ..._existingPlacement };
    draft.sync_status = _existingPlacement.status;
    draft.location_source = _existingPlacement.location_source || 'manual';
    // If window is closed and we have a placement, we can view it but not edit.
    if (!windowOpen) {
      submissionLocked = true;
    }
  } else if (!windowOpen) {
    document.getElementById('view-window-closed').classList.add('active');
    document.getElementById('view-wizard').classList.remove('active');
    return;
  } else {
    // Attempt local storage recovery
    const saved = localStorage.getItem('placement_draft_' + _userId);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.sync_status !== 'submitted') {
          draft = parsed;
          document.getElementById('resumeBanner').classList.remove('hidden');
        }
      } catch (e) {}
    }
  }

  // Bind inputs
  bindInputs();
  populateFormFromDraft();
  
  // Set initial stage
  if (['submitted', 'assigned', 'flagged', 'rejected'].includes(draft.sync_status)) {
    goToStage('3');
  } else {
    goToStage('1');
  }

  // Bind buttons
  document.getElementById('btn-stage1-next').onclick = () => { if (validateStage1()) goToStage('2'); };
  document.getElementById('btn-stage2-back').onclick = () => goToStage('1');
  document.getElementById('btn-stage2-next').onclick = () => goToStage('3');
  document.getElementById('btn-stage3-back').onclick = () => goToStage('2');
  
  document.getElementById('btn-submit').onclick = handleSubmit;

  // Review Edit Links
  document.querySelectorAll('.review-edit-link').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      if (!submissionLocked) goToStage(btn.getAttribute('data-jump-stage'));
    };
  });

  // Check incognito
  checkIncognito();
  
  // Initial ticket update
  updateTicketPreview();
}

function bindInputs() {
  const fields = ['company_name', 'nature_of_business', 'region', 'city_town', 'street_landmark', 'contact_person', 'company_contact_phone', 'start_date', 'end_date'];
  fields.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    el.addEventListener('input', (e) => {
      draft[f] = e.target.value;
      el.classList.remove('inp-error-shake');
      saveDraft();
      updateTicketPreview();
    });
  });
}

function populateFormFromDraft() {
  const fields = ['company_name', 'nature_of_business', 'region', 'city_town', 'street_landmark', 'contact_person', 'company_contact_phone', 'start_date', 'end_date'];
  fields.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (el && draft[f]) el.value = draft[f];
  });
}

function saveDraft() {
  if (draft.sync_status !== 'submitted') {
    localStorage.setItem('placement_draft_' + _userId, JSON.stringify(draft));
    const hint = document.getElementById('autosaveHint');
    hint.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;vertical-align:middle;color:var(--green)"></i> Saved just now';
    setTimeout(() => {
      hint.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;vertical-align:middle;"></i> Saved locally as draft';
      if (window.lucide) window.lucide.createIcons();
    }, 2000);
  }
}

function updateTicketPreview() {
  const card = document.getElementById('interactiveTicketCard');
  card.classList.remove('data-glow');
  void card.offsetWidth; // trigger reflow
  card.classList.add('data-glow');

  document.getElementById('p-company').textContent = draft.company_name || '—';
  document.getElementById('p-nature').textContent = draft.nature_of_business || '—';
  
  const rc = [draft.city_town, draft.region].filter(Boolean).join(', ');
  document.getElementById('p-region-city').textContent = rc || '—';

  const gpsEl = document.getElementById('p-gps');
  if (draft.location_source === 'gps' && draft.latitude) {
    gpsEl.textContent = draft.latitude.toFixed(4) + ', ' + draft.longitude.toFixed(4);
    gpsEl.style.color = 'var(--ttu-gold)';
  } else if (draft.location_source === 'manual') {
    gpsEl.textContent = 'Manual Override';
    gpsEl.style.color = 'var(--text-muted)';
  } else {
    gpsEl.textContent = '—';
    gpsEl.style.color = 'inherit';
  }
}

function isEditingClosed() {
  return submissionLocked || new Date() > EDIT_DEADLINE;
}

function formatEditDeadline(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function validateStage1() {
  const required = ['company_name', 'nature_of_business', 'region', 'city_town', 'street_landmark', 'contact_person', 'company_contact_phone', 'start_date', 'end_date'];
  let valid = true;
  required.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (!draft[f] || draft[f].trim() === '') {
      el.classList.remove('inp-error-shake');
      void el.offsetWidth;
      el.classList.add('inp-error-shake');
      valid = false;
    }
  });
  if (!valid) showToast('Please complete all required fields', 'error');
  return valid;
}

function goToStage(stageNum) {
  currentStage = stageNum;

  // Update tabs/dots
  const labels = ['Company Info', 'Geo-Location', 'Submit'];
  const dotsHtml = labels.map((l, i) => {
    const s = String(i + 1);
    let classes = 'stage-dot';
    if (s === currentStage) classes += ' active';
    else if (parseInt(s) < parseInt(currentStage) || draft.sync_status === 'submitted') classes += ' done';
    
    let content = s;
    if (classes.includes('done') && s !== currentStage) content = '<i data-lucide="check"></i>';
    
    let connector = '';
    if (i < 2) {
      let cClass = 'stage-connector';
      if (parseInt(s) < parseInt(currentStage) || draft.sync_status === 'submitted') cClass += ' done';
      connector = '<div class="' + cClass + '"></div>';
    }
    return '<div class="' + classes + '" onclick="if(!window.submissionLocked && ' + (parseInt(s) < parseInt(currentStage) ? 'true' : 'false') + ') document.querySelector(\'.review-edit-link[data-jump-stage=\\\''+s+'\\\']\').click()">' + content + '</div>' + connector;
  }).join('');
  
  document.getElementById('stageDotRow').innerHTML = dotsHtml;

  const labelsHtml = labels.map((l, i) => {
    const s = String(i + 1);
    return '<div class="stage-label' + (s === currentStage ? ' active' : '') + '">' + l + '</div>';
  }).join('');
  document.getElementById('stageLabelsRow').innerHTML = labelsHtml;

  // Show/hide views
  ['1', '2', '3'].forEach(s => {
    document.getElementById('stage-' + s).classList.toggle('active', s === currentStage);
  });

  if (currentStage === '2') {
    if (gpsState === 'idle' && draft.sync_status !== 'submitted' && draft.location_source !== 'manual') {
      startGpsCapture();
    } else {
      renderGpsStage();
    }
    document.getElementById('btn-stage2-next').disabled = (gpsState !== 'success' && gpsState !== 'manual' && draft.sync_status !== 'submitted');
    document.getElementById('onsiteBannerCompany').textContent = draft.company_name;
  } else if (currentStage === '3') {
    renderReviewStage();
  }

  if (window.lucide) window.lucide.createIcons();
}

function startGpsCapture() {
  gpsAttempts++;
  gpsState = 'locating';
  renderGpsStage();

  if (!navigator.geolocation) {
    handleGpsFailure('unsupported');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      draft.latitude = position.coords.latitude;
      draft.longitude = position.coords.longitude;
      draft.location_source = 'gps';
      gpsState = 'success';
      renderGpsStage();
      document.getElementById('btn-stage2-next').disabled = false;
      updateTicketPreview();
      saveDraft();
    },
    (error) => {
      const codes = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
      handleGpsFailure(codes[error.code] || 'unknown');
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

function handleGpsFailure(reason) {
  const messages = {
    denied: 'Location authorization was denied. Please check your browser settings.',
    timeout: 'Hardware timeout reached. Try standing closer to exterior exits.',
    unavailable: 'Geographical telemetry details are currently offline.',
    unsupported: 'Current portal container does not offer GPS access.',
    unknown: 'An unknown network error occurred.',
  };
  lastGpsErrorMessage = messages[reason] || messages.unknown;
  gpsState = 'failed';
  renderGpsStage();
}

function continueWithoutLocation() {
  draft.latitude = null;
  draft.longitude = null;
  draft.location_source = 'manual';
  gpsState = 'manual';
  renderGpsStage();
  document.getElementById('btn-stage2-next').disabled = false;
  updateTicketPreview();
  saveDraft();
}

function renderAttemptPips(used, current) {
  let html = '<div class="gps-attempt-pips" style="display:flex;gap:4px;margin-bottom:12px;">';
  for (let i = 1; i <= GPS_MAX_ATTEMPTS; i++) {
    let cls = 'width:8px;height:8px;border-radius:50%;background:';
    if (i === current) cls += 'var(--ttu-blue)';
    else if (i <= used) cls += 'var(--border-strong)';
    else cls += 'var(--border-default)';
    html += '<div style="' + cls + '"></div>';
  }
  return html + '</div>';
}

function renderGpsStage() {
  const box = document.getElementById('gpsStageBox');
  const attemptsLeft = GPS_MAX_ATTEMPTS - gpsAttempts;

  if (gpsState === 'locating') {
    box.innerHTML =
      renderAttemptPips(gpsAttempts - 1, gpsAttempts) +
      '<div class="gps-radar locating">' +
        '<div class="gps-radar-ring"></div><div class="gps-radar-ring"></div><div class="gps-radar-ring"></div>' +
        '<div class="gps-icon-ring locating"><i data-lucide="loader-circle" class="spinner"></i></div>' +
      '</div>' +
      '<div class="gps-title" style="font-weight:700;font-size:16px;">Acquiring Telemetry Coordinates…</div>' +
      '<div class="gps-message" style="color:var(--text-secondary);margin-top:8px;">Stand still inside the organization perimeter...</div>';
  } else if (gpsState === 'success') {
    box.innerHTML =
      '<div class="gps-radar"><div class="gps-icon-ring success"><i data-lucide="map-pin-check"></i></div></div>' +
      '<div class="gps-title" style="font-weight:700;font-size:16px;">Coordinates Locked Successfully</div>' +
      '<div class="gps-message" style="color:var(--text-secondary);margin-top:8px;margin-bottom:16px;">High-accuracy telemetry has been stamped onto your registration certificate.</div>' +
      '<div class="gps-coords"><span class="badge badge-gold" style="margin-right:8px;">Verified GPS</span>' + draft.latitude.toFixed(6) + ', ' + draft.longitude.toFixed(6) + '</div>' +
      '<div class="gps-actions"><button class="btn btn-outline" id="gpsRetryAnyway"><i data-lucide="rotate-ccw"></i> Recapture Coordinates</button></div>';
    setTimeout(() => { document.getElementById('gpsRetryAnyway').addEventListener('click', function () {
      gpsAttempts = 0; gpsState = 'idle'; startGpsCapture();
    })}, 50);
  } else if (gpsState === 'failed') {
    if (attemptsLeft > 0) {
      box.innerHTML =
        renderAttemptPips(gpsAttempts, 0) +
        '<div class="gps-radar"><div class="gps-icon-ring failed"><i data-lucide="shield-alert"></i></div></div>' +
        '<div class="gps-title" style="font-weight:700;font-size:16px;color:var(--ttu-red);">Acquisition Interrupted</div>' +
        '<div class="gps-message" style="color:var(--text-secondary);margin-top:8px;margin-bottom:16px;">' + lastGpsErrorMessage + '</div>' +
        '<div class="gps-actions"><button class="btn btn-primary" id="gpsTryAgain"><i data-lucide="rotate-ccw"></i> Attempt Recapture (' + attemptsLeft + ' left)</button></div>';
      setTimeout(() => { document.getElementById('gpsTryAgain').addEventListener('click', startGpsCapture) }, 50);
    } else {
      box.innerHTML =
        '<div class="gps-radar"><div class="gps-icon-ring failed"><i data-lucide="ban"></i></div></div>' +
        '<div class="gps-title" style="font-weight:700;font-size:16px;color:var(--ttu-red);">Automatic Location Timeout</div>' +
        '<div class="gps-message" style="color:var(--text-secondary);margin-top:8px;margin-bottom:16px;">' + lastGpsErrorMessage + ' You can attempt one final manual override.</div>' +
        '<div class="gps-actions" style="display:flex;gap:12px;justify-content:center;">' +
          '<button class="btn btn-outline" id="gpsOneMoreTry"><i data-lucide="rotate-ccw"></i> Retry One More Time</button>' +
          '<button class="btn btn-primary" id="gpsContinueManual"><i data-lucide="arrow-right"></i> Use Manual Override</button>' +
        '</div>';
      setTimeout(() => {
        document.getElementById('gpsOneMoreTry').addEventListener('click', startGpsCapture);
        document.getElementById('gpsContinueManual').addEventListener('click', continueWithoutLocation);
      }, 50);
    }
  } else if (gpsState === 'manual') {
    box.innerHTML =
      '<div class="gps-radar"><div class="gps-icon-ring manual"><i data-lucide="map-pin-off"></i></div></div>' +
      '<div class="gps-title" style="font-weight:700;font-size:16px;">GPS Hardware Bypassed</div>' +
      '<div class="gps-message" style="color:var(--text-secondary);margin-top:8px;margin-bottom:16px;">Your audit records will depend strictly on the written address.</div>' +
      '<div class="gps-actions"><button class="btn btn-outline" id="gpsRetryFromManual"><i data-lucide="rotate-ccw"></i> Reactivate GPS Locator</button></div>';
    setTimeout(() => { document.getElementById('gpsRetryFromManual').addEventListener('click', function () {
      gpsAttempts = 0; gpsState = 'idle'; startGpsCapture();
    }) }, 50);
  }

  if (window.lucide) window.lucide.createIcons();
}

function reviewRow(k, v) {
  return '<div class="review-row"><span class="k">' + k + '</span><span class="v">' + (v || '—') + '</span></div>';
}

function renderReviewStage() {
  document.getElementById('reviewCompanyRows').innerHTML =
    reviewRow('Company Name', draft.company_name) +
    reviewRow('Nature of Industry', draft.nature_of_business) +
    reviewRow('Physical Address', [draft.street_landmark, draft.city_town, draft.region].filter(Boolean).join(', ')) +
    reviewRow('Supervisor Name', draft.contact_person) +
    reviewRow('Supervisor Mobile', draft.company_contact_phone) +
    reviewRow('Attachment Period', draft.start_date + ' to ' + draft.end_date);

  const locationValue = draft.location_source === 'gps'
    ? draft.latitude.toFixed(6) + ', ' + draft.longitude.toFixed(6) + ' (Accurate GPS)'
    : draft.location_source === 'manual'
      ? 'Manual address audit bypass - Coordinates excluded'
      : '—';
  document.getElementById('reviewLocationRows').innerHTML = reviewRow('Validation Strategy', locationValue);

  renderSubmissionBanner();
}

function renderSubmissionBanner() {
  const banner = document.getElementById('syncBanner');
  const actions = document.getElementById('reviewActions');
  const lockedNote = document.getElementById('lockedNote');
  const pill = document.getElementById('submittedPill');
  const deadlineBanner = document.getElementById('editDeadlineBanner');
  const closedBanner = document.getElementById('editClosedBanner');
  const editLinks = document.querySelectorAll('.review-edit-link');

  if (draft.sync_status === 'pending') {
    banner.className = 'sync-banner pending';
    banner.innerHTML = '<i data-lucide="loader-circle"></i><span>Synchronization pending offline queue checks... Details remain cached and will upload once active cellular signals return.</span>';
    banner.classList.remove('hidden');
  } else if (draft.sync_status === 'error') {
    banner.className = 'sync-banner error';
    banner.innerHTML = '<i data-lucide="alert-circle"></i><span>' + (draft.lastErrorMessage || 'Server rejected registration request.') + '</span>';
    banner.classList.remove('hidden');
  } else if (draft.sync_status === 'flagged') {
    banner.className = 'sync-banner error';
    banner.innerHTML = '<i data-lucide="alert-triangle"></i><span>Submission flagged by Liaison office. Check remarks.</span>';
    banner.classList.remove('hidden');
  } else if (draft.sync_status === 'rejected') {
    banner.className = 'sync-banner error';
    banner.innerHTML = '<i data-lucide="x-circle"></i><span>Registration rejected. Please report to the Liaison office immediately.</span>';
    banner.classList.remove('hidden');
  } else if (draft.sync_status === 'assigned') {
    banner.className = 'sync-banner success';
    banner.innerHTML = '<i data-lucide="check-circle-2"></i><span>Placement assigned and approved.</span>';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  if (['submitted', 'assigned', 'flagged', 'rejected'].includes(draft.sync_status)) {
    pill.classList.remove('hidden');
    document.getElementById('submittedCompanyName').textContent = draft.company_name || 'selected provider';
  } else {
    pill.classList.add('hidden');
  }

  submissionLocked = ['assigned', 'flagged', 'rejected'].includes(draft.sync_status) || (draft.sync_status === 'submitted' && isEditingClosed());

  if (draft.sync_status === 'submitted' && !submissionLocked) {
    document.getElementById('editDeadlineText').textContent = formatEditDeadline(EDIT_DEADLINE);
    deadlineBanner.classList.remove('hidden');
    closedBanner.classList.add('hidden');
  } else if (submissionLocked) {
    document.getElementById('editClosedDateText').textContent = formatEditDeadline(EDIT_DEADLINE);
    closedBanner.classList.remove('hidden');
    deadlineBanner.classList.add('hidden');
  } else {
    deadlineBanner.classList.add('hidden');
    closedBanner.classList.add('hidden');
  }

  editLinks.forEach(function (el) { el.disabled = submissionLocked; });

  const submitBtn = document.getElementById('btn-submit');
  if (submitBtn) {
    submitBtn.innerHTML = draft.sync_status === 'submitted'
      ? '<i data-lucide="send"></i> Update Registration Details'
      : '<i data-lucide="send"></i> Confirm & Submit Placement';
  }

  if (submissionLocked) {
    actions.classList.add('hidden');
    lockedNote.classList.remove('hidden');
  } else {
    actions.classList.remove('hidden');
    lockedNote.classList.add('hidden');
  }

  if (window.lucide) window.lucide.createIcons();
}

async function handleSubmit() {
  const btn = document.getElementById('btn-submit');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader-circle" class="spinner"></i> Transmitting Securely...';
  btn.disabled = true;

  let saved, error;

  if (draft.id) {
    const patch = {
      company_name: draft.company_name,
      nature_of_business: draft.nature_of_business,
      contact_person: draft.contact_person,
      company_contact_phone: draft.company_contact_phone,
      region: draft.region,
      city_town: draft.city_town,
      street_landmark: draft.street_landmark,
      start_date: draft.start_date,
      end_date: draft.end_date,
      latitude: draft.latitude,
      longitude: draft.longitude,
      location_source: draft.location_source,
    };
    const res = await updateOwnPlacement(draft.id, patch);
    saved = res.data;
    error = res.error;
  } else {
    const res = await syncPlacement({
      draft_id:    draft.draft_id,
      student_id:  _userId,
      season_id:   _season.id,
      company_name: draft.company_name,
      nature_of_business: draft.nature_of_business,
      contact_person: draft.contact_person,
      company_contact_phone: draft.company_contact_phone,
      region: draft.region,
      city_town: draft.city_town,
      street_landmark: draft.street_landmark,
      start_date: draft.start_date,
      end_date: draft.end_date,
      latitude: draft.latitude,
      longitude: draft.longitude,
      location_source: draft.location_source,
    });
    saved = res.data;
    error = res.error;
  }

  btn.innerHTML = originalHtml;
  btn.disabled = false;

  if (error) {
    draft.sync_status = 'error';
    draft.lastErrorMessage = error.message;
    showToast('Transmission rejected: ' + error.message, 'error');
  } else {
    draft.sync_status = 'submitted';
    draft = { ...draft, ...saved }; // Update draft with server data (status, etc.)
    showToast('Placement registration confirmed securely!', 'success');
    launchConfetti();
    localStorage.removeItem('placement_draft_' + _userId); // Clear draft
    setTimeout(() => {
      window.location.reload();
    }, 3500); // Reload after confetti to update global state
  }
  renderSubmissionBanner();
}

function launchConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;
  const colors = ['var(--ttu-gold)', 'var(--ttu-blue)', '#ffffff'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    el.style.left = Math.random() * 100 + '%';
    el.style.top = -10 + Math.random() * 20 + 'px';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDelay = Math.random() * 0.5 + 's';
    el.style.transform = 'scale(' + (0.5 + Math.random() * 0.5) + ') rotate(' + Math.random() * 360 + 'deg)';
    container.appendChild(el);
  }
  setTimeout(() => { container.innerHTML = ''; }, 3500);
}

function checkIncognito() {
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => {
      if (est.quota < 120000000) {
        document.getElementById('privateBanner').classList.remove('hidden');
      }
    });
  }
}
