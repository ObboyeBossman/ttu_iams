/**
 * verify-letter
 *
 * Public endpoint for letter authenticity verification (FR2).
 *
 * A receiving company visits /verify/{code} (or scans the QR code on the
 * letter) which calls this function. It returns the letter's recorded
 * metadata — student name, company, date — so the company can confirm
 * the letter is genuine without the system ever storing the PDF itself.
 *
 * No authentication is required: the verification page is public.
 * The service-role client is used purely to bypass RLS on the letters
 * and profiles tables (the anon key + RLS would block an unauthenticated
 * request). No sensitive data (passwords, phone numbers) is returned.
 *
 * Request:  GET  /verify-letter?code=A3F9B1C2
 * Response: { found: true, letter: { ... } }  |  { found: false }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CODE_PATTERN = /^[A-Z0-9]{8}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",    // truly public — no origin restriction
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // -------------------------------------------------------------------------
  // Extract and validate the verification code from the query string.
  // -------------------------------------------------------------------------
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.toUpperCase().trim() ?? "";

  if (!CODE_PATTERN.test(code)) {
    return json(
      { found: false, error: "Invalid code format. Expected 8 uppercase letters or digits." },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // Look up the letter using the service-role client so RLS doesn't block
  // an unauthenticated caller. Only non-sensitive metadata is returned.
  // -------------------------------------------------------------------------
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: letter, error } = await serviceClient
    .from("letters")
    .select(`
      verification_code,
      company_name,
      region,
      city_town,
      street_landmark,
      generated_at,
      student:profiles!letters_student_id_fkey (
        full_name
      ),
      season:seasons!letters_season_id_fkey (
        name
      )
    `)
    .eq("verification_code", code)
    .maybeSingle();

  if (error) {
    console.error("letter lookup error:", error);
    return json({ found: false, error: "Lookup failed" }, 500);
  }

  if (!letter) {
    // Return a consistent response — do not distinguish "code not found"
    // from other failures to avoid code-enumeration attacks.
    return json({ found: false });
  }

  return json({
    found: true,
    letter: {
      verification_code: letter.verification_code,
      student_name:      (letter.student as { full_name: string } | null)?.full_name ?? "—",
      season:            (letter.season  as { name: string }       | null)?.name      ?? "—",
      company_name:      letter.company_name,
      company_address:   [letter.street_landmark, letter.city_town, letter.region]
                           .filter(Boolean)
                           .join(", "),
      generated_at:      letter.generated_at,
    },
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
