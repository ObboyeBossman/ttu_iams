// =============================================================================
// IAMS — src/modules/auth/auth-guard.js (FIXED: Memoized Session Init)
// =============================================================================

import { supabase } from '/shared/supabase-client.js';

export const LOGIN_PATH = '/src/modules/auth/login.html';

const DASHBOARD_PATHS = {
  super_admin:        '/src/modules/super_admin/dashboard/dashboard.html',
  admin:              '/src/modules/admin_portal/dashboard/dashboard.html',
  student:            '/src/modules/student/dashboard.html',
  school_supervisor:  '/src/modules/school-supervisor/dashboard.html',
  company_supervisor: '/src/modules/company-supervisor/dashboard.html',
};

let _cachedSession = null;
let _initPromise = null;          // ← Memoized promise, NOT a boolean flag
let _authListenerRegistered = false;

/**
 * Ensures the session is fetched exactly once, but safely: if the first
 * fetch returns null (e.g., IndexedDB not ready), the promise is NOT
 * marked as "done" — subsequent callers await the same promise, which
 * will resolve when the fetch actually completes.
 */
async function ensureInitialized() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      console.log('[auth-guard] getSession result:', data);
      _cachedSession = data?.session ?? null;
    } catch (e) {
      console.error('[auth-guard] Error getting session:', e);
      _cachedSession = null;
    }

    // Register auth state listener exactly once
    if (!_authListenerRegistered) {
      _authListenerRegistered = true;
      supabase.auth.onAuthStateChange((_event, session) => {
        console.log('[auth-guard] Auth state changed:', _event);
        _cachedSession = session;
      });
    }

    console.log('[auth-guard] Cached session:', _cachedSession);
  })();

  return _initPromise;
}

export async function getCurrentUserId() {
  await ensureInitialized();
  const userId = _cachedSession?.user?.id ?? null;
  console.log('[auth-guard] getCurrentUserId:', userId);
  return userId;
}

export async function getCurrentRole() {
  await ensureInitialized();
  const userId = _cachedSession?.user?.id;
  if (!userId) {
    console.log('[auth-guard] No user ID for role lookup');
    return null;
  }

  // Check if role is in session
  if (_cachedSession?._role) {
    console.log('[auth-guard] Role from session:', _cachedSession._role);
    return _cachedSession._role;
  }

  // Fallback to profiles table
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      console.log('[auth-guard] Role lookup failed:', error);
      return null;
    }

    console.log('[auth-guard] Role from profiles:', data.role);
    return data.role;
  } catch (e) {
    console.error('[auth-guard] Error getting role:', e);
    return null;
  }
}

export async function isAuthenticated() {
  await ensureInitialized();
  const authed = Boolean(_cachedSession?.user?.id);
  console.log('[auth-guard] isAuthenticated:', authed);
  return authed;
}

export function redirectToLogin() {
  console.log('[auth-guard] Redirecting to login');
  window.location.href = LOGIN_PATH;
}

export function redirectToOwnDashboard(role) {
  const path = DASHBOARD_PATHS[role];
  if (path) {
    console.log('[auth-guard] Redirecting to:', path);
    window.location.href = path;
  } else {
    console.log('[auth-guard] No dashboard for role:', role);
    window.location.href = LOGIN_PATH;
  }
}

export async function requireRole(allowedRoles) {
  console.log('[auth-guard] requireRole called with:', allowedRoles);

  await ensureInitialized();

  if (!_cachedSession?.user?.id) {
    console.log('[auth-guard] No session, redirecting to login');
    redirectToLogin();
    return new Promise(() => {});
  }

  const role = await getCurrentRole();
  console.log('[auth-guard] Current role:', role);

  if (!role || !allowedRoles.includes(role)) {
    console.log('[auth-guard] Role not allowed, redirecting to own dashboard');
    redirectToOwnDashboard(role);
    return new Promise(() => {});
  }

  console.log('[auth-guard] Role allowed, proceeding');
  return role;
}

/**
 * Redirects to the user's dashboard if they are already authenticated.
 * No sessionStorage flags needed — the session is read directly from
 * the cached session state, which is kept fresh by the memoized init
 * and the auth state listener.
 */
export async function redirectIfAlreadyAuthenticated() {
  console.log('[auth-guard] redirectIfAlreadyAuthenticated called');

  await ensureInitialized();

  if (!_cachedSession?.user?.id) {
    console.log('[auth-guard] No session, staying on login page');
    return;
  }

  const role = await getCurrentRole();
  console.log('[auth-guard] Authenticated as:', role);

  // Check if we're already on a dashboard page
  const currentPath = window.location.pathname;
  const isOnDashboard = Object.values(DASHBOARD_PATHS).some(path =>
    path && currentPath.includes(path)
  );

  if (isOnDashboard) {
    console.log('[auth-guard] Already on dashboard, staying');
    return;
  }

  console.log('[auth-guard] Redirecting to dashboard for role:', role);

  const path = DASHBOARD_PATHS[role];
  if (path) {
    window.location.href = path;
  }
}