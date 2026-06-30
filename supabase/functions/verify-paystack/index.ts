import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Server-side price list. The amount the client thinks it's paying never
// reaches this function — only the Paystack reference does. We look up what
// that reference should be worth, then check Paystack's own record of the
// transaction against it. Keep in sync with PAYMENT_FEES_PESEWAS in
// src/shared/services/payments.service.js (that copy only drives the UI).
const EXPECTED_AMOUNTS_PESEWAS: Record<string, number> = {
  logbook_access: 2000,      // GH¢ 20.00
  attachment_report: 5000,   // GH¢ 50.00
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { reference, student_id, season_id, purpose } = await req.json();

    if (!reference || !student_id || !season_id || !purpose) {
      return jsonResponse({ error: "Missing required parameters" }, 400);
    }
    if (!(purpose in EXPECTED_AMOUNTS_PESEWAS)) {
      return jsonResponse({ error: `Unknown purpose: ${purpose}` }, 400);
    }

    const expectedAmount = EXPECTED_AMOUNTS_PESEWAS[purpose];
    const mockMode = (Deno.env.get("PAYSTACK_MOCK_MODE") ?? "false").toLowerCase() === "true";
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");

    let verifiedStatus: "confirmed" | "failed";
    let verifiedAmount = expectedAmount;
    let failureReason = "";

    if (mockMode) {
      // Explicit opt-in only — never the implicit default. Local dev only.
      verifiedStatus = "confirmed";
    } else {
      if (!paystackSecret) {
        // Loud failure instead of the old silent "pretend it worked" path.
        console.error("PAYSTACK_SECRET_KEY is not set and PAYSTACK_MOCK_MODE is not enabled.");
        return jsonResponse({ error: "Payment verification is not configured on the server." }, 500);
      }

      const psRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      });
      const psData = await psRes.json();

      const txSucceeded = psRes.ok && psData?.status === true && psData?.data?.status === "success";
      const amountMatches = psData?.data?.amount === expectedAmount;
      const currencyMatches = psData?.data?.currency === "GHS";

      if (txSucceeded && amountMatches && currencyMatches) {
        verifiedStatus = "confirmed";
        verifiedAmount = psData.data.amount;
      } else {
        verifiedStatus = "failed";
        failureReason = !txSucceeded
          ? "Paystack reported the transaction as unsuccessful."
          : "Amount or currency did not match the expected fee for this purpose.";
        console.warn(`Payment verification failed for ref ${reference}: ${failureReason}`);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from("payments")
      .upsert({
        student_id,
        season_id,
        purpose,
        amount_pesewas: verifiedAmount,
        currency: "GHS",
        status: verifiedStatus,
        paystack_reference: reference,
        paid_at: verifiedStatus === "confirmed" ? new Date().toISOString() : null,
      }, { onConflict: "student_id,season_id,purpose" })
      .select()
      .single();

    if (error) {
      // unique_violation on paystack_reference = someone tried to replay a
      // reference already attached to a different student/season/purpose row.
      if (error.code === "23505" && error.message?.includes("paystack_reference")) {
        return jsonResponse({ error: "This payment reference has already been used." }, 409);
      }
      throw error;
    }

    if (verifiedStatus === "failed") {
      return jsonResponse({ success: false, error: failureReason, data }, 400);
    }

    return jsonResponse({ success: true, data });
  } catch (err) {
    console.error("Verification error:", err);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
});
