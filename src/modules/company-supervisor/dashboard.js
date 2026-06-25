// =============================================================================
// IAMS — src/modules/company-supervisor/dashboard.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';
import { getCurrentUser, getUserProfile } from '/shared/services/auth.service.js';

async function init() {
  await requireRole(['company_supervisor']);
  await initShell();

  const userRes = await getCurrentUser();
  const profileRes = await getUserProfile(userRes.data?.id);
  document.getElementById('welcome-msg').textContent = `Welcome, ${profileRes.data?.full_name ?? 'Supervisor'}`;

  document.getElementById('page-loading').style.display = 'none';
}

init();
