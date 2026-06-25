/**
 * admin-create-user
 *
 * Creates a new IAMS user account atomically:
 *   1. Creates the auth.users row via auth.admin.createUser() (service role)
 *   2. Inserts the public.profiles row
 *   3. If role = 'student', inserts the public.students row
 *
 * Why an Edge Function?
 *   auth.admin.createUser() requires the service-role key, which must
 *   never be sent to the browser. Only admin callers may invoke this
 *   function — the JWT is verified and the role is checked before any
 *   write is attempted (FR1).
 *
 * Request body (JSON):
 * {
 *   email:        string           required
 *   password:     string           required (min 8 chars)
 *   full_name:    string           required
 *   phone:        string           required
 *   role:         user_role        required  ('student' | 'admin' | 'school_supervisor' | 'company_supervisor')
 *   // student-only fields (required when role = 'student'):
 *   index_number: string
 *   department:   string
 *   programme:    string
 *   level:        string
 * }
 *
 * Response: { user_id, email, role }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const VALID_ROLES = ["student", "admin", "school_supervisor", "company_supervisor"] as const;
type UserRole = typeof VALID_ROLES[number];

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return json({ ok: true }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // -------------------------------------------------------------------------
  // Authenticate caller and verify they are an admin.
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

  const { data: { user: caller }, error: authError } = await userClient.auth.getUser();
  if (authError || !caller) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Fetch caller's role from profiles.
  const { data: callerProfile, error: profileError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single();

  if (profileError || callerProfile?.role !== "admin") {
    return json({ error: "Forbidden — admin only" }, 403);
  }

  // -------------------------------------------------------------------------
  // Parse and validate request body.
  // -------------------------------------------------------------------------
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { email, password, full_name, phone, role } = body;

  if (!email || !password || !full_name || !phone || !role) {
    return json({ error: "Missing required fields: email, password, full_name, phone, role" }, 400);
  }

  if (!(VALID_ROLES as readonly string[]).includes(role)) {
    return json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, 400);
  }

  if (password.length < 8) {
    return json({ error: "Password must be at least 8 characters" }, 400);
  }

  // Student-specific validation.
  if (role === "student") {
    const { index_number, department, programme, level } = body;
    if (!index_number || !department || !programme || !level) {
      return json(
        { error: "Student accounts require: index_number, department, programme, level" },
        400,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Create the account using the service-role client.
  // -------------------------------------------------------------------------
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Step 1: Create auth.users row.
  const { data: authData, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Admin-created accounts skip the email verification step.
  });

  if (createError) {
    console.error("auth.admin.createUser error:", createError);
    // Surface friendly messages for common failures.
    if (createError.message.includes("already registered")) {
      return json({ error: "A user with that email already exists" }, 409);
    }
    return json({ error: createError.message }, 500);
  }

  const newUserId = authData.user.id;

  // Step 2: Insert profiles row.
  const { error: profileInsertError } = await serviceClient
    .from("profiles")
    .insert({ id: newUserId, role: role as UserRole, full_name, phone });

  if (profileInsertError) {
    // Roll back the auth user to avoid orphaned records.
    await serviceClient.auth.admin.deleteUser(newUserId);
    console.error("profiles insert error:", profileInsertError);
    return json({ error: "Failed to create user profile" }, 500);
  }

  // Step 3 (students only): Insert students row.
  if (role === "student") {
    const { index_number, department, programme, level } = body;
    const { error: studentInsertError } = await serviceClient
      .from("students")
      .insert({ id: newUserId, index_number, department, programme, level });

    if (studentInsertError) {
      // Roll back both the auth user and the profile row.
      await serviceClient.from("profiles").delete().eq("id", newUserId);
      await serviceClient.auth.admin.deleteUser(newUserId);
      console.error("students insert error:", studentInsertError);
      // Friendly message for duplicate index number.
      if (studentInsertError.message.includes("unique")) {
        return json({ error: `Index number '${index_number}' is already registered` }, 409);
      }
      return json({ error: "Failed to create student record" }, 500);
    }
  }

  return json({ user_id: newUserId, email, role }, 201);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
