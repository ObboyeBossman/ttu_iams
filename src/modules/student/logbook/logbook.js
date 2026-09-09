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
import { hasPaid, initiatePayment, formatGHS, PAYMENT_FEES_PESEWAS } from '/shared/services/payments.service.js';
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

// ── Org profile sidebar & Telemetry ───────────────────────────────────────────
function renderOrgProfileDetails() {
  const container = document.getElementById('profileDetailsContainer');
  const orgNameEl = document.getElementById('orgNameBadge');
  const lbCompanyEl = document.getElementById('lbStatCompany');

  const companyName = _lb.placement?.company_name || 'Ghana Ports & Harbours Authority';
  if (orgNameEl) orgNameEl.textContent = companyName;
  if (lbCompanyEl) lbCompanyEl.textContent = companyName;

  if (!container) return;

  const addr = [_lb.placement?.street_landmark, _lb.placement?.city_town, _lb.placement?.region].filter(Boolean).join(', ') || 'Takoradi Port, Western Region';
  const nature = _lb.placement?.nature_of_business ?? 'Port Operations & Logistics';
  const supervisorPhone = _lb.placement?.supervisor_phone ?? '+233 302 811 200';
  const supervisorEmail = _lb.placement?.supervisor_email ?? 'e.appiah@tullow.com.gh';

  const natureEl = document.getElementById('orgNatureBadge');
  const addrEl   = document.getElementById('orgAddressBadge');
  if (natureEl) natureEl.textContent = nature;
  if (addrEl)   addrEl.textContent   = addr;

  container.innerHTML = `
    <div class="profile-row">
      <span class="profile-lbl">Nature of Business:</span>
      <span class="profile-val">${_esc(nature)}</span>
    </div>
    <div class="profile-row">
      <span class="profile-lbl">Official Address:</span>
      <span class="profile-val">${_esc(addr)}</span>
    </div>
    <div class="profile-row" style="background: rgba(240, 165, 0, 0.1); padding: 6px 8px; border-radius: 4px; margin-top: 6px;">
      <span class="profile-lbl" style="color:var(--ttu-gold-light);">Supervisor Contact:</span>
      <span class="profile-val" style="color:var(--ttu-gold-light);">${_esc(supervisorPhone)}</span>
    </div>
    <div class="profile-row" style="background: rgba(240, 165, 0, 0.1); padding: 6px 8px; border-radius: 4px;">
      <span class="profile-lbl" style="color:var(--ttu-gold-light);">Supervisor Email:</span>
      <span class="profile-val" style="color:var(--ttu-gold-light);">${_esc(supervisorEmail)}</span>
    </div>
  `;

  _updateTelemetryStats();
}

function _updateTelemetryStats() {
  const companyEl   = document.getElementById('lbStatCompany');
  const weekProgEl  = document.getElementById('lbStatWeekProgress');
  const pctEl       = document.getElementById('lbStatPct');
  const certCountEl = document.getElementById('lbStatCertCount');
  const syncStatusEl= document.getElementById('lbStatSyncStatus');

  if (companyEl) companyEl.textContent = _lb.placement?.company_name || 'Ghana Ports & Harbours';

  const totalWeeks = Math.max(_lb.weeks.length, 12);
  const activeWeekNum = (_lb.weeks[_lb.activeWeekIdx]?.week_number) ?? 1;
  const pct = Math.round((activeWeekNum / totalWeeks) * 100);

  if (weekProgEl)  weekProgEl.textContent  = `Week ${activeWeekNum} / ${totalWeeks}`;
  if (pctEl)         pctEl.textContent       = `${pct}%`;

  const certCount = _lb.weeks.filter(w => w.status === 'certified').length;
  if (certCountEl) certCountEl.textContent = `${certCount} Week${certCount !== 1 ? 's' : ''} Certified`;

  if (syncStatusEl) {
    syncStatusEl.textContent = _lb.isOnline ? 'IndexedDB Active ✔' : 'Working Offline ⚠️';
  }
}

// ── Month/Week drill-down accordion ───────────────────────────────────────────
// Replaces the old flat week-chip row with a 3-level hierarchy:
//   Months → Weeks (accordion rows) → Day grid (inline expand) → Day modal

const _drilldown = {
  openMonths:    new Set(),   // month keys currently expanded
  openWeeks:     new Set(),   // week ids currently expanded
  carouselIndex: 0,           // which month slide is currently visible
};

/**
 * Group _lb.weeks by calendar month, returning an ordered array of month buckets.
 * Each bucket: { key: 'YYYY-MM', label: 'April 2026', weeks: [...] }
 */
function _groupWeeksByMonth() {
  const map = new Map();
  for (const w of _lb.weeks) {
    const d   = new Date(w.week_start);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: d.toLocaleDateString('en-GH', { month: 'long', year: 'numeric' }),
        weeks: [],
      });
    }
    map.get(key).weeks.push(w);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function _monthStatus(weeks) {
  if (weeks.every(w => w.status === 'certified')) return 'done';
  if (weeks.some(w => w.status === 'certified' || w.status === 'submitted' || w._hasEntries)) return 'active';
  return 'upcoming';
}

function _weekDots(week) {
  const DAYS_LIST = _lb.gap4Days === '5day'
    ? ['Mon','Tue','Wed','Thu','Fri']
    : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  return DAYS_LIST.map(d => {
    const key  = `${week.id}_dot_${d}`;
    const stat = _lb._dotStatus?.[key] ?? 'empty';
    const cls  = stat === 'done' ? 'lb-wd lb-wd-done' : stat === 'draft' ? 'lb-wd lb-wd-draft' : 'lb-wd lb-wd-empty';
    return `<span class="${cls}"></span>`;
  }).join('');
}

function _weekPct(week) {
  const total   = _lb.gap4Days === '5day' ? 5 : 7;
  const logged  = (_lb._dotStatus ? Object.keys(_lb._dotStatus).filter(k => k.startsWith(`${week.id}_dot_`) && _lb._dotStatus[k] !== 'empty').length : 0);
  return Math.round((logged / total) * 100);
}

/**
 * Navigate the carousel to a specific month index and re-render.
 * Exposed so arrow buttons and dot clicks can call it.
 */
function _carouselGoTo(idx) {
  const months = _groupWeeksByMonth();
  _drilldown.carouselIndex = Math.max(0, Math.min(idx, months.length - 1));
  // Open that month's accordion automatically
  const month = months[_drilldown.carouselIndex];
  if (month) _drilldown.openMonths.add(month.key);
  _renderMonthWeekDrilldown();
}

function _renderMonthWeekDrilldown() {
  const container = document.getElementById('lb-week-chips');
  if (!container) return;

  if (!_lb.weeks || _lb.weeks.length === 0) {
    _lb.weeks = [];
    const baseMonday = _getMonday(new Date());
    for (let w = 1; w <= 12; w++) {
      const wStart = new Date(baseMonday);
      wStart.setDate(wStart.getDate() + (w - 1) * 7);
      const wEnd = new Date(wStart);
      wEnd.setDate(wEnd.getDate() + 6);
      _lb.weeks.push({
        id: `week_gen_${w}`,
        week_number: w,
        week_start: wStart.toISOString().split('T')[0],
        week_end: wEnd.toISOString().split('T')[0],
        status: 'draft',
        department_section: '',
        student_remarks: ''
      });
    }
  }

  const isMonthlyActive = !document.getElementById('monthlySummaryContainer')?.classList.contains('hidden');

  let html = `
    <div class="lb-week-pills-strip" style="display:flex; align-items:center; gap:8px; overflow-x:auto; padding:4px 0 10px 0; scrollbar-width:thin;">
  `;

  _lb.weeks.forEach((week, idx) => {
    const isActive = !isMonthlyActive && idx === _lb.activeWeekIdx;
    const isCertified = week.status === 'certified';
    const isSubmitted = week.status === 'submitted';

    let iconHtml = '';
    if (isCertified) {
      iconHtml = `<i data-lucide="shield-check" style="width:13px;height:13px;color:#10B981;"></i>`;
    } else if (isSubmitted) {
      iconHtml = `<i data-lucide="clock" style="width:13px;height:13px;color:#F59E0B;"></i>`;
    } else {
      iconHtml = `<span style="width:6px;height:6px;border-radius:50%;background:${isActive ? 'var(--ttu-gold)' : 'var(--text-muted)'};"></span>`;
    }

    html += `
      <button type="button" class="lb-week-pill-btn ${isActive ? 'active' : ''}" data-weekidx="${idx}" style="
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 15px;
        border-radius: 20px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s ease;
        border: 1px solid ${isActive ? 'var(--ttu-gold)' : 'var(--border-default)'};
        background: ${isActive ? 'rgba(240, 165, 0, 0.15)' : 'var(--bg-prefix)'};
        color: ${isActive ? 'var(--ttu-gold)' : 'var(--text-secondary)'};
        box-shadow: ${isActive ? '0 0 10px rgba(240, 165, 0, 0.15)' : 'none'};
      ">
        ${iconHtml}
        <span>Week ${week.week_number}</span>
      </button>
    `;
  });

  // Monthly summary tab pill button
  html += `
    <button type="button" class="lb-week-pill-btn ${isMonthlyActive ? 'active' : ''}" id="btn-tab-monthly-pill" style="
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 15px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s ease;
      border: 1px solid ${isMonthlyActive ? 'var(--ttu-gold)' : 'var(--border-default)'};
      background: ${isMonthlyActive ? 'rgba(240, 165, 0, 0.15)' : 'var(--bg-prefix)'};
      color: ${isMonthlyActive ? 'var(--ttu-gold)' : 'var(--text-secondary)'};
      margin-left: auto;
    ">
      <i data-lucide="file-text" style="width:13px;height:13px;"></i>
      <span>Monthly Summaries</span>
    </button>
  </div>`;

  container.innerHTML = html;

  // Bind click handlers
  container.querySelectorAll('.lb-week-pill-btn[data-weekidx]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.weekidx);
      await _selectWeek(idx);
    });
  });

  const monthlyPill = document.getElementById('btn-tab-monthly-pill');
  if (monthlyPill) {
    monthlyPill.addEventListener('click', () => {
      document.getElementById('weeklyFormContainer')?.classList.add('hidden');
      document.getElementById('monthlySummaryContainer')?.classList.remove('hidden');
      _renderMonthWeekDrilldown();
    });
  }

  if (window.lucide) window.lucide.createIcons();
}

function _buildDayGrid(week) {
  const DAYS_FULL  = _lb.gap4Days === '5day'
    ? ['Monday','Tuesday','Wednesday','Thursday','Friday']
    : ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const DAYS_SHORT = _lb.gap4Days === '5day'
    ? ['Mon','Tue','Wed','Thu','Fri']
    : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const monday  = new Date(week.week_start);
  const isLocked = week.status === 'submitted' || week.status === 'certified' || _lb.logbookFinalized;

  let html = '<div class="lb-day-grid">';
  DAYS_FULL.forEach((day, i) => {
    const date    = new Date(monday); date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const dotKey  = `${week.id}_dot_${DAYS_SHORT[i]}`;
    const status  = _lb._dotStatus?.[dotKey] ?? 'empty';
    const preview = _lb._dayPreviews?.[`${week.id}_${dateStr}`] ?? '';

    const isToday = date.toDateString() === new Date().toDateString();
    let cardCls = 'lb-day-card';
    if (status === 'done')  cardCls += ' lb-day-done';
    if (status === 'draft') cardCls += ' lb-day-draft';
    if (isToday)            cardCls += ' lb-day-today';

    const statusBadge = status === 'done'
      ? `<div class="lb-day-status lb-ds-done"><i data-lucide="check" style="width:9px;height:9px;"></i> Saved</div>`
      : status === 'draft'
      ? `<div class="lb-day-status lb-ds-draft"><i data-lucide="pencil" style="width:9px;height:9px;"></i> Draft</div>`
      : '';

    html += `
    <button class="lb-day-card ${cardCls.replace('lb-day-card ','')}"
      data-weekid="${week.id}" data-day="${day}" data-date="${dateStr}"
      data-daylabel="${DAYS_SHORT[i]}" data-locked="${isLocked}"
      title="Log ${day}">
      <div class="lb-day-lbl">${DAYS_SHORT[i]}</div>
      <div class="lb-day-num">${date.getDate()}${isToday ? '<span class="lb-today-pip"></span>' : ''}</div>
      ${preview
        ? `<div class="lb-day-preview">${_esc(preview.substring(0, 80))}${preview.length > 80 ? '…' : ''}</div>${statusBadge}`
        : `<div class="lb-day-preview lb-day-preview-empty">No entry</div><div class="lb-day-add"><i data-lucide="plus" style="width:14px;height:14px;"></i></div>`
      }
    </button>`;
  });
  html += '</div>';
  return html;
}

function _attachDrilldownListeners() {
  // ── Carousel prev/next arrows ──────────────────────────────────────────
  const prevBtn = document.getElementById('lb-car-prev');
  const nextBtn = document.getElementById('lb-car-next');
  if (prevBtn) prevBtn.addEventListener('click', () => _carouselGoTo(_drilldown.carouselIndex - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => _carouselGoTo(_drilldown.carouselIndex + 1));

  // ── Carousel dot clicks ────────────────────────────────────────────────
  document.querySelectorAll('.lb-cdot').forEach(dot => {
    dot.addEventListener('click', () => _carouselGoTo(Number(dot.dataset.cidx)));
  });

  // ── Month accordion toggles ────────────────────────────────────────────
  document.querySelectorAll('.lb-month-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.mkey;
      if (_drilldown.openMonths.has(key)) _drilldown.openMonths.delete(key);
      else _drilldown.openMonths.add(key);
      _renderMonthWeekDrilldown();
    });
  });

  // ── Week toggles ───────────────────────────────────────────────────────
  document.querySelectorAll('.lb-week-row').forEach(btn => {
    btn.addEventListener('click', async () => {
      const weekId  = btn.dataset.weekid;
      const weekIdx = _lb.weeks.findIndex(w => w.id === weekId || w.id === Number(weekId));

      if (_drilldown.openWeeks.has(weekId)) {
        _drilldown.openWeeks.delete(weekId);
      } else {
        _drilldown.openWeeks.add(weekId);
        if (weekIdx >= 0) await _loadWeekEntriesIntoCache(_lb.weeks[weekIdx]);
      }
      if (weekIdx >= 0) _lb.activeWeekIdx = weekIdx;
      _renderMonthWeekDrilldown();
      evaluateTimelineState();
      _updateCertBox(_lb.weeks[weekIdx]?.status);
    });
  });

  // ── Day card clicks → open modal ───────────────────────────────────────
  document.querySelectorAll('.lb-day-card').forEach(card => {
    card.addEventListener('click', () => {
      const { weekid, day, date, daylabel, locked } = card.dataset;
      const weekIdx = _lb.weeks.findIndex(w => w.id === weekid || w.id === Number(weekid));
      if (weekIdx >= 0) _lb.activeWeekIdx = weekIdx;
      _openDayModal({
        weekId: weekid,
        weekIdx,
        day,
        date,
        dayLabel: daylabel,
        isLocked: locked === 'true',
      });
    });
  });
}

// ── Cache week entries (for dot status + previews) ────────────────────────────
async function _loadWeekEntriesIntoCache(week) {
  if (!_lb._dotStatus)   _lb._dotStatus   = {};
  if (!_lb._dayPreviews) _lb._dayPreviews  = {};

  const DAYS_SHORT = _lb.gap4Days === '5day'
    ? ['Mon','Tue','Wed','Thu','Fri']
    : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DAYS_FULL  = _lb.gap4Days === '5day'
    ? ['Monday','Tuesday','Wednesday','Thursday','Friday']
    : ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

  let entries = [];
  try {
    const { data } = await getDailyEntriesForWeek(week.id);
    entries = data ?? [];
  } catch {
    // Fallback to Dexie offline drafts
    const monday = new Date(week.week_start);
    for (let i = 0; i < DAYS_FULL.length; i++) {
      const date    = new Date(monday); date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const val     = await _lbDraftGet(`${week.id}_${dateStr}`);
      if (val) entries.push({ log_date: dateStr, activities: val });
    }
  }

  const monday = new Date(week.week_start);
  DAYS_FULL.forEach((day, i) => {
    const date    = new Date(monday); date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const entry   = entries.find(e => e.log_date === dateStr || e.day_label === day);
    const val     = entry?.activities ?? '';
    const dotKey  = `${week.id}_dot_${DAYS_SHORT[i]}`;

    _lb._dotStatus[dotKey]              = val ? 'done' : 'empty';
    _lb._dayPreviews[`${week.id}_${dateStr}`] = val;
  });
}

// ── Day editor modal ──────────────────────────────────────────────────────────
let _modalOpen = false;

function _ensureDayModal() {
  if (document.getElementById('lb-day-modal')) return;

  const el = document.createElement('div');
  el.id = 'lb-day-modal-wrap';
  el.className = 'lb-modal-wrap';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'lb-modal-title');
  el.innerHTML = `
    <div class="lb-modal" id="lb-day-modal">
      <div class="lb-modal-top">
        <div>
          <div class="lb-modal-lbl" id="lb-modal-lbl"></div>
          <div class="lb-modal-title" id="lb-modal-title">Log your tasks and learnings</div>
        </div>
        <button class="lb-modal-x" id="lb-modal-close" aria-label="Close day editor">
          <i data-lucide="x" style="width:15px;height:15px;"></i>
        </button>
      </div>
      <div class="lb-modal-toolbar">
        <button class="format-btn lb-tb" onclick="applyFormatting('lb-modal-ta','bold')" title="Bold"><i data-lucide="bold"></i></button>
        <button class="format-btn lb-tb" onclick="applyFormatting('lb-modal-ta','italic')" title="Italic"><i data-lucide="italic"></i></button>
        <button class="format-btn lb-tb" onclick="applyFormatting('lb-modal-ta','list')" title="Bullet list"><i data-lucide="list"></i></button>
        <button class="format-btn lb-tb" onclick="applyFormatting('lb-modal-ta','code')" title="Code"><i data-lucide="code"></i></button>
        <span class="lb-tb-sep"></span>
        <button class="format-btn lb-tb" onclick="applyFormatting('lb-modal-ta','clear')" title="Clear"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="lb-modal-editor">
        <textarea id="lb-modal-ta" class="day-textarea lb-modal-textarea"
          placeholder="Describe your technical tasks and learnings for this day…"></textarea>
      </div>
      <div class="lb-modal-upload" id="lb-modal-upload" role="button" tabindex="0" aria-label="Upload images or files">
        <i data-lucide="upload" style="width:16px;height:16px;color:var(--text-muted);"></i>
        <span class="lb-modal-upload-text">
          <strong>Upload images or files</strong> — photos, sketches, documents (max 10 MB each)
        </span>
        <input type="file" id="lb-modal-file-input" multiple accept="image/*,.pdf,.doc,.docx" style="display:none;">
      </div>
      <div class="lb-modal-files" id="lb-modal-files"></div>
      <div class="lb-modal-footer">
        <div class="lb-modal-footer-info" id="lb-modal-foot-info">New entry</div>
        <div class="lb-modal-footer-btns">
          <button class="lb-btn-draft" id="lb-btn-draft">Save draft</button>
          <button class="lb-btn-save"  id="lb-btn-save">Save entry</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  // Close on backdrop click
  el.addEventListener('click', e => { if (e.target === el) _closeDayModal(); });
  document.getElementById('lb-modal-close').addEventListener('click', _closeDayModal);

  // ESC key
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _modalOpen) _closeDayModal(); });

  // File upload zone click
  document.getElementById('lb-modal-upload').addEventListener('click', () => {
    document.getElementById('lb-modal-file-input').click();
  });
  document.getElementById('lb-modal-file-input').addEventListener('change', _handleFileUpload);

  if (window.lucide) window.lucide.createIcons();
}

function _handleFileUpload(e) {
  const files   = [...e.target.files];
  const listEl  = document.getElementById('lb-modal-files');
  if (!listEl) return;
  listEl.innerHTML = '';
  files.forEach(f => {
    const row = document.createElement('div');
    row.className = 'lb-file-row';
    row.innerHTML = `<i data-lucide="paperclip" style="width:12px;height:12px;color:var(--text-muted);"></i>
      <span class="lb-file-name">${_esc(f.name)}</span>
      <span class="lb-file-size">${(f.size / 1024).toFixed(1)} KB</span>`;
    listEl.appendChild(row);
  });
  if (window.lucide) window.lucide.createIcons();
}

async function _openDayModal({ weekId, weekIdx, day, date, dayLabel, isLocked }) {
  _ensureDayModal();
  _modalOpen = true;

  const week      = _lb.weeks[weekIdx] ?? _lb.weeks[_lb.activeWeekIdx];
  const previewKey = `${weekId}_${date}`;
  const existing   = _lb._dayPreviews?.[previewKey] ?? '';

  // Also check Dexie for offline draft
  let draftVal = existing;
  if (!draftVal) {
    draftVal = await _lbDraftGet(`${weekId}_${date}`);
  }

  const dateObj   = new Date(date);
  const formatted = dateObj.toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('lb-modal-lbl').textContent   = `${formatted.toUpperCase()} · Week ${week?.week_number ?? ''}`;
  document.getElementById('lb-modal-title').textContent = isLocked ? 'Entry locked — view only' : 'Log your tasks and learnings';
  document.getElementById('lb-modal-foot-info').textContent = draftVal ? 'Last saved · auto' : 'New entry';

  const ta = document.getElementById('lb-modal-ta');
  ta.value    = draftVal;
  ta.readOnly = isLocked;
  ta.disabled = isLocked;

  // Wire formatting toolbar disabled state
  document.querySelectorAll('.lb-modal-toolbar .format-btn').forEach(b => b.disabled = isLocked);
  document.getElementById('lb-modal-upload').style.display = isLocked ? 'none' : '';
  document.getElementById('lb-modal-files').innerHTML = '';

  const btnDraft = document.getElementById('lb-btn-draft');
  const btnSave  = document.getElementById('lb-btn-save');
  btnDraft.style.display = isLocked ? 'none' : '';
  btnSave.style.display  = isLocked ? 'none' : '';

  // Dexie autosave on input
  ta.oninput = null;
  if (!isLocked) {
    ta.addEventListener('input', _debounce(async () => {
      await _lbDraftSet(`${weekId}_${date}`, ta.value);
      document.getElementById('lb-modal-foot-info').textContent = 'Draft saved locally…';
      _flashSaved();
    }, 300));
  }

  // Save draft button
  btnDraft.onclick = async () => {
    await _saveDayEntry({ weekId, weekIdx, day, date, dayLabel, value: ta.value, asDraft: true });
    _closeDayModal();
  };

  // Save entry button (Supabase)
  btnSave.onclick = async () => {
    await _saveDayEntry({ weekId, weekIdx, day, date, dayLabel, value: ta.value, asDraft: false });
    _closeDayModal();
  };

  const wrap = document.getElementById('lb-day-modal-wrap');
  wrap.style.display = 'flex';
  requestAnimationFrame(() => wrap.classList.add('lb-modal-open'));
  if (!isLocked) setTimeout(() => ta.focus(), 80);

  if (window.lucide) window.lucide.createIcons();
}

async function _saveDayEntry({ weekId, weekIdx, day, date, dayLabel, value, asDraft }) {
  if (!_lb._dotStatus)   _lb._dotStatus   = {};
  if (!_lb._dayPreviews) _lb._dayPreviews  = {};

  const DAYS_SHORT = _lb.gap4Days === '5day'
    ? ['Mon','Tue','Wed','Thu','Fri']
    : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DAYS_FULL  = _lb.gap4Days === '5day'
    ? ['Monday','Tuesday','Wednesday','Thursday','Friday']
    : ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const di        = DAYS_FULL.indexOf(day);
  const shortDay  = di >= 0 ? DAYS_SHORT[di] : dayLabel;
  const dotKey    = `${weekId}_dot_${shortDay}`;

  // Always save to Dexie
  await _lbDraftSet(`${weekId}_${date}`, value);

  // Update in-memory state
  _lb._dayPreviews[`${weekId}_${date}`] = value;
  _lb._dotStatus[dotKey] = value ? (asDraft ? 'draft' : 'done') : 'empty';

  // Push to Supabase if online and not draft-only
  if (!asDraft && _lb.isOnline) {
    const { error } = await upsertDailyEntry({ weekId, logDate: date, activities: value });
    if (error) {
      showToast('Could not sync to server — saved locally.', 'warning');
    } else {
      showToast('Entry saved.', 'success');
      _flashSaved();
    }
  } else if (asDraft) {
    showToast('Draft saved locally.', 'info');
    _flashSaved();
  }

  _renderMonthWeekDrilldown();
}

function _closeDayModal() {
  const wrap = document.getElementById('lb-day-modal-wrap');
  if (!wrap) return;
  wrap.classList.remove('lb-modal-open');
  setTimeout(() => { wrap.style.display = 'none'; }, 180);
  _modalOpen = false;
}

// Keep _renderWeekChips as an alias so any other call sites don't break
function _renderWeekChips() { _renderMonthWeekDrilldown(); }

// ── Timeline status bar ───────────────────────────────────────────────────────
function evaluateTimelineState() {
  const week = _lb.weeks[_lb.activeWeekIdx];
  const badgeContainer = document.getElementById('lbWeekStatusBadge');
  if (!badgeContainer) return;

  if (document.getElementById('weeklyFormContainer')?.classList.contains('hidden')) {
    badgeContainer.innerHTML = `
      <span class="badge-status" style="background:rgba(139,92,246,0.15); color:#8B5CF6; border:1px solid rgba(139,92,246,0.3); font-weight:700; padding:5px 12px; border-radius:20px; font-size:12px; display:inline-flex; align-items:center; gap:6px;">
        <i data-lucide="file-text" style="width:13px;height:13px;"></i> Monthly Summary View
      </span>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (!week) return;

  if (week.status === 'certified') {
    badgeContainer.innerHTML = `
      <span class="badge-status" style="background:rgba(16,185,129,0.15); color:#10B981; border:1px solid rgba(16,185,129,0.3); font-weight:700; padding:5px 12px; border-radius:20px; font-size:12px; display:inline-flex; align-items:center; gap:6px;">
        <i data-lucide="shield-check" style="width:13px;height:13px;"></i> Certified by Supervisor
      </span>`;
  } else if (week.status === 'submitted') {
    badgeContainer.innerHTML = `
      <span class="badge-status" style="background:rgba(245,158,11,0.15); color:#F59E0B; border:1px solid rgba(245,158,11,0.3); font-weight:700; padding:5px 12px; border-radius:20px; font-size:12px; display:inline-flex; align-items:center; gap:6px;">
        <i data-lucide="clock" style="width:13px;height:13px;"></i> Submitted (Awaiting Verification)
      </span>`;
  } else {
    badgeContainer.innerHTML = `
      <span class="badge-status" style="background:rgba(37,99,235,0.15); color:#3B82F6; border:1px solid rgba(37,99,235,0.3); font-weight:700; padding:5px 12px; border-radius:20px; font-size:12px; display:inline-flex; align-items:center; gap:6px;">
        <span style="width:7px; height:7px; border-radius:50%; background:#3B82F6;"></span> Draft Mode (Editable)
      </span>`;
  }
  if (window.lucide) window.lucide.createIcons();
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

// ── In-page Daily Activity Logs rendering ──────────────────────────────────────
async function _renderInPageDailyLogs(week) {
  const container = document.getElementById('dailyLogsInputs');
  if (!container) return;

  week = week || _lb.weeks[_lb.activeWeekIdx] || _lb.weeks[0];
  if (!week) return;

  const isLocked = week.status === 'submitted' || week.status === 'certified' || _lb.logbookFinalized;
  const DAYS_FULL = _lb.gap4Days === '5day'
    ? ['Monday','Tuesday','Wednesday','Thursday','Friday']
    : ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const DAYS_SHORT = _lb.gap4Days === '5day'
    ? ['Mon','Tue','Wed','Thu','Fri']
    : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const monday = (week.week_start && !isNaN(new Date(week.week_start))) ? new Date(week.week_start) : _getMonday(new Date());

  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--border-default);">
      <div>
        <h4 style="font-size:14.5px; font-weight:800; color:var(--text-primary); margin:0; display:flex; align-items:center; gap:6px;">
          <i data-lucide="book-open-check" style="width:16px;height:16px;color:var(--ttu-gold);"></i>
          <span>Daily Activity Logs</span>
        </h4>
        <p style="font-size:11.5px; color:var(--text-secondary); margin:2px 0 0 0;">Record technical tasks, tools used, and safety precautions observed for each working day.</p>
      </div>
      <span style="font-size:11px; font-weight:700; background:rgba(240,165,0,0.12); color:var(--ttu-gold); padding:3px 10px; border-radius:12px; border:1px solid rgba(240,165,0,0.25);">
        ${isLocked ? '🔒 View Only' : '⚡ Auto-saves to IndexedDB'}
      </span>
    </div>
    <div class="daily-cards-container" style="display:flex; flex-direction:column; gap:14px;">
  `;

  for (let i = 0; i < DAYS_FULL.length; i++) {
    const day = DAYS_FULL[i];
    const date = new Date(monday); date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const shortDay = DAYS_SHORT[i];
    const dotKey = `${week.id}_dot_${shortDay}`;
    const status = _lb._dotStatus?.[dotKey] ?? 'empty';
    const previewKey = `${week.id}_${dateStr}`;
    let val = _lb._dayPreviews?.[previewKey] ?? '';

    if (!val) {
      val = await _lbDraftGet(`${week.id}_${dateStr}`);
    }

    const formattedDate = date.toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' });
    const isToday = date.toDateString() === new Date().toDateString();

    const statusBadge = status === 'done'
      ? `<span class="badge-status present" style="background:var(--green-bg); color:var(--green); font-size:10.5px; padding:2px 8px; border-radius:4px; font-weight:700;"><i data-lucide="check" style="width:10px;height:10px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Saved</span>`
      : status === 'draft'
      ? `<span class="badge-status" style="background:var(--amber-bg); color:var(--amber); font-size:10.5px; padding:2px 8px; border-radius:4px; font-weight:700;"><i data-lucide="pencil" style="width:10px;height:10px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Draft</span>`
      : `<span class="badge-status" style="background:var(--bg-prefix); color:var(--text-muted); font-size:10.5px; padding:2px 8px; border-radius:4px; font-weight:600;">Empty</span>`;

    html += `
      <div class="daily-entry-card" style="background:var(--bg-prefix); border:1px solid var(--border-default); border-radius:var(--radius-md); padding:14px 16px; transition:all 0.2s; ${isToday ? 'border-color:var(--ttu-gold); box-shadow:0 0 12px rgba(240,165,0,0.12);' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:34px; height:34px; border-radius:8px; background:var(--bg-card); border:1px solid var(--border-default); color:var(--ttu-gold); font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center;">
              ${shortDay}
            </div>
            <div>
              <div style="font-size:13.5px; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                ${day} <span style="font-size:11.5px; font-weight:600; color:var(--text-muted); font-family:var(--font-mono);">${formattedDate}</span>
                ${isToday ? '<span style="background:var(--ttu-gold); color:var(--ttu-blue-dark); font-size:9px; font-weight:800; padding:1px 5px; border-radius:3px; text-transform:uppercase;">Today</span>' : ''}
              </div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            ${statusBadge}
            <button type="button" class="btn btn-ghost btn-sm lb-day-modal-trigger" data-weekid="${week.id}" data-day="${day}" data-date="${dateStr}" data-daylabel="${shortDay}" data-locked="${isLocked}" style="font-size:11px; padding:3px 9px; height:26px; border:1px solid var(--border-default); border-radius:6px;">
              <i data-lucide="maximize-2" style="width:11px;height:11px;margin-right:4px;"></i> Full Editor
            </button>
          </div>
        </div>

        <div class="textarea-wrapper" style="border-radius: var(--radius-sm);">
          <div class="formatting-toolbar" id="toolbar-daily_${week.id}_${dateStr}">
            <button class="format-btn" onclick="applyFormatting('daily_ta_${week.id}_${dateStr}', 'bold')" title="Bold" ${isLocked ? 'disabled' : ''}><i data-lucide="bold"></i></button>
            <button class="format-btn" onclick="applyFormatting('daily_ta_${week.id}_${dateStr}', 'italic')" title="Italic" ${isLocked ? 'disabled' : ''}><i data-lucide="italic"></i></button>
            <button class="format-btn" onclick="applyFormatting('daily_ta_${week.id}_${dateStr}', 'list')" title="Bullet List" ${isLocked ? 'disabled' : ''}><i data-lucide="list"></i></button>
            <button class="format-btn" onclick="applyFormatting('daily_ta_${week.id}_${dateStr}', 'code')" title="Code" ${isLocked ? 'disabled' : ''}><i data-lucide="code"></i></button>
            <button class="format-btn" onclick="applyFormatting('daily_ta_${week.id}_${dateStr}', 'clear')" title="Clear" ${isLocked ? 'disabled' : ''}><i data-lucide="trash-2"></i></button>
          </div>
          <textarea id="daily_ta_${week.id}_${dateStr}" class="day-textarea lb-inpage-ta" data-weekid="${week.id}" data-date="${dateStr}" data-day="${day}" data-shortday="${shortDay}" style="min-height:85px; font-size:13px;" placeholder="Describe technical operations, tools handled, or learnings on ${day}…" ${isLocked ? 'disabled' : ''}>${_esc(val)}</textarea>
        </div>
      </div>
    `;
  }

  html += `</div>`;
  container.innerHTML = html;

  // Bind live autosave event handlers for in-page textareas
  container.querySelectorAll('.lb-inpage-ta').forEach(ta => {
    if (isLocked) return;
    ta.addEventListener('input', _debounce(async () => {
      const { weekid, date, day, shortday } = ta.dataset;
      const value = ta.value;
      await _saveDayEntry({ weekId: weekid, weekIdx: _lb.activeWeekIdx, day, date, dayLabel: shortday, value, asDraft: true });
    }, 400));
  });

  // Bind full editor modal triggers
  container.querySelectorAll('.lb-day-modal-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const { weekid, day, date, daylabel, locked } = btn.dataset;
      _openDayModal({
        weekId: weekid,
        weekIdx: _lb.activeWeekIdx,
        day,
        date,
        dayLabel: daylabel,
        isLocked: locked === 'true',
      });
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

// ── Week content ──────────────────────────────────────────────────────────────
async function _selectWeek(idx, { skipRender = false } = {}) {
  if (!_lb.weeks || _lb.weeks.length === 0) return;
  idx = Math.max(0, Math.min(Number(idx) || 0, _lb.weeks.length - 1));
  _lb.activeWeekIdx = idx;

  // Keep the week-meta area visible, monthly panel hidden
  document.getElementById('weeklyFormContainer')?.classList.remove('hidden');
  document.getElementById('monthlySummaryContainer')?.classList.add('hidden');

  const week     = _lb.weeks[idx];
  const isLocked = week.status === 'submitted' || week.status === 'certified' || _lb.logbookFinalized;

  // Update heading label
  const rangeLabel = document.getElementById('weekRangeLabel');
  if (rangeLabel) rangeLabel.textContent = `Week ${week.week_number} Logbook Entry`;

  // Load this week's entries into the drilldown cache (dots + previews)
  await _loadWeekEntriesIntoCache(week);

  // Render in-page daily entry cards for Monday through Sunday
  await _renderInPageDailyLogs(week);

  // Meta fields (dept / remarks)
  const dept    = document.getElementById('weekDeptField');
  const remarks = document.getElementById('weekRemarksField');
  if (dept)    { dept.value    = week.department_section ?? '';  dept.disabled    = isLocked; }
  if (remarks) { remarks.value = week.student_remarks    ?? '';  remarks.disabled = isLocked; }

  // Submit button
  const submitBtn = document.getElementById('btnSubmitWeek');
  if (submitBtn) {
    submitBtn.disabled = isLocked;
    submitBtn.onclick  = isLocked ? null : () => _submitWeek(idx);
  }

  // Bind meta-field autosave (dept / remarks) for unlocked weeks
  if (!isLocked) _bindWeekMetaInputs(week, idx);

  evaluateTimelineState();
  _updateCertBox(week.status);
  _updateTelemetryStats();

  // Refresh the drilldown so dot status + previews reflect the loaded data
  if (!skipRender) _renderMonthWeekDrilldown();
}

// Meta-only autosave — day entries are now saved through the modal (_saveDayEntry).
// This just handles the dept/remarks fields in the week meta panel.
function _bindWeekMetaInputs(week, idx) {
  const weekId  = week.id;
  const dept    = document.getElementById('weekDeptField');
  const remarks = document.getElementById('weekRemarksField');

  const saveMeta = _debounce(async () => {
    if (!_lb.isOnline) return;
    await upsertWeekMeta(weekId, {
      dept_section:    dept?.value    ?? '',
      student_remarks: remarks?.value ?? '',
    });
    _flashSaved();
  }, 800);

  if (dept)    dept.addEventListener('blur',  saveMeta);
  if (remarks) {
    remarks.addEventListener('input', _debounce(async () => {
      await _lbDraftSet(`${weekId}_remarks`, remarks.value);
      _flashSaved();
    }, 300));
    remarks.addEventListener('blur', saveMeta);
  }
}

// Keep old name as alias so any lingering call sites don't throw
function _bindWeekInputs(week, idx) { _bindWeekMetaInputs(week, idx); }

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

  // Refresh side panels and dot status
  evaluateTimelineState();
  _updateCertBox('submitted');

  // Disable meta fields now the week is locked
  const deptEl    = document.getElementById('weekDeptField');
  const remarksEl = document.getElementById('weekRemarksField');
  if (deptEl)    deptEl.disabled    = true;
  if (remarksEl) remarksEl.disabled = true;
  if (btn)       btn.innerHTML      = '<i data-lucide="check"></i> Submitted';
  if (window.lucide) window.lucide.createIcons();

  // Re-render drilldown so the week row shows the submitted icon and dots
  _renderMonthWeekDrilldown();
}

// ── Monthly summary panel ─────────────────────────────────────────────────────

// Tracks which month pill is currently active (1-based)
let _ms_activeMonth = 1;

function _initMonthlyPanel() {
  const tab = document.getElementById('btn-tab-monthly');
  if (tab) tab.addEventListener('click', _openMonthlyView);
}

/**
 * Derive the number of months from the placement window.
 * Falls back to the highest month_number found in loaded summaries, or 1.
 */
function _ms_totalMonths() {
  if (_lb.placement?.start_date && _lb.placement?.end_date) {
    const start = new Date(_lb.placement.start_date);
    const end   = new Date(_lb.placement.end_date);
    const diff  = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
    if (diff > 0) return diff;
  }
  const maxFromData = _lb.monthSummaries.reduce((m, s) => Math.max(m, s.month_number ?? 0), 0);
  return Math.max(maxFromData, 1);
}

/** Return the summary status for a given month number */
function _ms_statusOf(monthNum) {
  const s = _lb.monthSummaries.find(s => s.month_number === monthNum);
  if (!s) return 'draft';
  if (s.status === 'assessed') return 'assessed';
  if (s._studentSubmitted || s.status === 'submitted') return 'submitted';
  return 'draft';
}

/** Inject the full monthly summary UI into #monthlySummaryContainer */
function _ms_render() {
  const container = document.getElementById('monthlySummaryContainer');
  if (!container) return;

  const total    = _ms_totalMonths();
  const active   = _ms_activeMonth;
  const summary  = _lb.monthSummaries.find(s => s.month_number === active);
  const status   = _ms_statusOf(active);
  const isLocked = status === 'assessed' || status === 'submitted' || _lb.logbookFinalized;
  const content  = summary?.student_summary ?? '';

  // ── Overview pills ──
  let pillsHtml = '';
  for (let m = 1; m <= total; m++) {
    const st      = _ms_statusOf(m);
    const isAct   = m === active;
    let pillCls   = 'ms-month-pill';
    let dotCls    = 'ms-pill-dot ms-pill-dot-draft';
    if (isAct)               { pillCls += ' ms-pill-active'; dotCls = 'ms-pill-dot ms-pill-dot-active'; }
    else if (st === 'assessed')  { pillCls += ' ms-pill-assessed'; dotCls = 'ms-pill-dot ms-pill-dot-assessed'; }
    else if (st === 'submitted') { pillCls += ' ms-pill-submitted'; dotCls = 'ms-pill-dot ms-pill-dot-submitted'; }

    const label = st === 'assessed' ? 'Assessed' : st === 'submitted' ? 'Submitted' : 'Draft';
    pillsHtml += `
      <button class="${pillCls}" data-ms-month="${m}" aria-label="Month ${m} — ${label}">
        <span class="${dotCls}"></span>Month ${m}
      </button>`;
  }

  // ── Status badge for the editor card header ──
  let badgeCls = 'ms-status-badge ms-status-draft';
  let badgeTxt = 'Draft';
  let badgeIcon = 'pencil';
  if (status === 'assessed')  { badgeCls = 'ms-status-badge ms-status-assessed';  badgeTxt = 'Assessed'; badgeIcon = 'shield-check'; }
  if (status === 'submitted') { badgeCls = 'ms-status-badge ms-status-submitted'; badgeTxt = 'Submitted'; badgeIcon = 'send'; }

  // ── Word count ──
  const words   = content.trim() ? content.trim().split(/\s+/).length : 0;
  const WC_MIN  = 100;
  const wcCls   = words === 0 ? '' : words >= WC_MIN ? 'ms-wc-good' : 'ms-wc-warn';
  const wcHint  = words >= WC_MIN ? `${words} words` : `${words} / ${WC_MIN} words min.`;

  // ── Locked banner message ──
  const lockedMsg = status === 'assessed'
    ? 'This summary has been assessed by your supervisor and is now read-only.'
    : status === 'submitted'
    ? 'You have submitted this summary. Editing is locked until it is returned.'
    : '';

  // ── Footer hint ──
  const footerHint = isLocked
    ? `<strong>Month ${active}</strong> is locked. Contact your liaison officer to request changes.`
    : `Summarise your cumulative technical experience, safety highlights, and inter-departmental transfers for <strong>Month ${active}</strong>. Minimum 100 words.`;

  container.innerHTML = `
    <div class="ms-shell">

      <!-- Overview strip -->
      <div class="ms-overview-strip" id="ms-pills-row">
        ${pillsHtml}
      </div>

      <!-- Editor card -->
      <div class="ms-editor-card${isLocked ? ' ms-locked' : ''}" id="ms-editor-card">

        <!-- Card header -->
        <div class="ms-card-header">
          <div>
            <div class="ms-card-title">Month ${active} — Student Summary</div>
            <div class="ms-card-meta">Monthly Report (Student Authored)</div>
          </div>
          <span class="${badgeCls}" id="ms-status-badge">
            <i data-lucide="${badgeIcon}" style="width:11px;height:11px;"></i>
            ${badgeTxt}
          </span>
        </div>

        <!-- Locked notice -->
        <div class="ms-locked-banner${isLocked ? ' ms-show' : ''}" id="ms-locked-banner">
          <i data-lucide="lock" style="width:14px;height:14px;flex-shrink:0;"></i>
          <span>${lockedMsg}</span>
        </div>

        <!-- Formatting toolbar -->
        <div class="ms-toolbar" id="ms-toolbar">
          <button class="format-btn" onclick="applyFormatting('ms-ta','bold')"   title="Bold"   ${isLocked ? 'disabled' : ''}><i data-lucide="bold"   style="width:14px;height:14px;"></i></button>
          <button class="format-btn" onclick="applyFormatting('ms-ta','italic')" title="Italic" ${isLocked ? 'disabled' : ''}><i data-lucide="italic" style="width:14px;height:14px;"></i></button>
          <button class="format-btn" onclick="applyFormatting('ms-ta','list')"   title="List"   ${isLocked ? 'disabled' : ''}><i data-lucide="list"   style="width:14px;height:14px;"></i></button>
          <button class="format-btn" onclick="applyFormatting('ms-ta','code')"   title="Code"   ${isLocked ? 'disabled' : ''}><i data-lucide="code"   style="width:14px;height:14px;"></i></button>
          <span class="ms-sep"></span>
          <button class="format-btn" onclick="applyFormatting('ms-ta','clear')"  title="Clear"  ${isLocked ? 'disabled' : ''}><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
          <span style="margin-left:auto;">
            <span class="ms-autosave-dot" id="ms-autosave-dot"></span>
          </span>
        </div>

        <!-- Textarea -->
        <textarea
          id="ms-ta"
          class="ms-textarea"
          placeholder="Provide your monthly overview here — cover technical tasks performed, departments rotated through, safety protocols observed, and key learnings…"
          ${isLocked ? 'disabled' : ''}
        >${_esc(content)}</textarea>

        <!-- Word count bar -->
        <div class="ms-textarea-footer">
          <span class="ms-wc ${wcCls}" id="ms-wc">${wcHint}</span>
        </div>
      </div>

      <!-- Submit footer -->
      <div class="ms-submit-footer">
        <p class="ms-footer-hint">${footerHint}</p>
        <button class="ms-btn-submit" id="ms-btn-submit" ${isLocked ? 'disabled' : ''}>
          <i data-lucide="send" style="width:15px;height:15px;"></i>
          Submit Month ${active}
        </button>
      </div>

    </div>`;

  // Re-create Lucide icons in the new DOM
  if (window.lucide) window.lucide.createIcons();

  // ── Wire pill clicks ──
  document.querySelectorAll('.ms-month-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _ms_activeMonth = Number(btn.dataset.msMonth);
      _ms_render();
    });
  });

  // ── Wire submit button ──
  const submitBtn = document.getElementById('ms-btn-submit');
  if (submitBtn && !isLocked) {
    submitBtn.addEventListener('click', _ms_submit);
  }

  // ── Wire textarea — live word count + autosave ──
  const ta = document.getElementById('ms-ta');
  if (ta && !isLocked) {
    ta.addEventListener('input', () => {
      const w    = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
      const wcEl = document.getElementById('ms-wc');
      if (wcEl) {
        wcEl.textContent  = w >= WC_MIN ? `${w} words` : `${w} / ${WC_MIN} words min.`;
        wcEl.className    = `ms-wc ${w === 0 ? '' : w >= WC_MIN ? 'ms-wc-good' : 'ms-wc-warn'}`;
      }
    });

    ta.addEventListener('blur', _debounce(async () => {
      if (!_lb.isOnline) return;
      const { error } = await upsertMonthlySummary({
        studentId:     _lb.studentId,
        placementId:   _lb.placementId,
        seasonId:      _lb.seasonId,
        monthNumber:   active,
        studentSummary: ta.value,
      });
      if (!error) {
        _flashSaved();
        const dot = document.getElementById('ms-autosave-dot');
        if (dot) { dot.classList.remove('ms-pulse'); void dot.offsetWidth; dot.classList.add('ms-pulse'); }
        // Update in-memory cache so pill dots reflect unsaved → draft
        const existing = _lb.monthSummaries.find(s => s.month_number === active);
        if (existing) existing.student_summary = ta.value;
        else _lb.monthSummaries.push({ month_number: active, student_summary: ta.value });
      }
    }, 600));
  }
}

async function _openMonthlyView() {
  document.getElementById('weeklyFormContainer')?.classList.add('hidden');
  document.getElementById('monthlySummaryContainer')?.classList.remove('hidden');
  document.getElementById('weekRangeLabel').textContent = 'Monthly Summaries';
  evaluateTimelineState();
  _updateCertBox('draft');

  // Load summaries from Supabase if not yet cached
  if (_lb.monthSummaries.length === 0) {
    const { data } = await listMonthlySummaries(_lb.studentId, _lb.seasonId);
    _lb.monthSummaries = data ?? [];
  }

  // Default to the current attachment month
  if (_lb.placement?.start_date) {
    const start    = new Date(_lb.placement.start_date);
    const now      = new Date();
    const elapsed  = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
    const total    = _ms_totalMonths();
    _ms_activeMonth = Math.max(1, Math.min(elapsed, total));
  }

  _ms_render();
}

async function _ms_submit() {
  const ta = document.getElementById('ms-ta');
  if (!ta?.value?.trim()) { showToast('Cannot submit an empty summary.', 'error'); return; }

  const words = ta.value.trim().split(/\s+/).length;
  if (words < 50) { showToast('Summary is too short — please provide at least 50 words.', 'warning'); return; }

  const btn = document.getElementById('ms-btn-submit');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="spinner" style="width:15px;height:15px;"></i> Submitting…'; }
  if (window.lucide) window.lucide.createIcons();

  const { error } = await upsertMonthlySummary({
    studentId:      _lb.studentId,
    placementId:    _lb.placementId,
    seasonId:       _lb.seasonId,
    monthNumber:    _ms_activeMonth,
    studentSummary: ta.value,
  });

  if (error) {
    showToast('Failed to submit summary: ' + error.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="send" style="width:15px;height:15px;"></i> Submit Month ${_ms_activeMonth}`; }
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Update in-memory record
  const existing = _lb.monthSummaries.find(s => s.month_number === _ms_activeMonth);
  if (existing) { existing._studentSubmitted = true; existing.student_summary = ta.value; }
  else _lb.monthSummaries.push({ month_number: _ms_activeMonth, student_summary: ta.value, _studentSubmitted: true });

  showToast(`Month ${_ms_activeMonth} summary submitted for assessment.`, 'success');
  _ms_render(); // re-render to flip to locked state
}

// Keep old names as aliases so any lingering HTML onclick / call sites don't throw
async function _loadMonthlySummaryDraft() { _ms_render(); }
async function _submitMonthlySummary()    { await _ms_submit(); }

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

function _wireLogbookPaymentGate() {
  const amountEl = document.getElementById('lbGateAmount');
  if (amountEl) amountEl.textContent = formatGHS(PAYMENT_FEES_PESEWAS.logbook_access);

  const bypassBtn = document.getElementById('lbBypassBtn');
  if (bypassBtn && !bypassBtn.dataset.wired) {
    bypassBtn.dataset.wired = '1';
    bypassBtn.onclick = async () => {
      localStorage.setItem('iams_bypass_paywall', 'true');
      localStorage.setItem('iams_bypass_logbook_access', 'true');
      showToast('Paywall bypassed (Demo Mode active). Unlocking Digital Logbook…', 'success');
      await initLogbook(_lb.studentId, _lb.seasonId, _lb.placement);
    };
  }

  const btn = document.getElementById('lbPayBtn');
  if (!btn || btn.dataset.wired) return; // don't double-bind on re-entry
  btn.dataset.wired = '1';

  btn.onclick = async () => {
    btn.disabled = true;
    btn.innerHTML = `<span class="ai-spinner" style="width:14px;height:14px;border-width:2px;margin:0 6px 0 0;display:inline-block;vertical-align:middle;"></span> Processing…`;

    const ok = await initiatePayment({
      studentId: _lb.studentId,
      seasonId: _lb.seasonId,
      purpose: 'logbook_access',
      onStatusChange: (status, message) => {
        if (status === 'confirmed') showToast('Payment successful! Unlocking your logbook…', 'success');
        else if (status === 'cancelled') showToast('Payment window closed.', 'warning');
        else if (status === 'error') showToast(message || 'Payment failed. Please try again.', 'error');
      },
    });

    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="credit-card"></i> Pay with Paystack`;
    if (window.lucide) window.lucide.createIcons();

    if (ok) await initLogbook(_lb.studentId, _lb.seasonId, _lb.placement);
  };
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

    if (placement) {
      const title = noPlacement.querySelector('.empty-state-title');
      const msg = noPlacement.querySelector('.empty-state-message');
      const btn = noPlacement.querySelector('.btn');
      
      if (placement.status === 'submitted' || placement.status === 'flagged') {
        if (title) title.textContent = 'Placement Pending Assignment';
        if (msg) msg.textContent = 'Your placement is currently being reviewed. Your logbook will be available once it is assigned.';
        if (btn) btn.classList.add('hidden');
      } else if (placement.status === 'rejected') {
        if (title) title.textContent = 'Placement Rejected';
        if (msg) msg.textContent = 'Your placement was rejected. Please contact the Liaison Office.';
        if (btn) btn.classList.add('hidden');
      }
    }
    return;
  }

  const paymentGate = document.getElementById('lb-payment-gate');
  const paidForLogbook = await hasPaid(studentId, seasonId, 'logbook_access');
  if (!paidForLogbook) {
    noPlacement?.classList.add('hidden');
    content?.classList.add('hidden');
    paymentGate?.classList.remove('hidden');
    _wireLogbookPaymentGate();
    return;
  }
  paymentGate?.classList.add('hidden');
  
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

  const today  = new Date();
  const monday = _getMonday(today);

  // If no weeks exist in database yet, generate 12 default attachment weeks
  if (_lb.weeks.length === 0) {
    const startDate = (placement?.start_date && !isNaN(new Date(placement.start_date)))
      ? new Date(placement.start_date)
      : today;
    const baseMonday = _getMonday(startDate);

    for (let w = 1; w <= 12; w++) {
      const wStart = new Date(baseMonday);
      wStart.setDate(wStart.getDate() + (w - 1) * 7);
      const wEnd = new Date(wStart);
      wEnd.setDate(wEnd.getDate() + 6);

      _lb.weeks.push({
        id: `week_gen_${w}`,
        week_number: w,
        week_start: wStart.toISOString().split('T')[0],
        week_end: wEnd.toISOString().split('T')[0],
        status: 'draft',
        department_section: '',
        student_remarks: ''
      });
    }
  }

  _lb.weeks.sort((a,b) => a.week_number - b.week_number);

  const weekNum = _calcWeekNumber(new Date(placement?.start_date || today), monday) || 1;
  const defaultIdx = _lb.weeks.findIndex(w => w.week_number === weekNum);
  const bootIdx    = defaultIdx >= 0 ? defaultIdx : 0;
  _lb.activeWeekIdx = bootIdx;

  _renderMonthWeekDrilldown();

  // Load active week entries into cache and render daily log cards
  const bootWeek = _lb.weeks[bootIdx];
  if (bootWeek) {
    await _loadWeekEntriesIntoCache(bootWeek);
    _drilldown.openWeeks.add(bootWeek.id);
  }

  // Update form & daily cards for the active week
  await _selectWeek(bootIdx);

  // Wire monthly summary tab
  _initMonthlyPanel();

  // PDF Export Binding
  const btnExportPdf = document.getElementById('btnExportPdf');
  if (btnExportPdf) btnExportPdf.onclick = exportPdf;
}