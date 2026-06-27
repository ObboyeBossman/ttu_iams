// =============================================================================
// IAMS — attendance-section.js  (Phase 2 — Premium Edition)
// Drives the premium attendance UI in #view-attendance.
// Connects GPS HUD, calendar, metrics, absence overlay, and detail drawer
// to real Supabase data via attendance.service.js.
// =============================================================================
import './attendance.css';
import { showToast } from '/shell/nav.js';
import {
  getTodayLog, checkIn, checkOut, logAbsence, listAttendanceLogs,
} from '/shared/services/attendance.service.js';

// ── Haversine distance (metres) ──────────────────────────────────────────────
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Formatters ───────────────────────────────────────────────────────────────
function _fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
}
function _duration(inTs, outTs) {
  if (!inTs || !outTs) return '—';
  const m = Math.round((new Date(outTs) - new Date(inTs)) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function _statusColor(s) {
  return s === 'present' ? 'var(--green)'
    : s === 'absent' ? '#EF4444'
    : s === 'flagged_location' ? '#F87171'
    : 'var(--text-muted)';
}
function _statusLabel(s) {
  return s === 'flagged_location' ? 'Flagged' : (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

// ── Module state ─────────────────────────────────────────────────────────────
let _studentId   = null;
let _seasonId    = null;
let _placement   = null;
let _studentName = '';
let _todayLog    = null;
let _allLogs     = [];
let _calViewDate = new Date();
let _dailyState  = 'pending'; // pending | checking_in | present | checking_out | done | absent

// ── Init ─────────────────────────────────────────────────────────────────────
export async function initAttendance(studentId, seasonId, placement, studentName) {
  _studentId   = studentId;
  _seasonId    = seasonId;
  _placement   = placement;
  _studentName = studentName || '';

  // Update date label in page header
  const dateLabel = document.getElementById('att-date-label');
  if (dateLabel) dateLabel.textContent = new Date().toLocaleDateString('en-GH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const noPlacement = document.getElementById('att-no-placement');
  const portal      = document.getElementById('att-portal');

  if (!placement || placement.status !== 'assigned') {
    noPlacement?.classList.remove('hidden');
    portal?.classList.add('hidden');
    return;
  }
  noPlacement?.classList.add('hidden');
  portal?.classList.remove('hidden');

  // Calendar init to current month
  _calViewDate = new Date();
  _calViewDate.setDate(1);

  // Populate ticket
  _tickSet('att-tick-student', _studentName || 'You');
  _tickSet('att-tick-company', placement.company_name);
  _tickSet('att-tick-anchor', placement.latitude ? 'GPS Locked ✔' : 'Pending Supervisor Visit');

  // Load data
  const { data: todayLog }  = await getTodayLog(studentId, seasonId);
  _todayLog  = todayLog;
  const { data: logs } = await listAttendanceLogs(studentId, seasonId);
  _allLogs   = logs ?? [];

  // Derive initial state from today's log
  if (_todayLog) {
    if (_todayLog.status === 'absent') {
      _dailyState = 'absent';
    } else if (_todayLog.check_in_time && _todayLog.check_out_time) {
      _dailyState = 'done';
    } else if (_todayLog.check_in_time) {
      _dailyState = 'present';
    }
  }

  _updateHelpText();
  _updateButtons();
  _updateTicketStatus();
  _renderMetrics();
  _renderCalendar();
  _wireEvents();
}

// ── Wire event listeners ─────────────────────────────────────────────────────
let _eventsWired = false;
function _wireEvents() {
  if (_eventsWired) return;
  _eventsWired = true;

  document.getElementById('att-checkin-btn')?.addEventListener('click', _handleCheckIn);
  document.getElementById('att-checkout-btn')?.addEventListener('click', _handleCheckOut);
  document.getElementById('att-absence-toggle-btn')?.addEventListener('click', () => {
    const overlay = document.getElementById('att-absence-overlay');
    overlay?.classList.toggle('active');
  });
  document.getElementById('att-absence-cancel-btn')?.addEventListener('click', () => {
    document.getElementById('att-absence-overlay')?.classList.remove('active');
  });
  document.getElementById('att-absence-submit-btn')?.addEventListener('click', _handleLogAbsence);

  // Calendar nav
  document.getElementById('att-cal-prev')?.addEventListener('click', () => {
    _calViewDate.setMonth(_calViewDate.getMonth() - 1);
    _renderCalendar();
  });
  document.getElementById('att-cal-next')?.addEventListener('click', () => {
    _calViewDate.setMonth(_calViewDate.getMonth() + 1);
    _renderCalendar();
  });

  // Drawer close
  document.getElementById('att-drawer-close')?.addEventListener('click', _closeDrawer);
  document.getElementById('att-drawer-overlay')?.addEventListener('click', _closeDrawer);
}

// ── GPS HUD helpers ───────────────────────────────────────────────────────────
function _setRadar(scanning, success = false) {
  const hub  = document.getElementById('att-radar-hub');
  const icon = document.getElementById('att-sensor-icon');
  if (!hub || !icon) return;
  hub.classList.toggle('scanning', scanning);
  icon.className = 'att-sensor-icon' + (scanning ? ' scanning' : success ? ' success' : '');
  if (success) {
    icon.innerHTML = '<i data-lucide="check" style="width:28px;height:28px;"></i>';
    if (window.lucide) lucide.createIcons();
  } else if (!scanning) {
    icon.innerHTML = '<i data-lucide="map-pin" style="width:28px;height:28px;"></i>';
    if (window.lucide) lucide.createIcons();
  }
}
function _setSensorText(status, sub) {
  const s = document.getElementById('att-sensor-status');
  const b = document.getElementById('att-sensor-sub');
  if (s) s.textContent = status;
  if (b) b.textContent = sub;
}

// ── Get GPS position ─────────────────────────────────────────────────────────
function _getPos() {
  return new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { timeout: 15000, maximumAge: 0 }),
  );
}

// ── Check-In flow ────────────────────────────────────────────────────────────
async function _handleCheckIn() {
  if (_dailyState !== 'pending') return;
  _dailyState = 'checking_in';
  _updateButtons();

  _setRadar(true);
  _setSensorText('Acquiring GPS lock…', 'Contacting satellite constellation');
  showToast('Capturing GPS location…', 'info');

  let lat = null, lng = null, distanceM = null;
  try {
    const pos = await _getPos();
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
    if (_placement.latitude && _placement.longitude) {
      distanceM = Math.round(haversineM(lat, lng, _placement.latitude, _placement.longitude));
    }
  } catch {
    showToast('Could not capture location. Please enable location access and try again.', 'error');
    _setRadar(false);
    _setSensorText('Sensors Idle', 'Coordinate trace stamps occur in background');
    _dailyState = 'pending';
    _updateButtons();
    return;
  }

  _setRadar(false, true);
  _setSensorText(
    'Telemetry verified!',
    distanceM !== null ? `~${distanceM}m from placement` : 'Location captured',
  );

  const { data: log, error } = await checkIn({
    studentId: _studentId, placementId: _placement.id, seasonId: _seasonId,
    lat, lon: lng, locationSource: 'gps', distanceM,
  });

  if (error) {
    showToast('Check-in failed: ' + error.message, 'error');
    _setRadar(false);
    _setSensorText('Sensors Idle', 'Coordinate trace stamps occur in background');
    _dailyState = 'pending';
    _updateButtons();
    return;
  }

  _todayLog = log;
  _allLogs  = [log, ..._allLogs.filter(l => l.log_date !== log.log_date)];
  _dailyState = 'present';
  _updateButtons();
  _updateHelpText();
  _updateTicketStatus();
  _renderMetrics();
  _renderCalendar();

  if (distanceM !== null && distanceM > 500) {
    showToast(`Check-in recorded but flagged — you appear ${distanceM}m from your placement.`, 'warning');
  } else {
    showToast('Checked in successfully!', 'success');
  }
}

// ── Check-Out flow ───────────────────────────────────────────────────────────
async function _handleCheckOut() {
  if (_dailyState !== 'present' || !_todayLog) return;
  _dailyState = 'checking_out';
  _updateButtons();

  _setRadar(true);
  _setSensorText('Verifying checkout anchors…', 'Transmitting to database');
  showToast('Recording check-out…', 'info');

  let lat = null, lng = null;
  try {
    const pos = await _getPos();
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
  } catch { /* GPS optional for checkout */ }

  const { data: updated, error } = await checkOut({
    logId: _todayLog.id, lat, lon: lng, locationSource: lat ? 'gps' : 'manual',
  });

  _setRadar(false, !error);
  if (error) {
    showToast('Check-out failed: ' + error.message, 'error');
    _setSensorText('Sensors Idle', 'Coordinate trace stamps occur in background');
    _dailyState = 'present';
    _updateButtons();
    return;
  }

  _todayLog  = updated;
  _allLogs   = [updated, ..._allLogs.filter(l => l.log_date !== updated.log_date)];
  _dailyState = 'done';
  _setSensorText('Checkout complete!', `Checked out at ${_fmtTime(updated.check_out_time)}`);
  _updateButtons();
  _updateHelpText();
  _updateTicketStatus();
  _renderMetrics();
  _renderCalendar();
  showToast('Checked out successfully!', 'success');
}

// ── Absence flow ─────────────────────────────────────────────────────────────
async function _handleLogAbsence() {
  if (_dailyState !== 'pending') return;
  const reason = document.getElementById('att-absence-reason')?.value || 'other';

  const { data: log, error } = await logAbsence({
    studentId: _studentId, placementId: _placement.id, seasonId: _seasonId, reason,
  });
  if (error) { showToast('Could not file absence: ' + error.message, 'error'); return; }

  _todayLog   = log;
  _allLogs    = [log, ..._allLogs.filter(l => l.log_date !== log.log_date)];
  _dailyState = 'absent';
  document.getElementById('att-absence-overlay')?.classList.remove('active');
  _updateButtons();
  _updateHelpText();
  _updateTicketStatus();
  _renderMetrics();
  _renderCalendar();
  showToast(`Absence filed: ${reason}`, 'success');
}

// ── Button state machine ──────────────────────────────────────────────────────
function _updateButtons() {
  const ci  = document.getElementById('att-checkin-btn');
  const co  = document.getElementById('att-checkout-btn');
  const ab  = document.getElementById('att-absence-toggle-btn');
  if (!ci) return;

  ci.disabled  = _dailyState !== 'pending';
  co.disabled  = _dailyState !== 'present';
  if (ab) ab.disabled = _dailyState !== 'pending';

  // Show/hide absence overlay cleanup
  if (_dailyState !== 'pending') {
    document.getElementById('att-absence-overlay')?.classList.remove('active');
  }
}

function _updateHelpText() {
  const el = document.getElementById('att-help-text');
  if (!el) return;
  const map = {
    pending:      'Tap Check In to record your daily arrival. GPS sensors will trace automatically.',
    checking_in:  'Acquiring GPS coordinates and verifying boundaries. Please wait…',
    present:      `Checked in at ${_fmtTime(_todayLog?.check_in_time)}. Remember to check out before you leave.`,
    checking_out: 'Transmitting checkout telemetry to the database…',
    done:         `Day complete! Check-in: ${_fmtTime(_todayLog?.check_in_time)} · Check-out: ${_fmtTime(_todayLog?.check_out_time)}`,
    absent:       'Absence filed for today. Access resets tomorrow morning.',
  };
  el.textContent = map[_dailyState] || '';
}

// ── Day title ────────────────────────────────────────────────────────────────
function _updateTicketStatus() {
  const today = new Date();
  const el = document.getElementById('att-day-title');
  if (el) el.textContent = today.toLocaleDateString('en-GH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const tickStatus = document.getElementById('att-tick-status');
  if (tickStatus) {
    const s = _todayLog?.status;
    tickStatus.textContent = _statusLabel(s) || 'Pending';
    tickStatus.style.color = s ? _statusColor(s) : 'var(--ttu-gold)';
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────────
function _renderMetrics() {
  const present = _allLogs.filter(l => l.status === 'present' || l.status === 'flagged_location').length;
  const absent  = _allLogs.filter(l => l.status === 'absent').length;
  const flagged = _allLogs.filter(l => l.status === 'flagged_location').length;
  const total   = present + absent;
  const rate    = total > 0 ? Math.round((present / total) * 100) : 0;

  _elSet('att-m-present', present);
  _elSet('att-m-absent',  absent);
  _elSet('att-m-flagged', flagged);
  _elSet('att-m-rate',    total > 0 ? `${rate}%` : '—');
  _elSet('att-record-count', `${_allLogs.length} record${_allLogs.length !== 1 ? 's' : ''}`);
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function _renderCalendar() {
  const grid  = document.getElementById('att-cal-grid');
  const label = document.getElementById('att-cal-month');
  if (!grid) return;
  grid.innerHTML = '';

  const year  = _calViewDate.getFullYear();
  const month = _calViewDate.getMonth();
  if (label) label.textContent = `${MONTHS[month]} ${year}`;

  const today = new Date();
  // Build lookup by date string (yyyy-mm-dd)
  const logMap = {};
  _allLogs.forEach(l => { logMap[l.log_date] = l; });

  DOW.forEach(d => {
    const h = document.createElement('div');
    h.className = 'att-cal-dow'; h.textContent = d; grid.appendChild(h);
  });

  const firstDow = new Date(year, month, 1).getDay();
  for (let i = 0; i < firstDow; i++) {
    const b = document.createElement('div'); b.className = 'att-cal-day att-cal-day--empty'; grid.appendChild(b);
  }

  const days = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    const dateObj = new Date(year, month, day);
    const key     = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const rec     = logMap[key];

    const isToday  = (dateObj.toDateString() === today.toDateString());
    const isFuture = dateObj > today;

    const cell = document.createElement('div');
    cell.className = 'att-cal-day';
    if (isToday)  cell.classList.add('att-cal-day--today');
    if (isFuture) cell.classList.add('att-cal-day--future');

    const num = document.createElement('span');
    num.textContent = day;
    num.style.cssText = 'position:relative;z-index:2;';
    cell.appendChild(num);

    if (rec && !isFuture) {
      const dot = document.createElement('div');
      dot.className = `att-cal-dot ${rec.status}`;
      cell.appendChild(dot);

      // Hover tooltip
      const tip = document.createElement('div');
      tip.className = 'att-cal-tip';
      const shortDate = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      tip.innerHTML = `
        <div class="att-tip-date">${shortDate}</div>
        <div class="att-tip-status" style="color:${_statusColor(rec.status)}">${_statusLabel(rec.status)}</div>
        <div class="att-tip-row"><span>Check-in</span><strong>${_fmtTime(rec.check_in_time)}</strong></div>
        <div class="att-tip-row"><span>Check-out</span><strong>${_fmtTime(rec.check_out_time)}</strong></div>
        ${rec.absence_reason ? `<div class="att-tip-row"><span>Reason</span><strong>${rec.absence_reason}</strong></div>` : ''}
      `;
      cell.appendChild(tip);

      // Click → open drawer
      cell.addEventListener('click', () => _openDrawer(rec, dateObj));
    }

    grid.appendChild(cell);
  }
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
function _openDrawer(rec, dateObj) {
  const overlay = document.getElementById('att-drawer-overlay');
  const panel   = document.getElementById('att-drawer-panel');
  const dateEl  = document.getElementById('att-drawer-date');
  const body    = document.getElementById('att-drawer-body');
  if (!panel || !body) return;

  const accent = _statusColor(rec.status);
  panel.style.setProperty('--att-drawer-accent', accent);

  if (dateEl) dateEl.textContent = dateObj.toLocaleDateString('en-GH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  body.innerHTML = `
    <div class="att-drawer-status-hero ${rec.status}">
      <div class="att-drawer-status-icon ${rec.status}">
        <i data-lucide="${rec.status === 'present' ? 'check-circle-2' : rec.status === 'absent' ? 'calendar-x' : 'alert-triangle'}" style="width:22px;height:22px;"></i>
      </div>
      <div>
        <div class="att-drawer-status-label" style="color:${accent}">${_statusLabel(rec.status)}</div>
        <div class="att-drawer-status-sub">${rec.absence_reason ? `Reason: ${rec.absence_reason}` : (rec.check_in_time ? `Duration: ${_duration(rec.check_in_time, rec.check_out_time)}` : 'No check-in recorded')}</div>
      </div>
    </div>

    ${rec.check_in_time ? `
    <div>
      <div class="att-drawer-section-title">Telemetry Timestamps</div>
      <div class="att-drawer-info-grid">
        <div class="att-drawer-info-cell">
          <div class="att-drawer-info-lbl">Check-In</div>
          <div class="att-drawer-info-val" style="color:var(--green)">${_fmtTime(rec.check_in_time)}</div>
        </div>
        <div class="att-drawer-info-cell">
          <div class="att-drawer-info-lbl">Check-Out</div>
          <div class="att-drawer-info-val">${_fmtTime(rec.check_out_time)}</div>
        </div>
        <div class="att-drawer-info-cell">
          <div class="att-drawer-info-lbl">Duration</div>
          <div class="att-drawer-info-val">${_duration(rec.check_in_time, rec.check_out_time)}</div>
        </div>
        ${rec.distance_from_placement_m != null ? `
        <div class="att-drawer-info-cell">
          <div class="att-drawer-info-lbl">Distance</div>
          <div class="att-drawer-info-val" style="color:${rec.distance_from_placement_m > 500 ? '#F87171' : 'var(--green)'}">${Math.round(rec.distance_from_placement_m)}m</div>
        </div>` : ''}
      </div>
    </div>` : ''}

    ${rec.status === 'flagged_location' ? `
    <div>
      <div class="att-drawer-section-title">Anomaly Flags</div>
      <div class="att-drawer-flag">
        <i data-lucide="alert-triangle" style="width:16px;height:16px;flex-shrink:0;"></i>
        <span>Location mismatch — checked in more than 500m from registered placement address. Distance: ${rec.distance_from_placement_m != null ? Math.round(rec.distance_from_placement_m) + 'm' : 'Unknown'}</span>
      </div>
    </div>` : ''}
  `;

  if (window.lucide) lucide.createIcons();
  overlay?.classList.add('open');
  panel?.classList.add('open');
}

function _closeDrawer() {
  document.getElementById('att-drawer-overlay')?.classList.remove('open');
  document.getElementById('att-drawer-panel')?.classList.remove('open');
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function _elSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function _tickSet(id, val) { _elSet(id, val); }
