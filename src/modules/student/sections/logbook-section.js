// =============================================================================
// IAMS — logbook-section.js  (Phase 2)
// Handles all #logbook UI: week chips, daily textarea rows, monthly summary.
// Called from dashboard.js loadLogbook().
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

// ── Haversine (not needed in logbook but kept for completeness) ───────────────

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

let _lb = { studentId:null, seasonId:null, placementId:null, weeks:[], activeWeekIdx:0,
             monthSummaries:[], activeMonthIdx:0, isOnline: navigator.onLine };

// ── Debounce ──────────────────────────────────────────────────────────────────
function _debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── "Saved" tick flash ────────────────────────────────────────────────────────
function _flashSaved(tickEl) {
  if (!tickEl) return;
  tickEl.classList.add('visible');
  setTimeout(() => tickEl.classList.remove('visible'), 1500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initLogbook(studentId, seasonId, placement) {
  _lb.studentId = studentId;
  _lb.seasonId  = seasonId;
  _lb.placementId = placement?.id ?? null;

  const noPlacement = document.getElementById('lb-no-placement');
  const content     = document.getElementById('lb-content');

  if (!placement || placement.status !== 'assigned') {
    noPlacement?.classList.remove('hidden');
    content?.classList.add('hidden');
    return;
  }
  noPlacement?.classList.add('hidden');
  content?.classList.remove('hidden');

  // Wire tabs
  document.querySelectorAll('[data-lb-tab]').forEach(btn => {
    btn.addEventListener('click', () => _switchLbTab(btn.dataset.lbTab));
  });

  // Load weeks
  const { data: weeks } = await listLogbookWeeks(studentId, seasonId);
  _lb.weeks = weeks ?? [];

  // Ensure current week exists
  const today = new Date();
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

  // Online/offline chip
  window.addEventListener('online',  () => { _lb.isOnline = true;  _updateOfflineChip(false); });
  window.addEventListener('offline', () => { _lb.isOnline = false; _updateOfflineChip(true); });
}

function _updateOfflineChip(offline) {
  const el = document.getElementById('lb-offline-indicator');
  if (!el) return;
  el.innerHTML = offline
    ? `<span class="offline-chip"><i data-lucide="wifi-off"></i> Working offline</span>`
    : '';
}

function _getMonday(d) {
  const day = d.getDay(); // 0=Sun
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

// ── Week chips ────────────────────────────────────────────────────────────────
function _renderWeekChips() {
  const row = document.getElementById('lb-week-chips');
  if (!row) return;
  row.innerHTML = '';
  _lb.weeks.forEach((w, i) => {
    const chip = document.createElement('button');
    chip.className = 'week-chip' + (i === _lb.activeWeekIdx ? ' active' : '')
      + (w.status === 'submitted' || w.status === 'certified' ? ' completed' : '');
    chip.innerHTML = `Week ${w.week_number}`
      + (w.status === 'submitted' ? ' ✓' : '')
      + (w.status === 'certified' ? ' 🔒' : '');
    chip.disabled = w.status === 'certified';
    if (w.status === 'certified') chip.classList.add('locked');
    chip.addEventListener('click', () => _selectWeek(i));
    row.appendChild(chip);
  });
}

// ── Week content ──────────────────────────────────────────────────────────────
async function _selectWeek(idx) {
  if (idx < 0 || idx >= _lb.weeks.length) return;
  _lb.activeWeekIdx = idx;
  _renderWeekChips();

  const week = _lb.weeks[idx];
  const area = document.getElementById('lb-week-area');
  if (!area) return;
  area.innerHTML = `<p style="font-size:13px;color:var(--text-secondary)">Loading week ${week.week_number}…</p>`;

  let entries = [];
  try {
    const { data } = await getDailyEntriesForWeek(week.id);
    entries = data ?? [];
  } catch {
    // Offline — load from Dexie
    for (const day of DAYS) {
      const val = await _lbDraftGet(`${week.id}_${day}`);
      entries.push({ day_label: day, activities: val });
    }
    _updateOfflineChip(true);
  }

  const isLocked = week.status === 'submitted' || week.status === 'certified';
  const entryMap = {};
  entries.forEach(e => { entryMap[e.log_date ?? e.day_label] = e.activities ?? ''; });

  // Build 7-day table
  const monday = new Date(week.week_start);
  let tableRows = '';
  DAYS.forEach((day, i) => {
    const date = new Date(monday); date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const val = entryMap[dateStr] ?? '';
    tableRows += `
      <tr>
        <td class="logbook-day-label">${day}<br><span style="font-size:10px;font-weight:400;color:var(--text-muted)">${date.toLocaleDateString('en-GH',{month:'short',day:'numeric'})}</span></td>
        <td>
          <textarea class="logbook-activity-ta" id="lbta-${dateStr}" data-date="${dateStr}" data-weekid="${week.id}" ${isLocked ? 'readonly' : ''}>${_esc(val)}</textarea>
          <span class="saved-tick" id="lbtick-${dateStr}">✓ Saved</span>
        </td>
      </tr>`;
  });

  area.innerHTML = `
    <table class="logbook-day-table">
      <thead><tr><th style="width:90px">Day</th><th>Activities</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
      <div>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:5px;">Department / Section</label>
        <input class="inp" id="lb-dept" value="${_esc(week.department_section??'')}" ${isLocked?'disabled':''} placeholder="e.g. Engineering Dept.">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:5px;">Student Remarks</label>
        <input class="inp" id="lb-remarks" value="${_esc(week.student_remarks??'')}" ${isLocked?'disabled':''} placeholder="Optional remarks">
      </div>
    </div>
    <div class="week-status-bar">
      <span class="badge ${_statusBadgeClass(week.status)}">${week.status}</span>
      ${!isLocked ? `<button class="btn btn-primary btn-sm" id="lb-submit-week">Submit Week</button>` : '<span style="font-size:12px;color:var(--text-muted)">Submitted — read only</span>'}
    </div>`;

  if (!isLocked) {
    // Auto-save textareas
    area.querySelectorAll('.logbook-activity-ta').forEach(ta => {
      const dateStr = ta.dataset.date;
      const weekId  = ta.dataset.weekid;
      const tick    = document.getElementById(`lbtick-${dateStr}`);

      // Dexie save on every keystroke (debounced 300ms)
      ta.addEventListener('input', _debounce(async () => {
        await _lbDraftSet(`${weekId}_${dateStr}`, ta.value);
      }, 300));

      // Supabase save on blur (debounced 500ms)
      ta.addEventListener('blur', _debounce(async () => {
        if (!_lb.isOnline) return;
        const { error } = await upsertDailyEntry({ weekId, logDate: dateStr, activities: ta.value });
        if (!error) _flashSaved(tick);
      }, 500));
    });

    // Meta fields auto-save
    const deptInput    = document.getElementById('lb-dept');
    const remarksInput = document.getElementById('lb-remarks');
    const saveMeta = _debounce(async () => {
      if (!_lb.isOnline) return;
      await upsertWeekMeta(week.id, {
        dept_section:    deptInput?.value ?? '',
        student_remarks: remarksInput?.value ?? '',
      });
    }, 800);
    deptInput?.addEventListener('blur', saveMeta);
    remarksInput?.addEventListener('blur', saveMeta);

    // Submit week
    document.getElementById('lb-submit-week')?.addEventListener('click', async () => {
      const btn = document.getElementById('lb-submit-week');
      if (!btn) return;
      btn.disabled = true; btn.textContent = 'Submitting…';
      const { error } = await submitLogbookWeek(week.id);
      if (error) { showToast('Failed to submit week: ' + error.message, 'error'); btn.disabled = false; btn.textContent = 'Submit Week'; return; }
      _lb.weeks[idx].status = 'submitted';
      showToast('Week ' + week.week_number + ' submitted.', 'success');
      _renderWeekChips();
      await _selectWeek(idx);
    });
  }
}

// ── Monthly summary ───────────────────────────────────────────────────────────
export async function initMonthlyPanel() {
  const { data: summaries } = await listMonthlySummaries(_lb.studentId, _lb.seasonId);
  _lb.monthSummaries = summaries ?? [];

  // Build 3 months (configurable)
  const monthCount = 3;
  const chipsRow = document.getElementById('lb-month-chips');
  if (!chipsRow) return;
  chipsRow.innerHTML = '';
  for (let m = 1; m <= monthCount; m++) {
    const chip = document.createElement('button');
    const exists = _lb.monthSummaries.find(s => s.month_number === m);
    chip.className = 'week-chip' + (m === 1 ? ' active' : '') + (exists ? ' completed' : '');
    chip.textContent = `Month ${m}`;
    chip.addEventListener('click', () => _selectMonth(m));
    chipsRow.appendChild(chip);
  }
  await _selectMonth(1);
}

async function _selectMonth(monthNum) {
  document.querySelectorAll('#lb-month-chips .week-chip').forEach((c,i) => c.classList.toggle('active', i+1 === monthNum));
  const area = document.getElementById('lb-month-area');
  if (!area) return;
  const summary = _lb.monthSummaries.find(s => s.month_number === monthNum);
  const isLocked = summary?.status === 'assessed';
  area.innerHTML = `
    <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:8px;">Month ${monthNum} Summary</label>
    <textarea id="lb-month-ta" class="logbook-activity-ta" style="min-height:200px;width:100%;" ${isLocked?'readonly':''}>${_esc(summary?.student_summary??'')}</textarea>
    <span class="saved-tick" id="lb-month-tick" style="display:block;margin-top:6px;">✓ Saved</span>`;

  if (!isLocked) {
    const ta = document.getElementById('lb-month-ta');
    ta?.addEventListener('blur', _debounce(async () => {
      if (!_lb.isOnline) return;
      const { error } = await upsertMonthlySummary({
        studentId: _lb.studentId, placementId: _lb.placementId,
        seasonId: _lb.seasonId, monthNumber: monthNum, studentSummary: ta.value,
      });
      if (!error) _flashSaved(document.getElementById('lb-month-tick'));
    }, 500));
  }
}

// ── Tab switch ────────────────────────────────────────────────────────────────
async function _switchLbTab(tab) {
  document.querySelectorAll('[data-lb-tab]').forEach(b => b.classList.toggle('active', b.dataset.lbTab === tab));
  document.querySelectorAll('.logbook-tab-panel').forEach(p => p.classList.toggle('active', p.id === `lb-panel-${tab}`));
  if (tab === 'monthly' && _lb.monthSummaries.length === 0) await initMonthlyPanel();
}

function _statusBadgeClass(s) {
  return { draft:'badge-draft', submitted:'badge-submitted', certified:'badge-certified' }[s] ?? 'badge-pending';
}
function _esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
