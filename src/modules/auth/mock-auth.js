// =============================================================================
// IAMS Mock — Auth (FIXED: Clean sign-out, no sessionStorage flags)
// =============================================================================

const SESSION_STORAGE_KEY = 'iams_mock_session';

let _currentSession = null;
let _authChangeListeners = [];

// --- Storage helpers ---
function loadSessionFromStorage() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      console.log('[mock-auth] No session in storage');
      return null;
    }
    const session = JSON.parse(raw);
    console.log('[mock-auth] Loaded session from storage:', session);
    return session;
  } catch (e) {
    console.warn('[mock-auth] Failed to load session:', e);
    return null;
  }
}

function saveSessionToStorage(session) {
  try {
    if (session) {
      const cleanSession = {
        userId: session.userId,
        email: session.email,
        role: session.role,
        user: {
          id: session.userId || session.user?.id,
          email: session.email || session.user?.email
        }
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(cleanSession));
      console.log('[mock-auth] Saved session to storage:', cleanSession);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      console.log('[mock-auth] Removed session from storage');
    }
  } catch (e) {
    console.warn('[mock-auth] Failed to save session:', e);
  }
}

function notifyAuthChange(event) {
  console.log('[mock-auth] Notifying listeners:', event);
  for (const fn of _authChangeListeners) {
    try { fn(event, _currentSession); } catch (e) { console.error('mock auth listener error:', e); }
  }
}

// --- Public API ---
function restoreSession() {
  const session = loadSessionFromStorage();
  if (session) {
    _currentSession = {
      userId: session.userId || session.user?.id,
      email: session.email || session.user?.email,
      role: session.role,
      user: {
        id: session.userId || session.user?.id,
        email: session.email || session.user?.email
      }
    };
  } else {
    _currentSession = null;
  }
  console.log('[mock-auth] Restored session:', _currentSession);
  return _currentSession;
}

function getSession() {
  if (!_currentSession) {
    const stored = loadSessionFromStorage();
    if (stored) {
      _currentSession = {
        userId: stored.userId || stored.user?.id,
        email: stored.email || stored.user?.email,
        role: stored.role,
        user: {
          id: stored.userId || stored.user?.id,
          email: stored.email || stored.user?.email
        }
      };
      console.log('[mock-auth] Restored session from storage in getSession:', _currentSession);
    }
  }

  if (!_currentSession) {
    console.log('[mock-auth] No session found');
    return null;
  }

  return {
    user: {
      id: _currentSession.userId,
      email: _currentSession.email
    },
    _role: _currentSession.role
  };
}

async function signInWithPassword(idb, { email, password: _password }) {
  console.log('[mock-auth] Sign in attempt:', email);

  try {
    const allProfiles = await idb.getAll('profiles');
    console.log('[mock-auth] Found profiles:', allProfiles.length);

    let match = allProfiles.find(
      (p) => (p._mock_email || '').toLowerCase() === (email || '').toLowerCase()
    );

    if (!match) {
      const allStudents = await idb.getAll('students');
      const student = allStudents.find(
        (s) => s.index_number.toLowerCase() === (email || '').toLowerCase()
      );
      if (student) match = allProfiles.find((p) => p.id === student.id);
    }

    if (!match) {
      console.log('[mock-auth] No match found for:', email);
      return {
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' }
      };
    }

    console.log('[mock-auth] Match found:', match.full_name, match.role);

    _currentSession = {
      userId: match.id,
      email: match._mock_email || email,
      role: match.role,
      user: {
        id: match.id,
        email: match._mock_email || email
      }
    };

    saveSessionToStorage(_currentSession);
    notifyAuthChange('SIGNED_IN');

    return {
      data: {
        user: { id: match.id, email: match._mock_email || email },
        session: { user: { id: match.id, email: match._mock_email || email } },
      },
      error: null,
    };
  } catch (e) {
    console.error('[mock-auth] Sign in error:', e);
    return {
      data: { user: null, session: null },
      error: { message: 'Sign in failed: ' + e.message }
    };
  }
}

/**
 * Sign out — clears session from memory and localStorage.
 * No sessionStorage flags needed — the login page reads the session
 * directly from auth-guard, which reads from mock-auth.getSession().
 */
async function signOut() {
  console.log('[mock-auth] Signing out');

  _currentSession = null;
  localStorage.removeItem(SESSION_STORAGE_KEY);

  console.log('[mock-auth] Session cleared, storage removed');

  notifyAuthChange('SIGNED_OUT');

  return { error: null };
}

function onAuthStateChange(callback) {
  _authChangeListeners.push(callback);
  console.log('[mock-auth] Added auth listener, total:', _authChangeListeners.length);
  return {
    data: {
      subscription: {
        unsubscribe: () => {
          _authChangeListeners = _authChangeListeners.filter((fn) => fn !== callback);
        },
      },
    },
  };
}

function uid() {
  return _currentSession ? _currentSession.userId : null;
}

function role() {
  return _currentSession ? _currentSession.role : null;
}

// --- Auto-restore on module load ---
console.log('[mock-auth] Initializing...');
restoreSession();

export const mockAuth = {
  restoreSession,
  getSession,
  signInWithPassword,
  signOut,
  onAuthStateChange,
  uid,
  role,
};