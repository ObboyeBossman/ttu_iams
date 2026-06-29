// =============================================================================
// IAMS — src/modules/school-supervisor/visits.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { getSupervisorPlacements, listVisitsForPlacement } from '/shared/services/supervisors.service.js';

async function init() {
  await requireRole(['school_supervisor']);
  await initShell('visits');

  const tbody = document.getElementById('visits-tbody');

  const { data: placements, error } = await getSupervisorPlacements();

  if (error || !placements || placements.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">No students available for visits.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading visit records...</td></tr>';
  
  const visitsPromises = placements.map(p => listVisitsForPlacement(p.id));
  const visitsResults = await Promise.all(visitsPromises);

  tbody.innerHTML = placements.map((p, idx) => {
    const student = p.profiles || {};
    const loc = [p.city_town, p.region].filter(Boolean).join(', ');
    const visits = visitsResults[idx].data || [];
    const lastVisit = visits.length > 0 ? new Date(visits[0].visit_date).toLocaleDateString() : 'Never';
    
    return `
      <tr>
        <td>
          <div style="font-weight:500">${student.full_name || '—'}</div>
        </td>
        <td>
          <div style="font-weight:500">${p.company_name || '—'}</div>
        </td>
        <td style="font-size:13px">${loc || '—'}</td>
        <td style="font-size:13px">${lastVisit}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="alert('Logging visits will be fully functional in Phase 2!')">
            Log Visit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

init();
