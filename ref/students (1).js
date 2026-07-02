// =============================================================================
// IAMS — super_admin/students/students.js
// Bulk CSV/XLSX import + searchable student directory.
// =============================================================================

import { requireRole }          from '/modules/auth/auth-guard.js';
import { initShell, showToast } from '/shell/nav.js';
import { supabase }             from '/shared/supabase-client.js';
import { formatDate }           from '/shared/utils.js';
import { listStudents, filterStudents } from '/shared/services/students.js';
import { listProgrammesFull, resolveProgrammeId } from '/shared/services/institution.service.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

await requireRole(['super_admin']);
await initShell('students');

document.getElementById('page-loading').classList.add('hidden');
document.getElementById('page-body').classList.remove('hidden');

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

async function writeAuditLog(action, targetType, targetId, detail = {}) {
  const session = await getSession();
  await supabase.from('super_admin_audit').insert({ actor_id: session?.user?.id, action, target_type: targetType, target_id: String(targetId ?? ''), detail });
}

// ── Validation constants ──────────────────────────────────────────────────────

const INDEX_NUMBER_RE = /^TTU\/[A-Z]+\/\d{2}\/\d{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateDefaultPassword(indexNumber) {
  return indexNumber.replace(/\//g, '') + '@IAMS';
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-import').style.display    = tab === 'import' ? '' : 'none';
    document.getElementById('tab-directory').style.display = tab === 'directory' ? '' : 'none';
    if (tab === 'directory') loadDirectory();
  });
});

// ── Download template ─────────────────────────────────────────────────────────

document.getElementById('download-template-btn').addEventListener('click', () => {
  const headers = 'full_name,index_number,email,phone,level,programme_name,programme_type,department_code,faculty_code';
  const example = 'Kwame Mensah,TTU/CSC/23/001,kwame.mensah@example.com,0241234567,HND 1,Computer Science,HND,CSC,FENG';
  const blob = new Blob([headers + '\n' + example], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'iams_students_template.csv';
  a.click();
});

// ── File upload & parse ───────────────────────────────────────────────────────

let _parsedRows = [];
let _validRows  = [];
let _programmes = [];

// Load programmes once for validation
const { data: progData } = await listProgrammesFull();
_programmes = progData ?? [];

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
    // XLSX
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs');
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  _parsedRows = rows;
  validateAndPreview(rows);
});

function validateRow(row, index) {
  const errors = [];
  if (!row.full_name?.trim())          errors.push('Name required');
  if (!row.email?.trim() || !EMAIL_RE.test(row.email.trim())) errors.push('Valid email required');
  if (!row.phone?.trim())              errors.push('Phone required');
  if (!row.index_number?.trim() || !INDEX_NUMBER_RE.test(row.index_number.trim())) errors.push('Invalid index number (TTU/XXX/YY/NNN)');
  if (!row.level?.trim())              errors.push('Level required');

  const programmeId = resolveProgrammeId({
    programme_name: row.programme_name,
    programme_type: row.programme_type,
    department_code: row.department_code,
    faculty_code: row.faculty_code,
  }, _programmes);
  if (!programmeId)                    errors.push('Programme not found — check name, type, dept/faculty codes');

  return { errors, programmeId };
}

function validateAndPreview(rows) {
  const tbody = document.getElementById('preview-tbody');
  let validCount = 0;
  _validRows = [];

  tbody.innerHTML = rows.map((row, i) => {
    const { errors, programmeId } = validateRow(row, i);
    const ok = errors.length === 0;
    if (ok) { validCount++; _validRows.push({ ...row, _programmeId: programmeId }); }
    return `
      <tr class="${ok ? 'row-ok' : 'row-err'}">
        <td>${i + 1}</td>
        <td>${esc(row.full_name)}</td>
        <td><code>${esc(row.index_number)}</code></td>
        <td>${esc(row.email)}</td>
        <td>${esc(row.phone)}</td>
        <td>${esc(row.level)}</td>
        <td>${esc(row.programme_name)}</td>
        <td>${esc(row.department_code)}</td>
        <td>${esc(row.faculty_code)}</td>
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
  confirmBtn.textContent = `Import ${validCount} Valid Student${validCount !== 1 ? 's' : ''}`;
  confirmBtn.disabled = validCount === 0;
}

// ── Import ────────────────────────────────────────────────────────────────────

async function callCreateUser(payload) {
  const session = await getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create user');
  return json;
}

document.getElementById('confirm-import-btn').addEventListener('click', async () => {
  if (_validRows.length === 0) return;

  const btn = document.getElementById('confirm-import-btn');
  btn.disabled = true;

  const progressWrap  = document.getElementById('import-progress-wrap');
  const progressBar   = document.getElementById('import-progress-bar');
  const progressLabel = document.getElementById('import-progress-label');
  const resultEl      = document.getElementById('import-result');
  progressWrap.style.display = '';

  let successCount = 0;
  let failCount    = 0;
  const failures   = [];

  for (let i = 0; i < _validRows.length; i++) {
    const row = _validRows[i];
    const pct = Math.round(((i + 1) / _validRows.length) * 100);
    progressBar.style.width = pct + '%';
    progressLabel.textContent = `Creating account ${i + 1} of ${_validRows.length} — ${esc(row.full_name)}…`;

    try {
      await callCreateUser({
        email:          row.email.trim(),
        password:       generateDefaultPassword(row.index_number.trim()),
        role:           'student',
        full_name:      row.full_name.trim(),
        phone:          row.phone.trim(),
        index_number:   row.index_number.trim(),
        programme_id:   row._programmeId,
        level:          row.level.trim(),
        programme_name: row.programme_name?.trim(),
        department_name: '',
      });
      successCount++;
    } catch (err) {
      failCount++;
      failures.push({ index: row.index_number, error: err.message });
    }
  }

  await writeAuditLog('bulk_import_students', 'students', 'batch', { total: _validRows.length, success: successCount, failed: failCount });

  progressWrap.style.display = 'none';
  resultEl.style.display = '';
  resultEl.innerHTML = `
    <div class="alert ${failCount === 0 ? 'alert-success' : 'alert-warning'}" style="margin-bottom:var(--space-md);">
      <strong>${successCount} account${successCount !== 1 ? 's' : ''} created successfully.</strong>
      ${failCount > 0 ? ` ${failCount} failed.` : ''}
    </div>
    ${failCount > 0 ? `<details><summary style="font-size:13px;cursor:pointer;">Show failures</summary><pre style="font-size:11px;margin-top:8px;">${esc(JSON.stringify(failures, null, 2))}</pre></details>` : ''}
    <p style="font-size:13px;color:var(--text-secondary);margin-top:var(--space-md);">
      Default password formula: <code style="background:var(--bg-page);padding:2px 6px;border-radius:4px;">[IndexNumber with slashes removed]@IAMS</code>
    </p>`;

  showToast(`Import complete: ${successCount} created, ${failCount} failed`, failCount === 0 ? 'success' : 'info');
  btn.textContent = 'Import Complete';
});

// ── Directory ─────────────────────────────────────────────────────────────────

let _allStudents = [];
let _dirLoaded   = false;

async function loadDirectory() {
  if (_dirLoaded) return;
  _dirLoaded = true;

  const { data, error } = await listStudents();
  if (error) { showToast('Failed to load students', 'error'); return; }
  _allStudents = data ?? [];

  // Populate filter selects
  const faculties = [...new Set(_allStudents.filter(s => s.faculty_name).map(s => `${s.faculty_id}||${s.faculty_name}`))];
  document.getElementById('dir-faculty').innerHTML = `<option value="">All faculties</option>` +
    faculties.map(f => { const [id, name] = f.split('||'); return `<option value="${esc(id)}">${esc(name)}</option>`; }).join('');

  renderDirectory();

  ['dir-search','dir-faculty','dir-dept','dir-prog','dir-level'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      if (id === 'dir-faculty') updateDeptFilter();
      renderDirectory();
    });
  });
}

function updateDeptFilter() {
  const facultyId = document.getElementById('dir-faculty').value;
  const depts = [...new Set(_allStudents.filter(s => (!facultyId || s.faculty_id === facultyId) && s.department_name).map(s => `${s.department_id}||${s.department_name}`))];
  document.getElementById('dir-dept').innerHTML = `<option value="">All departments</option>` +
    depts.map(d => { const [id, name] = d.split('||'); return `<option value="${esc(id)}">${esc(name)}</option>`; }).join('');
  document.getElementById('dir-prog').innerHTML = `<option value="">All programmes</option>`;
}

function renderDirectory() {
  const search     = document.getElementById('dir-search').value;
  const facultyId  = document.getElementById('dir-faculty').value;
  const deptId     = document.getElementById('dir-dept').value;
  const progId     = document.getElementById('dir-prog').value;
  const level      = document.getElementById('dir-level').value;

  const filtered = filterStudents(_allStudents, { faculty_id: facultyId, department_id: deptId, programme_id: progId, level, search });

  const tbody = document.getElementById('dir-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:32px;color:var(--text-muted);">No students found</td></tr>`;
  } else {
    tbody.innerHTML = filtered.slice(0, 200).map(s => `
      <tr>
        <td><code style="font-size:12px;">${esc(s.index_number)}</code></td>
        <td style="font-weight:500;">${esc(s.full_name)}</td>
        <td>${esc(s.programme_name ?? s.programme ?? '—')} <span style="color:var(--text-muted);font-size:11px;">${esc(s.programme_type ?? '')}</span></td>
        <td>${esc(s.department_code ?? '—')}</td>
        <td>${esc(s.level ?? '—')}</td>
        <td><span class="badge ${s.is_active !== false ? 'badge-green' : 'badge-gray'}">${s.is_active !== false ? 'Active' : 'Inactive'}</span></td>
        <td>${esc(formatDate(s.created_at))}</td>
      </tr>`).join('');
  }

  document.getElementById('dir-pagination').textContent =
    `Showing ${Math.min(filtered.length, 200)} of ${filtered.length} student${filtered.length !== 1 ? 's' : ''}`;
}
