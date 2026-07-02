// =============================================================================
// IAMS — super_admin/structure/structure.js
// Faculty → Department → Programme three-column tree manager.
// =============================================================================

import { requireRole }          from '/modules/auth/auth-guard.js';
import { initShell, showToast } from '/shell/nav.js';
import { supabase }             from '/shared/supabase-client.js';
import {
  listFaculties, createFaculty, updateFaculty, deleteFaculty,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listProgrammes, createProgramme, updateProgramme, deleteProgramme,
} from '/shared/services/institution.service.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

await requireRole(['super_admin']);
await initShell('structure');

document.getElementById('page-loading').classList.add('hidden');
document.getElementById('page-body').classList.remove('hidden');

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function getActorId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

async function writeAuditLog(action, targetType, targetId, detail = {}) {
  const actorId = await getActorId();
  await supabase.from('super_admin_audit').insert({ actor_id: actorId, action, target_type: targetType, target_id: String(targetId ?? ''), detail });
}

// ── State ─────────────────────────────────────────────────────────────────────

let _faculties   = [];
let _departments = [];
let _programmes  = [];
let _selectedFacultyId   = null;
let _selectedDeptId      = null;
let _editingFacultyId    = null;
let _editingDeptId       = null;
let _editingProgId       = null;

// ── Render helpers ────────────────────────────────────────────────────────────

function renderFaculties() {
  const el = document.getElementById('faculties-list');
  if (_faculties.length === 0) { el.innerHTML = `<div class="tree-empty">No faculties yet. Add one to start.</div>`; return; }
  el.innerHTML = _faculties.map(f => {
    const deptCount = f.departments?.[0]?.count ?? 0;
    const sel = f.id === _selectedFacultyId ? ' selected' : '';
    return `
      <div class="tree-item${sel}" data-fid="${esc(f.id)}">
        <div>
          <div class="tree-item-name">${esc(f.name)}</div>
          <div class="tree-item-meta">${esc(f.code)} · ${esc(String(deptCount))} dept${deptCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="tree-item-actions">
          <button class="btn-sm--secondary" data-edit-faculty="${esc(f.id)}">Edit</button>
          <button class="btn-sm--danger" data-del-faculty="${esc(f.id)}">Del</button>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.tree-item').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      _selectedFacultyId = row.dataset.fid;
      _selectedDeptId = null;
      loadDepartments(_selectedFacultyId);
      renderFaculties();
      document.getElementById('add-dept-btn').disabled = false;
      document.getElementById('add-prog-btn').disabled = true;
    });
  });
  el.querySelectorAll('[data-edit-faculty]').forEach(btn => {
    btn.addEventListener('click', () => openFacultyModal(_faculties.find(f => f.id === btn.dataset.editFaculty)));
  });
  el.querySelectorAll('[data-del-faculty]').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteFaculty(btn.dataset.delFaculty));
  });
}

function renderDepartments() {
  const el = document.getElementById('departments-list');
  if (!_selectedFacultyId) { el.innerHTML = `<div class="tree-empty">Select a faculty</div>`; return; }
  if (_departments.length === 0) { el.innerHTML = `<div class="tree-empty">No departments yet.</div>`; return; }
  el.innerHTML = _departments.map(d => {
    const progCount = d.programmes?.[0]?.count ?? 0;
    const sel = d.id === _selectedDeptId ? ' selected' : '';
    return `
      <div class="tree-item${sel}" data-did="${esc(d.id)}">
        <div>
          <div class="tree-item-name">${esc(d.name)}</div>
          <div class="tree-item-meta">${esc(d.code)} · ${esc(String(progCount))} programme${progCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="tree-item-actions">
          <button class="btn-sm--secondary" data-edit-dept="${esc(d.id)}">Edit</button>
          <button class="btn-sm--danger" data-del-dept="${esc(d.id)}">Del</button>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.tree-item').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      _selectedDeptId = row.dataset.did;
      loadProgrammes(_selectedDeptId);
      renderDepartments();
      document.getElementById('add-prog-btn').disabled = false;
    });
  });
  el.querySelectorAll('[data-edit-dept]').forEach(btn => {
    btn.addEventListener('click', () => openDeptModal(_departments.find(d => d.id === btn.dataset.editDept)));
  });
  el.querySelectorAll('[data-del-dept]').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteDept(btn.dataset.delDept));
  });
}

function renderProgrammes() {
  const el = document.getElementById('programmes-list');
  if (!_selectedDeptId) { el.innerHTML = `<div class="tree-empty">Select a department</div>`; return; }
  if (_programmes.length === 0) { el.innerHTML = `<div class="tree-empty">No programmes yet.</div>`; return; }
  el.innerHTML = _programmes.map(p => `
    <div class="tree-item">
      <div>
        <div class="tree-item-name">${esc(p.name)}</div>
        <div class="tree-item-meta">${esc(p.type)} · ${esc(String(p.duration_years))}yr${p.duration_years !== 1 ? 's' : ''}</div>
      </div>
      <div class="tree-item-actions">
        <button class="btn-sm--secondary" data-edit-prog="${esc(p.id)}">Edit</button>
        <button class="btn-sm--danger" data-del-prog="${esc(p.id)}">Del</button>
      </div>
    </div>`).join('');

  el.querySelectorAll('[data-edit-prog]').forEach(btn => {
    btn.addEventListener('click', () => openProgModal(_programmes.find(p => p.id === btn.dataset.editProg)));
  });
  el.querySelectorAll('[data-del-prog]').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteProg(btn.dataset.delProg));
  });
}

// ── Data loaders ──────────────────────────────────────────────────────────────

async function loadFaculties() {
  const { data, error } = await listFaculties();
  if (error) { showToast('Failed to load faculties', 'error'); return; }
  _faculties = data ?? [];
  renderFaculties();
}

async function loadDepartments(facultyId) {
  document.getElementById('departments-list').innerHTML = `<div class="tree-empty">Loading…</div>`;
  document.getElementById('programmes-list').innerHTML = `<div class="tree-empty">Select a department</div>`;
  _programmes = [];
  const { data, error } = await listDepartments(facultyId);
  if (error) { showToast('Failed to load departments', 'error'); return; }
  _departments = data ?? [];
  renderDepartments();
}

async function loadProgrammes(deptId) {
  document.getElementById('programmes-list').innerHTML = `<div class="tree-empty">Loading…</div>`;
  const { data, error } = await listProgrammes(deptId);
  if (error) { showToast('Failed to load programmes', 'error'); return; }
  _programmes = data ?? [];
  renderProgrammes();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', (e) => { if (e.target === el) closeModal(el.id); });
});

function showErr(bannerEl, msgEl, msg) {
  bannerEl.classList.remove('hidden');
  msgEl.textContent = msg;
}
function clearErr(bannerEl) { bannerEl.classList.add('hidden'); }

// ── Faculty modal ─────────────────────────────────────────────────────────────

function openFacultyModal(existing = null) {
  _editingFacultyId = existing?.id ?? null;
  document.getElementById('faculty-modal-title').textContent = existing ? 'Edit Faculty' : 'Add Faculty';
  document.getElementById('f-name').value = existing?.name ?? '';
  document.getElementById('f-code').value = existing?.code ?? '';
  clearErr(document.getElementById('faculty-err'));
  openModal('faculty-modal');
  document.getElementById('f-name').focus();
}

document.getElementById('add-faculty-btn').addEventListener('click', () => openFacultyModal());

document.getElementById('faculty-save-btn').addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  const code = document.getElementById('f-code').value.trim().toUpperCase();
  const banner = document.getElementById('faculty-err');
  const msg    = document.getElementById('faculty-err-msg');
  clearErr(banner);
  if (!name) return showErr(banner, msg, 'Faculty name is required.');
  if (!code) return showErr(banner, msg, 'Faculty code is required.');

  const btn = document.getElementById('faculty-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const actorId = await getActorId();
    if (_editingFacultyId) {
      const { error } = await updateFaculty(_editingFacultyId, { name, code });
      if (error) throw error;
      await writeAuditLog('update_faculty', 'faculty', _editingFacultyId, { name, code });
      showToast('Faculty updated', 'success');
    } else {
      const { data, error } = await createFaculty({ name, code, created_by: actorId });
      if (error) throw error;
      await writeAuditLog('create_faculty', 'faculty', data.id, { name, code });
      showToast('Faculty created', 'success');
    }
    closeModal('faculty-modal');
    await loadFaculties();
  } catch (e) {
    showErr(banner, msg, e.message ?? 'Save failed.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Faculty';
  }
});

async function handleDeleteFaculty(id) {
  const f = _faculties.find(x => x.id === id);
  const deptCount = f?.departments?.[0]?.count ?? 0;
  if (deptCount > 0) { showToast(`Cannot delete — ${deptCount} department(s) still belong to this faculty.`, 'error'); return; }
  if (!confirm(`Delete faculty "${f?.name}"? This cannot be undone.`)) return;
  const { error } = await deleteFaculty(id);
  if (error) { showToast(error.message ?? 'Delete failed', 'error'); return; }
  await writeAuditLog('delete_faculty', 'faculty', id, { name: f?.name });
  showToast('Faculty deleted', 'success');
  if (_selectedFacultyId === id) { _selectedFacultyId = null; _departments = []; _programmes = []; renderDepartments(); renderProgrammes(); }
  await loadFaculties();
}

// ── Department modal ──────────────────────────────────────────────────────────

function openDeptModal(existing = null) {
  _editingDeptId = existing?.id ?? null;
  const faculty = _faculties.find(f => f.id === _selectedFacultyId);
  document.getElementById('dept-modal-title').textContent = existing ? 'Edit Department' : 'Add Department';
  document.getElementById('dept-context').textContent = `Faculty: ${faculty?.name ?? '—'}`;
  document.getElementById('d-name').value = existing?.name ?? '';
  document.getElementById('d-code').value = existing?.code ?? '';
  clearErr(document.getElementById('dept-err'));
  openModal('dept-modal');
  document.getElementById('d-name').focus();
}

document.getElementById('add-dept-btn').addEventListener('click', () => openDeptModal());

document.getElementById('dept-save-btn').addEventListener('click', async () => {
  const name = document.getElementById('d-name').value.trim();
  const code = document.getElementById('d-code').value.trim().toUpperCase();
  const banner = document.getElementById('dept-err');
  const msg    = document.getElementById('dept-err-msg');
  clearErr(banner);
  if (!name) return showErr(banner, msg, 'Department name is required.');
  if (!code) return showErr(banner, msg, 'Department code is required.');

  const btn = document.getElementById('dept-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const actorId = await getActorId();
    if (_editingDeptId) {
      const { error } = await updateDepartment(_editingDeptId, { name, code });
      if (error) throw error;
      await writeAuditLog('update_department', 'department', _editingDeptId, { name, code });
      showToast('Department updated', 'success');
    } else {
      const { data, error } = await createDepartment({ faculty_id: _selectedFacultyId, name, code, created_by: actorId });
      if (error) throw error;
      await writeAuditLog('create_department', 'department', data.id, { name, code, faculty_id: _selectedFacultyId });
      showToast('Department created', 'success');
    }
    closeModal('dept-modal');
    await loadFaculties(); // refresh dept count in faculties
    await loadDepartments(_selectedFacultyId);
  } catch (e) {
    showErr(banner, msg, e.message ?? 'Save failed.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Department';
  }
});

async function handleDeleteDept(id) {
  const d = _departments.find(x => x.id === id);
  const progCount = d?.programmes?.[0]?.count ?? 0;
  if (progCount > 0) { showToast(`Cannot delete — ${progCount} programme(s) still belong to this department.`, 'error'); return; }
  if (!confirm(`Delete department "${d?.name}"? This cannot be undone.`)) return;
  const { error } = await deleteDepartment(id);
  if (error) { showToast(error.message ?? 'Delete failed', 'error'); return; }
  await writeAuditLog('delete_department', 'department', id, { name: d?.name });
  showToast('Department deleted', 'success');
  if (_selectedDeptId === id) { _selectedDeptId = null; _programmes = []; renderProgrammes(); document.getElementById('add-prog-btn').disabled = true; }
  await loadDepartments(_selectedFacultyId);
}

// ── Programme modal ───────────────────────────────────────────────────────────

function openProgModal(existing = null) {
  _editingProgId = existing?.id ?? null;
  const dept = _departments.find(d => d.id === _selectedDeptId);
  document.getElementById('prog-modal-title').textContent = existing ? 'Edit Programme' : 'Add Programme';
  document.getElementById('prog-context').textContent = `Department: ${dept?.name ?? '—'}`;
  document.getElementById('p-name').value = existing?.name ?? '';
  document.getElementById('p-type').value = existing?.type ?? '';
  document.getElementById('p-duration').value = existing?.duration_years ?? '4';
  clearErr(document.getElementById('prog-err'));
  openModal('prog-modal');
  document.getElementById('p-name').focus();
}

document.getElementById('add-prog-btn').addEventListener('click', () => openProgModal());

document.getElementById('prog-save-btn').addEventListener('click', async () => {
  const name     = document.getElementById('p-name').value.trim();
  const type     = document.getElementById('p-type').value;
  const duration = parseInt(document.getElementById('p-duration').value, 10);
  const banner = document.getElementById('prog-err');
  const msg    = document.getElementById('prog-err-msg');
  clearErr(banner);
  if (!_selectedDeptId) return showErr(banner, msg, 'Please select a department first.');
  if (!name) return showErr(banner, msg, 'Programme name is required.');
  if (!type) return showErr(banner, msg, 'Programme type is required.');
  if (!duration || duration < 1) return showErr(banner, msg, 'Duration must be at least 1 year.');

  const btn = document.getElementById('prog-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const actorId = await getActorId();
    if (_editingProgId) {
      const { error } = await updateProgramme(_editingProgId, { name, type, duration_years: duration });
      if (error) throw error;
      await writeAuditLog('update_programme', 'programme', _editingProgId, { name, type, duration_years: duration });
      showToast('Programme updated', 'success');
    } else {
      const { data, error } = await createProgramme({ department_id: _selectedDeptId, name, type, duration_years: duration, created_by: actorId });
      if (error) throw error;
      await writeAuditLog('create_programme', 'programme', data.id, { name, type, duration_years: duration, department_id: _selectedDeptId });
      showToast('Programme created', 'success');
    }
    closeModal('prog-modal');
    await loadProgrammes(_selectedDeptId);
    await loadDepartments(_selectedFacultyId); // refresh prog count
  } catch (e) {
    showErr(banner, msg, e.message ?? 'Save failed.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Programme';
  }
});

async function handleDeleteProg(id) {
  const p = _programmes.find(x => x.id === id);
  if (!confirm(`Delete programme "${p?.name} (${p?.type})"? Students linked to it will lose their programme reference.`)) return;
  const { error } = await deleteProgramme(id);
  if (error) { showToast(error.message ?? 'Delete failed — students may still be linked to this programme.', 'error'); return; }
  await writeAuditLog('delete_programme', 'programme', id, { name: p?.name });
  showToast('Programme deleted', 'success');
  await loadProgrammes(_selectedDeptId);
}

// ── Init ──────────────────────────────────────────────────────────────────────

await loadFaculties();
