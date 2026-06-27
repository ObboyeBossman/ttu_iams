// =============================================================================
// IAMS — settings.js  (Phase 2)
// Handles #settings: appearance toggle, notification prefs, account info.
// =============================================================================
import './settings.css';
import { showToast } from '/shell/nav.js';
import { getAuthUser } from '/shared/services/profile.service.js';

const THEME_KEY   = 'iams_theme_mode';
const NOTIF_KEY   = 'iams_notif_prefs';

// ── Theme management ──────────────────────────────────────────────────────────

function _applyTheme(mode) {
  const html = document.documentElement;
  if (mode === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    html.setAttribute('data-theme', mode);
  }
}

export function applyStoredTheme() {
  const mode = localStorage.getItem(THEME_KEY) ?? 'light';
  _applyTheme(mode);
}

// ── Settings init ─────────────────────────────────────────────────────────────
export async function initSettings() {
  // Wire settings tabs
  document.querySelectorAll('[data-stab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-stab]').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.settings-tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `spanel-${btn.dataset.stab}`));
    });
  });

  // Appearance buttons
  const savedMode = localStorage.getItem(THEME_KEY) ?? 'light';
  document.querySelectorAll('[data-theme-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeMode === savedMode);
    btn.addEventListener('click', () => {
      const mode = btn.dataset.themeMode;
      localStorage.setItem(THEME_KEY, mode);
      _applyTheme(mode);
      document.querySelectorAll('[data-theme-mode]').forEach(b =>
        b.classList.toggle('active', b === btn));
      showToast(`Theme set to ${mode}.`, 'info');
    });
  });

  // System mode media query listener
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) ?? 'light') === 'system') _applyTheme('system');
  });

  // Notifications
  const notifPrefs = JSON.parse(localStorage.getItem(NOTIF_KEY) ?? '{}');
  const placementToggle = document.getElementById('notif-placement');
  const visitToggle     = document.getElementById('notif-visit');
  if (placementToggle) { placementToggle.checked = notifPrefs.placement ?? true; placementToggle.addEventListener('change', _saveNotifs); }
  if (visitToggle)     { visitToggle.checked     = notifPrefs.visit    ?? false; visitToggle.addEventListener('change', _saveNotifs); }

  // Account info
  const { data: user } = await getAuthUser();
  const emailEl   = document.getElementById('settings-email');
  const createdEl = document.getElementById('settings-created');
  if (emailEl && user)   emailEl.textContent   = user.email ?? '—';
  if (createdEl && user) createdEl.textContent = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GH', { year:'numeric', month:'long', day:'numeric' })
    : '—';

  // Sign out button in settings panel
  document.getElementById('settings-signout-btn')?.addEventListener('click', async () => {
    const { supabase } = await import('/shared/supabase-client.js');
    await supabase.auth.signOut();
    window.location.href = '/src/modules/auth/login.html';
  });
}

function _saveNotifs() {
  const prefs = {
    placement: document.getElementById('notif-placement')?.checked ?? true,
    visit:     document.getElementById('notif-visit')?.checked ?? false,
  };
  localStorage.setItem(NOTIF_KEY, JSON.stringify(prefs));
  showToast('Notification preferences saved.', 'success');
}
