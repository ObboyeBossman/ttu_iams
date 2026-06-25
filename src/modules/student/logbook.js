// =============================================================================
// IAMS — src/modules/student/logbook.js  (Phase 2 — Coming Soon)
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';

async function init() {
  await requireRole(['student']);
  await initShell();
  const loading = document.getElementById('page-loading');
  if (loading) loading.style.display = 'none';
}

init();
