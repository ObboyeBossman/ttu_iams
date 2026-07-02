#!/usr/bin/env node
// =============================================================================
// seed-superadmin.mjs — creates the super_admin auth user + profile row
// Usage: node scripts/seed-superadmin.mjs
// =============================================================================

import { createClient } from '@supabase/supabase-js';

// ---------- Config -----------------------------------------------------------

const SUPABASE_URL  = 'https://ocugyniwzbsprruwjaaf.supabase.co';
const SA_EMAIL      = 'superadmin@ttu.edu.gh';
const SA_PASSWORD   = 'SuperAdmin@IAMS2025';
const SA_FULL_NAME  = 'System Super Admin';
const SA_PHONE      = '+233200000000';

// ---------- Bootstrap --------------------------------------------------------

// Service key retrieved at run-time via the CLI to avoid storing it in source
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('❌  SUPABASE_SERVICE_ROLE_KEY env var is required.');
  console.error('    Run: SUPABASE_SERVICE_ROLE_KEY=$(supabase projects api-keys --project-ref ocugyniwzbsprruwjaaf | grep service_role | awk \'{print $NF}\') node scripts/seed-superadmin.mjs');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- Main -------------------------------------------------------------

async function seed() {
  console.log('🔧  Seeding super_admin account…');

  // 1. Check if user already exists
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'super_admin')
    .maybeSingle();

  if (existing) {
    console.log('✅  super_admin profile already exists — skipping.');
    return;
  }

  // 2. Create auth user
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email:          SA_EMAIL,
    password:       SA_PASSWORD,
    email_confirm:  true,
  });

  if (authErr) {
    if (authErr.message?.includes('already registered')) {
      console.log('ℹ️   Auth user already exists. Fetching id…');
      const { data: users } = await admin.auth.admin.listUsers();
      const existing = users?.users?.find(u => u.email === SA_EMAIL);
      if (!existing) { console.error('❌  Could not find existing user.'); process.exit(1); }
      await upsertProfile(existing.id);
      return;
    }
    console.error('❌  Failed to create auth user:', authErr.message);
    process.exit(1);
  }

  await upsertProfile(authData.user.id);
}

async function upsertProfile(userId) {
  const { error: profErr } = await admin.from('profiles').upsert({
    id:        userId,
    role:      'super_admin',
    full_name: SA_FULL_NAME,
    phone:     SA_PHONE,
    is_active: true,
  }, { onConflict: 'id' });

  if (profErr) {
    console.error('❌  Failed to upsert profile:', profErr.message);
    process.exit(1);
  }

  console.log('');
  console.log('✅  Super Admin seeded successfully!');
  console.log('');
  console.log('   Email   :', SA_EMAIL);
  console.log('   Password:', SA_PASSWORD);
  console.log('   Role    : super_admin');
  console.log('');
  console.log('   👉  Navigate to: http://localhost:5173/src/modules/super_admin/dashboard/dashboard.html');
}

seed().catch(err => { console.error('Unexpected error:', err); process.exit(1); });
