// =============================================================================
// IAMS — shared/supabase-client.js
// =============================================================================
// Single point of Supabase client construction. Per the project structure
// doc, every file in shared/services/ imports `supabase` from here and
// nothing else in the app constructs a client directly.
//
// NOTE: This module must NEVER throw at the top level. A module-level throw
// propagates to every importer and prevents any event listeners (e.g. form
// submit handlers) from being registered — causing silent failures in
// production where env vars may not be set in Vercel yet.
// =============================================================================

/**
 * A no-op stub returned when Supabase credentials are missing or the
 * SDK fails to load. Lets callers' try/catch blocks handle failures
 * gracefully instead of crashing the whole module graph.
 */
function makeStub(reason) {
  const err = { message: reason };
  return {
    from: () => ({
      select: () => ({ data: null, error: err }),
      eq:     () => ({ data: null, error: err }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: err }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: err }) }) }) }),
      order:  () => ({ data: null, error: err }),
      maybeSingle: async () => ({ data: null, error: null }),
    }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    rpc:  async () => ({ data: null, error: err }),
  };
}

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[IAMS] Supabase credentials are missing.\n' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Vercel\n' +
    'project environment variables (Settings → Environment Variables).\n' +
    'DB-dependent features will be skipped — letter generation still works.'
  );
  supabase = makeStub('No Supabase credentials configured.');
} else {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  } catch (err) {
    console.error('[IAMS] Failed to initialize Supabase client:', err);
    supabase = makeStub(err?.message ?? 'Supabase SDK failed to load.');
  }
}

export { supabase };
