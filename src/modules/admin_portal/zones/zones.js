// =============================================================================
// IAMS — src/modules/admin_portal/zones.js
// Zone & Supervisor Management
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import {
  listZones, createZone, updateZone, deleteZone,
  listSupervisorsForZone, assignSupervisorToZone, unassignSupervisorFromZone,
} from '/shared/services/zones.js';
import { listSupervisors } from '/shared/services/supervisors.service.js';
import { showToast } from '/shared/utils.js';

// ── State ─────────────────────────────────────────────────────────────────────
let zones       = [];
let supervisors = [];
let editingZoneId     = null;
let deletingZoneId    = null;
let supervisorZoneId  = null;
let zoneSupervisors   = [];

// ── DOM ───────────────────────────────────────────────────────────────────────
const pageLoading = document.getElementById('page-loading');
const createBtn   = document.getElementById('create-zone-btn');
const zonesSkeleton = document.getElementById('zones-skeleton');
const zonesEmpty    = document.getElementById('zones-empty');
const zonesGrid     = document.getElementById('zones-grid');

const zoneModal       = document.getElementById('zone-modal');
const zoneModalTitle  = document.getElementById('zone-modal-title');
const zoneModalClose  = document.getElementById('zone-modal-close');
const zoneModalCancel = document.getElementById('zone-modal-cancel');
const zoneModalSubmit = document.getElementById('zone-modal-submit');
const zoneModalSpinner= document.getElementById('zone-modal-spinner');
const zoneModalError  = document.getElementById('zone-modal-error');
const zoneModalErrMsg = document.getElementById('zone-modal-error-msg');
const zoneForm        = document.getElementById('zone-form');
const zoneIdInput     = document.getElementById('zone-id');

const confirmModal   = document.getElementById('confirm-modal');
const confirmName    = document.getElementById('confirm-zone-name');
const confirmCancel  = document.getElementById('confirm-cancel');
const confirmDelete  = document.getElementById('confirm-delete');
const confirmSpinner = document.getElementById('confirm-spinner');

const supModal     = document.getElementById('supervisor-modal');
const supModalClose= document.getElementById('sup-modal-close');
const supModalDone = document.getElementById('sup-modal-done');
const supZoneLabel = document.getElementById('sup-zone-label');
const supList      = document.getElementById('sup-list');
const supSelect    = document.getElementById('sup-select');
const supAddBtn    = document.getElementById('sup-add-btn');

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function closeAllModals() {
  zoneModal.style.display   = 'none';
  confirmModal.style.display= 'none';
  supModal.style.display    = 'none';
}

// ── Zone cards ────────────────────────────────────────────────────────────────
async function loadZoneCards() {
  zonesSkeleton.style.display = 'block';
  zonesEmpty.style.display    = 'none';
  zonesGrid.style.display     = 'none';

  const { data, error } = await listZones();
  if (error) { showToast('Failed to load zones: ' + error.message, 'error'); return; }

  zones = data ?? [];
  zonesSkeleton.style.display = 'none';

  if (zones.length === 0) {
    zonesEmpty.style.display = 'flex';
    return;
  }

  zonesGrid.style.display = 'grid';

  // For each zone, fetch its supervisors
  const zoneData = await Promise.all(zones.map(async (z) => {
    const { data: sups } = await listSupervisorsForZone(z.id);
    return { ...z, supervisors: sups ?? [] };
  }));

  zonesGrid.innerHTML = zoneData.map((z) => `
    <div class="zone-card" data-zone-id="${z.id}">
      <div class="zone-card-header">
        <div class="zone-card-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>
        </div>
        <div class="zone-card-name">${esc(z.name)}</div>
        <div class="zone-card-actions">
          <button class="btn-icon" data-action="edit" data-id="${z.id}" aria-label="Edit zone" title="Edit">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon btn-icon--danger" data-action="delete" data-id="${z.id}" data-name="${esc(z.name)}" aria-label="Delete zone" title="Delete">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </div>
      ${z.description ? `<p class="zone-card-desc">${esc(z.description)}</p>` : ''}
      <div class="zone-card-supervisors">
        <div class="zone-card-sup-header">
          <span class="zone-card-sup-title">Supervisors (${z.supervisors.length})</span>
          <button class="btn-sm btn-sm--secondary" data-action="supervisors" data-id="${z.id}" data-name="${esc(z.name)}">Manage</button>
        </div>
        ${z.supervisors.length === 0
          ? '<p class="zone-card-no-sup">No supervisors assigned</p>'
          : z.supervisors.map((s) => `
            <div class="supervisor-chip" data-sid="${s.school_supervisor_id}">
              <div class="supervisor-chip-avatar">${esc(getInitials(s.school_supervisor_id))}</div>
              <span>${esc(s.school_supervisor_id)}</span>
            </div>`).join('')
        }
      </div>
    </div>
  `).join('');

  // Re-apply supervisor names asynchronously
  applySupNames(zoneData);
}

function getInitials(id) {
  const sup = supervisors.find((s) => s.id === id);
  if (!sup) return '?';
  return sup.full_name.split(' ').map((w) => w[0]).slice(0,2).join('').toUpperCase();
}

function applySupNames(zoneData) {
  for (const z of zoneData) {
    for (const sup of z.supervisors) {
      const match = supervisors.find((s) => s.id === sup.school_supervisor_id);
      if (!match) continue;
      const chip = zonesGrid.querySelector(`[data-sid="${sup.school_supervisor_id}"]`);
      if (chip) {
        chip.querySelector('.supervisor-chip-avatar').textContent = match.full_name.split(' ').map((w) => w[0]).slice(0,2).join('').toUpperCase();
        chip.querySelector('span').textContent = match.full_name;
      }
    }
  }
}

// ── Zone modal ────────────────────────────────────────────────────────────────
function openZoneModal(zone = null) {
  editingZoneId = zone?.id ?? null;
  zoneModalTitle.textContent = zone ? 'Edit Zone' : 'New Zone';
  zoneIdInput.value = zone?.id ?? '';
  document.getElementById('z-name').value = zone?.name ?? '';
  document.getElementById('z-desc').value = zone?.description ?? '';
  zoneModalError.style.display = 'none';
  zoneModal.style.display = 'flex';
  document.getElementById('z-name').focus();
}

async function handleZoneFormSubmit(e) {
  e.preventDefault();
  zoneModalError.style.display = 'none';

  const name = document.getElementById('z-name').value.trim();
  const description = document.getElementById('z-desc').value.trim() || null;

  if (!name) {
    document.getElementById('err-z-name').textContent = 'Zone name is required.';
    return;
  }
  document.getElementById('err-z-name').textContent = '';

  zoneModalSubmit.disabled       = true;
  zoneModalSpinner.style.display = 'inline-block';

  const { error } = editingZoneId
    ? await updateZone(editingZoneId, { name, description })
    : await createZone({ name, description });

  zoneModalSubmit.disabled       = false;
  zoneModalSpinner.style.display = 'none';

  if (error) {
    zoneModalErrMsg.textContent  = error.message || 'Failed to save zone.';
    zoneModalError.style.display = 'flex';
    return;
  }

  showToast(editingZoneId ? 'Zone updated.' : 'Zone created.', 'success');
  closeAllModals();
  await loadZoneCards();
}

// ── Delete modal ──────────────────────────────────────────────────────────────
function openConfirmModal(id, name) {
  deletingZoneId = id;
  confirmName.textContent = name;
  confirmModal.style.display = 'flex';
}

async function handleDelete() {
  if (!deletingZoneId) return;
  confirmDelete.disabled      = true;
  confirmSpinner.style.display= 'inline-block';

  const { error } = await deleteZone(deletingZoneId);

  confirmDelete.disabled      = false;
  confirmSpinner.style.display= 'none';

  if (error) {
    showToast(error.message || 'Failed to delete zone.', 'error');
    closeAllModals();
    return;
  }
  showToast('Zone deleted.', 'success');
  closeAllModals();
  await loadZoneCards();
}

// ── Supervisor modal ──────────────────────────────────────────────────────────
async function openSupModal(zoneId, zoneName) {
  supervisorZoneId = zoneId;
  supZoneLabel.textContent = `Zone: ${zoneName}`;
  supModal.style.display = 'flex';
  supList.innerHTML = '<div class="spinner-sm" style="margin:12px auto"></div>';

  const { data, error } = await listSupervisorsForZone(zoneId);
  if (error) { showToast('Failed to load supervisors.', 'error'); return; }

  zoneSupervisors = data ?? [];
  renderSupList();
  populateSupSelect();
}

function renderSupList() {
  if (zoneSupervisors.length === 0) {
    supList.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No supervisors assigned to this zone yet.</p>';
    return;
  }
  supList.innerHTML = zoneSupervisors.map((zs) => {
    const sup = supervisors.find((s) => s.id === zs.school_supervisor_id);
    return `
      <div class="sup-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-default)">
        <span style="font-size:13.5px;font-weight:500">${esc(sup?.full_name ?? zs.school_supervisor_id)}</span>
        <button class="btn-sm btn-sm--danger" data-remove="${zs.school_supervisor_id}">Remove</button>
      </div>
    `;
  }).join('');

  supList.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sid = btn.dataset.remove;
      btn.disabled = true;
      const { error } = await unassignSupervisorFromZone(supervisorZoneId, sid);
      if (error) { showToast(error.message || 'Failed to remove supervisor.', 'error'); btn.disabled = false; return; }
      zoneSupervisors = zoneSupervisors.filter((zs) => zs.school_supervisor_id !== sid);
      renderSupList();
      await loadZoneCards();
    });
  });
}

function populateSupSelect() {
  const assignedIds = new Set(zoneSupervisors.map((zs) => zs.school_supervisor_id));
  const available   = supervisors.filter((s) => !assignedIds.has(s.id));
  supSelect.innerHTML = '<option value="">— Select a supervisor —</option>' +
    available.map((s) => `<option value="${s.id}">${esc(s.full_name)}</option>`).join('');
}

async function handleAddSupervisor() {
  const sid = supSelect.value;
  if (!sid) { showToast('Please select a supervisor.', 'warning'); return; }

  supAddBtn.disabled = true;
  const { error } = await assignSupervisorToZone(supervisorZoneId, sid);
  supAddBtn.disabled = false;

  if (error) { showToast(error.message || 'Failed to assign supervisor.', 'error'); return; }

  const { data } = await listSupervisorsForZone(supervisorZoneId);
  zoneSupervisors = data ?? [];
  renderSupList();
  populateSupSelect();
  await loadZoneCards();
  showToast('Supervisor assigned.', 'success');
}

// ── Grid event delegation ─────────────────────────────────────────────────────
function handleGridAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, name } = btn.dataset;
  const zone = zones.find((z) => z.id === id);

  if (action === 'edit')        openZoneModal(zone);
  if (action === 'delete')      openConfirmModal(id, name || zone?.name);
  if (action === 'supervisors') openSupModal(id, name || zone?.name);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await requireRole(['admin']);
  await initShell();

  // Load all school supervisors once
  const { data } = await listSupervisors();
  supervisors = data ?? [];

  createBtn.addEventListener('click', () => openZoneModal());
  zoneModalClose.addEventListener('click', closeAllModals);
  zoneModalCancel.addEventListener('click', closeAllModals);
  zoneForm.addEventListener('submit', handleZoneFormSubmit);
  confirmCancel.addEventListener('click', closeAllModals);
  confirmDelete.addEventListener('click', handleDelete);
  supModalClose.addEventListener('click', () => { closeAllModals(); loadZoneCards(); });
  supModalDone.addEventListener('click',  () => { closeAllModals(); loadZoneCards(); });
  supAddBtn.addEventListener('click', handleAddSupervisor);
  zonesGrid.addEventListener('click', handleGridAction);

  [zoneModal, confirmModal, supModal].forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeAllModals(); });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

  pageLoading.style.display = 'none';
  await loadZoneCards();
}

init();
