// =============================================================================
// IAMS — src/modules/student/dashboard.js
// =============================================================================

import { requireRole, getCurrentUserId }   from '../auth/auth-guard.js';
import { renderShell, navigateTo, showToast } from '/shell/nav.js';
import { supabase }                         from '/shared/supabase-client.js';
import { getOpenSeason, isPlacementWindowOpen } from '/shared/services/seasons.js';
import { getLetterCountForSeason, generateLetter, listLetters } from '/shared/services/letters.js';
import { getOwnPlacementForSeason, syncPlacement } from '/shared/services/placements.js';
import { letterCountTier, formatDate, formatAddress, generateUuid } from '/shared/utils.js';
import { listAttendanceLogs }               from '/shared/services/attendance.service.js';
import { initAttendance }                  from './sections/attendance-section.js';
import { initLogbook }                     from './sections/logbook-section.js';
import { initProfile }                     from './sections/profile-section.js';
import { initSettings, applyStoredTheme }  from './sections/settings-section.js';
import { downloadPdfLetter }               from './sections/generate-letter-pdf.js';
import './sections/dashboard-widgets.css';

// ── 1. Auth guard ────────────────────────────────────────────────────────────
const role = await requireRole(['student']);

// ── 2. Load user profile ─────────────────────────────────────────────────────
const userId = await getCurrentUserId();
const { data: profile } = await supabase
  .from('profiles')
  .select('full_name')
  .eq('id', userId)
  .maybeSingle();

const fullName = profile?.full_name ?? 'Student';
const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

// Apply stored theme before shell renders (prevents flash)
applyStoredTheme();

// ── 3. Render shell ──────────────────────────────────────────────────────────
await renderShell('student', 'dashboard', { name: fullName, initials, email: '' });

// ── 4. Page routing ──────────────────────────────────────────────────────────
const PAGE_KEYS = ['dashboard', 'generate-letter', 'register-placement', 'attendance', 'logbook', 'profile', 'settings'];

function showPage(page) {
  PAGE_KEYS.forEach(key => {
    const el = document.getElementById(`view-${key}`);
    if (el) el.classList.toggle('active', key === page);
  });
}

window.addEventListener('hashchange', () => {
  const page = (location.hash || '').replace('#', '') || 'dashboard';
  if (PAGE_KEYS.includes(page)) {
    showPage(page);
    if (page === 'generate-letter')    loadGenerateLetter();
    if (page === 'register-placement') loadRegisterPlacement();
    if (page === 'attendance')         loadAttendancePage();
    if (page === 'logbook')            loadLogbookPage();
    if (page === 'profile')            loadProfilePage();
    if (page === 'settings')           loadSettingsPage();
  }
});

// Show initial page from hash or default
const initialPage = (location.hash || '').replace('#', '') || 'dashboard';
showPage(initialPage);

// ── 5. Global data ───────────────────────────────────────────────────────────
let _season      = null;
let _letterCount = 0;
let _placement   = null;

async function loadGlobalData() {
  const { data: season } = await getOpenSeason();
  _season = season;

  if (season) {
    const { count } = await getLetterCountForSeason(userId, season.id);
    _letterCount = count ?? 0;

    const { data: pl } = await getOwnPlacementForSeason(userId, season.id);
    _placement = pl;
  }
}

await loadGlobalData();

// ── 6. Dashboard page ────────────────────────────────────────────────────────
function renderDashboard() {
  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('dash-greeting').textContent = `${greeting}, ${fullName.split(' ')[0]}`;

  // Season label
  const seasonLabel = document.getElementById('dash-season-label');
  seasonLabel.textContent = _season
    ? `Active season: ${_season.name}`
    : 'No active attachment season at the moment.';

  // Letter count
  const countEl = document.getElementById('dash-letter-count');
  const tierEl  = document.getElementById('dash-letter-tier');
  countEl.textContent = _letterCount;
  const tier = letterCountTier(_letterCount);
  countEl.style.color = tier === 'danger' ? 'var(--ttu-red)' : tier === 'warning' ? 'var(--amber)' : 'var(--text-primary)';
  tierEl.textContent = _season ? `this season (${_season.name})` : '—';

  // Placement badge
  const badgeEl = document.getElementById('dash-placement-badge');
  if (_placement) {
    const cls = { submitted:'badge-submitted', assigned:'badge-present', flagged:'badge-flagged', rejected:'badge-absent' }[_placement.status] ?? 'badge-pending';
    badgeEl.innerHTML = `<span class="badge ${cls}">${_placement.status}</span>
      <span style="font-size:12px;color:var(--text-secondary);margin-top:4px;display:block;">${_placement.company_name}</span>`;
  } else {
    badgeEl.innerHTML = `<span class="badge badge-pending">Not submitted</span>`;
  }

  // Window
  const windowOpen = isPlacementWindowOpen(_season);
  document.getElementById('dash-window-status').textContent = windowOpen ? 'Open' : (_season ? 'Closed' : '—');
  document.getElementById('dash-window-status').style.color = windowOpen ? 'var(--green)' : 'var(--text-secondary)';
  document.getElementById('dash-window-dates').textContent  = _season
    ? `${formatDate(_season.placement_window_start)} – ${formatDate(_season.placement_window_end)}` : '—';

  // Journey timeline
  _renderJourneyTimeline();

  // Attendance count stat card
  _renderAttendanceStat();

  // Logbook quick-link
  _renderLogbookQuickLink();

  // Recent letters
  renderDashboardLetters();
}

function _renderJourneyTimeline() {
  const nodes = [
    { id: 'jn-letter',     reached: _letterCount > 0 },
    { id: 'jn-registered', reached: !!_placement },
    { id: 'jn-assigned',   reached: _placement?.status === 'assigned' },
    { id: 'jn-logbook',    reached: _placement?.status === 'assigned' }, // proxy until logbook check
    { id: 'jn-complete',   reached: false }, // Phase 3
  ];
  nodes.forEach(({ id, reached }) => {
    document.getElementById(id)?.classList.toggle('reached', reached);
  });
}

async function _renderAttendanceStat() {
  const el    = document.getElementById('dash-attendance-count');
  const label = document.getElementById('dash-attendance-label');
  if (!_placement || _placement.status !== 'assigned' || !_season) {
    if (el) el.textContent = '—';
    if (label) label.textContent = 'no active placement';
    return;
  }
  const { data: logs } = await listAttendanceLogs(userId, _season.id);
  const weekStart = _getThisMonday();
  const thisWeek  = (logs ?? []).filter(l => l.log_date >= weekStart && l.check_in_time);
  if (el) el.textContent = thisWeek.length;
  if (label) label.textContent = `day${thisWeek.length !== 1 ? 's' : ''} checked in this week`;
}

function _getThisMonday() {
  const d = new Date(); const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff); return d.toISOString().split('T')[0];
}

async function _renderLogbookQuickLink() {
  const ql = document.getElementById('dash-logbook-quicklink');
  if (!_placement || _placement.status !== 'assigned') return;
  ql?.classList.remove('hidden'); // show it
  const progressEl = document.getElementById('dash-logbook-progress');
  if (progressEl) progressEl.innerHTML = 'Open your logbook to record today\'s activities.';
}

let _allLetters = [];

async function renderDashboardLetters() {
  const listEl = document.getElementById('dash-letters-list');
  const { data: letters } = await listLetters();
  _allLetters = letters ?? [];
  if (!_allLetters.length) {
    listEl.innerHTML = `<p style="font-size:13px;color:var(--text-secondary);">No letters generated yet.</p>`;
    return;
  }
  listEl.innerHTML = letters.slice(0, 3).map(l => `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:10px 0;border-bottom:0.5px solid var(--border-default);">
      <div>
        <div style="font-size:13px;font-weight:500;color:var(--text-primary);">${l.company_name}</div>
        <div style="font-size:12px;color:var(--text-secondary);">${formatDate(l.generated_at)}
          &nbsp;·&nbsp;<code style="font-size:11px;">${l.verification_code}</code></div>
      </div>
      <button class="icon-btn download-letter-btn" data-letter-id="${l.id}" title="Download PDF" style="width:32px;height:32px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </button>
    </div>`).join('') + (letters.length > 3
      ? `<p style="font-size:12px;color:var(--text-secondary);margin-top:8px;">
           +${letters.length - 3} more — go to Generate Letter to see all.</p>` : '');
}

renderDashboard();

// ── 7. Generate Letter page ──────────────────────────────────────────────────
let _glLoaded = false;

async function loadGenerateLetter() {
  if (_glLoaded) return;
  _glLoaded = true;

  // Season window gate
  const windowOpen = isPlacementWindowOpen(_season);
  document.getElementById('gl-window-closed').classList.toggle('hidden', windowOpen);
  document.getElementById('gl-submit').disabled = !windowOpen;

  // Letter count badge
  const tier = letterCountTier(_letterCount);
  const tierColor = tier === 'danger' ? 'var(--ttu-red)' : tier === 'warning' ? 'var(--amber)' : 'var(--text-primary)';
  document.getElementById('gl-count-badge').innerHTML =
    `<span style="font-size:13px;color:${tierColor};font-weight:600;">${_letterCount}</span>
     <span style="font-size:13px;color:var(--text-secondary);">letter${_letterCount !== 1 ? 's' : ''} generated this season</span>`;

  // History
  await renderLetterHistory();

  // Form submit
  document.getElementById('gl-form').addEventListener('submit', handleGenerateLetter);
}

async function renderLetterHistory() {
  const hist = document.getElementById('gl-history');
  const { data: letters } = await listLetters();
  _allLetters = letters ?? [];
  const seasonLetters = _allLetters.filter(l => _season && l.season_id === _season.id);
  if (!seasonLetters.length) {
    hist.innerHTML = `<p style="font-size:13px;color:var(--text-secondary);">No letters yet this season.</p>`;
    return;
  }
  hist.innerHTML = seasonLetters.map(l => `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:10px 0;border-bottom:0.5px solid var(--border-default);">
      <div>
        <div style="font-size:13px;font-weight:500;">${l.company_name}</div>
        <div style="font-size:12px;color:var(--text-secondary);">
          ${formatAddress(l)} &nbsp;·&nbsp; ${formatDate(l.generated_at)}
        </div>
        <code style="font-size:11px;color:var(--text-muted);">${l.verification_code}</code>
      </div>
      <button class="icon-btn download-letter-btn" data-letter-id="${l.id}" title="Download PDF" style="width:32px;height:32px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </button>
    </div>`).join('');
}

// Event delegation for downloading letters
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.download-letter-btn');
  if (!btn) return;
  const letterId = btn.dataset.letterId;
  const letter = _allLetters.find(l => l.id === letterId);
  if (!letter) return;
  
  btn.disabled = true;
  btn.style.opacity = '0.5';
  try {
    const { data: studentProfile } = await supabase
      .from('student_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    await downloadPdfLetter(letter, studentProfile);
    showToast(`Downloaded letter for ${letter.company_name}.`, 'success');
  } catch (err) {
    console.error('PDF Generation Error:', err);
    showToast('Failed to generate PDF.', 'error');
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
});

function glFieldErr(id, show, msg = '') {
  const el = document.getElementById(id);
  el.classList.toggle('hidden', !show);
  if (msg) el.textContent = msg;
}

async function handleGenerateLetter(e) {
  e.preventDefault();
  document.getElementById('gl-banner').classList.add('hidden');

  const company_name          = document.getElementById('gl-company').value.trim();
  const contact_person        = document.getElementById('gl-contact').value.trim();
  const company_contact_phone = document.getElementById('gl-phone').value.trim();
  const region                = document.getElementById('gl-region').value.trim();
  const city_town             = document.getElementById('gl-city').value.trim();
  const street_landmark       = document.getElementById('gl-street').value.trim();

  let ok = true;
  glFieldErr('gl-company-err', !company_name);        if (!company_name)          ok = false;
  glFieldErr('gl-contact-err', !contact_person);      if (!contact_person)        ok = false;
  glFieldErr('gl-phone-err',   !company_contact_phone); if (!company_contact_phone) ok = false;
  glFieldErr('gl-region-err',  !region);              if (!region)                ok = false;
  glFieldErr('gl-city-err',    !city_town);           if (!city_town)             ok = false;
  glFieldErr('gl-street-err',  !street_landmark);     if (!street_landmark)       ok = false;
  if (!ok) return;

  const btn = document.getElementById('gl-submit');
  btn.disabled = true;
  btn.textContent = 'Generating…';

  const { data: letter, error } = await generateLetter({
    student_id: userId,
    season_id:  _season.id,
    company_name, contact_person, company_contact_phone,
    region, city_town, street_landmark,
  });

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="file-down"></i> Generate &amp; Download Letter';

  if (error) {
    document.getElementById('gl-banner-msg').textContent = error.message;
    document.getElementById('gl-banner').classList.remove('hidden');
    return;
  }

  // Update count
  _letterCount++;
  const tier = letterCountTier(_letterCount);
  const tierColor = tier === 'danger' ? 'var(--ttu-red)' : tier === 'warning' ? 'var(--amber)' : 'var(--text-primary)';
  document.getElementById('gl-count-badge').innerHTML =
    `<span style="font-size:13px;color:${tierColor};font-weight:600;">${_letterCount}</span>
     <span style="font-size:13px;color:var(--text-secondary);">letter${_letterCount !== 1 ? 's' : ''} generated this season</span>`;

  // Refresh history
  _glLoaded = false;
  await renderLetterHistory();

  // Trigger PDF download
  try {
    const { data: studentProfile } = await supabase
      .from('student_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    await downloadPdfLetter(letter, studentProfile);
    showToast(`Letter for ${letter.company_name} recorded and downloaded.`, 'success');
  } catch (err) {
    console.error('PDF Generation Error:', err);
    showToast(`Letter recorded, but failed to generate PDF.`, 'warning');
  }
  
  e.target.reset();
}

// ── 8. Register Placement page ───────────────────────────────────────────────
let _rpLoaded = false;

async function loadRegisterPlacement() {
  if (_rpLoaded) return;
  _rpLoaded = true;

  const windowOpen = isPlacementWindowOpen(_season);

  // If already submitted, show notice and lock form
  if (_placement) {
    document.getElementById('rp-submitted-notice').classList.remove('hidden');
    document.getElementById('rp-notice-title').textContent =
      `Placement ${_placement.status}.`;
    document.getElementById('rp-notice-body').textContent =
      ` ${_placement.company_name} · ${formatAddress(_placement)}`;

    if (_placement.status !== 'submitted') {
      // Terminal status — form is irrelevant
      document.getElementById('rp-form-card').classList.add('hidden');
      return;
    }
    // submitted but window closed — read-only view
    if (!windowOpen) {
      document.getElementById('rp-form').querySelectorAll('input').forEach(i => i.disabled = true);
      document.getElementById('rp-submit').disabled = true;
    }
    // Pre-fill form with existing data
    document.getElementById('rp-company').value = _placement.company_name       ?? '';
    document.getElementById('rp-nature').value  = _placement.nature_of_business ?? '';
    document.getElementById('rp-contact').value = _placement.contact_person     ?? '';
    document.getElementById('rp-phone').value   = _placement.company_contact_phone ?? '';
    document.getElementById('rp-region').value  = _placement.region             ?? '';
    document.getElementById('rp-city').value    = _placement.city_town          ?? '';
    document.getElementById('rp-street').value  = _placement.street_landmark    ?? '';
    document.getElementById('rp-start').value   = _placement.start_date         ?? '';
    document.getElementById('rp-end').value     = _placement.end_date           ?? '';
    return;
  }

  if (!windowOpen) {
    document.getElementById('rp-window-closed').classList.remove('hidden');
    document.getElementById('rp-form').querySelectorAll('input').forEach(i => i.disabled = true);
    document.getElementById('rp-submit').disabled = true;
    return;
  }

  document.getElementById('rp-form').addEventListener('submit', handleRegisterPlacement);
}

function rpFieldErr(id, show) {
  document.getElementById(id).classList.toggle('hidden', !show);
}

async function handleRegisterPlacement(e) {
  e.preventDefault();
  document.getElementById('rp-banner').classList.add('hidden');

  const company_name          = document.getElementById('rp-company').value.trim();
  const nature_of_business    = document.getElementById('rp-nature').value.trim();
  const contact_person        = document.getElementById('rp-contact').value.trim();
  const company_contact_phone = document.getElementById('rp-phone').value.trim();
  const region                = document.getElementById('rp-region').value.trim();
  const city_town             = document.getElementById('rp-city').value.trim();
  const street_landmark       = document.getElementById('rp-street').value.trim();
  const start_date            = document.getElementById('rp-start').value;
  const end_date              = document.getElementById('rp-end').value;

  let ok = true;
  rpFieldErr('rp-company-err', !company_name);      if (!company_name)          ok = false;
  rpFieldErr('rp-nature-err',  !nature_of_business); if (!nature_of_business)   ok = false;
  rpFieldErr('rp-contact-err', !contact_person);    if (!contact_person)        ok = false;
  rpFieldErr('rp-phone-err',   !company_contact_phone); if (!company_contact_phone) ok = false;
  rpFieldErr('rp-region-err',  !region);            if (!region)                ok = false;
  rpFieldErr('rp-city-err',    !city_town);         if (!city_town)             ok = false;
  rpFieldErr('rp-street-err',  !street_landmark);   if (!street_landmark)       ok = false;
  rpFieldErr('rp-start-err',   !start_date);        if (!start_date)            ok = false;
  rpFieldErr('rp-end-err',     !end_date);          if (!end_date)              ok = false;
  if (!ok) return;

  const btn = document.getElementById('rp-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  // Attempt GPS capture (non-blocking, 8 s timeout)
  let latitude = null, longitude = null, location_source = 'manual';
  const gpsLabel = document.getElementById('rp-gps-label');
  gpsLabel.textContent = 'Capturing location…';
  try {
    const pos = await new Promise((res, rej) => {
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 0 });
    });
    latitude        = pos.coords.latitude;
    longitude       = pos.coords.longitude;
    location_source = 'gps';
    gpsLabel.textContent = `Location captured (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
  } catch {
    gpsLabel.textContent = 'Location unavailable — submitting with address only.';
  }

  const { data: saved, error } = await syncPlacement({
    draft_id:    generateUuid(),
    student_id:  userId,
    season_id:   _season.id,
    company_name, nature_of_business, contact_person, company_contact_phone,
    region, city_town, street_landmark, start_date, end_date,
    latitude, longitude, location_source,
  });

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="send"></i> Submit Placement';

  if (error) {
    document.getElementById('rp-banner-msg').textContent = error.message;
    document.getElementById('rp-banner').classList.remove('hidden');
    return;
  }

  _placement = saved;
  showToast('Placement submitted successfully.', 'success');

  // Refresh notice
  document.getElementById('rp-submitted-notice').classList.remove('hidden');
  document.getElementById('rp-notice-title').textContent = 'Placement submitted.';
  document.getElementById('rp-notice-body').textContent =
    ` ${saved.company_name} · ${formatAddress(saved)}`;
  document.getElementById('rp-form').querySelectorAll('input').forEach(i => i.disabled = true);
  document.getElementById('rp-submit').disabled = true;
}

// ── 9. Phase 2 section loaders ───────────────────────────────────────────────
let _attendanceLoaded = false;
let _logbookLoaded    = false;
let _profileLoaded2   = false;
let _settingsLoaded   = false;

async function loadAttendancePage() {
  if (_attendanceLoaded) return;
  _attendanceLoaded = true;
  await initAttendance(userId, _season?.id ?? null, _placement);
}

async function loadLogbookPage() {
  if (_logbookLoaded) return;
  _logbookLoaded = true;
  const seasonLabel = document.getElementById('lb-season-label');
  if (seasonLabel && _season) seasonLabel.textContent = `Season: ${_season.name}`;
  await initLogbook(userId, _season?.id ?? null, _placement);
}

async function loadProfilePage() {
  if (_profileLoaded2) return;
  _profileLoaded2 = true;
  await initProfile(userId);
}

async function loadSettingsPage() {
  if (_settingsLoaded) return;
  _settingsLoaded = true;
  await initSettings();
}

// Legacy name used by existing code (generate-letter, register-placement still call loadProfile)
async function loadProfile() { await loadProfilePage(); }

// ── 10. Initial page dispatch ─────────────────────────────────────────────────
if (initialPage === 'generate-letter')    loadGenerateLetter();
if (initialPage === 'register-placement') loadRegisterPlacement();
if (initialPage === 'attendance')         loadAttendancePage();
if (initialPage === 'logbook')            loadLogbookPage();
if (initialPage === 'profile')            loadProfilePage();
if (initialPage === 'settings')           loadSettingsPage();