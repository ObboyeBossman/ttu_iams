/**
 * get-letter-assets
 *
 * Returns short-lived signed URLs for the four private Supabase Storage
 * assets used in attachment letter generation:
 *   - TTU letterhead image   (ttu_letterhead.jpeg)
 *   - Official stamp image   (ttu_signature_stamp.jpeg — combined sig + stamp)
 *   - TTU footer bar image   (ttu_footer.png)
 *
 * (The legacy `signature_path` column is still read for backward compatibility
 * but `stamp_path` now maps to the combined signature+stamp asset per the
 * updated letter layout spec.)
 *
 * Why an Edge Function?
 *   These assets live in a private storage bucket. Generating signed URLs
 *   requires the service-role key, which must never be exposed client-side.
 *   The function is called once per letter generation; the URLs expire
 *   after 60 seconds — long enough to fetch the images for jsPDF but
 *   short enough to prevent lifting and reusing them to forge letters
 *   outside the system (see NFR2, FR2).
 *
 * Request:  POST (authenticated — any role)
 * Response: { letterhead_url, stamp_url, footer_url, expires_in }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const SIGNED_URL_EXPIRES_IN = 60; // seconds

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // -------------------------------------------------------------------------
  // Authenticate the caller — any logged-in user may request asset URLs.
  // We use the caller's JWT (not the service role) to verify they are
  // authenticated, then use the service role to generate signed URLs.
  // -------------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Missing Authorization header" }, 401);
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  // -------------------------------------------------------------------------
  // Use service-role client to fetch asset paths from settings and generate
  // signed URLs from the private bucket.
  // -------------------------------------------------------------------------
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Read asset storage paths from the single-row settings table.
  // footer_path was added in migration 20260626000001_settings_footer_path.
  const { data: settings, error: settingsError } = await serviceClient
    .from("settings")
    .select("letterhead_path, stamp_path, footer_path")
    .single();

  if (settingsError) {
    console.error("settings fetch error:", settingsError);
    return json({ error: "Failed to load asset settings" }, 500);
  }

  if (!settings.letterhead_path || !settings.stamp_path || !settings.footer_path) {
    return json(
      {
        error:
          "Letter assets have not been fully configured yet. " +
          "Ask the admin to upload the letterhead, stamp/signature, and footer images, " +
          "then set all three paths in Settings.",
      },
      422,
    );
  }

  // Generate short-lived signed URLs for all three assets in parallel.
  const BUCKET = "letter-assets";

  const [letterheadResult, stampResult, footerResult] = await Promise.all([
    serviceClient.storage.from(BUCKET).createSignedUrl(
      settings.letterhead_path,
      SIGNED_URL_EXPIRES_IN,
    ),
    serviceClient.storage.from(BUCKET).createSignedUrl(
      settings.stamp_path,
      SIGNED_URL_EXPIRES_IN,
    ),
    serviceClient.storage.from(BUCKET).createSignedUrl(
      settings.footer_path,
      SIGNED_URL_EXPIRES_IN,
    ),
  ]);

  const failures = [
    letterheadResult.error && "letterhead",
    stampResult.error     && "stamp",
    footerResult.error    && "footer",
  ].filter(Boolean);

  if (failures.length > 0) {
    console.error("signed URL errors:", { letterheadResult, stampResult, footerResult });
    return json({ error: `Failed to generate signed URLs for: ${failures.join(", ")}` }, 500);
  }

  return json({
    letterhead_url: letterheadResult.data!.signedUrl,
    stamp_url:      stampResult.data!.signedUrl,
    footer_url:     footerResult.data!.signedUrl,
    expires_in:     SIGNED_URL_EXPIRES_IN,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
