// =============================================================================
// IAMS — src/modules/admin/dashboard.js
// =============================================================================

import { requireRole, getCurrentUserId }   from '../../auth/auth-guard.js';
import { renderShell, navigateTo, showToast } from '/shell/nav.js';
import { supabase }                         from '/shared/supabase-client.js';
import { listSeasons, getOpenSeason, openSeason, closeSeason, archiveSeason, createSeason }
  from '/shared/services/seasons.js';
import { listZones, createZone, deleteZone, listSupervisorsForZone }
  from '/shared/services/zones.js';
import { listPlacements, listPlacementsBySeason, batchAssignToZone,
         flagPlacement, rejectPlacement }   from '/shared/services/placements.js';
import { listLetters }                      from '/shared/services/letters.js';
import { formatDate, formatAddress, statusLabel } from '/shared/utils.js';

// ── 1. Auth guard ────────────────────────────────────────────────────────────
await requireRole(['admin']);
const userId = await getCurrentUserId();

// ── 2. Load user profile ─────────────────────────────────────────────────────
const { data: profile } = await supabase
  .from('profiles')
  .select('full_name')
  .eq('id', userId)
  .maybeSingle();

const fullName = profile?.full_name ?? 'Admin';
const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

// ── 3. Render shell ──────────────────────────────────────────────────────────
await renderShell('admin', 'dashboard', { name: fullName, initials, email: '' });

// ── 4. Page routing ──────────────────────────────────────────────────────────
const PAGE_KEYS = ['dashboard', 'zones', 'seasons',
                   'assign-placements', 'letters-audit', 'settings'];

function showPage(page) {
  if (page === 'users') {
    window.location.href = '/src/modules/admin_portal/users/users.html';
    return;
  }
  PAGE_KEYS.forEach(key => {
    const el = document.getElementById(`view-${key}`);
    if (el) el.classList.toggle('active', key === page);
  });
}

window.addEventListener('hashchange', () => {
  const page = (location.hash || '').replace('#', '') || 'dashboard';
  if (page === 'users' || PAGE_KEYS.includes(page)) {
    showPage(page);
    dispatchPageLoad(page);
  }
});

// Fixed: nav.js uses replaceState(null, '', '#page') which does NOT trigger
// 'hashchange'. We add a one-time click intercept for the 'users' module
// since it requires a hard redirect to its own HTML file.
function wireUsersRedirect() {
  // Use a MutationObserver or a setInterval if the shell renders asynchronously,
  // but nav.js renderShell is awaited, so the elements should be there.
  const usersBtn = document.querySelector('.sidebar-item[data-page="users"]');
  if (usersBtn) {
    usersBtn.addEventListener('click', (e) => {
      // The nav.js listener also runs but e.preventDefault() is called there.
      // We want to force the redirect.
      window.location.href = '/src/modules/admin_portal/users/users.html';
    });
  }
}

function dispatchPageLoad(page) {
    if (page === 'zones')             loadZones();
    if (page === 'seasons')           loadSeasons();
    if (page === 'assign-placements') loadAssignPlacements();
    if (page === 'letters-audit')     loadLettersAudit();
    if (page === 'settings')          loadSettings();
}

const initialPage = (location.hash || '').replace('#', '') || 'dashboard';
showPage(initialPage);
wireUsersRedirect();

// ── 5. Global data ───────────────────────────────────────────────────────────
let _season     = null;
let _students   = []; // Kept for lookup in Assign Placements & Letters Audit
let _placements = [];
let _zones      = [];
let _letters    = [];

async function loadGlobalData() {
  const [{ data: season }, { data: students }, { data: placements },
         { data: zones }, { data: letters }] = await Promise.all([
    getOpenSeason(),
    supabase.from('profiles').select('*').eq('role', 'student'),
    listPlacements(),
    listZones(),
    listLetters(),
  ]);
  _season     = season;
  _students   = students   ?? [];
  _placements = placements ?? [];
  _zones      = zones      ?? [];
  _letters    = letters    ?? [];
}

await loadGlobalData();

// ── 6. Admin Dashboard page ───────────────────────────────────────────────────
function renderAdminDashboard() {
  document.getElementById('adash-season-label').textContent = _season
    ? `Active season: ${_season.name}`
    : 'No active season. Open a season from the Seasons page.';

  const statusCount = (s) => _placements.filter(p => p.status === s).length;
  document.getElementById('stat-students').textContent  = '—';
  document.getElementById('stat-submitted').textContent = statusCount('submitted');
  document.getElementById('stat-assigned').textContent  = statusCount('assigned');
  document.getElementById('stat-flagged').textContent   = statusCount('flagged');
  document.getElementById('stat-rejected').textContent  = statusCount('rejected');
  document.getElementById('stat-letters').textContent   =
    _season ? _letters.filter(l => l.season_id === _season?.id).length : '—';

  // Placements by zone
  const zoneEl = document.getElementById('adash-zone-table');
  const byZone = {};
  _placements.forEach(p => {
    const zone = _zones.find(z => z.id === p.zone_id);
    const key  = zone ? zone.name : 'Unassigned';
    byZone[key] = (byZone[key] ?? 0) + 1;
  });
  if (!Object.keys(byZone).length) {
    zoneEl.innerHTML = `<p style="font-size:13px;color:var(--text-secondary);">No placements yet.</p>`;
    return;
  }
  zoneEl.innerHTML = Object.entries(byZone)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `
      <div style="display:flex;justify-content:space-between;padding:10px 0;
                  border-bottom:0.5px solid var(--border-default);">
        <span style="font-size:13px;">${name}</span>
        <span class="badge badge-blue">${count}</span>
      </div>`).join('');
}

renderAdminDashboard();
if (initialPage !== 'dashboard') dispatchPageLoad(initialPage);

// ── 8. Zones page ────────────────────────────────────────────────────────────
let _zonesLoaded = false;

async function loadZones() {
  if (_zonesLoaded) return;
  _zonesLoaded = true;
  renderZoneList();

  document.getElementById('zone-add-btn').addEventListener('click', async () => {
    const name = prompt('Zone name:');
    if (!name?.trim()) return;
    const desc = prompt('Description (optional):') ?? '';
    const { error } = await createZone({ name: name.trim(), description: desc.trim() });
    if (error) { showToast(error.message, 'error'); return; }
    const { data } = await listZones();
    _zones = data ?? [];
    _zonesLoaded = false;
    renderZoneList();
    showToast(`Zone "${name}" created.`, 'success');
  });
}

function renderZoneList() {
  const el = document.getElementById('zones-list');
  if (!_zones.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><i data-lucide="map"></i></div>
      <div class="empty-state-title">No zones yet</div>
      <div class="empty-state-message">Create your first zone to start assigning placements.</div>
    </div>`;
    return;
  }
  el.innerHTML = _zones.map(z => {
    const count = _placements.filter(p => p.zone_id === z.id).length;
    return `<div class="card" style="margin-bottom:12px;display:flex;
                justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:14px;font-weight:600;">${z.name}</div>
        <div style="font-size:12px;color:var(--text-secondary);">${z.description ?? '—'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <span class="badge badge-blue">${count} placement${count !== 1 ? 's' : ''}</span>
      </div>
    </div>`;
  }).join('');
}

// ── 9. Seasons page ───────────────────────────────────────────────────────────
let _seasonsLoaded = false;
let _allSeasons = [];

async function loadSeasons() {
  if (_seasonsLoaded) return;
  _seasonsLoaded = true;
  const { data } = await listSeasons();
  _allSeasons = data ?? [];
  renderSeasonList();

  document.getElementById('season-add-btn').addEventListener('click', () => {
    showCreateSeasonModal();
  });
}

function renderSeasonList() {
  const el = document.getElementById('seasons-list');
  if (!_allSeasons.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><i data-lucide="calendar-range"></i></div>
      <div class="empty-state-title">No seasons yet</div>
    </div>`;
    return;
  }
  el.innerHTML = _allSeasons.map(s => {
    const statusBadge = {
      upcoming: 'badge-pending', open: 'badge-present',
      closed: 'badge-reviewed', archived: 'badge-finalized',
    }[s.status] ?? 'badge-gray';
    return `<div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:14px;font-weight:600;">${s.name}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
            ${formatDate(s.start_date)} – ${formatDate(s.end_date)}<br>
            Window: ${formatDate(s.placement_window_start)} – ${formatDate(s.placement_window_end)}
          </div>
        </div>
        <span class="badge ${statusBadge}">${s.status}</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        ${s.status === 'upcoming' ? `<button class="btn btn-sm btn-primary" data-season-action="open" data-id="${s.id}">Open</button>` : ''}
        ${s.status === 'open'     ? `<button class="btn btn-sm btn-outline" data-season-action="close" data-id="${s.id}">Close</button>` : ''}
        ${s.status === 'closed'   ? `<button class="btn btn-sm btn-ghost" data-season-action="archive" data-id="${s.id}">Archive</button>` : ''}
      </div>
    </div>`;
  }).join('');

  // Wire action buttons
  document.querySelectorAll('[data-season-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.seasonAction;
      const fn = { open: openSeason, close: closeSeason, archive: archiveSeason }[action];
      if (!fn) return;
      const { error } = await fn(id);
      if (error) { showToast(error.message, 'error'); return; }
      const { data } = await listSeasons();
      _allSeasons = data ?? [];
      _season = _allSeasons.find(s => s.status === 'open') ?? null;
      renderSeasonList();
      showToast(`Season ${action}d.`, 'success');
    });
  });
}

function showCreateSeasonModal() {
  // Minimal prompt-based creation for Phase 1
  const name = prompt('Season name (e.g. 2026/2027 Semester 1):');
  if (!name?.trim()) return;
  const start    = prompt('Start date (YYYY-MM-DD):');
  const end      = prompt('End date (YYYY-MM-DD):');
  const winStart = prompt('Placement window start (YYYY-MM-DD):');
  const winEnd   = prompt('Placement window end (YYYY-MM-DD):');
  if (!start || !end || !winStart || !winEnd) return;

  createSeason({ name: name.trim(), start_date: start, end_date: end,
                 placement_window_start: winStart, placement_window_end: winEnd })
    .then(({ error }) => {
      if (error) { showToast(error.message, 'error'); return; }
      listSeasons().then(({ data }) => {
        _allSeasons = data ?? [];
        _seasonsLoaded = false;
        renderSeasonList();
        showToast('Season created.', 'success');
      });
    });
}

// ── 10. Assign Placements page ────────────────────────────────────────────────
let _apLoaded = false;

async function loadAssignPlacements() {
  if (_apLoaded) return;
  _apLoaded = true;

  // Populate zone selector
  const sel = document.getElementById('ap-zone-select');
  _zones.forEach(z => {
    const o = document.createElement('option');
    o.value = z.id; o.textContent = z.name;
    sel.appendChild(o);
  });

  // Only show submitted/flagged placements — these are the ones that can transition
  const reviewable = _placements.filter(p => p.status === 'submitted' || p.status === 'flagged');
  renderAssignTable(reviewable);

  // Select-all toggle
  document.getElementById('ap-select-all').addEventListener('change', (e) => {
    document.querySelectorAll('.ap-row-check').forEach(cb => cb.checked = e.target.checked);
    updateAssignBtn();
  });

  sel.addEventListener('change', updateAssignBtn);

  document.getElementById('ap-assign-btn').addEventListener('click', async () => {
    const zoneId = sel.value;
    if (!zoneId) { showToast('Select a zone first.', 'info'); return; }
    const checked = [...document.querySelectorAll('.ap-row-check:checked')].map(cb => cb.dataset.id);
    if (!checked.length) { showToast('Select at least one placement.', 'info'); return; }

    const btn = document.getElementById('ap-assign-btn');
    btn.disabled = true;
    btn.textContent = 'Assigning…';

    const { succeeded, failed } = await batchAssignToZone(checked, zoneId);
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="link-2"></i> Assign Selected';

    if (failed.length) showToast(`${failed.length} assignment(s) failed.`, 'error');
    if (succeeded.length) showToast(`${succeeded.length} placement(s) assigned.`, 'success');

    // Refresh placements
    const { data } = await listPlacements();
    _placements = data ?? [];
    _apLoaded = false;
    await loadAssignPlacements();
  });
}

function updateAssignBtn() {
  const anyChecked = document.querySelectorAll('.ap-row-check:checked').length > 0;
  const zoneChosen = document.getElementById('ap-zone-select').value !== '';
  document.getElementById('ap-assign-btn').disabled = !(anyChecked && zoneChosen);
}

function renderAssignTable(rows) {
  const tbody = document.getElementById('ap-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-secondary);">
      No placements awaiting review.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(p => {
    const student = _students.find(s => s.id === p.student_id);
    const cls = { submitted: 'badge-submitted', flagged: 'badge-flagged' }[p.status] ?? '';
    return `<tr style="border-bottom:0.5px solid var(--border-default);">
      <td style="padding:10px 16px;">
        <input type="checkbox" class="ap-row-check" data-id="${p.id}" onchange="updateAssignBtn()">
      </td>
      <td style="padding:10px 16px;font-size:13px;">
        <div style="font-weight:500;">${student?.full_name ?? '—'}</div>
        <div style="font-size:12px;color:var(--text-secondary);">${student?.index_number ?? ''}</div>
      </td>
      <td style="padding:10px 16px;font-size:13px;">${p.company_name}</td>
      <td style="padding:10px 16px;font-size:12px;color:var(--text-secondary);">${formatAddress(p)}</td>
      <td style="padding:10px 16px;">
        <span style="font-size:12px;">${p.location_source === 'gps' ? '📍 GPS' : '📋 Manual'}</span>
      </td>
      <td style="padding:10px 16px;"><span class="badge ${cls}">${p.status}</span></td>
      <td style="padding:10px 16px;">
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-danger" onclick="adminFlag('${p.id}')">Flag</button>
          <button class="btn btn-sm btn-ghost" onclick="adminReject('${p.id}')">Reject</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Expose flag/reject to inline onclick (simpler than event delegation for a table)
window.updateAssignBtn = updateAssignBtn;
window.adminFlag = async (id) => {
  const { error } = await flagPlacement(id);
  if (error) { showToast(error.message, 'error'); return; }
  const { data } = await listPlacements();
  _placements = data ?? [];
  _apLoaded = false;
  await loadAssignPlacements();
  showToast('Placement flagged.', 'info');
};
window.adminReject = async (id) => {
  if (!confirm('Reject this placement? This cannot be undone.')) return;
  const { error } = await rejectPlacement(id);
  if (error) { showToast(error.message, 'error'); return; }
  const { data } = await listPlacements();
  _placements = data ?? [];
  _apLoaded = false;
  await loadAssignPlacements();
  showToast('Placement rejected.', 'info');
};

// ── 11. Letters Audit page ────────────────────────────────────────────────────
let _laLoaded = false;

async function loadLettersAudit() {
  if (_laLoaded) return;
  _laLoaded = true;
  renderLettersAudit(_letters);

  document.getElementById('la-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = q
      ? _letters.filter(l => {
          const s = _students.find(st => st.id === l.student_id);
          return l.company_name.toLowerCase().includes(q) ||
                 s?.full_name.toLowerCase().includes(q) ||
                 s?.index_number.toLowerCase().includes(q);
        })
      : _letters;
    renderLettersAudit(filtered);
  });
}

function renderLettersAudit(rows) {
  const tbody = document.getElementById('la-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--text-secondary);">No letters found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(l => {
    const s = _students.find(st => st.id === l.student_id);
    return `<tr style="border-bottom:0.5px solid var(--border-default);">
      <td style="padding:10px 16px;font-size:13px;">
        <div style="font-weight:500;">${s?.full_name ?? '—'}</div>
        <div style="font-size:12px;color:var(--text-secondary);">${s?.index_number ?? ''}</div>
      </td>
      <td style="padding:10px 16px;font-size:13px;">${l.company_name}</td>
      <td style="padding:10px 16px;font-size:13px;">${formatDate(l.generated_at)}</td>
      <td style="padding:10px 16px;"><code style="font-size:11px;">${l.verification_code}</code></td>
    </tr>`;
  }).join('');
}

// ── 12. Settings page ─────────────────────────────────────────────────────────
let _settingsLoaded = false;

async function loadSettings() {
  if (_settingsLoaded) return;
  _settingsLoaded = true;

  const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).single();
  const card = document.getElementById('settings-card');
  card.innerHTML = `
    <div class="form-section-title">Branding Assets</div>
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
      These paths point to the branding assets stored in Supabase Storage. Update them
      when you upload a new letterhead, stamp, or signature.
    </p>
    ${['letterhead_path','stamp_path','signature_path'].map(field => `
      <div style="margin-bottom:16px;">
        <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:6px;">
          ${field.replace('_path','').replace('_',' ').replace(/\b\w/g, c=>c.toUpperCase())} Path
        </label>
        <input class="inp" type="text" id="set-${field}" value="${settings?.[field] ?? ''}"
               placeholder="branding/filename.png">
      </div>`).join('')}
    <div class="alert alert-danger hidden" id="set-error" style="margin-bottom:12px;"></div>
    <button class="btn btn-primary" id="set-save">Save Changes</button>`;

  document.getElementById('set-save').addEventListener('click', async () => {
    const patch = {
      letterhead_path: document.getElementById('set-letterhead_path').value.trim(),
      stamp_path:      document.getElementById('set-stamp_path').value.trim(),
      signature_path:  document.getElementById('set-signature_path').value.trim(),
    };
    const { error } = await supabase.from('settings').update(patch).eq('id', 1);
    if (error) {
      document.getElementById('set-error').textContent = error.message;
      document.getElementById('set-error').classList.remove('hidden');
      return;
    }
    showToast('Settings saved.', 'success');
  });
}