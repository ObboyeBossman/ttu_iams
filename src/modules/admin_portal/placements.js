// =============================================================================
// IAMS — src/modules/admin_portal/placements.js
// Batch Assignment & Placement Review
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { listSeasons } from '/shared/services/seasons.js';
import { listZones }   from '/shared/services/zones.js';
import {
  listPlacementsBySeason,
  assignPlacementToZone, batchAssignToZone,
  flagPlacement, rejectPlacement
} from '/shared/services/placements.js';
import { showToast, formatDate } from '/shared/utils.js';

// ── State ─────────────────────────────────────────────────────────────────────
let seasons      = [];
let zones        = [];
let activeSeason = null;
let activeTab    = 'all';
let placements   = [];
let selectedIds  = new Set();

// ── DOM ───────────────────────────────────────────────────────────────────────
const pageLoading      = document.getElementById('page-loading');
const seasonFilter     = document.getElementById('season-filter');
const tabs             = document.querySelectorAll('.tab-btn');
const batchActions     = document.getElementById('batch-actions');
const batchZoneSelect  = document.getElementById('batch-zone-select');
const batchAssignBtn   = document.getElementById('batch-assign-btn');
const selectedCount    = document.getElementById('selected-count');
const selectAll        = document.getElementById('select-all');
const tbody            = document.getElementById('placements-tbody');

const COUNT_ELS = {
  all:       document.getElementById('count-all'),
  submitted: document.getElementById('count-submitted'),
  assigned:  document.getElementById('count-assigned'),
  flagged:   document.getElementById('count-flagged'),
  rejected:  document.getElementById('count-rejected'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const STATUS_BADGE = {
  submitted: '<span class="badge badge-amber">Awaiting Review</span>',
  assigned:  '<span class="badge badge-green">Assigned</span>',
  flagged:   '<span class="badge badge-gray">Flagged</span>',
  rejected:  '<span class="badge badge-neutral">Rejected</span>',
};

// ── Loaders ───────────────────────────────────────────────────────────────────
async function loadFilters() {
  const [sRes, zRes] = await Promise.all([listSeasons(), listZones()]);
  seasons = sRes.data ?? [];
  zones   = zRes.data ?? [];

  if (seasons.length > 0) {
    seasonFilter.innerHTML = seasons.map(s => `<option value="${s.id}">${esc(s.name)} (${esc(s.status)})</option>`).join('');
    seasonFilter.disabled = false;
    activeSeason = seasons[0].id; // default to most recent
  } else {
    seasonFilter.innerHTML = '<option value="">No seasons found</option>';
  }

  if (zones.length > 0) {
    batchZoneSelect.innerHTML = '<option value="">— Select Zone —</option>' + 
      zones.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('');
    batchZoneSelect.disabled = false;
  }
}

async function loadPlacements() {
  if (!activeSeason) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:40px">Loading…</td></tr>';
  
  const { data, error } = await listPlacementsBySeason(activeSeason);
  if (error) {
    showToast('Failed to load placements.', 'error');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger" style="padding:40px">Error loading data</td></tr>';
    return;
  }

  placements = data ?? [];
  updateCounts();
  renderTable();
}

function updateCounts() {
  const counts = { all: placements.length, submitted: 0, assigned: 0, flagged: 0, rejected: 0 };
  for (const p of placements) {
    if (counts[p.status] !== undefined) counts[p.status]++;
  }
  for (const [status, el] of Object.entries(COUNT_ELS)) {
    el.textContent = counts[status];
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderTable() {
  selectedIds.clear();
  updateBatchUI();

  const filtered = activeTab === 'all' ? placements : placements.filter(p => p.status === activeTab);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:40px">No placements in this status.</td></tr>`;
    selectAll.disabled = true;
    selectAll.checked = false;
    return;
  }

  selectAll.disabled = false;
  selectAll.checked = false;

  tbody.innerHTML = filtered.map(p => {
    // Supabase JS mock join stub — in a real app, the view or query would include student details.
    // For Phase 1 without the full edge function, we just display the student ID.
    const studentInfo = `<div class="text-sm font-medium">Student: ${esc(p.student_id.substring(0,8))}...</div>`;
    const location = [p.street_landmark, p.city_town, p.region].filter(Boolean).join(', ');
    const zoneName = p.zone_id ? zones.find(z => z.id === p.zone_id)?.name : 'Unassigned';
    const gpsIcon = p.location_source === 'gps' 
      ? '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> GPS' 
      : 'Manual';

    return `
      <tr>
        <td style="text-align:center">
          <input type="checkbox" class="field-checkbox row-select" value="${p.id}">
        </td>
        <td>${studentInfo}</td>
        <td>
          <div style="font-weight:600">${esc(p.company_name)}</div>
          <div style="font-size:12px;color:var(--text-muted)">${esc(p.nature_of_business)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(location)}</div>
        </td>
        <td>
          <div style="font-size:13px">${formatDate(p.start_date)} – ${formatDate(p.end_date)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;display:flex;align-items:center;gap:4px">
            ${gpsIcon}
          </div>
        </td>
        <td>
          <div style="margin-bottom:4px">${STATUS_BADGE[p.status]}</div>
          ${p.zone_id ? `<div style="font-size:12px;color:var(--text-secondary)">Zone: <strong>${esc(zoneName)}</strong></div>` : ''}
        </td>
        <td class="text-right action-cell">
          ${renderRowActions(p)}
        </td>
      </tr>
    `;
  }).join('');

  // Attach row select events
  document.querySelectorAll('.row-select').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) selectedIds.add(e.target.value);
      else selectedIds.delete(e.target.value);
      updateBatchUI();
    });
  });
}

function renderRowActions(p) {
  if (p.status === 'submitted') {
    return `
      <button class="btn-sm btn-sm--danger" data-action="reject" data-id="${p.id}">Reject</button>
      <button class="btn-sm btn-sm--secondary" data-action="flag" data-id="${p.id}">Flag</button>
    `;
  }
  if (p.status === 'flagged') {
    return `
      <button class="btn-sm btn-sm--danger" data-action="reject" data-id="${p.id}">Reject</button>
    `;
  }
  return '';
}

// ── Batch Actions ─────────────────────────────────────────────────────────────
function updateBatchUI() {
  selectedCount.textContent = selectedIds.size;
  const hasSelection = selectedIds.size > 0;
  
  if (hasSelection && batchZoneSelect.value) {
    batchAssignBtn.disabled = false;
  } else {
    batchAssignBtn.disabled = true;
  }

  // Update selectAll indeterminate state
  const visibleCheckboxes = document.querySelectorAll('.row-select');
  if (visibleCheckboxes.length > 0) {
    if (selectedIds.size === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    } else if (selectedIds.size === visibleCheckboxes.length) {
      selectAll.checked = true;
      selectAll.indeterminate = false;
    } else {
      selectAll.checked = false;
      selectAll.indeterminate = true;
    }
  }
}

// ── Event Handlers ────────────────────────────────────────────────────────────
seasonFilter.addEventListener('change', async (e) => {
  activeSeason = e.target.value;
  await loadPlacements();
});

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.status;
    
    // Only show batch actions on 'submitted' tab
    batchActions.style.visibility = activeTab === 'submitted' ? 'visible' : 'hidden';
    
    renderTable();
  });
});

selectAll.addEventListener('change', (e) => {
  const isChecked = e.target.checked;
  document.querySelectorAll('.row-select').forEach(cb => {
    cb.checked = isChecked;
    if (isChecked) selectedIds.add(cb.value);
    else selectedIds.delete(cb.value);
  });
  updateBatchUI();
});

batchZoneSelect.addEventListener('change', updateBatchUI);

batchAssignBtn.addEventListener('click', async () => {
  const zoneId = batchZoneSelect.value;
  if (!zoneId || selectedIds.size === 0) return;

  batchAssignBtn.disabled = true;
  const originalText = batchAssignBtn.textContent;
  batchAssignBtn.textContent = 'Assigning…';

  const { succeeded, failed } = await batchAssignToZone(Array.from(selectedIds), zoneId);
  
  if (failed.length > 0) {
    showToast(`Assigned ${succeeded.length}, failed ${failed.length}.`, 'warning');
  } else {
    showToast(`Successfully assigned ${succeeded.length} placements.`, 'success');
  }

  batchAssignBtn.textContent = originalText;
  batchZoneSelect.value = '';
  await loadPlacements();
});

tbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  
  btn.disabled = true;
  try {
    if (action === 'flag') {
      await flagPlacement(id);
      showToast('Placement flagged for review.', 'success');
    } else if (action === 'reject') {
      if (!confirm('Are you sure you want to reject this placement? This cannot be undone.')) {
        btn.disabled = false;
        return;
      }
      await rejectPlacement(id);
      showToast('Placement rejected.', 'success');
    }
    await loadPlacements();
  } catch (err) {
    showToast(err.message || 'Action failed.', 'error');
    btn.disabled = false;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await requireRole(['admin']);
  await initShell();
  
  await loadFilters();
  if (activeSeason) {
    await loadPlacements();
  }
  
  batchActions.style.visibility = activeTab === 'submitted' ? 'visible' : 'hidden';
  pageLoading.style.display = 'none';
}

init();
