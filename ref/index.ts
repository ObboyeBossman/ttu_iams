// =============================================================================
// IAMS — supabase/functions/create-user/index.ts
// Creates an auth user + profile row (+ optional role-specific row) on
// behalf of a verified super_admin. The service role key never leaves the
// server — clients only pass their own JWT, which is re-verified here.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── 1. Verify caller is a super_admin ──────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await anonClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerProfile, error: profileError } = await anonClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || callerProfile?.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: super_admin only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 2. Parse body ──────────────────────────────────────────────────────
    const body = await req.json()
    const {
      email,
      password,
      role,
      full_name,
      phone,
      // student-specific
      index_number,
      programme_id,
      level,
      programme_name,
      department_name,
      // school_supervisor-specific
      staff_id,
      // company_supervisor-specific
      company_name,
      company_phone,
    } = body

    if (!email || !password || !role || !full_name || !phone) {
      return new Response(JSON.stringify({ error: 'Missing required fields: email, password, role, full_name, phone' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const validRoles = ['student', 'admin', 'school_supervisor', 'company_supervisor']
    if (!validRoles.includes(role)) {
      return new Response(JSON.stringify({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 3. Create auth user via service role ───────────────────────────────
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createError) throw createError

    const newUserId = newUser.user.id

    // ── 4. Insert public.profiles row ──────────────────────────────────────
    const { error: pErr } = await adminClient.from('profiles').insert({
      id:        newUserId,
      role,
      full_name,
      phone,
      is_active: true,
    })
    if (pErr) {
      // Rollback auth user if profile insert fails
      await adminClient.auth.admin.deleteUser(newUserId)
      throw pErr
    }

    // ── 5. Insert role-specific row ────────────────────────────────────────
    if (role === 'student') {
      if (!index_number) {
        await adminClient.auth.admin.deleteUser(newUserId)
        return new Response(JSON.stringify({ error: 'index_number is required for student role' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { error: sErr } = await adminClient.from('students').insert({
        id:           newUserId,
        index_number,
        programme_id: programme_id ?? null,
        level:        level ?? null,
        // Deprecated text fields — kept populated during transition
        department:   department_name ?? '',
        programme:    programme_name ?? '',
      })
      if (sErr) {
        await adminClient.auth.admin.deleteUser(newUserId)
        throw sErr
      }
    }

    if (role === 'school_supervisor') {
      const { error: ssErr } = await adminClient.from('school_supervisors').insert({
        id:       newUserId,
        staff_id: staff_id ?? null,
      })
      if (ssErr) {
        // school_supervisors table may not have extra fields — soft-fail
        console.warn('school_supervisors insert warning:', ssErr.message)
      }
    }

    if (role === 'company_supervisor') {
      const { error: csErr } = await adminClient.from('company_supervisors').insert({
        id:            newUserId,
        company_name:  company_name ?? null,
        company_phone: company_phone ?? null,
      })
      if (csErr) {
        console.warn('company_supervisors insert warning:', csErr.message)
      }
    }

    // ── 6. Return ──────────────────────────────────────────────────────────
    return new Response(JSON.stringify({ user_id: newUserId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('create-user error:', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
