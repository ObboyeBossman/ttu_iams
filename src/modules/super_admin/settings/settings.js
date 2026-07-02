// =============================================================================
// IAMS — super_admin/settings/settings.js
// Letter assets, season emergency controls, own profile.
// =============================================================================

import { requireRole }          from '/modules/auth/auth-guard.js';
import { initShell, showToast } from '/shell/nav.js';
import { supabase }             from '/shared/supabase-client.js';
import { getCurrentUserId }     from '/modules/auth/auth-guard.js';

await requireRole(['super_admin']);
await initShell('settings');

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

// ── Letter Assets ─────────────────────────────────────────────────────────────

const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
if (settings) {
  document.getElementById('asset-letterhead').value = settings.letterhead_path ?? '';
  document.getElementById('asset-stamp').value      = settings.stamp_path ?? '';
  document.getElementById('asset-footer').value     = settings.footer_path ?? '';
}

document.getElementById('save-assets-btn').addEventListener('click', async () => {
  const letterhead = document.getElementById('asset-letterhead').value.trim();
  const stamp      = document.getElementById('asset-stamp').value.trim();
  const footer     = document.getElementById('asset-footer').value.trim();
  const session    = await getSession();
  const btn = document.getElementById('save-assets-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const { error } = await supabase.from('settings').update({
    letterhead_path: letterhead || null,
    stamp_path:      stamp || null,
    footer_path:     footer || null,
    updated_at:      new Date().toISOString(),
    updated_by:      session?.user?.id,
  }).eq('id', 1);

  if (error) { showToast(error.message, 'error'); }
  else {
    await writeAuditLog('update_letter_assets', 'settings', '1', { letterhead, stamp, footer });
    showToast('Letter asset paths saved', 'success');
  }
  btn.disabled = false; btn.textContent = 'Save Asset Paths';
});

// ── Season emergency controls ─────────────────────────────────────────────────

const { data: seasons } = await supabase.from('seasons').select('id, name, status').order('start_date', { ascending: false });
const openSeasons = (seasons ?? []).filter(s => s.status === 'open');
const listEl = document.getElementById('seasons-emergency-list');

if (openSeasons.length === 0) {
  listEl.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No seasons are currently open.</p>`;
} else {
  listEl.innerHTML = openSeasons.map(s => `
    <div class="season-row">
      <div>
        <div style="font-weight:500;font-size:14px;">${esc(s.name)}</div>
        <div style="font-size:12px;color:var(--text-muted);">Status: open</div>
      </div>
      <button class="btn btn-outline" style="color:var(--ttu-red);border-color:var(--ttu-red);" data-force-close="${esc(s.id)}" data-season-name="${esc(s.name)}">
        Force Close
      </button>
    </div>`).join('');

  listEl.querySelectorAll('[data-force-close]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id   = btn.dataset.forceClose;
      const name = btn.dataset.seasonName;
      if (!confirm(`Force-close season "${name}"? Students will no longer be able to submit placements. This cannot be undone.`)) return;
      btn.disabled = true; btn.textContent = 'Closing…';
      const { error } = await supabase.from('seasons').update({ status: 'closed' }).eq('id', id);
      if (error) { showToast(error.message, 'error'); btn.disabled = false; btn.textContent = 'Force Close'; return; }
      await writeAuditLog('force_close_season', 'season', id, { name });
      showToast(`Season "${name}" closed`, 'success');
      btn.closest('.season-row').remove();
      if (listEl.querySelectorAll('.season-row').length === 0) {
        listEl.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No seasons are currently open.</p>`;
      }
    });
  });
}

// ── My Profile ────────────────────────────────────────────────────────────────

const userId = await getCurrentUserId();
if (userId) {
  const { data: profile } = await supabase.from('profiles').select('full_name, phone').eq('id', userId).maybeSingle();
  if (profile) {
    document.getElementById('p-name').value  = profile.full_name ?? '';
    document.getElementById('p-phone').value = profile.phone ?? '';
  }
}

document.getElementById('save-profile-btn').addEventListener('click', async () => {
  const name  = document.getElementById('p-name').value.trim();
  const phone = document.getElementById('p-phone').value.trim();
  if (!name || !phone) { showToast('Name and phone are required', 'error'); return; }

  const btn = document.getElementById('save-profile-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const { error } = await supabase.from('profiles').update({ full_name: name, phone }).eq('id', userId);
  if (error) { showToast(error.message, 'error'); }
  else { showToast('Profile updated', 'success'); }
  btn.disabled = false; btn.textContent = 'Save Profile';
});
