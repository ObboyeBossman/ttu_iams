// =============================================================================
// IAMS — src/modules/admin_portal/seasons.js
// Season Management: create, list, open, close, archive
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import {
  listSeasons, createSeason, updateSeason,
  openSeason, closeSeason, archiveSeason,
} from '/shared/services/seasons.js';
import { showToast, formatDate, isDateRangeOrdered, isWindowWithinSeason } from '/shared/utils.js';

// ── State ─────────────────────────────────────────────────────────────────────
let seasons     = [];
let editingId   = null;

// ── DOM ───────────────────────────────────────────────────────────────────────
const pageLoading     = document.getElementById('page-loading');
const createBtn       = document.getElementById('create-season-btn');
const seasonsSkeleton = document.getElementById('seasons-skeleton');
const seasonsEmpty    = document.getElementById('seasons-empty');
const seasonsTableWrap= document.getElementById('seasons-table-wrap');
const seasonsTbody    = document.getElementById('seasons-tbody');
const modal           = document.getElementById('season-modal');
const modalTitle      = document.getElementById('modal-title');
const modalClose      = document.getElementById('modal-close');
const modalCancel     = document.getElementById('modal-cancel');
const modalSubmit     = document.getElementById('modal-submit');
const modalSpinner    = document.getElementById('modal-spinner');
const modalError      = document.getElementById('modal-error');
const modalErrorMsg   = document.getElementById('modal-error-msg');
const seasonForm      = document.getElementById('season-form');
const seasonIdInput   = document.getElementById('season-id');

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const STATUS_BADGE = {
  upcoming: '<span class="badge badge-gray">Upcoming</span>',
  open:     '<span class="badge badge-green">Open</span>',
  closed:   '<span class="badge badge-amber">Closed</span>',
  archived: '<span class="badge badge-neutral">Archived</span>',
};

function actionButtons(s) {
  const btns = [];
  if (s.status === 'upcoming' || s.status === 'open') {
    btns.push(`<button class="btn-sm btn-sm--secondary" data-action="edit" data-id="${s.id}">Edit</button>`);
  }
  if (s.status === 'upcoming') {
    btns.push(`<button class="btn-sm btn-sm--primary" data-action="open" data-id="${s.id}">Open</button>`);
  }
  if (s.status === 'open') {
    btns.push(`<button class="btn-sm btn-sm--amber" data-action="close" data-id="${s.id}">Close</button>`);
  }
  if (s.status === 'closed') {
    btns.push(`<button class="btn-sm btn-sm--neutral" data-action="archive" data-id="${s.id}">Archive</button>`);
  }
  return btns.join(' ');
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderSeasons() {
  seasonsSkeleton.style.display = 'none';
  if (seasons.length === 0) {
    seasonsEmpty.style.display     = 'flex';
    seasonsTableWrap.style.display = 'none';
    return;
  }
  seasonsEmpty.style.display     = 'none';
  seasonsTableWrap.style.display = 'block';

  seasonsTbody.innerHTML = seasons.map((s) => `
    <tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${formatDate(s.start_date)} — ${formatDate(s.end_date)}</td>
      <td>${formatDate(s.placement_window_start)} — ${formatDate(s.placement_window_end)}</td>
      <td>${STATUS_BADGE[s.status] ?? esc(s.status)}</td>
      <td class="text-right action-cell">${actionButtons(s)}</td>
    </tr>
  `).join('');
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadSeasons() {
  seasonsSkeleton.style.display = 'block';
  seasonsEmpty.style.display    = 'none';
  seasonsTableWrap.style.display= 'none';

  const { data, error } = await listSeasons();
  if (error) { showToast('Failed to load seasons: ' + error.message, 'error'); return; }
  seasons = data ?? [];
  renderSeasons();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(season = null) {
  editingId = season?.id ?? null;
  modalTitle.textContent = season ? 'Edit Season' : 'New Season';
  seasonIdInput.value = season?.id ?? '';
  document.getElementById('s-name').value         = season?.name ?? '';
  document.getElementById('s-start').value        = season?.start_date ?? '';
  document.getElementById('s-end').value          = season?.end_date ?? '';
  document.getElementById('s-window-start').value = season?.placement_window_start ?? '';
  document.getElementById('s-window-end').value   = season?.placement_window_end ?? '';
  modalError.style.display = 'none';
  modal.style.display = 'flex';
  document.getElementById('s-name').focus();
}

function closeModal() {
  modal.style.display = 'none';
  seasonForm.reset();
  editingId = null;
}

function setModalLoading(on) {
  modalSubmit.disabled        = on;
  modalSpinner.style.display  = on ? 'inline-block' : 'none';
}

// ── Form submit ───────────────────────────────────────────────────────────────
async function handleModalSubmit(e) {
  e.preventDefault();
  modalError.style.display = 'none';

  const name                   = document.getElementById('s-name').value.trim();
  const start_date             = document.getElementById('s-start').value;
  const end_date               = document.getElementById('s-end').value;
  const placement_window_start = document.getElementById('s-window-start').value;
  const placement_window_end   = document.getElementById('s-window-end').value;

  if (!name || !start_date || !end_date || !placement_window_start || !placement_window_end) {
    modalErrorMsg.textContent = 'All fields are required.';
    modalError.style.display  = 'flex';
    return;
  }
  if (!isDateRangeOrdered(start_date, end_date)) {
    modalErrorMsg.textContent = 'Season start date must be before or equal to the end date.';
    modalError.style.display  = 'flex';
    return;
  }
  if (!isWindowWithinSeason({ start_date, end_date, placement_window_start, placement_window_end })) {
    modalErrorMsg.textContent = 'The placement window must fall within the season dates.';
    modalError.style.display  = 'flex';
    return;
  }

  setModalLoading(true);
  const payload = { name, start_date, end_date, placement_window_start, placement_window_end };

  const { error } = editingId
    ? await updateSeason(editingId, payload)
    : await createSeason(payload);

  setModalLoading(false);

  if (error) {
    modalErrorMsg.textContent = error.message || 'Failed to save season.';
    modalError.style.display  = 'flex';
    return;
  }

  showToast(editingId ? 'Season updated.' : 'Season created.', 'success');
  closeModal();
  await loadSeasons();
}

// ── Table action delegation ───────────────────────────────────────────────────
async function handleTableAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id     = btn.dataset.id;
  const season = seasons.find((s) => s.id === id);
  if (!season) return;

  btn.disabled = true;

  try {
    if (action === 'edit') {
      openModal(season);
      btn.disabled = false;
      return;
    }

    const handlers = { open: openSeason, close: closeSeason, archive: archiveSeason };
    const handler = handlers[action];
    if (!handler) { btn.disabled = false; return; }

    const { error } = await handler(id);
    if (error) {
      showToast(error.message || `Failed to ${action} season.`, 'error');
    } else {
      showToast(`Season ${action}ed successfully.`, 'success');
      await loadSeasons();
    }
  } catch (err) {
    showToast(err.message || 'An error occurred.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await requireRole(['admin']);
  await initShell();

  createBtn.addEventListener('click', () => openModal());
  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  seasonForm.addEventListener('submit', handleModalSubmit);
  seasonsTbody.addEventListener('click', handleTableAction);

  // Close modal on overlay click
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  // ESC key
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  pageLoading.style.display = 'none';
  await loadSeasons();
}

init();
