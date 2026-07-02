// =============================================================================
// IAMS — src/modules/auth/login.js
// =============================================================================

import { redirectIfAlreadyAuthenticated, LOGIN_PATH } from './auth-guard.js';

// ── Check if already authenticated ──────────────────────────────────────────
redirectIfAlreadyAuthenticated();

const form       = document.getElementById('login-form');
const idInput    = document.getElementById('email');
const pwInput    = document.getElementById('password');
const btnSignin  = document.querySelector('.sign-btn');

// ── Dynamic Error Banner ─────────────────────────────────────────────────────
let errBanner = document.getElementById('login-error');
let errMsg    = document.getElementById('login-error-msg');

if (!errBanner && form) {
  errBanner = document.createElement('div');
  errBanner.style.cssText = 'display:none;padding:12px;border-radius:12px;font-size:14px;font-weight:600;text-align:center;margin-bottom:20px;border:1px solid rgba(220,38,38,0.3);background-color:rgba(220,38,38,0.1);color:#ef4444;';
  errMsg = document.createElement('span');
  errBanner.appendChild(errMsg);
  form.parentNode.insertBefore(errBanner, form);
}

function setLoading(on) {
  if (!btnSignin) return;
  if (on) {
    btnSignin.disabled    = true;
    btnSignin.style.opacity  = '0.7';
    btnSignin.style.cursor   = 'not-allowed';
    btnSignin.innerHTML  = `<span class="material-symbols-outlined text-lg" style="animation:spin 1s linear infinite;">progress_activity</span> Signing in…`;
  } else {
    btnSignin.disabled    = false;
    btnSignin.style.opacity  = '1';
    btnSignin.style.cursor   = 'pointer';
    btnSignin.innerHTML  = `Sign in <span class="material-symbols-outlined text-lg">arrow_forward</span>`;
  }
}

function showBannerError(msg) {
  if (errMsg && errBanner) {
    errMsg.textContent      = msg;
    errBanner.style.display = 'block';
  } else {
    alert(msg);
  }
}

function clearBannerError() {
  if (errBanner) errBanner.style.display = 'none';
}

[idInput, pwInput].forEach(el => el?.addEventListener('input', clearBannerError));

// ── Password Visibility Toggle ───────────────────────────────────────────────
const togglePasswordBtn = document.getElementById('toggle-password');
const toggleIcon        = document.getElementById('toggle-icon');

if (togglePasswordBtn && toggleIcon && pwInput) {
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword  = pwInput.type === 'password';
    pwInput.type      = isPassword ? 'text' : 'password';
    toggleIcon.textContent = isPassword ? 'visibility' : 'visibility_off';
  });
}

// ── Index Number → Email conversion ─────────────────────────────────────────
// Students log in with their index number (e.g. BC/IAS/24/112).
// The derived email is: strip slashes, lowercase, append @ttu.edu.gh
// e.g. BC/IAS/24/112 → bcias24112@ttu.edu.gh
// Non-student users (admin, supervisors) enter their email directly.
// We detect an index number by the presence of '/' in the input.
function resolveLoginEmail(input) {
  if (input.includes('/')) {
    // Treat as index number → derive email
    return input.replace(/\//g, '').toLowerCase() + '@ttu.edu.gh';
  }
  // Already an email address
  return input.toLowerCase();
}


if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearBannerError();

    const rawInput = idInput?.value?.trim();
    const pwd      = pwInput?.value;

    if (!rawInput || !pwd) {
      showBannerError('Please enter your index number (or email) and password.');
      return;
    }

    const email = resolveLoginEmail(rawInput);
    console.log('[login.js] Resolved login email:', email);

    setLoading(true);

    try {
      const { supabase } = await import('/shared/supabase-client.js');

      // ── Sign in ────────────────────────────────────────────────────────────
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pwd });

      console.log('[login.js] signInWithPassword result:', { data, error });

      // Robust check: error OR missing session OR missing user
      if (error) {
        setLoading(false);
        showBannerError(
          error.message === 'Invalid login credentials'
            ? 'That email and password don\'t match our records.'
            : error.message ?? 'Sign-in failed. Please try again.'
        );
        return;
      }

      if (!data?.session || !data?.user?.id) {
        setLoading(false);
        console.warn('[login.js] No session or user in response:', data);
        showBannerError('Sign-in failed — no session returned. Please check your credentials and try again.');
        return;
      }

      // ── Look up role to route correctly ───────────────────────────────────
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();

      console.log('[login.js] Profile lookup:', { profile, profileErr });

      if (profileErr || !profile) {
        setLoading(false);
        showBannerError('Your account was found but your profile is missing. Please contact the administrator.');
        console.error('[login.js] Profile fetch failed:', profileErr);
        return;
      }

      const role = profile.role;
      console.log('[login.js] Login successful, role:', role);

      // ── Redirect to the appropriate dashboard ─────────────────────────────
      const dashboardPaths = {
        super_admin:        '/src/modules/super_admin/dashboard/dashboard.html',
        admin:              '/src/modules/admin_portal/dashboard/dashboard.html',
        student:            '/src/modules/student/dashboard.html',
        school_supervisor:  '/src/modules/school-supervisor/dashboard.html',
        company_supervisor: '/src/modules/company-supervisor/dashboard.html',
      };

      const path = dashboardPaths[role];
      if (!path) {
        setLoading(false);
        showBannerError(`Unknown role "${role}". Please contact the administrator.`);
        return;
      }

      console.log('[login.js] Redirecting to:', path);
      window.location.href = path;

    } catch (err) {
      setLoading(false);
      showBannerError('An unexpected error occurred. Check the console.');
      console.error('[login.js] Unexpected error:', err);
    }
  });
}