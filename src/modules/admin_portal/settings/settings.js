// =============================================================================
// IAMS — src/modules/admin_portal/settings.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { supabase }    from '/shared/supabase-client.js';
import { showToast }   from '/shared/utils.js';

let _settingsLoaded = false;

async function loadSettings() {
  if (_settingsLoaded) return;
  _settingsLoaded = true;

  const { data: settings, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  
  const card = document.getElementById('settings-card');
  if (error) {
    card.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
    return;
  }

  card.innerHTML = `
    <div class="form-section-title" style="margin-bottom:12px;font-weight:600;font-size:16px;">Branding Assets</div>
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
      These paths point to the branding assets stored in Supabase Storage. Update them
      when you upload a new letterhead, stamp, or signature.
    </p>
    ${['letterhead_path','stamp_path','signature_path'].map(field => `
      <div style="margin-bottom:16px;">
        <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:6px;">
          ${field.replace('_path','').replace('_',' ').replace(/\b\w/g, c=>c.toUpperCase())} Path
        </label>
        <input class="inp" type="text" id="set-${field}" value="${settings?.[field] ?? ''}"
               placeholder="branding/filename.png">
      </div>`).join('')}
    <div class="alert alert-danger hidden" id="set-error" style="margin-bottom:12px;"></div>
    <button class="btn btn-primary" id="set-save">Save Changes</button>`;

  document.getElementById('set-save').addEventListener('click', async () => {
    const btn = document.getElementById('set-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    const patch = {
      letterhead_path: document.getElementById('set-letterhead_path').value.trim(),
      stamp_path:      document.getElementById('set-stamp_path').value.trim(),
      signature_path:  document.getElementById('set-signature_path').value.trim(),
    };
    
    const { error: updateError } = await supabase.from('settings').update(patch).eq('id', 1);
    
    btn.disabled = false;
    btn.textContent = 'Save Changes';
    
    if (updateError) {
      document.getElementById('set-error').textContent = updateError.message;
      document.getElementById('set-error').classList.remove('hidden');
      return;
    }
    
    document.getElementById('set-error').classList.add('hidden');
    showToast('Settings saved successfully.', 'success');
  });
}

async function init() {
  await requireRole(['admin']);
  await initShell();
  
  await loadSettings();
  document.getElementById('page-loading').style.display = 'none';
}

init();
