// =============================================================================
// IAMS — src/modules/admin_portal/letters-audit.js
// Read-only audit log of all letters generated.
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { listSeasons } from '/shared/services/seasons.js';
import { listLettersForSeason, listLetters } from '/shared/services/letters.js';
import { showToast, formatDateTime } from '/shared/utils.js';

// ── State ─────────────────────────────────────────────────────────────────────
let seasons      = [];
let activeSeason = null; // null means 'All Seasons'
let letters      = [];

// ── DOM ───────────────────────────────────────────────────────────────────────
const pageLoading  = document.getElementById('page-loading');
const seasonFilter = document.getElementById('season-filter');
const tbody        = document.getElementById('letters-tbody');
const totalLabel   = document.getElementById('total-letters');

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Loaders ───────────────────────────────────────────────────────────────────
async function loadFilters() {
  const { data } = await listSeasons();
  seasons = data ?? [];

  if (seasons.length > 0) {
    seasonFilter.innerHTML = '<option value="all">All Seasons</option>' + 
      seasons.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    seasonFilter.disabled = false;
    // Default to 'all' or active if desired, let's just stick to 'all' for audit
    activeSeason = 'all';
    seasonFilter.value = 'all';
  } else {
    seasonFilter.innerHTML = '<option value="">No seasons found</option>';
  }
}

async function loadLetters() {
  tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:40px">Loading…</td></tr>';
  
  const { data, error } = activeSeason === 'all' 
    ? await listLetters() 
    : await listLettersForSeason(activeSeason);

  if (error) {
    showToast('Failed to load letters: ' + error.message, 'error');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger" style="padding:40px">Error loading data</td></tr>';
    totalLabel.textContent = '0';
    return;
  }

  letters = data ?? [];
  totalLabel.textContent = letters.length;
  renderTable();
}

function renderTable() {
  if (letters.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:40px">No letters found.</td></tr>`;
    return;
  }

  tbody.innerHTML = letters.map(l => {
    const location = [l.city_town, l.region].filter(Boolean).join(', ');
    return `
      <tr>
        <td>${formatDateTime(l.generated_at)}</td>
        <td><span style="font-family:monospace">${esc(l.student_id.substring(0,8))}...</span></td>
        <td style="font-weight:500">${esc(l.company_name)}</td>
        <td style="font-size:13px;color:var(--text-secondary)">${esc(location)}</td>
        <td><code class="code-pill">${esc(l.verification_code)}</code></td>
      </tr>
    `;
  }).join('');
}

// ── Event Handlers ────────────────────────────────────────────────────────────
seasonFilter.addEventListener('change', async (e) => {
  activeSeason = e.target.value;
  await loadLetters();
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await requireRole(['admin']);
  await initShell();
  
  await loadFilters();
  await loadLetters();
  
  pageLoading.style.display = 'none';
}

init();
