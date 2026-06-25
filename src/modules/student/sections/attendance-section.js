// =============================================================================
// IAMS — attendance-section.js  (Phase 2)
// Handles #attendance: today card, GPS check-in/out, history table.
// =============================================================================
import './attendance.css';
import { showToast } from '/shell/nav.js';
import { getTodayLog, checkIn, checkOut, listAttendanceLogs } from '/shared/services/attendance.service.js';

// ── Haversine distance (metres) ───────────────────────────────────────────────
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function _fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GH', { hour:'2-digit', minute:'2-digit' });
}
function _duration(inTs, outTs) {
  if (!inTs || !outTs) return '—';
  const m = Math.round((new Date(outTs) - new Date(inTs)) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`;
}
function _badgeHtml(status) {
  const map = { present:'badge-present', absent:'badge-absent', flagged_location:'badge-flagged' };
  return `<span class="badge ${map[status]??'badge-pending'}">${status?.replace('_',' ')??'—'}</span>`;
}

let _clockTimer = null;

export async function initAttendance(studentId, seasonId, placement) {
  const noPlacement  = document.getElementById('att-no-placement');
  const todaySection = document.getElementById('att-today-section');
  const dateLabel    = document.getElementById('att-date-label');

  const today = new Date();
  if (dateLabel) {
    dateLabel.textContent = today.toLocaleDateString('en-GH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  }
  document.getElementById('att-full-date').textContent = today.toLocaleDateString('en-GH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

  // Start live clock
  if (_clockTimer) clearInterval(_clockTimer);
  _clockTimer = setInterval(() => {
    const el = document.getElementById('att-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-GH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }, 1000);

  if (!placement || placement.status !== 'assigned') {
    noPlacement?.classList.remove('hidden');
    todaySection?.classList.add('hidden');
    return;
  }
  noPlacement?.classList.add('hidden');
  todaySection?.classList.remove('hidden');

  // Placement address
  const addrEl = document.getElementById('att-placement-addr');
  if (addrEl) addrEl.textContent = `${placement.company_name} — ${placement.city_town}, ${placement.region}`;

  // Load today's record
  const { data: log } = await getTodayLog(studentId, seasonId);
  _renderTodayCard(log, studentId, seasonId, placement);

  // History
  await _renderHistory(studentId, seasonId);
}

function _renderTodayCard(log, studentId, seasonId, placement) {
  const pre     = document.getElementById('att-pre-checkin');
  const post    = document.getElementById('att-post-checkin');
  const complete = document.getElementById('att-complete');
  const card    = document.getElementById('att-today-card');
  [pre, post, complete].forEach(el => el?.classList.add('hidden'));

  if (!log) {
    pre?.classList.remove('hidden');
    document.getElementById('att-checkin-btn')?.addEventListener('click', () =>
      _handleCheckIn(studentId, seasonId, placement));
    return;
  }
  if (log.check_in_time && !log.check_out_time) {
    card?.classList.add('checked-in');
    const infoEl = document.getElementById('att-checkin-info');
    if (infoEl) infoEl.innerHTML = _checkinInfoHtml(log);
    post?.classList.remove('hidden');
    document.getElementById('att-checkout-btn')?.addEventListener('click', () =>
      _handleCheckOut(log, card));
    return;
  }
  if (log.check_in_time && log.check_out_time) {
    card?.classList.add('checked-out');
    const infoEl = document.getElementById('att-complete-info');
    if (infoEl) infoEl.innerHTML = _checkinInfoHtml(log, true);
    complete?.classList.remove('hidden');
    return;
  }
}

function _checkinInfoHtml(log, withCheckout = false) {
  const isFlagged = log.status === 'flagged_location';
  let html = `
    <div class="attendance-checkin-info-item">
      <div class="attendance-checkin-info-label">Check In</div>
      <div class="attendance-checkin-info-value present">${_fmt(log.check_in_time)}</div>
    </div>`;
  if (withCheckout) html += `
    <div class="attendance-checkin-info-item">
      <div class="attendance-checkin-info-label">Check Out</div>
      <div class="attendance-checkin-info-value">${_fmt(log.check_out_time)}</div>
    </div>
    <div class="attendance-checkin-info-item">
      <div class="attendance-checkin-info-label">Duration</div>
      <div class="attendance-checkin-info-value">${_duration(log.check_in_time, log.check_out_time)}</div>
    </div>`;
  if (log.distance_from_placement_m != null) html += `
    <div class="attendance-checkin-info-item">
      <div class="attendance-checkin-info-label">Distance</div>
      <div class="attendance-checkin-info-value ${isFlagged?'flagged':''}">${Math.round(log.distance_from_placement_m)}m</div>
    </div>`;
  return html;
}

async function _handleCheckIn(studentId, seasonId, placement) {
  const btn = document.getElementById('att-checkin-btn');
  if (!btn) return;
  if (!navigator.onLine) { showToast('No internet connection. Check-in requires connectivity.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Capturing GPS…';

  let lat, lng, distanceM = null, flagged = false, flagReason = null;
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 15000, maximumAge: 0 }));
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;

    if (placement.latitude && placement.longitude) {
      distanceM = haversineM(lat, lng, placement.latitude, placement.longitude);
      if (distanceM > 500) {
        flagged = true;
        flagReason = `Location mismatch — checked in ${Math.round(distanceM)}m from expected placement address`;
      }
    }
  } catch {
    showToast('Could not capture your location. Please enable location access and try again.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="map-pin-check"></i> Check In';
    return;
  }

  const { data: log, error } = await checkIn({
    studentId, placementId: placement.id, seasonId,
    lat, lon: lng, locationSource: 'gps',
    distanceM: distanceM != null ? Math.round(distanceM) : null,
  });

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="map-pin-check"></i> Check In';

  if (error) { showToast('Check-in failed: ' + error.message, 'error'); return; }

  if (flagged) {
    showToast('Check-in recorded but flagged — you appear to be further than expected from your placement address.', 'warning');
  } else {
    showToast('Checked in successfully.', 'success');
  }
  _renderTodayCard(log, studentId, seasonId, placement);
  await _renderHistory(studentId, seasonId);
}

async function _handleCheckOut(log, card) {
  const btn = document.getElementById('att-checkout-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Capturing GPS…';

  let lat = null, lng = null;
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 15000, maximumAge: 0 }));
    lat = pos.coords.latitude; lng = pos.coords.longitude;
  } catch { /* GPS optional for checkout */ }

  const { data: updated, error } = await checkOut({ logId: log.id, lat, lon: lng, locationSource: lat ? 'gps' : 'manual' });
  if (error) { showToast('Check-out failed: ' + error.message, 'error'); btn.disabled = false; btn.innerHTML = '<i data-lucide="log-out"></i> Check Out'; return; }

  showToast('Checked out successfully.', 'success');
  card?.classList.remove('checked-in');
  card?.classList.add('checked-out');
  document.getElementById('att-post-checkin')?.classList.add('hidden');
  const completeEl = document.getElementById('att-complete');
  const infoEl     = document.getElementById('att-complete-info');
  if (infoEl) infoEl.innerHTML = _checkinInfoHtml(updated, true);
  completeEl?.classList.remove('hidden');
  await _renderHistory(log.student_id, log.season_id);
}

async function _renderHistory(studentId, seasonId) {
  const body = document.getElementById('att-history-body');
  if (!body) return;
  const { data: logs } = await listAttendanceLogs(studentId, seasonId);
  if (!logs?.length) {
    body.innerHTML = '<p style="font-size:13px;color:var(--text-secondary)">No attendance records yet for this season.</p>';
    return;
  }
  const rows = logs.slice(0, 20).map(l => `
    <tr>
      <td>${l.log_date}</td>
      <td>${_fmt(l.check_in_time)}</td>
      <td>${_fmt(l.check_out_time)}</td>
      <td>${_duration(l.check_in_time, l.check_out_time)}</td>
      <td>${_badgeHtml(l.status)}</td>
    </tr>`).join('');
  body.innerHTML = `
    <table class="attendance-history-table">
      <thead><tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Duration</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
