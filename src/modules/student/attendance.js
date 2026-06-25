// =============================================================================
// IAMS — src/modules/student/attendance.js  (Phase 2 — Coming Soon)
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';

async function init() {
  await requireRole(['student']);
  await initShell();

  // Show today's date in the subtitle
  const dateEl = document.getElementById('today-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-GH', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  const loading = document.getElementById('page-loading');
  if (loading) loading.style.display = 'none';
}

init();
