import { requireRole } from '/modules/auth/auth-guard.js';
import { initShell }   from '/shell/nav.js';

async function init() {
  await requireRole(['school_supervisor']);
  await initShell();
}
init();
