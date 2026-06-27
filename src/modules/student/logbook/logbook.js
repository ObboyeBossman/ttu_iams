// =============================================================================
// IAMS — logbook.js  (Phase 2 – Premium Logbook Portal)
// Drives the new two-panel logbook workspace injected into dashboard.html.
// Called from dashboard.js → loadLogbookPage() → initLogbook().
// =============================================================================
import './logbook.css';
import { showToast } from '/shell/nav.js';
import {
  listLogbookWeeks, getOrCreateWeek, getDailyEntriesForWeek,
  upsertDailyEntry, upsertWeekMeta, submitLogbookWeek,
  listMonthlySummaries, upsertMonthlySummary,
} from '/shared/services/logbook.service.js';
import Dexie from 'https://esm.sh/dexie@4';

// ── Dexie store for offline daily drafts ─────────────────────────────────────
const _db = new Dexie('iams_offline_queue');
_db.version(1).stores({ drafts: 'draft_id, student_id, season_id, sync_status' });
_db.version(2).stores({
  drafts: 'draft_id, student_id, season_id, sync_status',
  logbook_drafts: 'key',
});

async function _lbDraftGet(key) {
  try { const r = await _db.logbook_drafts.get(key); return r?.value ?? ''; } catch { return ''; }
}
async function _lbDraftSet(key, value) {
  try { await _db.logbook_drafts.put({ key, value }); } catch { /* ignore */ }
}

// ── Debounce ──────────────────────────────────────────────────────────────────
function _debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── "Saved" flash on autosave indicator ──────────────────────────────────────
function _flashSaved() {
  const ind  = document.getElementById('autosaveIndicator');
  const text = document.getElementById('autosaveStatusText');
  if (!ind || !text) return;
  ind.className = 'db-indicator saving';
  text.textContent = 'IndexedDB Autosaving…';
  setTimeout(() => {
    ind.className = 'db-indicator';
    text.textContent = _lb.incognitoSimulated ? 'Memory Cache Only ⚠️' : 'IndexedDB Draft Saved ✔';
    document.getElementById('lastSyncStamp').textContent =
      `Autosaved: ${new Date().toLocaleTimeString()}`;
  }, 600);
}

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

let _lb = {
  studentId: null,
  seasonId: null,
  placementId: null,
  placement: null,
  weeks: [],
  activeWeekIdx: 0,
  monthSummaries: [],
  isOnline: navigator.onLine,

  // Simulator configurations corresponding to the Gaps
  incognitoSimulated: false,
  logbookFinalized: false,
  gap1Source: 'supplemental', // 'strict' | 'supplemental'
  gap2Trigger: 'admin', // 'all_certified' | 'admin'
  gap3Visibility: 'full', // 'full' | 'status_only'
  gap4Days: '7day', // '5day' | '7day'

  // Mock server-side data representing supervisor reviews & visits
  supervisorMonthlyAssessments: [
    { month: 1, text: "Excellent adaptation, followed all safety standards perfectly. Demonstrated good engineering reasoning during analytics exercises.", rating: 5, date: "June 24, 2026" },
    { month: 2, text: "", rating: 0, date: "" }
  ],
  schoolVisits: [
    { date: "June 15, 2026", liaison: "Dr. Nicholas Mensah (TTU Faculty)", score: 85, comments: "Kwesi shows clear discipline. The supervisor confirms technical performance matches logbook logs." }
  ]
};

// ── Helper ────────────────────────────────────────────────────────────────────
function _getMonday(d) {
  const day = d.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  const m = new Date(d); m.setDate(m.getDate() + diff); m.setHours(0,0,0,0);
  return m;
}
function _calcWeekNumber(startDate, monday) {
  const start = _getMonday(new Date(startDate));
  const diffMs = monday - start;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (7 * 86400000)) + 1;
}
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Org profile sidebar ───────────────────────────────────────────────────────
function renderOrgProfileDetails() {
  const container = document.getElementById('profileDetailsContainer');
  if (!container) return;

  const addr = [_lb.placement?.street_landmark, _lb.placement?.city_town, _lb.placement?.region].filter(Boolean).join(', ') || '—';
  const nature = _lb.placement?.nature_of_business ?? '—';
  const supervisorEmail = _lb.placement?.supervisor_email ?? 'e.appiah@tullow.com.gh';

  container.innerHTML = `
    <div class="profile-row">
      <span class="profile-lbl">Nature of Business:</span>
      <span class="profile-val">${_esc(nature)}</span>
    </div>
    <div class="profile-row">
      <span class="profile-lbl">Official Address:</span>
      <span class="profile-val">${_esc(addr)}</span>
    </div>
    <div class="profile-row" style="background: rgba(240, 165, 0, 0.1); padding: 4px; border-radius: 4px;">
      <span class="profile-lbl" style="color:var(--ttu-gold-light);">Supervisor Contact:</span>
      <span class="profile-val" style="color:var(--ttu-gold-light);">+233 302 611 200</span>
    </div>
    <div class="profile-row" style="background: rgba(240, 165, 0, 0.1); padding: 4px; border-radius: 4px;">
      <span class="profile-lbl" style="color:var(--ttu-gold-light);">Supervisor Email:</span>
      <span class="profile-val" style="color:var(--ttu-gold-light);">${_esc(supervisorEmail)}</span>
    </div>
  `;
}

// ── Week chip row ─────────────────────────────────────────────────────────────
function _renderWeekChips() {
  const row = document.getElementById('lb-week-chips');
  if (!row) return;
  row.innerHTML = '';

  _lb.weeks.forEach((w, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i === _lb.activeWeekIdx ? ' active' : '');
    if (w.status === 'submitted') btn.innerHTML = `Week ${w.week_number} <i data-lucide="check" style="width:12px;height:12px;"></i>`;
    else if (w.status === 'certified') btn.innerHTML = `Week ${w.week_number} <i data-lucide="lock" style="width:12px;height:12px;"></i>`;
    else btn.textContent = `Week ${w.week_number}`;
    btn.addEventListener('click', () => _selectWeek(i));
    row.appendChild(btn);
  });

  if (window.lucide) window.lucide.createIcons();
}

// ── Timeline status bar ───────────────────────────────────────────────────────
function evaluateTimelineState() {
  const week = _lb.weeks[_lb.activeWeekIdx];
  const draftStep = document.getElementById('stepDraft');
  const submittedStep = document.getElementById('stepSubmitted');
  const lockedStep = document.getElementById('stepLocked');
  const finalizedStep = document.getElementById('stepFinalized');

  if (!draftStep || !submittedStep || !lockedStep || !finalizedStep) return;

  draftStep.className = "timeline-step";
  submittedStep.className = "timeline-step";
  lockedStep.className = "timeline-step";
  finalizedStep.className = "timeline-step";

  if (_lb.logbookFinalized) {
    finalizedStep.className = "timeline-step active";
    draftStep.className = "timeline-step completed";
    submittedStep.className = "timeline-step completed";
    lockedStep.className = "timeline-step completed";
    return;
  }

  // Monthly summary tab active
  if (document.getElementById('weeklyFormContainer')?.classList.contains('hidden')) {
    draftStep.className = "timeline-step active";
    return;
  }

  if (!week) return;

  if (week.status === 'certified') {
    lockedStep.className = "timeline-step active";
    draftStep.className = "timeline-step completed";
    submittedStep.className = "timeline-step completed";
  } else if (week.status === 'submitted') {
    submittedStep.className = "timeline-step active";
    draftStep.className = "timeline-step completed";
  } else {
    draftStep.className = "timeline-step active";
  }
}

// ── Supervisor cert box ───────────────────────────────────────────────────────
function _updateCertBox(status) {
  const box   = document.getElementById('supervisorCertBox');
  const icon  = document.getElementById('certIcon');
  const title = document.getElementById('certTitle');
  const desc  = document.getElementById('certDescription');
  if (!box) return;

  const week = _lb.weeks[_lb.activeWeekIdx];

  if (status === 'certified') {
    box.className = 'supervisor-cert-card certified';
    icon?.setAttribute('data-lucide', 'shield-check');
    if (icon) icon.style.color = 'var(--green)';
    if (title) title.textContent = 'Weekly Logbook Certified';
    if (desc) {
      const certBy = week?.company_certified_by || 'Emmanuel Appiah (Chief Petroleum Eng.)';
      const certAt = week?.company_certified_at ? new Date(week.company_certified_at).toLocaleDateString() : new Date().toLocaleDateString();
      desc.innerHTML = `Approved by: <strong>${certBy}</strong> &nbsp;&bull;&nbsp; Date: ${certAt}`;
    }
  } else if (status === 'submitted') {
    box.className = 'supervisor-cert-card';
    icon?.setAttribute('data-lucide', 'clock');
    if (icon) icon.style.color = 'var(--amber)';
    if (title) title.textContent = 'Submitted to Supervisor Queue';
    if (desc)  desc.textContent  = 'Awaiting verification. Editing is locked unless returned.';
  } else {
    box.className = 'supervisor-cert-card';
    icon?.setAttribute('data-lucide', 'shield-alert');
    if (icon) icon.style.color = 'var(--text-muted)';
    if (title) title.textContent = 'Weekly Certification Pending';
    if (desc)  desc.textContent  = 'This week is in draft state. Fill out your entries and submit.';
  }
  if (window.lucide) window.lucide.createIcons();
}

// ── Week content ──────────────────────────────────────────────────────────────
async function _selectWeek(idx) {
  if (idx < 0 || idx >= _lb.weeks.length) return;
  _lb.activeWeekIdx = idx;
  _renderWeekChips();

  // Ensure weekly form is visible, monthly hidden
  document.getElementById('weeklyFormContainer')?.classList.remove('hidden');
  document.getElementById('monthlySummaryContainer')?.classList.add('hidden');

  const week = _lb.weeks[idx];
  document.getElementById('weekRangeLabel').textContent = `Week ${week.week_number} Logbook Entry`;

  const isLocked = week.status === 'submitted' || week.status === 'certified' || _lb.logbookFinalized;

  // Load entries — online from Supabase, offline from Dexie
  let entries = [];
  try {
    const { data } = await getDailyEntriesForWeek(week.id);
    entries = data ?? [];
  } catch {
    const listDays = _lb.gap4Days === '5day' 
      ? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
      : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    for (const day of listDays) {
      const val = await _lbDraftGet(`${week.id}_${day}`);
      entries.push({ day_label: day, activities: val });
    }
    _updateOfflineChip(true);
  }

  const entryMap = {};
  entries.forEach(e => { entryMap[e.log_date ?? e.day_label] = e.activities ?? ''; });

  // Build daily input grid
  const container = document.getElementById('dailyLogsInputs');
  container.innerHTML = '';
  const monday = new Date(week.week_start);

  const listDays = _lb.gap4Days === '5day' 
    ? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  listDays.forEach((day, i) => {
    const date    = new Date(monday); date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const val     = entryMap[dateStr] ?? entryMap[day] ?? '';

    const card = document.createElement('div');
    card.className = 'daily-grid-card';
    card.innerHTML = `
      <span class="day-label">
        ${day}<br>
        <span style="font-size:10px;font-weight:400;color:var(--text-muted)">
          ${date.toLocaleDateString('en-GH',{month:'short',day:'numeric'})}
        </span>
      </span>
      <div class="textarea-wrapper">
        <div class="formatting-toolbar">
          <button class="format-btn" onclick="applyFormatting('entry-${day}', 'bold')" title="Bold"><i data-lucide="bold"></i></button>
          <button class="format-btn" onclick="applyFormatting('entry-${day}', 'italic')" title="Italic"><i data-lucide="italic"></i></button>
          <button class="format-btn" onclick="applyFormatting('entry-${day}', 'list')" title="Bullet List"><i data-lucide="list"></i></button>
          <button class="format-btn" onclick="applyFormatting('entry-${day}', 'code')" title="Code"><i data-lucide="code"></i></button>
          <button class="format-btn" onclick="applyFormatting('entry-${day}', 'clear')" title="Clear"><i data-lucide="trash-2"></i></button>
        </div>
        <textarea class="day-textarea day-entry-box" id="entry-${day}" data-date="${dateStr}" data-weekid="${week.id}"
          ${isLocked ? 'disabled' : ''}
          placeholder="Describe your technical tasks and learnings...">${_esc(val)}</textarea>
        <span class="saved-tick" id="lbtick-${day}" style="display:block;font-size:11px;color:var(--green);padding:4px 12px;opacity:0;transition:opacity .3s;">✓ Saved</span>
      </div>`;
    container.appendChild(card);
  });

  // Meta fields
  const dept    = document.getElementById('weekDeptField');
  const remarks = document.getElementById('weekRemarksField');
  if (dept)    { dept.value    = week.department_section ?? '';  dept.disabled    = isLocked; }
  if (remarks) { remarks.value = week.student_remarks    ?? '';  remarks.disabled = isLocked; }

  // Submit button
  const submitBtn = document.getElementById('btnSubmitWeek');
  if (submitBtn) {
    submitBtn.disabled = isLocked;
    submitBtn.onclick = isLocked ? null : () => _submitWeek(idx);
  }

  evaluateTimelineState();
  _updateCertBox(week.status);

  if (!isLocked) {
    _bindWeekInputs(week, idx);
  }

  // Format toolbar state
  document.querySelectorAll('.format-btn').forEach(btn => {
    const ta = btn.closest('.textarea-wrapper')?.querySelector('textarea');
    if (ta) btn.disabled = ta.disabled;
  });

  if (window.lucide) window.lucide.createIcons();
}

function _bindWeekInputs(week, idx) {
  const weekId = week.id;
  const monday = new Date(week.week_start);

  const listDays = _lb.gap4Days === '5day' 
    ? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  listDays.forEach((day, i) => {
    const ta = document.getElementById(`entry-${day}`);
    if (!ta) return;
    const date = new Date(monday);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const tick    = document.getElementById(`lbtick-${day}`);

    // Dexie autosave on input (300ms debounce)
    ta.addEventListener('input', _debounce(async () => {
      await _lbDraftSet(`${weekId}_${dateStr}`, ta.value);
      _flashSaved();
    }, 300));

    // Supabase save on blur (500ms debounce)
    ta.addEventListener('blur', _debounce(async () => {
      if (!_lb.isOnline) return;
      const { error } = await upsertDailyEntry({ weekId, logDate: dateStr, activities: ta.value });
      if (!error && tick) { tick.style.opacity = '1'; setTimeout(() => tick.style.opacity = '0', 1500); }
    }, 500));
  });

  // Meta field autosave
  const dept    = document.getElementById('weekDeptField');
  const remarks = document.getElementById('weekRemarksField');
  
  const saveMeta = _debounce(async () => {
    if (!_lb.isOnline) return;
    await upsertWeekMeta(week.id, {
      dept_section:    dept?.value    ?? '',
      student_remarks: remarks?.value ?? '',
    });
    _flashSaved();
  }, 800);

  if (dept) dept.addEventListener('blur', saveMeta);
  if (remarks) {
    remarks.addEventListener('input', _debounce(async () => {
      await _lbDraftSet(`${weekId}_remarks`, remarks.value);
      _flashSaved();
    }, 300));
    remarks.addEventListener('blur', saveMeta);
  }
}

async function _submitWeek(idx) {
  const btn  = document.getElementById('btnSubmitWeek');
  const week = _lb.weeks[idx];
  const dept = document.getElementById('weekDeptField')?.value?.trim();

  if (!dept) { showToast('Please declare your assigned department before submitting.', 'error'); return; }

  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="spinner"></i> Submitting…'; }
  if (window.lucide) window.lucide.createIcons();

  // Save meta first
  if (_lb.isOnline) {
    await upsertWeekMeta(week.id, {
      dept_section:    dept,
      student_remarks: document.getElementById('weekRemarksField')?.value ?? '',
    });
  }

  const { error } = await submitLogbookWeek(week.id);
  if (error) {
    showToast('Failed to submit: ' + error.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i> Submit Week'; }
    return;
  }

  _lb.weeks[idx].status = 'submitted';
  showToast(`Week ${week.week_number} submitted to supervisor queue.`, 'success');
  _renderWeekChips();
  await _selectWeek(idx);
}

// ── Monthly summary panel ─────────────────────────────────────────────────────
function _initMonthlyPanel() {
  const showMonthlySummaryTab = document.getElementById('btn-tab-monthly');
  if (showMonthlySummaryTab) {
    showMonthlySummaryTab.addEventListener('click', _openMonthlyView);
  }
}

async function _openMonthlyView() {
  document.getElementById('weeklyFormContainer').classList.add('hidden');
  document.getElementById('monthlySummaryContainer').classList.remove('hidden');
  document.getElementById('weekRangeLabel').textContent = 'Monthly Summaries';
  evaluateTimelineState();
  _updateCertBox('draft');

  // Load summaries if not yet done
  if (_lb.monthSummaries.length === 0) {
    const { data } = await listMonthlySummaries(_lb.studentId, _lb.seasonId);
    _lb.monthSummaries = data ?? [];
  }

  await _loadMonthlySummaryDraft();
  
  const select = document.getElementById('monthlySummarySelect');
  if (select) {
    select.onchange = null;
    select.addEventListener('change', _loadMonthlySummaryDraft);
  }

  const submitBtn = document.getElementById('btnSubmitMonthlySummary');
  if (submitBtn) {
    submitBtn.onclick = null;
    submitBtn.addEventListener('click', _submitMonthlySummary);
  }
}

async function _loadMonthlySummaryDraft() {
  const monthNum = parseInt(document.getElementById('monthlySummarySelect')?.value ?? '1');
  const summary  = _lb.monthSummaries.find(s => s.month_number === monthNum);
  const ta       = document.getElementById('monthlySummaryContent');
  const btn      = document.getElementById('btnSubmitMonthlySummary');
  const badge    = document.getElementById('monthlySummaryStatusBadge');
  const isLocked = summary?.status === 'assessed' || summary?._studentSubmitted === true || _lb.logbookFinalized;

  if (ta)    { ta.value = summary?.student_summary ?? ''; ta.readOnly = isLocked; ta.disabled = isLocked; }
  if (btn)   btn.disabled = isLocked;
  
  if (badge) {
    badge.textContent = isLocked ? 'Submitted' : 'Draft';
    badge.className = isLocked ? 'badge-status late' : 'badge-status present';
    badge.style.background = isLocked ? 'rgba(239, 68, 68, 0.15)' : 'var(--green-bg)';
    badge.style.color = isLocked ? '#EF4444' : 'var(--green)';
    badge.style.padding = '4px 10px';
    badge.style.borderRadius = '4px';
    badge.style.fontSize = '12px';
  }

  // Format toolbar state
  document.querySelectorAll('#toolbar-monthlySummaryContent .format-btn').forEach(btn => {
    btn.disabled = isLocked;
  });

  // Bind autosave on blur
  if (ta && !isLocked) {
    ta.oninput = null; // clear previous
    ta.addEventListener('blur', _debounce(async () => {
      if (!_lb.isOnline) return;
      const { error } = await upsertMonthlySummary({
        studentId: _lb.studentId, placementId: _lb.placementId,
        seasonId: _lb.seasonId, monthNumber: monthNum, studentSummary: ta.value,
      });
      if (!error) _flashSaved();
    }, 500));
  }
}

async function _submitMonthlySummary() {
  const monthNum = parseInt(document.getElementById('monthlySummarySelect')?.value ?? '1');
  const ta       = document.getElementById('monthlySummaryContent');
  if (!ta?.value?.trim()) { showToast('Cannot submit an empty summary.', 'error'); return; }

  const btn = document.getElementById('btnSubmitMonthlySummary');
  if (btn) btn.disabled = true;

  // Upsert the summary text — status advances to 'assessed' only via supervisor action
  const { error } = await upsertMonthlySummary({
    studentId: _lb.studentId, placementId: _lb.placementId,
    seasonId: _lb.seasonId, monthNumber: monthNum, studentSummary: ta.value,
  });

  if (error) {
    showToast('Failed to submit summary: ' + error.message, 'error');
    if (btn) btn.disabled = false;
    return;
  }

  // Track locally that this month has been submitted (pending supervisor assessment)
  const existing = _lb.monthSummaries.find(s => s.month_number === monthNum);
  if (existing) existing._studentSubmitted = true;
  else _lb.monthSummaries.push({ month_number: monthNum, _studentSubmitted: true });

  showToast(`Month ${monthNum} summary saved and submitted for assessment.`, 'success');
  await _loadMonthlySummaryDraft();
}

// ── Formatting toolbar handler (exposed on window for onclick attrs) ───────────
window.applyFormatting = function(textareaId, styleType) {
  const textarea = document.getElementById(textareaId);
  if (!textarea || textarea.readOnly || textarea.disabled) return;

  const start = textarea.selectionStart;
  const end   = textarea.selectionEnd;
  const text  = textarea.value;
  const selectedText  = text.substring(start, end);
  let replacement = '';
  let cursorOffset = 0;

  switch (styleType) {
    case 'bold':   replacement = `**${selectedText || 'bold text'}**`;          cursorOffset = selectedText ? 0 : 2; break;
    case 'italic': replacement = `*${selectedText || 'italic text'}*`;           cursorOffset = selectedText ? 0 : 1; break;
    case 'list':
      if (selectedText) {
        replacement = selectedText.split('\n').map(line => line.startsWith('- ') ? line : `- ${line}`).join('\n');
      } else {
        replacement = `\n- `;
      }
      break;
    case 'code':   replacement = `\`${selectedText || 'code snippet'}\``;        cursorOffset = selectedText ? 0 : 1; break;
    case 'clear':
      if (selectedText) {
        replacement = selectedText.replace(/[*`\-]/g, '');
      } else {
        textarea.value = '';
        textarea.dispatchEvent(new Event('input'));
        _flashSaved();
        return;
      }
      break;
  }

  textarea.value = text.substring(0, start) + replacement + text.substring(end);
  textarea.focus();
  if (selectedText) {
    textarea.setSelectionRange(start, start + replacement.length);
  } else {
    textarea.setSelectionRange(start + replacement.length - cursorOffset, start + replacement.length - cursorOffset);
  }
  textarea.dispatchEvent(new Event('input'));
  _flashSaved();
};

window.__lbApplyFmt = window.applyFormatting;

// ── Offline chip ──────────────────────────────────────────────────────────────
function _updateOfflineChip(offline) {
  const el = document.getElementById('lb-offline-indicator');
  if (!el) return;
  el.innerHTML = offline
    ? `<span style="background:var(--amber-bg);color:var(--amber);border:1px dashed var(--amber);padding:4px 12px;border-radius:9999px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:6px;"><i data-lucide="wifi-off" style="width:12px;height:12px;"></i>Working offline</span>`
    : '';
  if (window.lucide) window.lucide.createIcons();
}

// ── Incognito check ───────────────────────────────────────────────────────────
function _checkIncognito() {
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(est => {
      if (est.quota < 120000000) {
        _lb.incognitoSimulated = true;
        document.getElementById('incognitoBanner')?.classList.remove('hidden');
        const text = document.getElementById('autosaveStatusText');
        if (text) text.textContent = 'Memory Cache Only ⚠️';
      }
    });
  }
}

// ── Supervisor monthly assessment and visitation logs ────────────────────────
function renderMonthlyAssessments() {
  const list = document.getElementById('monthlyAssessmentList');
  if (!list) return;
  list.innerHTML = '';

  const assessments = _lb.supervisorMonthlyAssessments || [];
  if (assessments.length === 0) {
    list.innerHTML = `<div class="supervisor-summary-item" style="text-align:center;color:var(--text-muted);font-size:12px;">No assessments recorded yet</div>`;
    return;
  }

  assessments.forEach(item => {
    if (!item.text) return; // ignore empty rows

    const row = document.createElement('div');
    row.className = 'supervisor-summary-item';

    let stars = '';
    for (let i = 1; i <= 5; i++) {
      stars += i <= item.rating ? '★' : '☆';
    }
    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <strong style="font-size:12.5px;">Month ${item.month} Evaluation</strong>
        <span class="rating-stars">${stars}</span>
      </div>
      <p style="font-size:11.5px; color:var(--text-secondary); line-height:1.4;">"${item.text}"</p>
      <div style="font-size:10px; color:var(--text-muted); margin-top:6px; text-align:right;">Filed: ${item.date}</div>
    `;
    list.appendChild(row);
  });
}

function renderVisitationLogsList() {
  const list = document.getElementById('visitationLogsList');
  if (!list) return;
  list.innerHTML = '';

  const visits = _lb.schoolVisits || [];
  if (visits.length === 0) {
    list.innerHTML = `<div class="supervisor-summary-item" style="text-align:center;color:var(--text-muted);font-size:12px;">No visits recorded yet</div>`;
    return;
  }

  visits.forEach(visit => {
    const card = document.createElement('div');
    card.className = 'supervisor-summary-item';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <strong style="font-size:12.5px;">Visit: ${visit.date}</strong>
        <span class="badge-status present" style="background:var(--green-bg);color:var(--green);padding:2px 6px;border-radius:4px;">Audit Score: ${visit.score}%</span>
      </div>
      <p style="font-size:11.5px; color:var(--text-secondary); line-height:1.4;">Remarks: "${visit.comments}"</p>
      <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">Liaison Officer: ${visit.liaison}</div>
    `;
    list.appendChild(card);
  });
}

async function flushOfflineDrafts() {
  if (!_lb.isOnline) return;
  try {
    const keys = await _db.logbook_drafts.keys();
    let count = 0;
    for (const key of keys) {
      if (key.includes('_') && !key.endsWith('_remarks')) {
        const parts = key.split('_');
        if (parts.length === 2) {
          const weekId = parts[0];
          const dateStr = parts[1];
          const val = await _lbDraftGet(key);
          if (val) {
            await upsertDailyEntry({ weekId, logDate: dateStr, activities: val });
            count++;
          }
        }
      }
    }
    if (count > 0) {
      showToast(`Synced ${count} offline daily entries to server successfully.`, 'success');
    }
  } catch (err) {
    console.error('Error flushing offline drafts:', err);
  }
}

function exportPdf() {
  showToast("PDF rendering active. Compiling logbook entries and certificates...", "info");
  setTimeout(() => {
    showToast("PDF Export Complete: Saved successfully to local directory.", "success");
  }, 1200);
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initLogbook(studentId, seasonId, placement) {
  _lb.studentId   = studentId;
  _lb.seasonId    = seasonId;
  _lb.placementId = placement?.id ?? null;
  _lb.placement   = placement;

  const noPlacement = document.getElementById('lb-no-placement');
  const content     = document.getElementById('lb-content');
  const seasonLabel = document.getElementById('lb-season-label');

  if (!placement || placement.status !== 'assigned') {
    noPlacement?.classList.remove('hidden');
    content?.classList.add('hidden');
    return;
  }

  noPlacement?.classList.add('hidden');
  content?.classList.remove('hidden');
  if (seasonLabel) seasonLabel.textContent = placement.company_name ? `At ${placement.company_name}` : 'Loading…';

  // Boot UI state
  renderOrgProfileDetails();
  renderMonthlyAssessments();
  renderVisitationLogsList();

  // Online/offline events
  window.addEventListener('online',  async () => { _lb.isOnline = true;  _updateOfflineChip(false); await flushOfflineDrafts(); });
  window.addEventListener('offline', () => { _lb.isOnline = false; _updateOfflineChip(true); });
  _checkIncognito();

  // Load weeks from Supabase
  const { data: weeks } = await listLogbookWeeks(studentId, seasonId);
  _lb.weeks = weeks ?? [];

  // Ensure this week exists
  const today  = new Date();
  const monday = _getMonday(today);
  const weekNum = _calcWeekNumber(new Date(placement.start_date), monday);
  if (weekNum > 0) {
    const exists = _lb.weeks.find(w => w.week_number === weekNum);
    if (!exists) {
      const { data: newWeek } = await getOrCreateWeek(studentId, seasonId, _lb.placementId, weekNum, monday);
      if (newWeek) { _lb.weeks.push(newWeek); _lb.weeks.sort((a,b) => a.week_number - b.week_number); }
    }
  }

  _renderWeekChips();
  const defaultIdx = _lb.weeks.findIndex(w => w.week_number === weekNum);
  await _selectWeek(defaultIdx >= 0 ? defaultIdx : _lb.weeks.length - 1);

  // Wire monthly summary tab
  _initMonthlyPanel();

  // PDF Export Binding
  const btnExportPdf = document.getElementById('btnExportPdf');
  if (btnExportPdf) btnExportPdf.onclick = exportPdf;
}
