// =============================================================================
// IAMS — shared/supabase-client.js
// =============================================================================
// Single point of Supabase client construction. Per the project structure
// doc, every file in shared/services/ imports `supabase` from here and
// nothing else in the app constructs a client directly.
// =============================================================================

const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL and Anon Key must be provided in .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
