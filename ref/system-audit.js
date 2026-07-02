// =============================================================================
// IAMS — super_admin/system-audit/system-audit.js
// Read-only, filterable audit log of all super_admin actions.
// =============================================================================

import { requireRole }          from '/modules/auth/auth-guard.js';
import { initShell, showToast } from '/shell/nav.js';
import { supabase }             from '/shared/supabase-client.js';
import { formatDate }           from '/shared/utils.js';

await requireRole(['super_admin']);
await initShell('system-audit');

document.getElementById('page-loading').classList.add('hidden');
document.getElementById('page-body').classList.remove('hidden');

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Load data ─────────────────────────────────────────────────────────────────

let _entries = [];

async function loadAudit() {
  const { data, error } = await supabase
    .from('super_admin_audit')
    .select('id, action, target_type, target_id, detail, created_at, actor:profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) { showToast('Failed to load audit log', 'error'); return; }
  _entries = data ?? [];
  renderTable();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTable() {
  const from       = document.getElementById('filter-from').value;
  const to         = document.getElementById('filter-to').value;
  const action     = document.getElementById('filter-action').value;
  const targetType = document.getElementById('filter-target').value;

  let filtered = _entries;
  if (from)       filtered = filtered.filter(e => e.created_at >= from);
  if (to)         filtered = filtered.filter(e => e.created_at <= to + 'T23:59:59');
  if (action)     filtered = filtered.filter(e => e.action === action);
  if (targetType) filtered = filtered.filter(e => e.target_type === targetType);

  const tbody = document.getElementById('audit-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text-muted);">No entries found</td></tr>`;
    document.getElementById('audit-pagination').textContent = '';
    return;
  }

  tbody.innerHTML = filtered.slice(0, 200).map(e => {
    const detail = e.detail ? JSON.stringify(e.detail) : '—';
    return `
      <tr>
        <td style="white-space:nowrap;font-size:12px;">${esc(formatDateTime(e.created_at))}</td>
        <td style="font-weight:500;">${esc(e.actor?.full_name ?? 'System')}</td>
        <td><code style="font-size:12px;background:var(--bg-page);padding:2px 6px;border-radius:4px;">${esc(e.action)}</code></td>
        <td>${esc(e.target_type ?? '—')}</td>
        <td style="font-size:12px;color:var(--text-muted);">${esc(e.target_id ?? '—')}</td>
        <td class="detail-cell"><code title="${esc(detail)}">${esc(detail.length > 80 ? detail.slice(0, 80) + '…' : detail)}</code></td>
      </tr>`;
  }).join('');

  document.getElementById('audit-pagination').textContent =
    `Showing ${Math.min(filtered.length, 200)} of ${filtered.length} entr${filtered.length !== 1 ? 'ies' : 'y'}`;
}

// ── Filter controls ───────────────────────────────────────────────────────────

['filter-from', 'filter-to', 'filter-action', 'filter-target'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderTable);
});

document.getElementById('filter-clear-btn').addEventListener('click', () => {
  document.getElementById('filter-from').value   = '';
  document.getElementById('filter-to').value     = '';
  document.getElementById('filter-action').value = '';
  document.getElementById('filter-target').value = '';
  renderTable();
});

await loadAudit();
