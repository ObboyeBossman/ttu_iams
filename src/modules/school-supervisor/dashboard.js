// =============================================================================
// IAMS — src/modules/school-supervisor/dashboard.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { getMyZones, getSupervisorPlacements } from '/shared/services/supervisors.service.js';
import { getCurrentUser, getUserProfile } from '/shared/services/auth.service.js';

async function init() {
  await requireRole(['school_supervisor']);
  await initShell('dashboard');

  const userRes = await getCurrentUser();
  const profileRes = await getUserProfile(userRes.data?.id);
  const fullName = profileRes.data?.full_name ?? 'Supervisor';
  document.getElementById('welcome-msg').textContent = `Welcome back, ${fullName}`;

  const { data: zones } = await getMyZones();
  const { data: placements } = await getSupervisorPlacements();

  const zoneCount = zones?.length || 0;
  const placementCount = placements?.length || 0;
  const uniqueCompanies = new Set((placements || []).map(p => p.company_name).filter(Boolean)).size;

  document.getElementById('stat-zones').textContent = zoneCount;
  document.getElementById('stat-placements').textContent = placementCount;
  document.getElementById('stat-visits').textContent = '0';
  document.getElementById('stat-companies').textContent = uniqueCompanies;
  document.getElementById('zones-count-badge').textContent = `${zoneCount} Zone${zoneCount !== 1 ? 's' : ''}`;

  // Render zones list
  const zonesList = document.getElementById('zones-list');
  if (!zones || zones.length === 0) {
    zonesList.innerHTML = `
      <div class="empty-state" style="padding: 24px 16px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
        <div class="empty-state-title" style="font-size:14px;">No Zones Assigned</div>
        <div class="empty-state-message" style="font-size:12px;">You have not been assigned to any placement supervision zones yet. Contact the ILO admin.</div>
      </div>
    `;
  } else {
    zonesList.innerHTML = zones.map(z => {
      const zoneName = z.zones?.name || z.name || 'Assigned Zone';
      const zoneDesc = z.zones?.description || z.description || 'No description available';
      return `
        <div style="padding:14px; border:1px solid var(--border-default); border-radius:var(--radius-md); background:var(--bg-prefix); margin-bottom:10px; display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
          <div>
            <div style="font-weight:600; font-size:14px; color:var(--text-primary); margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--ttu-gold)"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              ${zoneName}
            </div>
            <div style="font-size:12px; color:var(--text-secondary); line-height:1.4;">${zoneDesc}</div>
          </div>
          <span class="badge badge-blue" style="flex-shrink:0;">Active Zone</span>
        </div>
      `;
    }).join('');
  }

  // Render recent placements in my zones
  const placementsList = document.getElementById('recent-placements-list');
  if (!placements || placements.length === 0) {
    placementsList.innerHTML = `
      <div class="empty-state" style="padding: 24px 16px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        <div class="empty-state-title" style="font-size:14px;">No Assigned Students</div>
        <div class="empty-state-message" style="font-size:12px;">No student placements have been assigned to your supervision zones yet.</div>
      </div>
    `;
  } else {
    placementsList.innerHTML = placements.slice(0, 5).map(p => {
      const studentName = p.profiles?.full_name || 'Student';
      const company = p.company_name || 'Company';
      const loc = [p.city_town, p.region].filter(Boolean).join(', ');
      return `
        <div style="padding:12px 14px; border:1px solid var(--border-default); border-radius:var(--radius-md); background:var(--bg-prefix); margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div>
            <div style="font-weight:600; font-size:13px; color:var(--text-primary); margin-bottom:2px;">${studentName}</div>
            <div style="font-size:12px; color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
              <span>🏢 ${company}</span>
              ${loc ? `<span>• 📍 ${loc}</span>` : ''}
            </div>
          </div>
          <a href="./students.html" class="btn btn-ghost btn-sm">View</a>
        </div>
      `;
    }).join('');
  }

  document.getElementById('page-loading').style.display = 'none';
}

init();
