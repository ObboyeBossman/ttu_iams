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

import { initShell } from '/shell/nav.js';

// ── 1. Auth guard ────────────────────────────────────────────────────────────
await requireRole(['admin']);

// ── 3. Render shell ──────────────────────────────────────────────────────────
await initShell('dashboard');

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
document.getElementById('view-dashboard').classList.add('active');