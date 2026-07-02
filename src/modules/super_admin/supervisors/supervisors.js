// =============================================================================
// IAMS — super_admin/supervisors/supervisors.js
// Bulk CSV/XLSX import + searchable directory for school and company supervisors.
// =============================================================================

import { requireRole }          from '/modules/auth/auth-guard.js';
import { initShell, showToast } from '/shell/nav.js';
import { supabase }             from '/shared/supabase-client.js';
import { formatDate }           from '/shared/utils.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

await requireRole(['super_admin']);
await initShell('supervisors');

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
    action,
    target_type: targetType,
    target_id:   String(targetId ?? ''),
    detail,
  });
}

// ── Supervisor type radio ─────────────────────────────────────────────────────

let _selectedType = 'school_supervisor';

const TEMPLATES = {
  school_supervisor: {
    headers:  'full_name,email,phone,staff_id',
    example:  'Dr. Kwame Mensah,kwame.mensah@ttu.edu.gh,0241234567,TTU/LEC/001',
    filename: 'iams_school_supervisors_template.csv',
    desc:     'CSV columns: full_name, email, phone, staff_id (optional)',
  },
  company_supervisor: {
    headers:  'full_name,email,phone,company_name,company_phone',
    example:  'Jane Asante,jane.asante@company.com,0551234567,Volta River Authority,030 1234567',
    filename: 'iams_company_supervisors_template.csv',
    desc:     'CSV columns: full_name, email, phone, company_name, company_phone',
  },
};

function updateTypeUI() {
  const t = TEMPLATES[_selectedType];
  document.getElementById('template-desc').textContent = t.desc;
  document.querySelectorAll('.type-radio').forEach(label => label.classList.remove('selected'));
  document.getElementById(`radio-${_selectedType === 'school_supervisor' ? 'school' : 'company'}-label`).classList.add('selected');
}

document.querySelectorAll('input[name="sv-type"]').forEach(radio => {
  radio.addEventListener('change', () => {
    _selectedType = radio.value;
    updateTypeUI();
    // Reset import flow
    _parsedRows = []; _validRows = [];
    document.getElementById('import-file').value = '';
    document.getElementById('step-preview').style.display = 'none';
    document.getElementById('step-confirm').style.display = 'none';
  });
});

updateTypeUI();

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-import').style.display    = tab === 'import' ? '' : 'none';
    document.getElementById('tab-directory').style.display = tab === 'directory' ? '' : 'none';
    if (tab === 'directory') loadDirectory(_selectedDirType);
  });
});

// ── Download template ─────────────────────────────────────────────────────────

document.getElementById('download-template-btn').addEventListener('click', () => {
  const t = TEMPLATES[_selectedType];
  const blob = new Blob([t.headers + '\n' + t.example], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = t.filename;
  a.click();
});

// ── Parse & Validate ──────────────────────────────────────────────────────────

let _parsedRows = [];
let _validRows  = [];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRow(row) {
  const errors = [];
  if (!row.full_name?.trim())  errors.push('Name required');
  if (!row.email?.trim() || !EMAIL_RE.test(row.email.trim())) errors.push('Valid email required');
  if (!row.phone?.trim())      errors.push('Phone required');
  if (_selectedType === 'company_supervisor' && !row.company_name?.trim()) errors.push('Company name required');
  return errors;
}

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  let rows = [];
  if (file.name.endsWith('.csv')) {
    const text = await file.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
    });
  } else {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs');
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  _parsedRows = rows;
  validateAndPreview(rows);
});

function validateAndPreview(rows) {
  const isSchool = _selectedType === 'school_supervisor';
  let validCount = 0;
  _validRows = [];

  const thead = document.getElementById('preview-thead').querySelector('tr');
  thead.innerHTML = `<th>#</th><th>Name</th><th>Email</th><th>Phone</th>
    ${isSchool ? '<th>Staff ID</th>' : '<th>Company</th><th>Co. Phone</th>'}
    <th>Status</th>`;

  const tbody = document.getElementById('preview-tbody');
  tbody.innerHTML = rows.map((row, i) => {
    const errors = validateRow(row);
    const ok = errors.length === 0;
    if (ok) { validCount++; _validRows.push(row); }
    const extra = isSchool
      ? `<td>${esc(row.staff_id)}</td>`
      : `<td>${esc(row.company_name)}</td><td>${esc(row.company_phone)}</td>`;
    return `
      <tr class="${ok ? 'row-ok' : 'row-err'}">
        <td>${i + 1}</td>
        <td>${esc(row.full_name)}</td>
        <td>${esc(row.email)}</td>
        <td>${esc(row.phone)}</td>
        ${extra}
        <td class="${ok ? '' : 'err-cell'}">${ok ? '✓ Valid' : esc(errors.join('; '))}</td>
      </tr>`;
  }).join('');

  const errCount = rows.length - validCount;
  document.getElementById('validation-summary').innerHTML = `
    <div class="alert ${errCount > 0 ? 'alert-warning' : 'alert-success'}">
      ${validCount} row${validCount !== 1 ? 's' : ''} valid
      ${errCount > 0 ? ` · <strong>${errCount} with errors</strong> (will be skipped)` : ''}
    </div>`;

  document.getElementById('step-preview').style.display = '';
  document.getElementById('step-confirm').style.display = '';

  const confirmBtn = document.getElementById('confirm-import-btn');
  confirmBtn.textContent = `Import ${validCount} Valid Supervisor${validCount !== 1 ? 's' : ''}`;
  confirmBtn.disabled = validCount === 0;
}

// ── Import ────────────────────────────────────────────────────────────────────

async function callCreateUser(payload) {
  const session = await getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body:    JSON.stringify(payload),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create user');
  return json;
}

function generateDefaultPassword(email) {
  const prefix = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
  return prefix + '@IAMS2025';
}

document.getElementById('confirm-import-btn').addEventListener('click', async () => {
  if (_validRows.length === 0) return;

  const btn            = document.getElementById('confirm-import-btn');
  btn.disabled         = true;
  const progressWrap   = document.getElementById('import-progress-wrap');
  const progressBar    = document.getElementById('import-progress-bar');
  const progressLabel  = document.getElementById('import-progress-label');
  const resultEl       = document.getElementById('import-result');
  progressWrap.style.display = '';

  let successCount = 0;
  let failCount    = 0;
  const failures   = [];

  for (let i = 0; i < _validRows.length; i++) {
    const row = _validRows[i];
    const pct = Math.round(((i + 1) / _validRows.length) * 100);
    progressBar.style.width  = pct + '%';
    progressLabel.textContent = `Creating account ${i + 1} of ${_validRows.length} — ${esc(row.full_name)}…`;

    try {
      await callCreateUser({
        email:         row.email.trim(),
        password:      generateDefaultPassword(row.email.trim()),
        role:          _selectedType,
        full_name:     row.full_name.trim(),
        phone:         row.phone.trim(),
        staff_id:      row.staff_id?.trim() ?? null,
        company_name:  row.company_name?.trim() ?? null,
        company_phone: row.company_phone?.trim() ?? null,
      });
      successCount++;
    } catch (err) {
      failCount++;
      failures.push({ name: row.full_name, error: err.message });
    }
  }

  await writeAuditLog('bulk_import_supervisors', 'supervisors', 'batch', {
    type: _selectedType, total: _validRows.length, success: successCount, failed: failCount,
  });

  progressWrap.style.display = 'none';
  resultEl.style.display     = '';
  resultEl.innerHTML = `
    <div class="alert ${failCount === 0 ? 'alert-success' : 'alert-warning'}" style="margin-bottom:var(--space-md);">
      <strong>${successCount} account${successCount !== 1 ? 's' : ''} created successfully.</strong>
      ${failCount > 0 ? ` ${failCount} failed.` : ''}
    </div>
    ${failCount > 0 ? `<details><summary style="font-size:13px;cursor:pointer;">Show failures</summary><pre style="font-size:11px;margin-top:8px;">${esc(JSON.stringify(failures, null, 2))}</pre></details>` : ''}
    <p style="font-size:13px;color:var(--text-secondary);margin-top:var(--space-md);">
      Default password: <code style="background:var(--bg-page);padding:2px 6px;border-radius:4px;">[email prefix]@IAMS2025</code>
    </p>`;

  showToast(`Import complete: ${successCount} created, ${failCount} failed`, failCount === 0 ? 'success' : 'info');
  btn.textContent = 'Import Complete';
});

// ── Directory ─────────────────────────────────────────────────────────────────

let _allSupervisors = [];
let _selectedDirType = 'school_supervisor';

document.querySelectorAll('.tab-btn[data-dir-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn[data-dir-type]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _selectedDirType = btn.dataset.dirType;
    loadDirectory(_selectedDirType);
  });
});

document.getElementById('dir-search').addEventListener('input', () => renderDirectory());

async function loadDirectory(type) {
  const tbody = document.getElementById('dir-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:32px;color:var(--text-muted);">Loading…</td></tr>`;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, is_active, created_at, role')
    .eq('role', type)
    .order('full_name', { ascending: true });

  if (error) { showToast('Failed to load supervisors', 'error'); return; }
  _allSupervisors = data ?? [];
  renderDirectory();
}

function renderDirectory() {
  const search   = document.getElementById('dir-search').value.trim().toLowerCase();
  const filtered = _allSupervisors.filter(s =>
    !search || s.full_name.toLowerCase().includes(search) || s.phone?.includes(search)
  );

  const tbody = document.getElementById('dir-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:32px;color:var(--text-muted);">No supervisors found</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.slice(0, 200).map(s => `
    <tr>
      <td style="font-weight:500;">${esc(s.full_name)}</td>
      <td>${esc(s.phone ?? '—')}</td>
      <td><span class="badge badge-gray">${esc(s.role?.replace('_', ' ') ?? '—')}</span></td>
      <td>—</td>
      <td><span class="badge ${s.is_active !== false ? 'badge-green' : 'badge-gray'}">${s.is_active !== false ? 'Active' : 'Inactive'}</span></td>
      <td>${esc(formatDate(s.created_at))}</td>
    </tr>`).join('');
}
