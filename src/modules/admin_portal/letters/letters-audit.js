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
let studentsMap  = new Map(); // student_id -> profile
let groupedLetters = new Map(); // student_id -> [letters]

// ── DOM ───────────────────────────────────────────────────────────────────────
const pageLoading  = document.getElementById('page-loading');
const seasonFilter = document.getElementById('season-filter');
const tbody        = document.getElementById('letters-tbody');
const totalLabel   = document.getElementById('total-letters');
const modal        = document.getElementById('letters-modal');
const modalName    = document.getElementById('lm-student-name');
const modalTbody   = document.getElementById('lm-tbody');
const modalCloseBtns = [document.getElementById('modal-close'), document.getElementById('lm-close-btn')];

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
import { supabase } from '/shared/supabase-client.js';

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
  
  // Group letters by student_id
  groupedLetters.clear();
  letters.forEach(l => {
    if (!groupedLetters.has(l.student_id)) groupedLetters.set(l.student_id, []);
    groupedLetters.get(l.student_id).push(l);
  });
  
  const studentIds = Array.from(groupedLetters.keys());
  
  // Fetch profiles for those students
  if (studentIds.length > 0) {
    // For large datasets, we'd need pagination/chunking, but for this admin portal we just query in chunks of 200
    // Actually, let's just fetch all needed profiles using .in()
    const { data: profiles, error: pError } = await supabase
      .from('student_profiles')
      .select('id, full_name, index_number, programme, level')
      .in('id', studentIds);
      
    if (!pError && profiles) {
      profiles.forEach(p => studentsMap.set(p.id, p));
    }
  }

  renderTable();
}

function renderTable() {
  if (groupedLetters.size === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:40px">No students have generated letters.</td></tr>`;
    return;
  }

  const rows = [];
  for (const [studentId, studentLetters] of groupedLetters.entries()) {
    const profile = studentsMap.get(studentId);
    const name = profile?.full_name ?? 'Unknown Student';
    const indexNo = profile?.index_number ?? studentId.substring(0,8) + '...';
    const progLevel = profile ? `${esc(profile.programme)} (Level ${profile.level})` : '—';
    
    rows.push(`
      <tr>
        <td style="font-weight:500;color:var(--text-primary)">${esc(name)}</td>
        <td><span style="font-family:monospace;color:var(--text-secondary)">${esc(indexNo)}</span></td>
        <td style="font-size:13px;color:var(--text-secondary)">${esc(progLevel)}</td>
        <td><span class="badge badge-gray">${studentLetters.length} Letter${studentLetters.length !== 1 ? 's' : ''}</span></td>
        <td class="text-right">
          <button class="btn-sm btn-sm--secondary view-letters-btn" data-sid="${esc(studentId)}">View Letters</button>
        </td>
      </tr>
    `);
  }
  
  tbody.innerHTML = rows.join('');
  
  // Attach listeners
  tbody.querySelectorAll('.view-letters-btn').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.sid));
  });
}

function openModal(studentId) {
  const profile = studentsMap.get(studentId);
  const name = profile?.full_name ?? 'Unknown Student';
  const studentLetters = groupedLetters.get(studentId) || [];
  
  modalName.textContent = name;
  
  modalTbody.innerHTML = studentLetters.map(l => {
    const location = [l.city_town, l.region].filter(Boolean).join(', ');
    return `
      <tr>
        <td style="white-space:nowrap">${formatDateTime(l.generated_at)}</td>
        <td>
          <div style="font-weight:500;color:var(--text-primary)">${esc(l.company_name)}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${esc(location)}</div>
        </td>
        <td><code class="code-pill">${esc(l.verification_code)}</code></td>
      </tr>
    `;
  }).join('');
  
  modal.style.display = 'flex';
}

// ── Event Handlers ────────────────────────────────────────────────────────────
seasonFilter.addEventListener('change', async (e) => {
  activeSeason = e.target.value;
  await loadLetters();
});

modalCloseBtns.forEach(btn => btn?.addEventListener('click', () => {
  modal.style.display = 'none';
}));

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await requireRole(['admin']);
  await initShell();
  
  await loadFilters();
  await loadLetters();
  
  pageLoading.style.display = 'none';
}

init();
