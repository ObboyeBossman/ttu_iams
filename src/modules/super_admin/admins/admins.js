// =============================================================================
// IAMS — super_admin/admins/admins.js
// Create and manage Liaison Office admin accounts (master-detail layout).
// =============================================================================

import { requireRole }          from '/modules/auth/auth-guard.js';
import { initShell, showToast } from '/shell/nav.js';
import { supabase }             from '/shared/supabase-client.js';
import { formatDate }           from '/shared/utils.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

await requireRole(['super_admin']);
await initShell('admins');

document.getElementById('page-loading').classList.add('hidden');
document.getElementById('page-body').classList.remove('hidden');

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

async function writeAuditLog(action, targetType, targetId, detail = {}) {
  const session = await getSession();
  await supabase.from('super_admin_audit').insert({
    actor_id: session?.user?.id,
    action, target_type: targetType, target_id: String(targetId ?? ''), detail,
  });
}

// ── State ─────────────────────────────────────────────────────────────────────

let _allAdmins    = [];
let _selectedId   = null;

// ── Load admins ───────────────────────────────────────────────────────────────

async function loadAdmins() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, is_active, created_at')
    .eq('role', 'admin')
    .order('full_name', { ascending: true });

  if (error) { showToast('Failed to load admins', 'error'); return; }
  _allAdmins = data ?? [];
  document.getElementById('admin-count').textContent = `${_allAdmins.length} account${_allAdmins.length !== 1 ? 's' : ''}`;
  renderList();
}

function renderList() {
  const search   = document.getElementById('admin-search').value.trim().toLowerCase();
  const filtered = _allAdmins.filter(a => !search || a.full_name.toLowerCase().includes(search));
  const list     = document.getElementById('admin-list');

  if (filtered.length === 0) {
    list.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px;">${search ? 'No results' : 'No admin accounts yet'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(a => `
    <div class="admin-list-item${a.id === _selectedId ? ' selected' : ''}" data-id="${esc(a.id)}">
      <div class="admin-list-name">${esc(a.full_name)}</div>
      <div class="admin-list-meta">${a.is_active !== false ? 'Active' : '<span style="color:var(--ttu-red)">Inactive</span>'} · ${esc(a.phone ?? '—')}</div>
    </div>`).join('');

  list.querySelectorAll('.admin-list-item').forEach(el => {
    el.addEventListener('click', () => selectAdmin(el.dataset.id));
  });
}

function selectAdmin(id) {
  _selectedId = id;
  renderList();
  const a = _allAdmins.find(x => x.id === id);
  if (!a) return;

  document.getElementById('detail-empty').style.display   = 'none';
  document.getElementById('detail-content').style.display = '';

  const initials = a.full_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('detail-avatar').textContent = initials;
  document.getElementById('detail-name').textContent   = a.full_name;
  document.getElementById('detail-meta').textContent   = `Admin · Joined ${formatDate(a.created_at)}`;
  document.getElementById('detail-phone').textContent  = a.phone ?? '—';
  document.getElementById('detail-since').textContent  = formatDate(a.created_at);

  const badge   = document.getElementById('detail-status-badge');
  const toggleBtn = document.getElementById('detail-toggle-btn');
  if (a.is_active !== false) {
    badge.className     = 'badge badge-green';
    badge.textContent   = 'Active';
    toggleBtn.textContent = 'Deactivate';
    toggleBtn.className = 'btn btn-outline';
    toggleBtn.style.color = 'var(--ttu-red)';
    toggleBtn.style.borderColor = 'var(--ttu-red)';
  } else {
    badge.className     = 'badge badge-gray';
    badge.textContent   = 'Inactive';
    toggleBtn.textContent = 'Reactivate';
    toggleBtn.className = 'btn btn-primary';
    toggleBtn.style.color = '';
    toggleBtn.style.borderColor = '';
  }
}

// ── Create admin ──────────────────────────────────────────────────────────────

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(ov.id); });
});

document.getElementById('create-admin-btn').addEventListener('click', () => {
  document.getElementById('c-name').value  = '';
  document.getElementById('c-phone').value = '';
  document.getElementById('c-email').value = '';
  document.getElementById('create-err').classList.add('hidden');
  openModal('create-modal');
  document.getElementById('c-name').focus();
});

document.getElementById('create-save-btn').addEventListener('click', async () => {
  const name  = document.getElementById('c-name').value.trim();
  const phone = document.getElementById('c-phone').value.trim();
  const email = document.getElementById('c-email').value.trim();
  const errBanner = document.getElementById('create-err');
  const errMsg    = document.getElementById('create-err-msg');
  errBanner.classList.add('hidden');

  if (!name)  { errMsg.textContent = 'Name is required.'; errBanner.classList.remove('hidden'); return; }
  if (!phone) { errMsg.textContent = 'Phone is required.'; errBanner.classList.remove('hidden'); return; }
  if (!email) { errMsg.textContent = 'Email is required.'; errBanner.classList.remove('hidden'); return; }

  const btn = document.getElementById('create-save-btn');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    const session  = await getSession();
    const password = name.toLowerCase().replace(/\s+/g, '.') + '@Admin2025';
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify({ email, password, role: 'admin', full_name: name, phone }),
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to create admin');

    await writeAuditLog('create_admin', 'admin', json.user_id, { full_name: name, email });

    showToast(`Admin account created. Temporary password shown below.`, 'success');
    closeModal('create-modal');
    await loadAdmins();

    // Show the temp password once
    setTimeout(() => {
      alert(`Account created for ${name}.\n\nTemporary password:\n${password}\n\nPlease share this securely.`);
    }, 400);
  } catch (err) {
    errMsg.textContent = err.message ?? 'Failed to create account.';
    errBanner.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
});

// ── Edit admin ────────────────────────────────────────────────────────────────

document.getElementById('detail-edit-btn').addEventListener('click', () => {
  const a = _allAdmins.find(x => x.id === _selectedId);
  if (!a) return;
  document.getElementById('e-name').value  = a.full_name;
  document.getElementById('e-phone').value = a.phone ?? '';
  document.getElementById('edit-err').classList.add('hidden');
  openModal('edit-modal');
  document.getElementById('e-name').focus();
});

document.getElementById('edit-save-btn').addEventListener('click', async () => {
  const name  = document.getElementById('e-name').value.trim();
  const phone = document.getElementById('e-phone').value.trim();
  const errBanner = document.getElementById('edit-err');
  const errMsg    = document.getElementById('edit-err-msg');
  errBanner.classList.add('hidden');

  if (!name)  { errMsg.textContent = 'Name is required.'; errBanner.classList.remove('hidden'); return; }
  if (!phone) { errMsg.textContent = 'Phone is required.'; errBanner.classList.remove('hidden'); return; }

  const btn = document.getElementById('edit-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const { error } = await supabase.from('profiles').update({ full_name: name, phone }).eq('id', _selectedId);
    if (error) throw error;
    await writeAuditLog('update_admin', 'admin', _selectedId, { full_name: name, phone });
    showToast('Admin details updated', 'success');
    closeModal('edit-modal');
    await loadAdmins();
    selectAdmin(_selectedId);
  } catch (err) {
    errMsg.textContent = err.message ?? 'Update failed.';
    errBanner.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
});

// ── Toggle active / reset password ───────────────────────────────────────────

document.getElementById('detail-toggle-btn').addEventListener('click', async () => {
  const a = _allAdmins.find(x => x.id === _selectedId);
  if (!a) return;
  const newState = a.is_active === false;
  const action   = newState ? 'Reactivate' : 'Deactivate';
  if (!confirm(`${action} admin account for "${a.full_name}"?`)) return;

  const { error } = await supabase.from('profiles').update({ is_active: newState }).eq('id', _selectedId);
  if (error) { showToast(error.message, 'error'); return; }
  await writeAuditLog(newState ? 'reactivate_admin' : 'deactivate_admin', 'admin', _selectedId, { full_name: a.full_name });
  showToast(`Admin ${newState ? 'reactivated' : 'deactivated'}`, 'success');
  await loadAdmins();
  selectAdmin(_selectedId);
});

document.getElementById('detail-reset-btn').addEventListener('click', async () => {
  const a = _allAdmins.find(x => x.id === _selectedId);
  if (!a) return;
  showToast('Password reset not yet implemented — contact Supabase dashboard to reset.', 'info');
});

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById('admin-search').addEventListener('input', renderList);

// ── Init ──────────────────────────────────────────────────────────────────────

await loadAdmins();
