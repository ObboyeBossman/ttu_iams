// =============================================================================
// IAMS — src/modules/school-supervisor/students.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { getSupervisorPlacements, getMyZones } from '/shared/services/supervisors.service.js';
import { statusLabel } from '/shared/utils.js';

let _allPlacements = [];

async function init() {
  await requireRole(['school_supervisor']);
  await initShell('students');

  const [{ data: placements }, { data: zones }] = await Promise.all([
    getSupervisorPlacements(),
    getMyZones(),
  ]);

  _allPlacements = placements || [];

  const total = _allPlacements.length;
  const active = _allPlacements.filter(p => p.status === 'assigned' || p.status === 'approved').length;
  const zoneCount = zones?.length || 0;

  document.getElementById('st-total').textContent = total;
  document.getElementById('st-active').textContent = active;
  document.getElementById('st-zones').textContent = zoneCount;
  document.getElementById('students-count-badge').textContent = `${total} Student${total !== 1 ? 's' : ''}`;

  renderTable(_allPlacements);

  // Search input handler
  const searchInput = document.getElementById('search-students');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        renderTable(_allPlacements);
        return;
      }
      const filtered = _allPlacements.filter(p => {
        const name = (p.profiles?.full_name || '').toLowerCase();
        const index = (p.students?.index_number || '').toLowerCase();
        const company = (p.company_name || '').toLowerCase();
        const zone = (p.zones?.name || '').toLowerCase();
        return name.includes(q) || index.includes(q) || company.includes(q) || zone.includes(q);
      });
      renderTable(filtered);
    });
  }
}

function getInitials(name) {
  if (!name) return 'ST';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function renderTable(placements) {
  const tbody = document.getElementById('students-tbody');

  if (!placements || placements.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding: 40px 16px;">
          <div class="empty-state" style="padding:0;">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <div class="empty-state-title">No Assigned Students Found</div>
            <div class="empty-state-message">There are currently no students placed in your assigned supervision zones matching your criteria.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = placements.map(p => {
    const student = p.profiles || {};
    const academic = p.students || {};
    const loc = [p.city_town, p.region].filter(Boolean).join(', ');
    const initials = getInitials(student.full_name);

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar avatar-md" style="background:var(--ttu-blue-surface);color:var(--ttu-blue);font-weight:600;">${initials}</div>
            <div>
              <div style="font-weight:600;color:var(--text-primary);font-size:13.5px;">${student.full_name || '—'}</div>
              <div style="font-size:12px;color:var(--text-muted);">${student.phone ? `📞 ${student.phone}` : 'No phone'}</div>
            </div>
          </div>
        </td>
        <td>
          <span style="font-family:monospace;font-size:12.5px;font-weight:600;background:var(--bg-prefix);padding:3px 8px;border-radius:4px;border:1px solid var(--border-default);">${academic.index_number || '—'}</span>
        </td>
        <td>
          <div style="font-size:13px;font-weight:500;color:var(--text-primary);">${academic.programme || '—'}</div>
          <div style="font-size:11.5px;color:var(--text-muted);">${academic.department || '—'}</div>
        </td>
        <td>
          <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${p.company_name || '—'}</div>
          <div style="font-size:11.5px;color:var(--text-muted);">Zone: ${p.zones?.name || '—'}</div>
        </td>
        <td style="font-size:12.5px;color:var(--text-secondary);">${loc ? `📍 ${loc}` : '—'}</td>
        <td>${statusLabel(p.status)}</td>
        <td style="text-align:right;">
          <a href="./visits.html" class="btn btn-outline btn-sm">Log Visit</a>
        </td>
      </tr>
    `;
  }).join('');
}

init();
