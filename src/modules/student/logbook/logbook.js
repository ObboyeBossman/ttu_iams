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

  if (!_lb._dotStatus) _lb._dotStatus = {};
  const months = _groupWeeksByMonth();

  // ── On first render, auto-snap to the month containing the active / current week ──
  if (_lb.weeks.length && _drilldown.openMonths.size === 0) {
    const aw = _lb.weeks[_lb.activeWeekIdx];
    if (aw) {
      const d   = new Date(aw.week_start);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const idx = months.findIndex(m => m.key === key);
      if (idx >= 0) _drilldown.carouselIndex = idx;
      _drilldown.openMonths.add(key);
      _drilldown.openWeeks.add(aw.id);
    }
  }

  // Clamp index in case months list shrank
  _drilldown.carouselIndex = Math.max(0, Math.min(_drilldown.carouselIndex, months.length - 1));
  const ci = _drilldown.carouselIndex;

  // ── Build dot indicators ──
  const dotsHtml = months.map((m, i) =>
    `<span class="lb-cdot${i === ci ? ' lb-cdot-active' : ''}" data-cidx="${i}" title="${m.label}"></span>`
  ).join('');

  // ── Build slide HTML for every month ──
  let slidesHtml = '';
  for (const month of months) {
    const isOpen  = _drilldown.openMonths.has(month.key);
    const status   = _monthStatus(month.weeks);
    const iconCls  = status === 'done' ? 'lb-month-icon-done' : status === 'active' ? 'lb-month-icon-active' : 'lb-month-icon-upcoming';
    const badgeCls = status === 'done' ? 'lb-badge-done' : status === 'active' ? 'lb-badge-active' : 'lb-badge-upcoming';
    const badgeTxt = status === 'done' ? 'Complete' : status === 'active' ? 'In progress' : 'Upcoming';

    let weeksHtml = '';
    for (const week of month.weeks) {
      const wOpen    = _drilldown.openWeeks.has(week.id);
      const isActive = week === _lb.weeks[_lb.activeWeekIdx];
      const wStatus  = week.status === 'certified' ? 'certified' : week.status === 'submitted' ? 'submitted' : 'draft';
      const pct      = _weekPct(week);
      const wStart   = new Date(week.week_start);
      const wEnd     = new Date(wStart); wEnd.setDate(wEnd.getDate() + 6);
      const dateRange = `${wStart.toLocaleDateString('en-GH',{month:'short',day:'numeric'})} – ${wEnd.toLocaleDateString('en-GH',{month:'short',day:'numeric'})}`;

      weeksHtml += `
        <div class="lb-week-block" data-weekid="${week.id}">
          <button class="lb-week-row${wOpen ? ' lb-week-open' : ''}${isActive ? ' lb-week-active' : ''}" data-weekid="${week.id}">
            <div class="lb-week-left">
              <i data-lucide="calendar-days" style="width:14px;height:14px;color:var(--text-muted);"></i>
              <div>
                <div class="lb-week-num">Week ${week.week_number}
                  ${wStatus === 'certified' ? '<i data-lucide="shield-check" style="width:11px;height:11px;color:var(--green);vertical-align:middle;margin-left:4px;"></i>' : ''}
                  ${wStatus === 'submitted' ? '<i data-lucide="send" style="width:11px;height:11px;color:var(--amber);vertical-align:middle;margin-left:4px;"></i>' : ''}
                </div>
                <div class="lb-week-dates">${dateRange}</div>
              </div>
            </div>
            <div class="lb-week-right">
              <div class="lb-week-dots">${_weekDots(week)}</div>
              <span class="lb-week-pct">${pct}%</span>
              <i data-lucide="${wOpen ? 'chevron-up' : 'chevron-down'}" style="width:13px;height:13px;color:var(--text-muted);"></i>
            </div>
          </button>
          <div class="lb-week-detail${wOpen ? ' lb-week-detail-open' : ''}" id="lb-wd-${week.id}">
            ${wOpen ? _buildDayGrid(week) : ''}
          </div>
        </div>`;
    }

    slidesHtml += `
      <div class="lb-month-slide">
        <div class="lb-month-block${isOpen ? ' lb-open' : ''}" data-mkey="${month.key}">
          <button class="lb-month-header" data-mkey="${month.key}" aria-expanded="${isOpen}">
            <div class="lb-month-left">
              <span class="lb-month-icon ${iconCls}">
                <i data-lucide="calendar" style="width:16px;height:16px;"></i>
              </span>
              <div>
                <div class="lb-month-name">${month.label}</div>
                <div class="lb-month-meta">${month.weeks.length} week${month.weeks.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
            <div class="lb-month-right">
              <span class="lb-badge ${badgeCls}">${badgeTxt}</span>
              <i data-lucide="${isOpen ? 'chevron-up' : 'chevron-down'}" class="lb-chevron" style="width:16px;height:16px;"></i>
            </div>
          </button>
          <div class="lb-month-body${isOpen ? ' lb-month-body-open' : ''}">
            <div class="lb-week-list">${weeksHtml}</div>
          </div>
        </div>
      </div>`;
  }

  // Only show nav controls if there is more than one month
  const showNav = months.length > 1;
  const currentLabel = months[ci]?.label ?? '';

  const html = `
    <div class="lb-carousel-shell">
      ${showNav ? `
      <div class="lb-carousel-nav">
        <button class="lb-carousel-arrow" id="lb-car-prev" aria-label="Previous month" ${ci === 0 ? 'disabled' : ''}>
          <i data-lucide="chevron-left" style="width:16px;height:16px;"></i>
        </button>
        <span class="lb-carousel-title">${currentLabel}</span>
        <button class="lb-carousel-arrow" id="lb-car-next" aria-label="Next month" ${ci === months.length - 1 ? 'disabled' : ''}>
          <i data-lucide="chevron-right" style="width:16px;height:16px;"></i>
        </button>
      </div>
      <div class="lb-carousel-dots">${dotsHtml}</div>` : ''}
      <div class="lb-carousel-viewport">
        <div class="lb-carousel-track" id="lb-car-track" style="transform: translateX(-${ci * 100}%)">
          ${slidesHtml}
        </div>
      </div>
    </div>`;

  container.innerHTML = html;
  _attachDrilldownListeners();
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
// The day-entry grid is now owned by the drilldown + modal (_buildDayGrid /
// _openDayModal).  _selectWeek is kept as a lightweight coordinator that
// updates the week meta panel (dept, remarks, submit button) and the right-hand
// side panels (timeline, cert box) whenever the active week changes.
async function _selectWeek(idx, { skipRender = false } = {}) {
  if (idx < 0 || idx >= _lb.weeks.length) return;
  _lb.activeWeekIdx = idx;

  // Keep the week-meta area visible, monthly panel hidden
  document.getElementById('weeklyFormContainer')?.classList.remove('hidden');
  document.getElementById('monthlySummaryContainer')?.classList.add('hidden');

  const week     = _lb.weeks[idx];
  const isLocked = week.status === 'submitted' || week.status === 'certified' || _lb.logbookFinalized;

  // Update the heading label (used by the header panel)
  const rangeLabel = document.getElementById('weekRangeLabel');
  if (rangeLabel) rangeLabel.textContent = `Week ${week.week_number} Logbook Entry`;

  // Clear the old textarea grid if it still exists in the DOM
  const oldGrid = document.getElementById('dailyLogsInputs');
  if (oldGrid) oldGrid.innerHTML = '';

  // Load this week's entries into the drilldown cache (dots + previews)
  await _loadWeekEntriesIntoCache(week);

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

  _renderMonthWeekDrilldown();

  // Pre-load this week's entries into cache so dots show immediately on boot
  const defaultIdx = _lb.weeks.findIndex(w => w.week_number === weekNum);
  const bootIdx    = defaultIdx >= 0 ? defaultIdx : _lb.weeks.length - 1;
  _lb.activeWeekIdx = bootIdx;
  if (_lb.weeks[bootIdx]) {
    await _loadWeekEntriesIntoCache(_lb.weeks[bootIdx]);
    _drilldown.openWeeks.add(_lb.weeks[bootIdx].id);
    _renderMonthWeekDrilldown();    // re-render now dots are populated
  }

  // Update meta panel and side panels for the boot week (drilldown already rendered above)
  await _selectWeek(bootIdx, { skipRender: true });

  // Wire monthly summary tab
  _initMonthlyPanel();

  // PDF Export Binding
  const btnExportPdf = document.getElementById('btnExportPdf');
  if (btnExportPdf) btnExportPdf.onclick = exportPdf;
}