// =============================================================================
// IAMS — src/modules/admin_portal/settings/settings.js
// =============================================================================
// Two tabs: Branding (system-wide letter assets — admin-only RLS) and
// Account (this admin's own profile + local appearance preference).
// Routes through shared/services/settings.js and profile.service.js rather
// than calling supabase.from(...)/supabase.storage directly — matches the
// codebase's "page scripts call services" convention.
//
// Real settings table columns: letterhead_path, stamp_path (combined
// signature+stamp), footer_path. No signature_path column exists; the
// previous version of this file listed it and would have errored on save.
// =============================================================================

import { requireRole }                                   from '/modules/auth/auth-guard.js';
import { initShell }                                     from '/shell/nav.js';
import { supabase }                                      from '/shared/supabase-client.js';
import { showToast, renderAvatarOrInitials }             from '/shared/utils.js';
import { getSettings, updateSettings }                   from '/shared/services/settings.js';
import { getOwnProfile, updateOwnProfile, getAuthUser, uploadAvatar, getAvatarUrl }  from '/shared/services/profile.service.js';

const BRANDING_FIELDS = [
  { key: 'letterhead_path', label: 'Letterhead' },
  { key: 'stamp_path',      label: 'Stamp & Signature' },
  { key: 'footer_path',     label: 'Footer' },
];

const THEME_KEY = 'iams_theme_mode';

// -----------------------------------------------------------------------------
// Tabs
// -----------------------------------------------------------------------------

function initTabs() {
  document.querySelectorAll('[data-stab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-stab]').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.settings-tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `spanel-${btn.dataset.stab}`));
    });
  });
}

// -----------------------------------------------------------------------------
// Branding tab
// -----------------------------------------------------------------------------

// Boolean re-entrancy guard — replaces the earlier { once: true } / manual
// re-bind pattern. try/finally guarantees the flag and button state are always
// restored regardless of which branch exits.
let _brandingSaving = false;

async function loadBranding() {
  const { data: settings, error } = await getSettings();
  const container = document.getElementById('branding-fields');

  if (error) {
    container.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
    document.getElementById('branding-save').disabled = true;
    return;
  }

  container.innerHTML = BRANDING_FIELDS.map(({ key, label }) => `
    <div class="field-group">
      <label class="field-group-label" for="brand-file-${key}">${label}</label>
      <input class="inp" type="file" id="brand-file-${key}" accept="image/*" style="padding:6px;width:100%;">
      ${settings?.[key]
        ? `<div class="current-asset-path">Current: <code>${settings[key]}</code></div>`
        : `<div class="current-asset-path" style="color:var(--text-warning);">Not yet uploaded — letter generation will fail until this is set.</div>`}
    </div>
  `).join('');
}

async function saveBranding() {
  if (_brandingSaving) return;
  _brandingSaving = true;

  const btn     = document.getElementById('branding-save');
  const errorEl = document.getElementById('branding-error');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  errorEl.classList.add('hidden');

  try {
    const patch = {};

    for (const { key, label } of BRANDING_FIELDS) {
      const fileInput = document.getElementById(`brand-file-${key}`);
      if (fileInput && fileInput.files.length > 0) {
        const file     = fileInput.files[0];
        const ext      = file.name.split('.').pop();
        const fileName = `${key.replace('_path', '')}.${ext}`;

        const { data, error } = await supabase.storage.from('branding').upload(fileName, file, { upsert: true });
        if (error) {
          errorEl.textContent = `Failed to upload ${label}: ${error.message}`;
          errorEl.classList.remove('hidden');
          return; // finally restores button state
        }
        patch[key] = data.path;
      }
    }

    if (Object.keys(patch).length === 0) {
      showToast('No files were selected to upload.', 'info');
      return;
    }

    const { error: updateError } = await updateSettings(patch);
    if (updateError) {
      errorEl.textContent = updateError.message;
      errorEl.classList.remove('hidden');
      return;
    }

    showToast('Branding assets updated.', 'success');
    await loadBranding(); // refresh "Current: ..." paths
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Branding';
    _brandingSaving = false;
  }
}

// -----------------------------------------------------------------------------
// Account tab
// -----------------------------------------------------------------------------

let _ownUserId    = null;
let _accountSaving = false;

async function loadAccount() {
  const { data: authUser } = await getAuthUser();
  if (!authUser) return;
  _ownUserId = authUser.id;

  const { data: profile, error } = await getOwnProfile(authUser.id);
  if (error || !profile) {
    const el = document.getElementById('account-error');
    el.textContent = error?.message || 'Could not load account details.';
    el.classList.remove('hidden');
    return;
  }

  document.getElementById('acct-full-name').value = profile.full_name || '';
  document.getElementById('acct-phone').value     = profile.phone     || '';

  document.getElementById('account-email').textContent = authUser.email || '—';
  document.getElementById('account-role').textContent  = profile.role
    ? profile.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : '—';
  document.getElementById('account-created').textContent = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-GH', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '—';

  // Identity row
  document.getElementById('account-identity-name').textContent = profile.full_name || '—';
  document.getElementById('account-identity-role').textContent = profile.role
    ? profile.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : '—';
  renderAvatarPreview(profile.full_name, profile.avatar_path);
}

async function saveAccount() {
  if (_accountSaving || !_ownUserId) return;
  _accountSaving = true;

  const btn     = document.getElementById('account-save');
  const errorEl = document.getElementById('account-error');
  errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const full_name = document.getElementById('acct-full-name').value;
    const phone     = document.getElementById('acct-phone').value;

    const { error } = await updateOwnProfile(_ownUserId, { full_name, phone });
    if (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
      return;
    }

    showToast('Account details updated.', 'success');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Account Details';
    _accountSaving = false;
  }
}

function renderAvatarPreview(fullName, avatarPath) {
  const preview = document.getElementById('account-avatar-preview');
  const url = getAvatarUrl(avatarPath);
  preview.outerHTML = renderAvatarOrInitials({ fullName, avatarUrl: url }, 'account-avatar-preview').replace('class="avatar account-avatar-preview"', 'class="account-avatar-preview" id="account-avatar-preview"');
}

let _avatarUploading = false;

function initAvatarUpload() {
  const editBtn = document.getElementById('account-avatar-edit-btn');
  const fileInput = document.getElementById('account-avatar-input');

  editBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !_ownUserId || _avatarUploading) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file.', 'warning');
      fileInput.value = '';
      return;
    }
    const MAX_BYTES = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_BYTES) {
      showToast('Image must be under 5MB.', 'warning');
      fileInput.value = '';
      return;
    }

    _avatarUploading = true;
    editBtn.disabled = true;

    const { data, error } = await uploadAvatar(_ownUserId, file);

    _avatarUploading = false;
    editBtn.disabled = false;
    fileInput.value = '';

    if (error) {
      showToast(`Could not upload photo: ${error.message}`, 'error');
      return;
    }

    renderAvatarPreview(document.getElementById('acct-full-name').value, data.avatar_path);
    showToast('Profile photo updated.', 'success');

    // Refresh the shell's own avatar render too
    const { initShell } = await import('/shell/nav.js');
    await initShell();
  });
}

// -----------------------------------------------------------------------------
// Appearance (theme) — writes the same localStorage key that the inline
// <head> script on every page reads, so this control is actually effective.
// -----------------------------------------------------------------------------

function _applyTheme(mode) {
  if (mode === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', mode);
  }
}

function initAppearance() {
  const saved = localStorage.getItem(THEME_KEY) ?? 'light';
  document.querySelectorAll('[data-theme-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeMode === saved);
    btn.addEventListener('click', () => {
      const mode = btn.dataset.themeMode;
      localStorage.setItem(THEME_KEY, mode);
      _applyTheme(mode);
      document.querySelectorAll('[data-theme-mode]').forEach(b =>
        b.classList.toggle('active', b === btn));
      showToast(`Theme set to ${mode}.`, 'info');
    });
  });
}

// -----------------------------------------------------------------------------
// Sign out
// -----------------------------------------------------------------------------

function initSignOut() {
  document.getElementById('account-signout-btn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/src/modules/auth/login.html';
  });
}

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

async function init() {
  await requireRole(['admin']);
  await initShell();

  initTabs();
  initAppearance();
  initSignOut();
  initAvatarUpload();

  // Bind save handlers once here — not re-bound on every loadBranding() call.
  document.getElementById('branding-save').addEventListener('click', saveBranding);
  document.getElementById('account-save').addEventListener('click', saveAccount);

  // Independent reads — no reason to serialize.
  await Promise.all([loadBranding(), loadAccount()]);

  document.getElementById('page-loading').style.display = 'none';
}

init();
