import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';

async function init() {
  await requireRole(['company_supervisor']);
  await initShell();
}
init();
