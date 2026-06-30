// =============================================================================
// IAMS — src/modules/admin_portal/finance/finance.js
// Read-only ledger of confirmed student payments (logbook access, report
// generation fees). All writes happen server-side in verify-paystack —
// this page only reads via payments.service.js.
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell } from '/shell/nav.js';
import { listSeasons } from '/shared/services/seasons.js';
import { listPaymentsForAdmin, summarizePayments, formatGHS } from '/shared/services/payments.service.js';
import { showToast, formatDateTime } from '/shared/utils.js';

// ── State ──────────────────────────────────────────────────────────────────────
let activeSeason = 'all';
let payments = [];

// ── DOM ────────────────────────────────────────────────────────────────────────
const pageLoading = document.getElementById('page-loading');
const seasonFilter = document.getElementById('season-filter');
const tbody = document.getElementById('payments-tbody');
const tableCount = document.getElementById('fin-table-count');

const PURPOSE_LABELS = {
  logbook_access: 'Logbook Access',
  attachment_report: 'Report Generation',
};

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Loaders ────────────────────────────────────────────────────────────────────
async function loadFilters() {
  const { data } = await listSeasons();
  const seasons = data ?? [];

  if (seasons.length > 0) {
    seasonFilter.innerHTML = '<option value="all">All Seasons</option>' +
      seasons.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    seasonFilter.disabled = false;
    seasonFilter.value = 'all';
  } else {
    seasonFilter.innerHTML = '<option value="">No seasons found</option>';
  }
}

async function loadPayments() {
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:40px">Loading…</td></tr>';

  const { data, error } = await listPaymentsForAdmin(activeSeason);
  if (error) {
    showToast('Failed to load payments: ' + error.message, 'error');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger" style="padding:40px">Error loading data</td></tr>';
    return;
  }

  payments = data ?? [];
  renderSummary();
  renderTable();
}

function renderSummary() {
  const summary = summarizePayments(payments);
  document.getElementById('fin-total').textContent = formatGHS(summary.total);
  document.getElementById('fin-count').textContent = summary.count;

  const lb = summary.byPurpose.logbook_access ?? { total: 0, count: 0 };
  document.getElementById('fin-logbook-total').textContent = formatGHS(lb.total);
  document.getElementById('fin-logbook-count').textContent = lb.count;

  const rep = summary.byPurpose.attachment_report ?? { total: 0, count: 0 };
  document.getElementById('fin-report-total').textContent = formatGHS(rep.total);
  document.getElementById('fin-report-count').textContent = rep.count;
}

function renderTable() {
  tableCount.textContent = payments.length;

  if (payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:40px">No confirmed payments yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = payments.map(p => {
    const name = p.student?.full_name ?? 'Unknown Student';
    const indexNo = p.student?.index_number ?? p.student_id.substring(0, 8) + '...';
    return `
      <tr>
        <td style="font-weight:500;color:var(--text-primary)">${esc(name)}</td>
        <td><span style="font-family:monospace;color:var(--text-secondary)">${esc(indexNo)}</span></td>
        <td><span class="badge badge-gray">${esc(PURPOSE_LABELS[p.purpose] ?? p.purpose)}</span></td>
        <td style="font-weight:600;color:var(--text-primary)">${formatGHS(p.amount_pesewas)}</td>
        <td><code class="code-pill">${esc(p.paystack_reference)}</code></td>
        <td class="text-right" style="white-space:nowrap">${formatDateTime(p.paid_at)}</td>
      </tr>
    `;
  }).join('');
}

// ── Event Handlers ─────────────────────────────────────────────────────────────
seasonFilter.addEventListener('change', async (e) => {
  activeSeason = e.target.value;
  await loadPayments();
});

// ── Init ────────────────────────────────────────────────────────────────────────
async function init() {
  await requireRole(['admin']);
  await initShell();

  await loadFilters();
  await loadPayments();

  pageLoading.style.display = 'none';
}

init();
