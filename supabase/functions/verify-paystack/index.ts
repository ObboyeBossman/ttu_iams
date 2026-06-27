import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { reference, student_id, season_id } = await req.json();

    if (!reference || !student_id || !season_id) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Paystack to verify
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY") || "sk_test_mock"; // Fallback for local testing
    
    // For local mock testing when paystack is not really reachable with a fake key
    let isSuccessful = false;
    let amount = 5000; // 50 GHS in pesewas
    
    if (paystackSecret !== "sk_test_mock") {
      const psRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
        },
      });
      const psData = await psRes.json();
      
      if (psData.status && psData.data.status === "success") {
        isSuccessful = true;
        amount = psData.data.amount;
      }
    } else {
      // In dev environment, just mock success
      isSuccessful = true;
    }

    if (!isSuccessful) {
      return new Response(JSON.stringify({ error: "Payment verification failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Init Supabase Service Role client to bypass RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Update database
    const { data, error } = await supabase
      .from("attachment_payments")
      .upsert({
        student_id: student_id,
        season_id: season_id,
        status: "confirmed",
        payment_reference: reference,
        confirmed_at: new Date().toISOString()
      }, { onConflict: "student_id,season_id" })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Verification error:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
