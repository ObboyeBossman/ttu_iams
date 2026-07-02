// =============================================================================
// IAMS — super_admin/system-health/system-health.js
// Cross-season aggregate read-only analytics.
// =============================================================================

import { requireRole }          from '/modules/auth/auth-guard.js';
import { initShell, showToast } from '/shell/nav.js';
import { supabase }             from '/shared/supabase-client.js';

await requireRole(['super_admin']);
await initShell('system-health');

document.getElementById('page-loading').classList.add('hidden');
document.getElementById('page-body').classList.remove('hidden');

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const statusBadge = (s) => {
  const map = { upcoming: 'badge-pending', open: 'badge-green', closed: 'badge-amber', archived: 'badge-gray' };
  return `<span class="badge ${map[s] ?? 'badge-gray'}">${esc(s)}</span>`;
};

// ── Fetch all data in parallel ────────────────────────────────────────────────

const [profilesRes, seasonsRes, paymentsRes, facultiesRes] = await Promise.all([
  supabase.from('profiles').select('role, is_active'),
  supabase.from('seasons').select('id, name, status, placements(status)').order('start_date', { ascending: false }),
  supabase.from('payments').select('season_id, purpose, amount_pesewas, status').eq('status', 'confirmed'),
  supabase.from('faculties').select(`
    name,
    departments(id, name, programmes(id, name, students(id)))
  `).order('name'),
]);

if (profilesRes.error || seasonsRes.error) {
  showToast('Failed to load some data', 'error');
}

// ── Users by role ─────────────────────────────────────────────────────────────

const profiles = profilesRes.data ?? [];
const roleGroups = {};
for (const p of profiles) {
  if (!roleGroups[p.role]) roleGroups[p.role] = { total: 0, active: 0, inactive: 0 };
  roleGroups[p.role].total++;
  if (p.is_active !== false) roleGroups[p.role].active++;
  else roleGroups[p.role].inactive++;
}

const roleOrder = ['super_admin', 'admin', 'student', 'school_supervisor', 'company_supervisor'];
document.getElementById('roles-tbody').innerHTML = roleOrder
  .filter(r => roleGroups[r])
  .map(r => {
    const g = roleGroups[r];
    return `<tr>
      <td><code style="font-size:12px;background:var(--bg-page);padding:2px 6px;border-radius:4px;">${esc(r)}</code></td>
      <td style="font-weight:600;">${g.total}</td>
      <td>${g.active}</td>
      <td>${g.inactive > 0 ? `<span style="color:var(--ttu-red);">${g.inactive}</span>` : '0'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--text-muted);">No users yet</td></tr>`;

// ── Placements by season ──────────────────────────────────────────────────────

const seasons = seasonsRes.data ?? [];
document.getElementById('placements-tbody').innerHTML = seasons.length === 0
  ? `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-muted);">No seasons yet</td></tr>`
  : seasons.map(s => {
    const pls  = s.placements ?? [];
    const count = (status) => pls.filter(p => p.status === status).length;
    return `<tr>
      <td style="font-weight:500;">${esc(s.name)}</td>
      <td>${statusBadge(s.status)}</td>
      <td style="font-weight:600;">${pls.length}</td>
      <td>${count('submitted')}</td>
      <td>${count('assigned')}</td>
      <td>${count('flagged') > 0 ? `<span style="color:var(--amber);">${count('flagged')}</span>` : 0}</td>
      <td>${count('rejected') > 0 ? `<span style="color:var(--ttu-red);">${count('rejected')}</span>` : 0}</td>
    </tr>`;
  }).join('');

// ── Payments by season ────────────────────────────────────────────────────────

const payments = paymentsRes.data ?? [];
const payBySeason = {};
for (const p of payments) {
  if (!payBySeason[p.season_id]) payBySeason[p.season_id] = { logbook: 0, report: 0, count: 0 };
  if (p.purpose === 'logbook_access')   payBySeason[p.season_id].logbook += p.amount_pesewas;
  if (p.purpose === 'attachment_report') payBySeason[p.season_id].report += p.amount_pesewas;
  payBySeason[p.season_id].count++;
}

document.getElementById('payments-tbody').innerHTML = seasons.length === 0
  ? `<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text-muted);">No seasons yet</td></tr>`
  : seasons.map(s => {
    const pb    = payBySeason[s.id] ?? { logbook: 0, report: 0, count: 0 };
    const total = (pb.logbook + pb.report) / 100;
    return `<tr>
      <td style="font-weight:500;">${esc(s.name)}</td>
      <td style="font-weight:600;">GH¢ ${total.toFixed(2)}</td>
      <td>GH¢ ${(pb.logbook / 100).toFixed(2)}</td>
      <td>GH¢ ${(pb.report / 100).toFixed(2)}</td>
      <td>${pb.count}</td>
    </tr>`;
  }).join('');

// ── Institutional summary ─────────────────────────────────────────────────────

const faculties = facultiesRes.data ?? [];
document.getElementById('institution-tbody').innerHTML = faculties.length === 0
  ? `<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--text-muted);">No faculties yet</td></tr>`
  : faculties.map(f => {
    const depts = f.departments ?? [];
    const progs = depts.flatMap(d => d.programmes ?? []);
    const studs = progs.flatMap(p => p.students ?? []);
    return `<tr>
      <td style="font-weight:500;">${esc(f.name)}</td>
      <td>${depts.length}</td>
      <td>${progs.length}</td>
      <td>${studs.length}</td>
    </tr>`;
  }).join('');
