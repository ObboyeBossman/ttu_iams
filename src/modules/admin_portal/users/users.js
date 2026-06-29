// =============================================================================
// IAMS — src/modules/admin/users/users.js
// =============================================================================

import { requireRole, getCurrentUserId } from '../../auth/auth-guard.js';
import { initShell, navigateTo, setTabs, showToast } from '/shell/nav.js';
import { supabase } from '/shared/supabase-client.js';
import { formatDate } from '/shared/utils.js';

// ── 1. Init ────────────────────────────────────────────────────────────
await requireRole(['admin']);
await initShell('users');

// ── 4. Tab Definitions ───────────────────────────────────────────────────────
const TABS = [
  { page: 'overview', label: 'Overview' },
  { page: 'students-dir', label: 'Students Directory' },
  { page: 'admins-dir', label: 'Admins Directory' },
  { page: 'school-sups', label: 'School Supervisors Directory', disabled: true, badge: 'Phase 2' },
  { page: 'company-sups', label: 'Company Supervisors Directory', disabled: true, badge: 'Phase 2' }
];

// Extend setTabs to handle disabled state and badges
function initTabs() {
  const container = document.getElementById('shell-topbarTabs');
  if (!container) return;

  container.innerHTML = '';
  TABS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    if (t.disabled) {
      btn.classList.add('disabled');
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
    btn.setAttribute('data-tab', t.page);
    
    const label = document.createElement('span');
    label.textContent = t.label;
    btn.appendChild(label);

    if (t.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-gold';
      badge.style.marginLeft = '8px';
      badge.style.fontSize = '10px';
      badge.textContent = t.badge;
      btn.appendChild(badge);
    }

    if (!t.disabled) {
      btn.addEventListener('click', () => switchTab(t.page));
    }
    container.appendChild(btn);
  });
  container.classList.remove('hidden');
}

// ── 5. State Management ──────────────────────────────────────────────────────
let _activeTab = 'overview';
let _users = []; // Cached users for the current directory tab
let _selectedUser = null;
let _currentRole = null;

// ── 6. Tab Navigation ────────────────────────────────────────────────────────
function switchTab(tabKey) {
  _activeTab = tabKey;
  _selectedUser = null;
  
  // Update UI active state
  document.querySelectorAll('#shell-topbarTabs .tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey);
  });

  // Toggle views
  const isOverview = tabKey === 'overview';
  document.getElementById('tab-overview').style.display = isOverview ? 'block' : 'none';
  document.getElementById('tab-directory').style.display = isOverview ? 'none' : 'block';

  if (isOverview) {
    loadOverview();
  } else {
    _currentRole = tabKey === 'students-dir' ? 'student' : 'admin';
    loadDirectory(_currentRole);
  }
}

// ── 7. Data Loading ──────────────────────────────────────────────────────────

async function loadOverview() {
  const statsGrid = document.getElementById('users-stats-grid');
  statsGrid.innerHTML = '<div class="skeleton skel-card" style="height:100px;"></div>'.repeat(4);

  const { data: stats } = await supabase.rpc('get_user_stats'); 
  // Fallback if RPC doesn't exist
  let studentsCount = 0, adminsCount = 0, schoolSupsCount = 0, companySupsCount = 0;
  
  const { count: sCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student');
  const { count: aCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'admin');
  const { count: ssCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'school_supervisor');
  const { count: csCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'company_supervisor');

  studentsCount = sCount || 0;
  adminsCount = aCount || 0;
  schoolSupsCount = ssCount || 0;
  companySupsCount = csCount || 0;

  statsGrid.innerHTML = `
    <div class="card metric-card">
      <div class="sec-label">Total Users</div>
      <div style="font-size:var(--text-display);font-weight:700;">${studentsCount + adminsCount + schoolSupsCount + companySupsCount}</div>
    </div>
    <div class="card metric-card">
      <div class="sec-label">Students</div>
      <div style="font-size:var(--text-display);font-weight:700;color:var(--ttu-blue);">${studentsCount}</div>
    </div>
    <div class="card metric-card">
      <div class="sec-label">Admins</div>
      <div style="font-size:var(--text-display);font-weight:700;color:var(--green);">${adminsCount}</div>
    </div>
    <div class="card metric-card">
      <div class="sec-label">Supervisors</div>
      <div style="font-size:var(--text-display);font-weight:700;color:var(--amber);">${schoolSupsCount + companySupsCount}</div>
    </div>
  `;

  // Recent Users
  const { data: recent } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  const recentList = document.getElementById('recent-users-list');
  recentList.innerHTML = (recent || []).map(u => `
    <div style="display:flex; justify-content:space-between; padding:12px; border-bottom:1px solid var(--border-default);">
      <div>
        <div style="font-weight:600; font-size:14px;">${u.full_name}</div>
        <div style="font-size:12px; color:var(--text-secondary);">${u.role.replace('_', ' ')}</div>
      </div>
      <div style="font-size:12px; color:var(--text-secondary);">${formatDate(u.created_at)}</div>
    </div>
  `).join('');
}

async function loadDirectory(role) {
  const listEl = document.getElementById('user-directory-list');
  listEl.innerHTML = '<div class="skeleton-list" style="padding:16px;"><div class="skeleton skel-text" style="margin-bottom:12px;"></div></div>';
  
  let query = supabase.from('profiles').select('*').eq('role', role).order('full_name');
  
  if (role === 'student') {
    // Join with students table for extra fields
    const { data, error } = await supabase
      .from('student_profiles')
      .select('*')
      .order('full_name');
    _users = data || [];
  } else {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', role)
      .order('full_name');
    _users = data || [];
  }

  renderUserList(_users);
  renderDetails(null);
}

// ── 8. Rendering ─────────────────────────────────────────────────────────────

function renderUserList(users) {
  const listEl = document.getElementById('user-directory-list');
  if (!users.length) {
    listEl.innerHTML = '<div style="padding:32px; text-align:center; color:var(--text-secondary);">No users found.</div>';
    return;
  }

  listEl.innerHTML = users.map(u => `
    <div class="user-item" data-id="${u.id}">
      <div class="user-item-name">${u.full_name}</div>
      <div class="user-item-sub">${u.email || u.index_number || u.phone}</div>
    </div>
  `).join('');

  // Click handlers
  listEl.querySelectorAll('.user-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.user-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      const user = users.find(u => u.id === el.dataset.id);
      renderDetails(user);
    });
  });
}

function renderDetails(user) {
  const panel = document.getElementById('user-details-panel');
  if (!user) {
    panel.innerHTML = `
      <div class="details-empty">
        <i data-lucide="user" style="width:48px; height:48px; margin-bottom:16px; opacity:0.2;"></i>
        <p>Select a user to view details.</p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const isStudent = user.role === 'student';
  
  panel.innerHTML = `
    <div class="details-card card">
      <div class="details-header">
        <div>
          <h2 style="margin:0 0 4px 0;">${user.full_name}</h2>
          <span class="badge ${isStudent ? 'badge-blue' : 'badge-green'}">${user.role.replace('_', ' ')}</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-sm btn-outline" onclick="alert('Placeholder: Edit')">Edit User</button>
          <button class="btn btn-sm btn-ghost" onclick="alert('Placeholder: Reset')">Reset Password</button>
        </div>
      </div>

      <div class="details-grid">
        <div>
          <div class="details-group-label">Contact Information</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div>
              <div style="font-size:12px; color:var(--text-secondary);">Email Address</div>
              <div class="details-value">${user.email || '—'}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--text-secondary);">Phone Number</div>
              <div class="details-value">${user.phone || '—'}</div>
            </div>
          </div>
        </div>

        ${isStudent ? `
        <div>
          <div class="details-group-label">Academic Details</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div>
              <div style="font-size:12px; color:var(--text-secondary);">Index Number</div>
              <div class="details-value">${user.index_number}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--text-secondary);">Programme</div>
              <div class="details-value">${user.programme}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--text-secondary);">Department</div>
              <div class="details-value">${user.department}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--text-secondary);">Level</div>
              <div class="details-value">${user.level}</div>
            </div>
          </div>
        </div>
        ` : ''}

        <div>
          <div class="details-group-label">Account Meta</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div>
              <div style="font-size:12px; color:var(--text-secondary);">Status</div>
              <div class="details-value">Active</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--text-secondary);">Member Since</div>
              <div class="details-value">${formatDate(user.created_at)}</div>
            </div>
          </div>
        </div>
      </div>

      <div style="padding-top:24px; border-top:1px solid var(--border-default); display:flex; justify-content:flex-end;">
        <button class="btn btn-sm btn-danger" onclick="alert('Placeholder: Deactivate')">Deactivate User</button>
      </div>
    </div>
  `;
}

// ── 9. Interactive Elements ──────────────────────────────────────────────────
document.getElementById('user-search-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const filtered = _users.filter(u => 
    u.full_name.toLowerCase().includes(q) || 
    (u.index_number && u.index_number.toLowerCase().includes(q)) ||
    (u.email && u.email.toLowerCase().includes(q))
  );
  renderUserList(filtered);
});

// ── 10. Initialization ───────────────────────────────────────────────────────
initTabs();
switchTab('overview');

// Handle hash changes for tabs
window.addEventListener('hashchange', () => {
  const page = location.hash.replace('#', '');
  if (page === 'users' || TABS.some(t => t.page === page)) {
    const tabMatch = TABS.find(t => t.page === page && !t.disabled);
    if (tabMatch) switchTab(tabMatch.page);
  }
});
