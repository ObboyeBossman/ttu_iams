import { supabase }    from '../../../shared/supabase-client.js';
import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { showToast }   from '../../../shared/utils.js';

let zonesMap = [];

async function init() {
  await requireRole(['admin']);
  await initShell();

  await fetchZones();
  await loadRegions();
  await loadUnresolved();
}

async function fetchZones() {
  const { data } = await supabase.from('zones').select('id, name');
  if (data) zonesMap = data;
}

// -----------------------------------------------------------------------------
// UI Helpers
// -----------------------------------------------------------------------------

function createProgressBar(total, supervised) {
  const percent = total > 0 ? (supervised / total) * 100 : 0;
  return `
    <div style="display:flex; align-items:center; gap:8px;">
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${percent}%"></div>
      </div>
      <span>${supervised} / ${total} supervised</span>
    </div>
  `;
}

function createAccordionItem(title, total, supervised, levelClass, fetchCallback) {
  const item = document.createElement('div');
  item.className = `accordion-item ${levelClass}`;

  const header = document.createElement('div');
  header.className = 'accordion-header';

  header.innerHTML = `
    <div class="accordion-title">${escapeHtml(title)}</div>
    <div class="accordion-stats">
      ${createProgressBar(total, supervised)}
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </div>
  `;

  const content = document.createElement('div');
  content.className = 'accordion-content';

  item.appendChild(header);
  item.appendChild(content);

  let loaded = false;
  header.addEventListener('click', async () => {
    const isExpanded = item.classList.toggle('is-expanded');
    if (isExpanded && !loaded) {
      content.innerHTML = '<div style="padding:16px; color:var(--text-muted)">Loading…</div>';
      await fetchCallback(content);
      loaded = true;
    }
  });

  return item;
}

// Minimal escaping — region/district/town names and student/company text
// come from user input (placement form) or an external API (Google), so
// they go through innerHTML in several places below and must be escaped.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// -----------------------------------------------------------------------------
// Data Fetching & Rendering — Region → District → Town → Placements
// -----------------------------------------------------------------------------

async function loadRegions() {
  const container = document.getElementById('regions-container');

  const { data, error } = await supabase.rpc('get_placement_regions');
  container.innerHTML = '';

  if (error) {
    console.error('loadRegions failed:', error);
    container.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-danger)">Could not load regional data. Check console for details.</div>';
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted)">No geocoded placements yet.</div>';
    return;
  }

  for (const row of data) {
    const item = createAccordionItem(row.region, row.total, row.supervised_count, 'level-region', async (contentNode) => {
      await loadDistricts(contentNode, row.region);
    });
    container.appendChild(item);
  }
}

async function loadDistricts(container, region) {
  const { data, error } = await supabase.rpc('get_placement_districts', { p_region: region });
  container.innerHTML = '';

  if (error) {
    console.error('loadDistricts failed:', error);
    container.innerHTML = '<div style="padding:16px; color:var(--text-danger)">Could not load districts.</div>';
    return;
  }
  if (!data || data.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted)">No districts found.</div>';
    return;
  }

  for (const row of data) {
    const item = createAccordionItem(row.district, row.total, row.supervised_count, 'level-district', async (contentNode) => {
      await loadTowns(contentNode, region, row.district);
    });
    container.appendChild(item);
  }
}

async function loadTowns(container, region, district) {
  const { data, error } = await supabase.rpc('get_placement_towns', { p_region: region, p_district: district });
  container.innerHTML = '';

  if (error) {
    console.error('loadTowns failed:', error);
    container.innerHTML = '<div style="padding:16px; color:var(--text-danger)">Could not load towns.</div>';
    return;
  }
  if (!data || data.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted)">No towns found.</div>';
    return;
  }

  for (const row of data) {
    const item = createAccordionItem(row.town, row.total, row.supervised_count, 'level-town', async (contentNode) => {
      await loadPlacements(contentNode, region, district, row.town);
    });
    container.appendChild(item);
  }
}

async function loadPlacements(container, region, district, town) {
  const { data, error } = await supabase
    .from('placements')
    .select('*, students:student_id(full_name)')
    .eq('geo_region', region)
    .eq('geo_district', district)
    .eq('geo_town', town)
    .order('created_at', { ascending: false });

  container.innerHTML = '';

  if (error) {
    console.error('loadPlacements failed:', error);
    container.innerHTML = '<div style="padding:16px; color:var(--text-danger)">Could not load placements.</div>';
    return;
  }
  if (!data || data.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted)">No placements found.</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'placement-grid';

  for (const placement of data) {
    grid.appendChild(createPlacementCard(placement));
  }
  container.appendChild(grid);
}

// -----------------------------------------------------------------------------
// Unresolved Placements (geocode_status = 'failed' or 'pending')
// -----------------------------------------------------------------------------

async function loadUnresolved() {
  const { data, error } = await supabase
    .from('placements')
    .select('*, students:student_id(full_name)')
    .in('geocode_status', ['failed', 'pending'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('loadUnresolved failed:', error);
    return;
  }
  if (!data || data.length === 0) return;

  document.getElementById('unresolved-container').style.display = 'block';
  document.getElementById('unresolved-count').textContent = data.length;

  const grid = document.getElementById('unresolved-grid');
  grid.innerHTML = '';
  for (const placement of data) {
    grid.appendChild(createPlacementCard(placement, true));
  }

  const toggle = document.getElementById('unresolved-toggle');
  const content = document.getElementById('unresolved-content');
  const chevron = toggle.querySelector('.chevron');

  toggle.addEventListener('click', () => {
    const isVisible = content.style.display !== 'none';
    content.style.display = isVisible ? 'none' : 'block';
    chevron.style.transform = isVisible ? 'rotate(90deg)' : 'none';
  });
}

// -----------------------------------------------------------------------------
// Placement Card
// -----------------------------------------------------------------------------

function createPlacementCard(placement, isUnresolved = false) {
  const card = document.createElement('div');
  card.className = 'placement-card';

  const isAssigned = placement.zone_id != null;
  let zoneText = 'Unassigned';
  if (isAssigned) {
    const z = zonesMap.find(z => z.id === placement.zone_id);
    zoneText = z ? z.name : 'Assigned';
  }

  card.innerHTML = `
    <div class="placement-card-header">
      <div>
        <div class="placement-student-name">${escapeHtml(placement.students?.full_name || 'Unknown Student')}</div>
        <div class="placement-company">${escapeHtml(placement.company_name)}</div>
      </div>
      <div class="placement-status ${isAssigned ? '' : 'unassigned'}">
        ${escapeHtml(zoneText)}
      </div>
    </div>

    <div style="font-size:13px; color:var(--text-secondary); margin-top:8px;">
      ${escapeHtml(placement.city_town)}, ${escapeHtml(placement.street_landmark)}
    </div>

    ${isUnresolved ? `
      <div style="font-size:12px; color:var(--text-muted);">
        Geocode status: <strong>${escapeHtml(placement.geocode_status)}</strong>
      </div>
    ` : ''}

    <div class="placement-actions">
      ${isUnresolved
        ? `
          <button class="btn btn-secondary btn-sm" data-action="retry" data-id="${placement.id}">Retry Geocoding</button>
          <button class="btn btn-secondary btn-sm" data-action="override" data-id="${placement.id}">Set Manually</button>
        `
        : `<button class="btn btn-primary btn-sm" data-action="assign" data-id="${placement.id}">Assign Zone</button>`
      }
    </div>
  `;

  // Delegated-style binding per card — avoids global window.* handlers that
  // silently break on PJAX re-navigation (the shell does PJAX).
  card.querySelectorAll('[data-action]').forEach(btn => {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'retry')    btn.addEventListener('click', () => retryGeocode(id));
    if (action === 'override') btn.addEventListener('click', () => openOverrideModal(id, placement));
    if (action === 'assign')   btn.addEventListener('click', () => openAssignModal(id));
  });

  return card;
}

// -----------------------------------------------------------------------------
// Retry Geocoding
// -----------------------------------------------------------------------------

async function retryGeocode(id) {
  const { data, error } = await supabase.from('placements').select('*').eq('id', id).single();
  if (error || !data) {
    showToast('Could not load placement for retry.', 'error');
    return;
  }
  if (data.latitude == null || data.longitude == null) {
    showToast('This placement has no GPS coordinates — nothing to retry. Use "Set Manually" instead.', 'warning');
    return;
  }

  showToast('Retrying geocoding…', 'info');
  const { error: invokeErr } = await supabase.functions.invoke('geocode-placement', { body: { record: data } });
  if (invokeErr) {
    showToast('Retry failed to start. Check console.', 'error');
    console.error(invokeErr);
    return;
  }
  showToast('Geocoding retry initiated. Refreshing in a moment…', 'success');
  setTimeout(() => init(), 2000);
}

// -----------------------------------------------------------------------------
// Manual Override — for locations where the Google API repeatedly fails.
// Spec: "a manual override allowing an admin to type in the correct
// region/district/town by hand if the API repeatedly fails".
// -----------------------------------------------------------------------------

let overrideTargetId = null;

function openOverrideModal(id, placement) {
  overrideTargetId = id;
  document.getElementById('override-region').value   = placement.geo_region   || '';
  document.getElementById('override-district').value = placement.geo_district || '';
  document.getElementById('override-town').value     = placement.geo_town     || '';
  document.getElementById('override-modal').style.display = 'flex';
}

document.getElementById('override-modal-close')?.addEventListener('click', () => {
  document.getElementById('override-modal').style.display = 'none';
});

document.getElementById('override-save')?.addEventListener('click', async () => {
  const region   = document.getElementById('override-region').value.trim();
  const district = document.getElementById('override-district').value.trim();
  const town     = document.getElementById('override-town').value.trim();

  if (!region || !district || !town || !overrideTargetId) {
    showToast('Region, district, and town are all required.', 'warning');
    return;
  }

  const { error } = await supabase
    .from('placements')
    .update({
      geo_region:     region,
      geo_district:   district,
      geo_town:       town,
      geocode_status: 'success',
      geocoded_at:    new Date().toISOString(),
    })
    .eq('id', overrideTargetId);

  if (error) {
    console.error(error);
    showToast('Could not save manual override.', 'error');
    return;
  }

  document.getElementById('override-modal').style.display = 'none';
  showToast('Location set manually.', 'success');
  init();
});

// -----------------------------------------------------------------------------
// Assign Zone (reuses the zone-assignment modal pattern already present
// in admin_portal/placements.js and the existing HTML)
// -----------------------------------------------------------------------------

let currentPlacementId = null;

function openAssignModal(id) {
  currentPlacementId = id;
  const select = document.getElementById('assign-zone-select');
  select.innerHTML = '<option value="">— Select a Zone —</option>' +
    zonesMap.map(z => `<option value="${z.id}">${escapeHtml(z.name)}</option>`).join('');
  document.getElementById('assign-modal').style.display = 'flex';
}

document.getElementById('assign-modal-close')?.addEventListener('click', () => {
  document.getElementById('assign-modal').style.display = 'none';
});

document.getElementById('assign-save')?.addEventListener('click', async () => {
  const zoneId = document.getElementById('assign-zone-select').value;
  if (!zoneId || !currentPlacementId) return;

  const { error } = await supabase
    .from('placements')
    .update({ zone_id: zoneId, status: 'assigned' })
    .eq('id', currentPlacementId);

  if (error) {
    console.error(error);
    showToast('Could not assign zone.', 'error');
    return;
  }

  document.getElementById('assign-modal').style.display = 'none';
  showToast('Zone assigned.', 'success');
  init();
});

// Run
init();
