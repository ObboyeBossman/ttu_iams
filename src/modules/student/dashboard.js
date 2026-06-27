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
import { listLogbookWeeks }                 from '/shared/services/logbook.service.js';
import { getAttachmentReport }              from '/shared/services/attachment-report.service.js';
import { initAttendance }                  from './attendance/attendance.js';
import { initLogbook }                     from './logbook/logbook.js';
import { initProfile }                     from './profile/profile.js';
import { initSettings, applyStoredTheme }  from './settings/settings.js';
import { generateAndDownloadLetter }       from '/shared/pdf/generate-letter.js';
import './dashboard-widgets.css';
import './placement/placement.css';
import { initPlacement }                   from './placement/placement.js';
import { initReport }                      from './report/report.js';
import './report/report.css';

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
const PAGE_KEYS = ['dashboard', 'generate-letter', 'register-placement', 'attendance', 'logbook', 'attachment-report', 'profile', 'settings'];

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
    if (page === 'attachment-report')  loadReportPage();
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

// --- TEMPORARY SEED SCRIPT ---
if (_season && _placement && _placement.status === 'assigned') {
  const seedFlag = localStorage.getItem('__seeded_logs_v3');
  if (!seedFlag) {
    console.log("Force seeding mock logs for testing...");
    localStorage.setItem('__seeded_logs_v3', 'true');

    try {
      const week1Id = generateUuid();
      const week2Id = generateUuid();
      
      // Upsert Weeks 1 & 2
      await supabase.from('logbook_weeks').upsert([
        { id: week1Id, student_id: userId, placement_id: _placement.id, season_id: _season.id, week_number: 1, week_start: '2026-01-06', week_end: '2026-01-12', department_section: 'Port Operations', student_remarks: 'Learned about cargo handling.', status: 'draft' },
        { id: week2Id, student_id: userId, placement_id: _placement.id, season_id: _season.id, week_number: 2, week_start: '2026-01-13', week_end: '2026-01-19', department_section: 'Logistics', student_remarks: 'Assisted in supply chain management.', status: 'draft' }
      ], { onConflict: 'student_id, season_id, week_number' });

      // Re-fetch the actual IDs in case they existed
      const { data: wks } = await supabase.from('logbook_weeks').select('id, week_number').eq('student_id', userId).in('week_number', [1, 2]);
      const w1 = wks?.find(w => w.week_number === 1)?.id;
      const w2 = wks?.find(w => w.week_number === 2)?.id;
      
      if (w1 && w2) {
        // Safely insert daily entries (will fail silently on unique constraint)
        await supabase.from('logbook_daily_entries').insert([
          { week_id: w1, log_date: '2026-01-06', activities: 'Orientation and facility tour.' },
          { week_id: w1, log_date: '2026-01-07', activities: 'Observed cargo loading processes.' },
          { week_id: w1, log_date: '2026-01-08', activities: 'Data entry for incoming vessels.' },
          { week_id: w1, log_date: '2026-01-09', activities: 'Shadowed the logistics manager.' },
          { week_id: w1, log_date: '2026-01-10', activities: 'Prepared weekly summary report.' },
          { week_id: w2, log_date: '2026-01-13', activities: 'Learned inventory management software.' },
          { week_id: w2, log_date: '2026-01-14', activities: 'Assisted in warehouse auditing.' },
          { week_id: w2, log_date: '2026-01-15', activities: 'Attended safety briefing.' },
          { week_id: w2, log_date: '2026-01-16', activities: 'Coordinated with transport team.' },
          { week_id: w2, log_date: '2026-01-17', activities: 'End of week review.' }
        ]).catch(() => {});
      }
      
      // Force all weeks for this student to submitted
      await supabase.from('logbook_weeks').update({ status: 'submitted' }).eq('student_id', userId).eq('status', 'draft');
      
      // Upsert summary
      await supabase.from('logbook_monthly_summaries').upsert([
        { student_id: userId, placement_id: _placement.id, season_id: _season.id, month_number: 1, student_summary: 'My first month focused on port operations and logistics. Developed solid practical knowledge of supply chain management.', status: 'draft' }
      ], { onConflict: 'student_id, season_id, month_number' });
      await supabase.from('logbook_monthly_summaries').update({ status: 'submitted' }).eq('student_id', userId);
      
      // Safely insert attendance (will fail silently if exists)
      await supabase.from('attendance_logs').insert([
        { student_id: userId, placement_id: _placement.id, season_id: _season.id, log_date: '2026-01-06', check_in_time: '2026-01-06T08:00:00Z', status: 'present' },
        { student_id: userId, placement_id: _placement.id, season_id: _season.id, log_date: '2026-01-07', check_in_time: '2026-01-07T08:05:00Z', status: 'present' },
        { student_id: userId, placement_id: _placement.id, season_id: _season.id, log_date: '2026-01-08', check_in_time: '2026-01-08T07:55:00Z', status: 'present' }
      ]).catch(() => {});
      
      console.log("Mock logs seeded successfully!");
      showToast("Test logs & attendance successfully seeded to remote DB!", "success");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      console.error("Seed failed:", e);
    }
  }
}
// --- END TEMPORARY SCRIPT ---
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

  // Logbook count stat card
  _renderLogbookStat();

  // Report status stat card
  _renderReportStat();

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

async function _renderLogbookStat() {
  const el = document.getElementById('dash-logbook-weeks');
  if (!_placement || _placement.status !== 'assigned' || !_season) {
    if (el) el.textContent = '—';
    return;
  }
  const { data: weeks } = await listLogbookWeeks(userId, _season.id);
  const submitted = (weeks ?? []).filter(w => w.status === 'submitted' || w.status === 'certified').length;
  if (el) el.textContent = submitted;
}

async function _renderReportStat() {
  const elStatus = document.getElementById('dash-report-status');
  const elPath = document.getElementById('dash-report-path');
  
  if (!_placement || _placement.status !== 'assigned' || !_season) {
    if (elStatus) elStatus.textContent = '—';
    if (elPath) elPath.textContent = 'no active placement';
    return;
  }

  const { data: report } = await getAttachmentReport(userId, _season.id);
  if (!report) {
    if (elStatus) elStatus.textContent = 'Not Started';
    if (elPath) elPath.textContent = 'awaiting submission';
    return;
  }

  if (elStatus) {
    elStatus.textContent = report.status;
    const colors = {
      'draft': 'var(--amber)',
      'submitted': 'var(--blue)',
      'flagged': 'var(--ttu-red)',
      'approved': 'var(--green)'
    };
    elStatus.style.color = colors[report.status] || 'var(--text-primary)';
  }

  if (elPath) {
    elPath.textContent = report.path_type === 'ai' ? 'AI Generator Path' : 
                         report.path_type === 'self' ? 'Manual PDF Upload' : 'Path Selected';
  }
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

  const hasPlacement = !!_placement;

  // Season window gate or placement registered gate
  const alertEl = document.getElementById('gl-window-closed');
  if (hasPlacement) {
    document.getElementById('gl-form').classList.add('hidden');
    // Hide the divider as well since the form is hidden
    const divider = document.getElementById('gl-form').nextElementSibling;
    if (divider && divider.classList.contains('divider')) divider.classList.add('hidden');
    
    alertEl.className = 'alert alert-info';
    alertEl.innerHTML = 'You have already registered a placement. Letter generation and downloads are disabled.';
    alertEl.classList.remove('hidden');
  } else {
    const windowOpen = isPlacementWindowOpen(_season);
    alertEl.className = 'alert alert-warning' + (windowOpen ? ' hidden' : '');
    alertEl.innerHTML = 'The placement submission window is currently closed. You cannot generate new letters outside the active season window.';
    document.getElementById('gl-submit').disabled = !windowOpen;
  }

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
    const hasPlacement = !!_placement;
  hist.innerHTML = seasonLetters.map(l => `
    <div class="letter-history-item" style="padding:10px 0;border-bottom:0.5px solid var(--border-default); cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:13px;font-weight:500;">${l.company_name}</div>
          <div style="font-size:12px;color:var(--text-secondary);">
            ${formatAddress(l)} &nbsp;·&nbsp; ${formatDate(l.generated_at)}
          </div>
          <code style="font-size:11px;color:var(--text-muted);">${l.verification_code}</code>
        </div>
        <button class="icon-btn download-letter-btn" data-letter-id="${l.id}" title="${hasPlacement ? 'Downloads disabled' : 'Download PDF'}" style="width:32px;height:32px; ${hasPlacement ? 'opacity:0.3; cursor:not-allowed;' : ''}" ${hasPlacement ? 'disabled' : ''}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
      </div>
      <div class="letter-details hidden" style="margin-top:12px; padding:12px; background:var(--bg-prefix); border-radius:6px; font-size:12px; color:var(--text-primary);">
        <div style="margin-bottom:6px;"><strong>Contact Person:</strong> ${l.contact_person}</div>
        <div style="margin-bottom:6px;"><strong>Company Phone:</strong> ${l.company_phone}</div>
        <div style="margin-bottom:6px;"><strong>Generated:</strong> ${new Date(l.generated_at).toLocaleString()}</div>
        ${hasPlacement ? `<div style="color:var(--text-secondary); margin-top:8px;"><em>Downloads are disabled because you have an active placement.</em></div>` : ''}
      </div>
    </div>`).join('');
}

// Event delegation for toggling letter details
document.addEventListener('click', (e) => {
  const item = e.target.closest('.letter-history-item');
  if (!item) return;

  // Don't expand if they clicked the download button
  if (e.target.closest('.download-letter-btn')) return;

  const detailsEl = item.querySelector('.letter-details');
  if (detailsEl) {
    detailsEl.classList.toggle('hidden');
  }
});

// Event delegation for downloading letters
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.download-letter-btn');
  if (!btn || !!_placement) return;
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
    await generateAndDownloadLetter(letter, studentProfile, _season);
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
    await generateAndDownloadLetter(letter, studentProfile, _season);
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
  await initPlacement(userId, _season, _placement, profile);
}

// ── 9. Phase 2 section loaders ───────────────────────────────────────────────
let _attendanceLoaded = false;
let _logbookLoaded    = false;
let _profileLoaded2   = false;
let _settingsLoaded   = false;

async function loadAttendancePage() {
  if (_attendanceLoaded) return;
  _attendanceLoaded = true;
  await initAttendance(userId, _season?.id ?? null, _placement, fullName);
}

async function loadLogbookPage() {
  if (_logbookLoaded) return;
  _logbookLoaded = true;
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

let _reportLoaded = false;
async function loadReportPage() {
  if (_reportLoaded) return;
  _reportLoaded = true;
  await initReport(userId, _season?.id ?? null, _placement);
}

// Legacy name used by existing code (generate-letter, register-placement still call loadProfile)
async function loadProfile() { await loadProfilePage(); }

// ── 10. Initial page dispatch ─────────────────────────────────────────────────
if (initialPage === 'generate-letter')    loadGenerateLetter();
if (initialPage === 'register-placement') loadRegisterPlacement();
if (initialPage === 'attendance')         loadAttendancePage();
if (initialPage === 'logbook')            loadLogbookPage();
if (initialPage === 'attachment-report')  loadReportPage();
if (initialPage === 'profile')            loadProfilePage();
if (initialPage === 'settings')           loadSettingsPage();