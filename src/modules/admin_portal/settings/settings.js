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

  const fields = ['letterhead_path', 'stamp_path', 'signature_path', 'footer_path'];
  
  card.innerHTML = `
    <div class="form-section-title" style="margin-bottom:12px;font-weight:600;font-size:16px;">Branding Assets</div>
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
      Upload new branding assets below. They will be saved to Supabase Storage and updated in the system automatically.
    </p>
    ${fields.map(field => `
      <div style="margin-bottom:16px;">
        <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:6px;">
          ${field.replace('_path','').replace('_',' ').replace(/\b\w/g, c=>c.toUpperCase())}
        </label>
        <input class="inp" type="file" id="set-file-${field}" accept="image/*" style="padding:6px;width:100%;">
        ${settings?.[field] ? `<div style="font-size:11.5px;color:var(--text-secondary);margin-top:4px;">Current: <code>${settings[field]}</code></div>` : ''}
      </div>`).join('')}
    <div class="alert alert-danger hidden" id="set-error" style="margin-bottom:12px;"></div>
    <button class="btn btn-primary" id="set-save">Save Changes</button>`;

  document.getElementById('set-save').addEventListener('click', async () => {
    const btn = document.getElementById('set-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    document.getElementById('set-error').classList.add('hidden');
    
    const patch = {};
    let uploadError = null;

    for (const field of fields) {
      const fileInput = document.getElementById(`set-file-${field}`);
      if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const ext = file.name.split('.').pop();
        const fileName = `${field.replace('_path', '')}.${ext}`; // e.g. stamp.png
        
        const { data, error } = await supabase.storage.from('branding').upload(fileName, file, { upsert: true });
        
        if (error) {
          uploadError = `Failed to upload ${field}: ${error.message}`;
          break;
        } else {
          patch[field] = data.path;
        }
      }
    }
    
    if (uploadError) {
      document.getElementById('set-error').textContent = uploadError;
      document.getElementById('set-error').classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Save Changes';
      return;
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await supabase.from('settings').update(patch).eq('id', 1);
      
      if (updateError) {
        document.getElementById('set-error').textContent = updateError.message;
        document.getElementById('set-error').classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Save Changes';
        return;
      }
    } else {
       // Nothing was selected
       btn.disabled = false;
       btn.textContent = 'Save Changes';
       showToast('No files were selected to upload.', 'info');
       return;
    }
    
    btn.disabled = false;
    btn.textContent = 'Save Changes';
    showToast('Settings saved successfully.', 'success');
    
    _settingsLoaded = false;
    loadSettings();
  });
}

async function init() {
  await requireRole(['admin']);
  await initShell();
  
  await loadSettings();
  document.getElementById('page-loading').style.display = 'none';
}

init();
