// =============================================================================
// IAMS — shared/services/payments.service.js
// =============================================================================
// All payment reads + Paystack charge orchestration for paid features
// (logbook access, AI report generation). Pages never call supabase or
// PaystackPop directly for this — they call functions exported here.
//
// This file NEVER writes to the payments table. All writes happen inside
// the verify-paystack Edge Function (service role, bypasses RLS), only
// after it independently re-verifies the transaction with Paystack. See
// "payments: ..." policies in rls-policies.sql.
// =============================================================================

import { supabase } from '../supabase-client.js';

/** UI-side copy of pricing — the server (verify-paystack's
 *  EXPECTED_AMOUNTS_PESEWAS) is the real source of truth and is checked
 *  independently of whatever this file tells PaystackPop to charge. */
export const PAYMENT_FEES_PESEWAS = {
  logbook_access:    2000,  // GH¢ 20.00
  attachment_report: 5000,  // GH¢ 50.00
};

export function formatGHS(pesewas) {
  return `GH¢ ${(pesewas / 100).toFixed(2)}`;
}

/** True only if there's a server-confirmed payment for `purpose` in `seasonId`. Fails CLOSED on any read error — never grants access because a query errored. */
export async function hasPaid(studentId, seasonId, purpose) {
  const { data, error } = await supabase
    .from('payments')
    .select('id')
    .eq('student_id', studentId)
    .eq('season_id', seasonId)
    .eq('purpose', purpose)
    .eq('status', 'confirmed')
    .maybeSingle();

  if (error) {
    console.error(`hasPaid(${purpose}) check failed:`, error);
    return false;
  }
  return !!data;
}

/**
 * Opens the Paystack inline popup for `purpose`, then hands the resulting
 * reference to the verify-paystack Edge Function for independent
 * confirmation. Resolves true ONLY after the server confirms success —
 * the popup's own callback is never treated as proof of payment on its own.
 */
export async function initiatePayment({ studentId, seasonId, purpose, onStatusChange }) {
  const amount = PAYMENT_FEES_PESEWAS[purpose];
  const publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

  if (!publicKey) {
    onStatusChange?.('error', 'Payments are not configured yet. Contact the Liaison Office.');
    return false;
  }
  if (typeof PaystackPop === 'undefined') {
    onStatusChange?.('error', 'Payment gateway failed to load. Check your connection and retry.');
    return false;
  }

  let email = 'student@ttu.edu.gh';
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) email = user.email;
  } catch { /* keep fallback */ }

  return new Promise((resolve) => {
    const handler = PaystackPop.setup({
      key: publicKey,
      email,
      amount,
      currency: 'GHS',
      ref: `IAMS_${purpose}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      callback: async (response) => {
        onStatusChange?.('verifying');
        const { data, error } = await supabase.functions.invoke('verify-paystack', {
          body: { reference: response.reference, student_id: studentId, season_id: seasonId, purpose },
        });

        if (!error && data?.success) {
          onStatusChange?.('confirmed');
          resolve(true);
        } else {
          const msg = data?.error || error?.message ||
            `Payment could not be verified. If you were charged, contact the Liaison Office with reference ${response.reference}.`;
          onStatusChange?.('error', msg);
          resolve(false);
        }
      },
      onClose: () => {
        onStatusChange?.('cancelled');
        resolve(false);
      },
    });
    handler.openIframe();
  });
}

// ── Admin: Finance ───────────────────────────────────────────────────────────

/** Every confirmed payment, optionally filtered by season, with the paying student's name + index number joined in. Admin-only (RLS: "payments: admin reads all"). */
export async function listPaymentsForAdmin(seasonId = null) {
  let query = supabase
    .from('payments')
    .select('*')
    .eq('status', 'confirmed')
    .order('paid_at', { ascending: false });

  if (seasonId && seasonId !== 'all') query = query.eq('season_id', seasonId);

  const { data: payments, error } = await query;
  if (error || !payments) return { data: [], error };

  const studentIds = [...new Set(payments.map(p => p.student_id))];
  const studentsMap = new Map();
  if (studentIds.length > 0) {
    const { data: profiles } = await supabase
      .from('student_profiles')
      .select('id, full_name, index_number')
      .in('id', studentIds);
    (profiles ?? []).forEach(p => studentsMap.set(p.id, p));
  }

  return { data: payments.map(p => ({ ...p, student: studentsMap.get(p.student_id) ?? null })), error: null };
}

/** Aggregates an already-fetched payments array by purpose, for the Finance summary cards. Plain client-side reduce — consistent with how other admin pages here total rows they've already fetched, rather than a separate RPC. */
export function summarizePayments(payments) {
  const summary = { total: 0, count: payments.length, byPurpose: {} };
  for (const p of payments) {
    summary.total += p.amount_pesewas;
    if (!summary.byPurpose[p.purpose]) summary.byPurpose[p.purpose] = { total: 0, count: 0 };
    summary.byPurpose[p.purpose].total += p.amount_pesewas;
    summary.byPurpose[p.purpose].count += 1;
  }
  return summary;
}
