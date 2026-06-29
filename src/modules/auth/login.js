// =============================================================================
// IAMS — src/modules/auth/login.js
// =============================================================================

import { redirectIfAlreadyAuthenticated, LOGIN_PATH } from './auth-guard.js';

// ── Check if already authenticated ──────────────────────────────────────────
redirectIfAlreadyAuthenticated();

const form = document.getElementById('login-form');
const idInput = document.getElementById('email');
const pwInput = document.getElementById('password');
const btnSignin = document.querySelector('.sign-btn');

// ── Dynamic Error Banner ─────────────────────────────────────────────────────
let errBanner = document.getElementById('login-error');
let errMsg = document.getElementById('login-error-msg');

if (!errBanner && form) {
  errBanner = document.createElement('div');
  errBanner.style.cssText = 'display: none; padding: 12px; border-radius: 12px; font-size: 14px; font-weight: 600; text-align: center; margin-bottom: 20px; border: 1px solid rgba(220, 38, 38, 0.3); background-color: rgba(220, 38, 38, 0.1); color: #ef4444;';
  
  errMsg = document.createElement('span');
  errBanner.appendChild(errMsg);
  
  form.parentNode.insertBefore(errBanner, form);
}

function setLoading(on) {
  if (!btnSignin) return;
  if (on) {
    btnSignin.disabled = true;
    btnSignin.style.opacity = '0.7';
    btnSignin.style.cursor = 'not-allowed';
    btnSignin.innerHTML = `<span class="material-symbols-outlined text-lg animate-spin" style="animation: spin 1s linear infinite;">progress_activity</span> Signing in…`;
  } else {
    btnSignin.disabled = false;
    btnSignin.style.opacity = '1';
    btnSignin.style.cursor = 'pointer';
    btnSignin.innerHTML = `Sign in <span class="material-symbols-outlined text-lg">arrow_forward</span>`;
  }
}

function showBannerError(msg) {
  if (errMsg && errBanner) {
    errMsg.textContent = msg;
    errBanner.style.display = 'block';
  } else {
    alert(msg);
  }
}

function clearBannerError() {
  if (errBanner) {
    errBanner.style.display = 'none';
  }
}

[idInput, pwInput].forEach(el => el?.addEventListener('input', clearBannerError));

// ── Form submit ──────────────────────────────────────────────────────────────
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearBannerError();

    const email = idInput?.value?.trim();
    const pwd = pwInput?.value;
    
    if (!email || !pwd) {
      showBannerError('Please enter both email and password.');
      return;
    }

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

      window.location.href = path;

    } catch (err) {
      setLoading(false);
      showBannerError('An unexpected error occurred. Check the console.');
      console.error('[login.js]', err);
    }
  });
}