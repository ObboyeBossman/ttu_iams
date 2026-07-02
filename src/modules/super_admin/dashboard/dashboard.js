// =============================================================================
// IAMS — super_admin/dashboard/dashboard.js
// Platform-wide snapshot: users, seasons, institutional completeness, audit log.
// =============================================================================

import { requireRole }                    from '/modules/auth/auth-guard.js';
import { initShell, showToast }           from '/shell/nav.js';
import { supabase }                       from '/shared/supabase-client.js';
import { formatDate, timeAgo }            from '/shared/utils.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

await requireRole(['super_admin']);
await initShell('dashboard');

document.getElementById('page-loading').classList.add('hidden');
document.getElementById('page-body').classList.remove('hidden');

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Status badge helper ───────────────────────────────────────────────────────

function statusBadge(status) {
  const map = {
    upcoming: 'badge-pending',
    open:     'badge-green',
    closed:   'badge-amber',
    archived: 'badge-gray',
  };
  return `<span class="badge ${map[status] ?? 'badge-gray'}">${esc(status)}</span>`;
}

// ── Fetch all data in parallel ────────────────────────────────────────────────

const [
  profilesRes,
  studentsRes,
  supervisorsRes,
  seasonsRes,
  paymentsRes,
  lettersRes,
  placementsRes,
  facultiesRes,
  departmentsRes,
  programmesRes,
  auditRes,
] = await Promise.all([
  supabase.from('profiles').select('role'),
  supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
  supabase.from('profiles').select('id', { count: 'exact', head: true }).in('role', ['school_supervisor','company_supervisor']),
  supabase.from('seasons').select('id, name, status, start_date, end_date, placements(count)').order('start_date', { ascending: false }),
  supabase.from('payments').select('amount_pesewas').eq('status', 'confirmed'),
  supabase.from('letters').select('id', { count: 'exact', head: true }),
  supabase.from('placements').select('id', { count: 'exact', head: true }).eq('status', 'flagged'),
  supabase.from('faculties').select('id', { count: 'exact', head: true }),
  supabase.from('departments').select('id', { count: 'exact', head: true }),
  supabase.from('programmes').select('id', { count: 'exact', head: true }),
  supabase.from('super_admin_audit')
    .select('id, action, target_type, created_at, actor:profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(20),
]);

// ── Stat cards ────────────────────────────────────────────────────────────────

const profiles = profilesRes.data ?? [];
const totalUsers    = profiles.length;
const totalStudents = studentsRes.count ?? 0;
const totalSupervisors = supervisorsRes.count ?? 0;
const totalAdmins   = profiles.filter(p => p.role === 'admin').length;
const totalSeasons  = (seasonsRes.data ?? []).length;
const totalPlacements = (seasonsRes.data ?? []).reduce((sum, s) => sum + (s.placements?.[0]?.count ?? 0), 0);
const totalLetters  = lettersRes.count ?? 0;
const totalPaymentsGHS = (paymentsRes.data ?? []).reduce((sum, p) => sum + (p.amount_pesewas ?? 0), 0) / 100;

const stats = [
  { label: 'Total Users',      value: totalUsers,                       accent: 'accent-blue' },
  { label: 'Students',         value: totalStudents,                    accent: 'accent-blue' },
  { label: 'Admins',           value: totalAdmins,                      accent: 'accent-gold' },
  { label: 'Supervisors',      value: totalSupervisors,                 accent: 'accent-gold' },
  { label: 'Seasons',          value: totalSeasons,                     accent: 'accent-green' },
  { label: 'Placements',       value: totalPlacements,                  accent: 'accent-green' },
  { label: 'Letters Generated',value: totalLetters,                     accent: 'accent-red', sub: `${lettersRes.count ?? 0} total` },
  { label: 'Total Payments',   value: `GH¢ ${totalPaymentsGHS.toFixed(0)}`, accent: 'accent-red', isText: true },
];

document.getElementById('stat-grid').innerHTML = stats.map(s => `
  <div class="sa-stat-card ${s.accent}">
    <span class="sa-stat-label">${esc(s.label)}</span>
    <span class="sa-stat-value">${s.isText ? esc(s.value) : esc(String(s.value))}</span>
    ${s.sub ? `<span class="sa-stat-sub">${esc(s.sub)}</span>` : ''}
  </div>
`).join('');

// ── Institutional structure counts ────────────────────────────────────────────

document.getElementById('struct-grid').innerHTML = `
  <div class="struct-item">
    <div class="struct-item-count">${esc(String(facultiesRes.count ?? 0))}</div>
    <div class="struct-item-label">Faculties</div>
  </div>
  <div class="struct-item">
    <div class="struct-item-count">${esc(String(departmentsRes.count ?? 0))}</div>
    <div class="struct-item-label">Departments</div>
  </div>
  <div class="struct-item">
    <div class="struct-item-count">${esc(String(programmesRes.count ?? 0))}</div>
    <div class="struct-item-label">Programmes</div>
  </div>
`;

// ── Seasons table ─────────────────────────────────────────────────────────────

const seasons = seasonsRes.data ?? [];
const seasonsTbody = document.getElementById('seasons-tbody');
if (seasons.length === 0) {
  seasonsTbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:32px;color:var(--text-muted);">No seasons yet</td></tr>`;
} else {
  seasonsTbody.innerHTML = seasons.map(s => `
    <tr>
      <td style="font-weight:500;">${esc(s.name)}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${esc(String(s.placements?.[0]?.count ?? 0))}</td>
      <td>${esc(formatDate(s.start_date))}</td>
      <td>${esc(formatDate(s.end_date))}</td>
    </tr>
  `).join('');
}

// ── Audit log ─────────────────────────────────────────────────────────────────

const auditEntries = auditRes.data ?? [];
const auditList = document.getElementById('audit-list');
if (auditEntries.length === 0) {
  auditList.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No audit entries yet.</p>`;
} else {
  auditList.innerHTML = auditEntries.map(e => `
    <div class="audit-row">
      <span class="audit-actor">${esc(e.actor?.full_name ?? 'System')}</span>
      <span class="audit-action">${esc(e.action)}${e.target_type ? ` <span style="color:var(--text-muted);">${esc(e.target_type)}</span>` : ''}</span>
      <span class="audit-time">${esc(timeAgo(e.created_at))}</span>
    </div>
  `).join('');
}

// ── Flagged placements alert ──────────────────────────────────────────────────

const flagged = placementsRes.count ?? 0;
if (flagged > 0) {
  showToast(`${flagged} placement${flagged === 1 ? '' : 's'} currently flagged`, 'info');
}
