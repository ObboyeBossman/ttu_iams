// =============================================================================
// IAMS — src/modules/admin_portal/students.js
// =============================================================================

import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';

async function init() {
  await requireRole(['admin']);
  await initShell();
}

init();
