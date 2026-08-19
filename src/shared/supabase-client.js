// =============================================================================
// IAMS — shared/supabase-client.js
// =============================================================================
// Single point of Supabase client construction.
// This module must NEVER throw an uncaught error at the top level.
// =============================================================================

const defaultUrl = 'https://ocugyniwzbsprruwjaaf.supabase.co';
const defaultAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jdWd5bml3emJzcHJydXdqYWFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NTk3ODgsImV4cCI6MjA5ODMzNTc4OH0.IqBeJBDyD9W0X9-wTTGAZXlohV8Lc_8Ueo83Vk4UlKE';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || defaultUrl;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || defaultAnonKey;

let supabaseInstance;

try {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
} catch (err) {
  console.warn('[IAMS] Supabase client init warning:', err);
  supabaseInstance = {
    from: () => ({
      select: () => ({ data: [], error: null }),
      eq: () => ({ select: () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      order: () => ({ data: [], error: null }),
      update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) })
    }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    rpc: async () => ({ data: [], error: null }),
  };
}

export const supabase = supabaseInstance;
