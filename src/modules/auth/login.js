// =============================================================================
// IAMS — src/modules/auth/login.js (FIXED: No sessionStorage flags)
// =============================================================================

import { redirectIfAlreadyAuthenticated, LOGIN_PATH } from './auth-guard.js';

// ── Check if already authenticated ──────────────────────────────────────────
// No sessionStorage flags needed — auth-guard reads the live session directly.
redirectIfAlreadyAuthenticated();

// ── Password toggle ──────────────────────────────────────────────────────────
const pwToggle = document.getElementById('pw-toggle');
const pwInput = document.getElementById('login-password');
const iconShow = document.getElementById('pw-icon-show');
const iconHide = document.getElementById('pw-icon-hide');

pwToggle.addEventListener('click', () => {
  const isHidden = pwInput.type === 'password';
  pwInput.type = isHidden ? 'text' : 'password';
  iconShow.style.display = isHidden ? 'none' : '';
  iconHide.style.display = isHidden ? '' : 'none';
  pwToggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
});

// ── Inline validation helpers ────────────────────────────────────────────────
function setFieldError(inputEl, errorEl, msg) {
  inputEl.classList.add('input-error');
  errorEl.querySelector('span').textContent = msg;
  errorEl.classList.add('visible');
  inputEl.setAttribute('aria-invalid', 'true');
}

function clearFieldError(inputEl, errorEl) {
  inputEl.classList.remove('input-error');
  errorEl.classList.remove('visible');
  inputEl.setAttribute('aria-invalid', 'false');
}

const idInput = document.getElementById('login-id');
const idError = document.getElementById('id-error');
const pwError = document.getElementById('pw-error');

idInput.addEventListener('input', () => clearFieldError(idInput, idError));
pwInput.addEventListener('input', () => clearFieldError(pwInput, pwError));

// ── Banner error ─────────────────────────────────────────────────────────────
const form = document.getElementById('login-form');
const spinner = document.getElementById('signin-spinner');
const btnLabel = document.getElementById('signin-label');
const arrow = document.getElementById('signin-arrow');
const errBanner = document.getElementById('login-error');
const errMsg = document.getElementById('login-error-msg');

function setLoading(on) {
  spinner.style.display = on ? 'block' : 'none';
  arrow.style.display = on ? 'none' : '';
  btnLabel.textContent = on ? 'Signing in…' : 'Sign in';
  document.getElementById('btn-signin').disabled = on;
}

function showBannerError(msg) {
  errMsg.textContent = msg;
  errBanner.classList.add('visible');
}

function clearBannerError() {
  errBanner.classList.remove('visible');
}

[idInput, pwInput].forEach(el => el.addEventListener('input', clearBannerError));

// ── Google stub ──────────────────────────────────────────────────────────────
document.getElementById('btn-google')?.addEventListener('click', () => {
  showBannerError('Google sign-in is not available yet.');
});

// ── Form submit ──────────────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBannerError();

  const email = idInput.value.trim();
  const pwd = pwInput.value;
  let hasError = false;

  if (!email) {
    setFieldError(idInput, idError, 'Enter your email or index number.');
    hasError = true;
  }
  if (!pwd) {
    setFieldError(pwInput, pwError, 'Enter your password.');
    hasError = true;
  }
  if (hasError) return;

  setLoading(true);

  try {
    const { supabase } = await import('/shared/supabase-client.js');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pwd });

    if (error || !data?.session) {
      setLoading(false);
      showBannerError(
        error?.message === 'Invalid login credentials'
          ? 'That email or index number and password don\'t match our records.'
          : (error?.message ?? 'Sign-in failed. Please try again.')
      );
      return;
    }

    // ── Look up role to route correctly ──────────────────────────────────────
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle();

    console.log('[login.js] Login successful, redirecting as:', profile?.role);

    // ── Redirect to the appropriate dashboard ────────────────────────────────
    const role = profile?.role;
    const dashboardPaths = {
      admin: '/src/modules/admin_portal/dashboard/dashboard.html',
      student: '/src/modules/student/dashboard.html',
    };

    const path = dashboardPaths[role] || LOGIN_PATH;
    console.log('[login.js] Redirecting to:', path);

    // No sessionStorage flags needed — the session is now stored in
    // mock-auth's localStorage and will be read by auth-guard on the
    // dashboard page.
    window.location.href = path;

  } catch (err) {
    setLoading(false);
    showBannerError('An unexpected error occurred. Check the console.');
    console.error('[login.js]', err);
  }
});