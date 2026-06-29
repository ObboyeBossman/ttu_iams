// =============================================================================
// IAMS — src/modules/school-supervisor/dashboard.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { getMyZones, getSupervisorPlacements } from '/shared/services/supervisors.service.js';
import { getCurrentUser, getUserProfile } from '/shared/services/auth.service.js';
import { showToast } from '/shared/utils.js';

async function init() {
  await requireRole(['school_supervisor']);
  await initShell('dashboard');

  const userRes = await getCurrentUser();
  const profileRes = await getUserProfile(userRes.data?.id);
  document.getElementById('welcome-msg').textContent = `Welcome, ${profileRes.data?.full_name ?? 'Supervisor'}`;

  const { data: zones } = await getMyZones();
  const { data: placements } = await getSupervisorPlacements();

  document.getElementById('stat-zones').textContent = zones?.length || 0;
  document.getElementById('stat-placements').textContent = placements?.length || 0;

  const zonesList = document.getElementById('zones-list');
  if (!zones || zones.length === 0) {
    zonesList.innerHTML = '<p class="text-muted">You are not assigned to any zones yet.</p>';
  } else {
    zonesList.innerHTML = zones.map(z => `
      <div style="padding:12px;border:1px solid var(--border-default);border-radius:8px;margin-bottom:8px">
        <strong style="display:block;margin-bottom:4px">${z.zones.name}</strong>
        <span style="font-size:13px;color:var(--text-secondary)">${z.zones.description || 'No description'}</span>
      </div>
    `).join('');
  }

  document.getElementById('page-loading').style.display = 'none';
}

init();
