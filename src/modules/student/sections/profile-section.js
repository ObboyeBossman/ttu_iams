// =============================================================================
// IAMS — profile-section.js  (Phase 2)
// Handles #profile: dynamic initials avatar, inline phone edit, change password.
// =============================================================================
import './profile.css';
import { showToast } from '/shell/nav.js';
import { getProfile, updatePhone } from '/shared/services/profile.service.js';
import { supabase } from '/shared/supabase-client.js';

function _esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function _initials(name) {
  const parts = (name ?? '').trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : (parts[0]?.slice(0,2) ?? 'S').toUpperCase();
}

export async function initProfile(userId) {
  const card = document.getElementById('profile-card');
  if (!card) return;

  card.innerHTML = `<p style="font-size:13px;color:var(--text-secondary)">Loading…</p>`;

  const { data: profile, error } = await getProfile(userId);
  if (error || !profile) {
    card.innerHTML = `<div class="alert alert-danger">Failed to load profile. Please refresh.</div>`;
    return;
  }

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:18px;margin-bottom:24px;">
      <div id="profile-avatar" style="width:60px;height:60px;border-radius:50%;background:var(--ttu-blue);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;flex-shrink:0;">${_initials(profile.full_name)}</div>
      <div>
        <div style="font-size:18px;font-weight:700;color:var(--text-primary)">${_esc(profile.full_name)}</div>
        <div style="font-size:13px;color:var(--text-secondary)">${_esc(profile.index_number)}</div>
      </div>
    </div>
    <div id="profile-fields">
      <div class="profile-field-row">
        <div class="profile-field-label">Department</div>
        <div class="profile-field-value">${_esc(profile.department)}</div>
      </div>
      <div class="profile-field-row">
        <div class="profile-field-label">Programme</div>
        <div class="profile-field-value">${_esc(profile.programme)}</div>
      </div>
      <div class="profile-field-row">
        <div class="profile-field-label">Level</div>
        <div class="profile-field-value">${_esc(profile.level)}</div>
      </div>
      <div class="profile-field-row" id="phone-row">
        <div class="profile-field-label">Phone</div>
        <div class="profile-field-value" id="phone-display">${_esc(profile.phone)}</div>
        <button class="profile-edit-btn" id="phone-edit-btn">Edit</button>
      </div>
    </div>
    <div class="divider"></div>
    <div>
      <button class="btn btn-ghost" id="toggle-pw-btn" style="font-size:13px;padding:0;color:var(--ttu-blue);">
        <i data-lucide="lock"></i> Change Password
      </button>
    </div>
    <div class="change-pw-form" id="change-pw-form">
      <div class="form-row">
        <label for="pw-new">New Password</label>
        <input class="inp" type="password" id="pw-new" placeholder="At least 8 characters" autocomplete="new-password">
      </div>
      <div class="form-row">
        <label for="pw-confirm">Confirm New Password</label>
        <input class="inp" type="password" id="pw-confirm" placeholder="Repeat password" autocomplete="new-password">
      </div>
      <div class="alert alert-danger hidden" id="pw-error" style="margin-bottom:12px;"></div>
      <button class="btn btn-primary btn-sm" id="pw-save-btn">Save New Password</button>
    </div>`;

  _wirePhoneEdit(userId, profile.phone);
  _wirePwChange();
}

function _wirePhoneEdit(userId, currentPhone) {
  const editBtn  = document.getElementById('phone-edit-btn');
  const display  = document.getElementById('phone-display');
  const phoneRow = document.getElementById('phone-row');
  if (!editBtn) return;

  editBtn.addEventListener('click', () => {
    // Switch to inline form
    display.style.display   = 'none';
    editBtn.style.display   = 'none';
    const form = document.createElement('div');
    form.className = 'profile-inline-form';
    form.innerHTML = `<input class="inp" type="tel" id="phone-inp" value="${_esc(currentPhone)}" style="height:32px;font-size:13px;" maxlength="15"><button class="btn btn-primary btn-sm" id="phone-save">Save</button><button class="btn btn-ghost btn-sm" id="phone-cancel">Cancel</button>`;
    phoneRow.appendChild(form);

    document.getElementById('phone-cancel').addEventListener('click', () => {
      form.remove(); display.style.display = ''; editBtn.style.display = '';
    });
    document.getElementById('phone-save').addEventListener('click', async () => {
      const newPhone = document.getElementById('phone-inp').value.trim();
      const saveBtn = document.getElementById('phone-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      const { data, error } = await updatePhone(userId, newPhone);
      saveBtn.disabled = false; saveBtn.textContent = 'Save';
      if (error) { showToast('Failed: ' + error.message, 'error'); return; }
      display.textContent = data.phone;
      currentPhone = data.phone;
      form.remove(); display.style.display = ''; editBtn.style.display = '';
      showToast('Phone number updated.', 'success');
    });
  });
}

function _wirePwChange() {
  document.getElementById('toggle-pw-btn')?.addEventListener('click', () => {
    document.getElementById('change-pw-form')?.classList.toggle('open');
  });
  document.getElementById('pw-save-btn')?.addEventListener('click', async () => {
    const newPw  = document.getElementById('pw-new')?.value ?? '';
    const confirm = document.getElementById('pw-confirm')?.value ?? '';
    const errEl  = document.getElementById('pw-error');
    errEl?.classList.add('hidden');

    if (newPw.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.';
      errEl?.classList.remove('hidden'); return;
    }
    if (newPw !== confirm) {
      errEl.textContent = 'Passwords do not match.';
      errEl?.classList.remove('hidden'); return;
    }
    const btn = document.getElementById('pw-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    const { error } = await supabase.auth.updateUser({ password: newPw });
    btn.disabled = false; btn.textContent = 'Save New Password';
    if (error) { errEl.textContent = error.message; errEl?.classList.remove('hidden'); return; }
    showToast('Password changed successfully.', 'success');
    document.getElementById('change-pw-form')?.classList.remove('open');
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
  });
}
