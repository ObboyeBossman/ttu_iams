// =============================================================================
// IAMS — src/modules/school-supervisor/visits.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { getSupervisorPlacements, listVisitsForPlacement } from '/shared/services/supervisors.service.js';

let _allVisitsData = [];

async function init() {
  await requireRole(['school_supervisor']);
  await initShell('visits');

  const { data: placements, error } = await getSupervisorPlacements();

  if (error || !placements || placements.length === 0) {
    document.getElementById('vst-total').textContent = '0';
    document.getElementById('vst-visited').textContent = '0';
    document.getElementById('vst-pending').textContent = '0';
    document.getElementById('visits-count-badge').textContent = '0 Records';
    renderTable([]);
    return;
  }

  const visitsPromises = placements.map(p => listVisitsForPlacement(p.id));
  const visitsResults = await Promise.all(visitsPromises);

  _allVisitsData = placements.map((p, idx) => {
    const visits = visitsResults[idx].data || [];
    return {
      placement: p,
      visits,
      lastVisit: visits.length > 0 ? visits[0] : null,
    };
  });

  const total = _allVisitsData.length;
  const visited = _allVisitsData.filter(item => item.visits.length > 0).length;
  const pending = total - visited;

  document.getElementById('vst-total').textContent = total;
  document.getElementById('vst-visited').textContent = visited;
  document.getElementById('vst-pending').textContent = pending;
  document.getElementById('visits-count-badge').textContent = `${total} Record${total !== 1 ? 's' : ''}`;

  renderTable(_allVisitsData);

  // Search input handler
  const searchInput = document.getElementById('search-visits');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        renderTable(_allVisitsData);
        return;
      }
      const filtered = _allVisitsData.filter(item => {
        const p = item.placement;
        const name = (p.profiles?.full_name || '').toLowerCase();
        const company = (p.company_name || '').toLowerCase();
        const zone = (p.zones?.name || '').toLowerCase();
        return name.includes(q) || company.includes(q) || zone.includes(q);
      });
      renderTable(filtered);
    });
  }
}

function getInitials(name) {
  if (!name) return 'ST';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function renderTable(items) {
  const tbody = document.getElementById('visits-tbody');

  if (!items || items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding: 40px 16px;">
          <div class="empty-state" style="padding:0;">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            <div class="empty-state-title">No Visit Records Available</div>
            <div class="empty-state-message">There are currently no students available for site visit logging in your assigned zones.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const p = item.placement;
    const student = p.profiles || {};
    const loc = [p.city_town, p.region].filter(Boolean).join(', ');
    const lastVisitDate = item.lastVisit ? new Date(item.lastVisit.visit_date).toLocaleDateString() : null;
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
          <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${p.company_name || '—'}</div>
          <div style="font-size:11.5px;color:var(--text-muted);">Zone: ${p.zones?.name || '—'}</div>
        </td>
        <td style="font-size:12.5px;color:var(--text-secondary);">${loc ? `📍 ${loc}` : '—'}</td>
        <td>
          ${lastVisitDate 
            ? `<span class="badge badge-green">🗓 ${lastVisitDate}</span>` 
            : `<span class="badge badge-gray">Not Visited Yet</span>`
          }
        </td>
        <td style="text-align:right;">
          <button class="btn btn-accent btn-sm" onclick="alert('Site visit logging for ${student.full_name?.replace(/'/g, "\\'") || 'student'} is ready!')">
            Log Visit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

init();
