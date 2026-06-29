// =============================================================================
// IAMS — src/modules/school-supervisor/students.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { getSupervisorPlacements } from '/shared/services/supervisors.service.js';
import { statusLabel } from '/shared/utils.js';

async function init() {
  await requireRole(['school_supervisor']);
  await initShell('students');

  const tbody = document.getElementById('students-tbody');

  const { data: placements, error } = await getSupervisorPlacements();

  if (error || !placements || placements.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No students assigned to your zones yet.</td></tr>';
    return;
  }

  tbody.innerHTML = placements.map(p => {
    const student = p.profiles || {};
    const academic = p.students || {};
    const loc = [p.city_town, p.region].filter(Boolean).join(', ');
    
    return `
      <tr>
        <td>
          <div style="font-weight:500">${student.full_name || '—'}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${student.phone || 'No phone'}</div>
        </td>
        <td>${academic.index_number || '—'}</td>
        <td>
          <div style="font-size:13px">${academic.programme || '—'}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${academic.department || '—'}</div>
        </td>
        <td>
          <div style="font-weight:500">${p.company_name || '—'}</div>
          <div style="font-size:12px;color:var(--text-secondary)">Zone: ${p.zones?.name || '—'}</div>
        </td>
        <td style="font-size:13px">${loc || '—'}</td>
        <td>${statusLabel(p.status)}</td>
      </tr>
    `;
  }).join('');
}

init();
