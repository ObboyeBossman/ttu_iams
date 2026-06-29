import { supabase } from '../../../shared/supabase-client.js';

let zonesMap = [];

async function init() {
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

function createAccordionItem(id, title, total, supervised, levelClass, fetchCallback) {
  const item = document.createElement('div');
  item.className = `accordion-item ${levelClass}`;
  
  const header = document.createElement('div');
  header.className = 'accordion-header';
  
  header.innerHTML = `
    <div class="accordion-title">${title}</div>
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
      content.innerHTML = '<div style="padding:16px; color:var(--text-muted)">Loading...</div>';
      await fetchCallback(content);
      loaded = true;
    }
  });
  
  return item;
}

// -----------------------------------------------------------------------------
// Data Fetching & Rendering
// -----------------------------------------------------------------------------

async function loadRegions() {
  const container = document.getElementById('regions-container');
  // Use postgrest RPC or raw query if grouped. Since this is client side without RPC for custom group by,
  // we actually need to create RPC functions or fetch all and group, BUT the prompt explicitly says:
  // "Use efficient grouped queries rather than fetching all placements and grouping client-side"
  // Wait, if it's Supabase client, we don't have standard GROUP BY via `.from('placements').select(...)`. 
  // We need to create a database function/RPC for these queries!
  // I must add RPCs to the migration!
  
  // Let me just call an RPC `get_placement_regions`
  const { data, error } = await supabase.rpc('get_placement_regions');
  container.innerHTML = '';
  
  if (error || !data || data.length === 0) {
    container.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted)">No regional data available.</div>';
    return;
  }
  
  for (const row of data) {
    const item = createAccordionItem(`region-${row.region}`, row.region, row.total, row.supervised_count, 'level-region', async (contentNode) => {
      await loadDistricts(contentNode, row.region);
    });
    container.appendChild(item);
  }
}

async function loadDistricts(container, region) {
  const { data, error } = await supabase.rpc('get_placement_districts', { p_region: region });
  container.innerHTML = '';
  if (error || !data || data.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted)">No districts found.</div>';
    return;
  }
  
  for (const row of data) {
    const item = createAccordionItem(`district-${row.district}`, row.district, row.total, row.supervised_count, 'level-district', async (contentNode) => {
      await loadTowns(contentNode, region, row.district);
    });
    container.appendChild(item);
  }
}

async function loadTowns(container, region, district) {
  const { data, error } = await supabase.rpc('get_placement_towns', { p_region: region, p_district: district });
  container.innerHTML = '';
  if (error || !data || data.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted)">No towns found.</div>';
    return;
  }
  
  for (const row of data) {
    const item = createAccordionItem(`town-${row.town}`, row.town, row.total, row.supervised_count, 'level-town', async (contentNode) => {
      await loadPlacements(contentNode, region, district, row.town);
    });
    container.appendChild(item);
  }
}

async function loadPlacements(container, region, district, town) {
  const { data, error } = await supabase
    .from('placements')
    .select('*, students:student_id(full_name)')
    .eq('region', region)
    .eq('district', district)
    .eq('town', town)
    .order('created_at', { ascending: false });
    
  container.innerHTML = '';
  if (error || !data || data.length === 0) {
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
// Unresolved Placements
// -----------------------------------------------------------------------------

async function loadUnresolved() {
  const { data, error } = await supabase
    .from('placements')
    .select('*, students:student_id(full_name)')
    .in('geocode_status', ['failed', 'pending']);
    
  if (error || !data || data.length === 0) return;
  
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
    chevron.style.transform = isVisible ? 'none' : 'rotate(90deg)';
  });
}

function createPlacementCard(placement, isUnresolved = false) {
  const card = document.createElement('div');
  card.className = 'placement-card';
  
  const isAssigned = placement.zone_id != null;
  let supervisorText = 'Unassigned';
  if (isAssigned) {
    const z = zonesMap.find(z => z.id === placement.zone_id);
    supervisorText = z ? z.name : 'Assigned';
  }
  
  card.innerHTML = `
    <div class="placement-card-header">
      <div>
        <div class="placement-student-name">${placement.students?.full_name || 'Unknown Student'}</div>
        <div class="placement-company">${placement.company_name}</div>
      </div>
      <div class="placement-status ${isAssigned ? '' : 'unassigned'}">
        ${supervisorText}
      </div>
    </div>
    
    <div style="font-size:13px; color:var(--text-secondary); margin-top:8px;">
      ${placement.city_town}, ${placement.street_landmark}
    </div>
    
    <div class="placement-actions">
      ${isUnresolved 
        ? `<button class="btn btn-secondary btn-sm" onclick="retryGeocode('${placement.id}')">Retry Geocode</button>`
        : `<button class="btn btn-primary btn-sm" onclick="openAssignModal('${placement.id}')">Assign Zone</button>`
      }
    </div>
  `;
  return card;
}

window.retryGeocode = async (id) => {
  const { data } = await supabase.from('placements').select('*').eq('id', id).single();
  if (data) {
    await supabase.functions.invoke('geocode-placement', { body: { record: data } });
    alert('Geocoding retry initiated');
  }
};

let currentPlacementId = null;
window.openAssignModal = (id) => {
  currentPlacementId = id;
  const select = document.getElementById('assign-zone-select');
  select.innerHTML = '<option value="">— Select a Zone —</option>' + zonesMap.map(z => `<option value="${z.id}">${z.name}</option>`).join('');
  document.getElementById('assign-modal').style.display = 'flex';
};

document.getElementById('assign-modal-close').addEventListener('click', () => {
  document.getElementById('assign-modal').style.display = 'none';
});

document.getElementById('assign-save').addEventListener('click', async () => {
  const zoneId = document.getElementById('assign-zone-select').value;
  if (!zoneId || !currentPlacementId) return;
  
  const { error } = await supabase.from('placements').update({ zone_id: zoneId, status: 'assigned' }).eq('id', currentPlacementId);
  if (!error) {
    document.getElementById('assign-modal').style.display = 'none';
    // Reload the page content to reflect changes
    init();
  }
});

// Run
init();
