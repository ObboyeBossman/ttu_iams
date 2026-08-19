// =============================================================================
// IAMS — src/modules/student/public-letter.js
// Public (Unauthenticated) Attachment Letter Generator
// =============================================================================

import { getOpenSeason } from '/shared/services/seasons.js';
import { createLetter } from '/shared/services/letters.js';
import { generateAndDownloadLetter } from '/shared/pdf/generate-letter.js';
import { generateVerificationCode, showToast } from '/shared/utils.js';

let seasonPromise = null;

function fetchSeason() {
  if (!seasonPromise) {
    seasonPromise = (async () => {
      try {
        const { data } = await getOpenSeason();
        if (data) return data;
      } catch (e) {
        console.warn('[public-letter] Could not fetch active season:', e);
      }
      const currentYear = new Date().getFullYear();
      return {
        id: 'e5000000-0000-0000-0000-000000000002',
        name: `${currentYear} Industrial Attachment`,
        start_date: `${currentYear}-09-01`,
        end_date: `${currentYear}-11-30`,
      };
    })();
  }
  return seasonPromise;
}

function init() {
  // 1. Immediately register submit listener synchronously to prevent default browser GET submits
  const form = document.getElementById('public-letter-form');
  if (form) {
    form.addEventListener('submit', handleSubmit);
  }

  // 2. Pre-fetch season in background
  fetchSeason();
}

// =============================================================================
// TEMPORARY BLOCK — set to false to re-enable letter generation
// =============================================================================
const LETTER_GENERATION_BLOCKED = true;

async function handleSubmit(e) {
  e.preventDefault();

  // ── Temporary access block ────────────────────────────────────────────────
  if (LETTER_GENERATION_BLOCKED) {
    // Hide form, show a styled access-denied screen
    const form = document.getElementById('public-letter-form');
    const loaderContainer = document.getElementById('processing-container');
    if (form) form.classList.add('hidden');
    if (loaderContainer) loaderContainer.classList.add('hidden');

    // Inject or reveal the access-denied panel
    let denied = document.getElementById('access-denied-panel');
    if (!denied) {
      denied = document.createElement('div');
      denied.id = 'access-denied-panel';
      denied.innerHTML = `
        <div class="flex flex-col items-center justify-center gap-5 py-14 px-6 text-center">
          <div class="relative flex items-center justify-center w-24 h-24 rounded-full bg-red-500/10 border-2 border-red-500/30">
            <span class="material-symbols-outlined text-5xl text-red-400">lock</span>
          </div>
          <div class="space-y-2">
            <h3 class="font-display font-bold text-2xl text-red-400">Access Denied</h3>
            <p class="text-sm subtext max-w-sm mx-auto leading-relaxed">
              Letter generation is temporarily unavailable.<br/>
              Please contact support for assistance.
            </p>
          </div>
          <div class="flex items-center gap-3 mt-2 px-5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <span class="material-symbols-outlined text-amber-400">call</span>
            <div class="text-left">
              <p class="text-xs font-semibold uppercase tracking-wider text-amber-400">Contact Support</p>
              <p class="text-sm font-bold text-amber-300">0593529509 — Bossman</p>
            </div>
          </div>
          <button id="denied-back-btn"
            class="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white transition-colors px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20">
            <span class="material-symbols-outlined text-base">arrow_back</span>
            Go Back
          </button>
        </div>`;
      const card = document.querySelector('.card') || document.body;
      card.appendChild(denied);

      document.getElementById('denied-back-btn').addEventListener('click', () => {
        denied.classList.add('hidden');
        if (form) form.classList.remove('hidden');
      });
    } else {
      denied.classList.remove('hidden');
    }
    return; // ← stop here; nothing below executes
  }
  // ── End temporary block ───────────────────────────────────────────────────

  const form = document.getElementById('public-letter-form');
  const loaderContainer = document.getElementById('processing-container');
  const stepText = document.getElementById('processing-step-text');
  const progressBar = document.getElementById('processing-progress-bar');

  // Transition UI: Hide form, show processing screen
  if (form) form.classList.add('hidden');
  if (loaderContainer) loaderContainer.classList.remove('hidden');

  const updateProgress = (pct, text) => {
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (stepText) stepText.textContent = text;
  };

  try {
    updateProgress(20, 'Connecting to TTU Industrial Liaison Database...');

    // Resolve season (fetches if not ready)
    const season = await fetchSeason();

    // 1. Gather student profile inputs
    const studentProfile = {
      full_name: document.getElementById('full_name').value.trim(),
      index_number: document.getElementById('index_number').value.trim(),
      programme: document.getElementById('programme').value.trim(),
      phone: document.getElementById('phone').value.trim(),
    };

    // 2. Gather letter/company details
    const verificationCode = generateVerificationCode();
    const nowIso = new Date().toISOString();
    const companyLocation = document.getElementById('city_town').value.trim();

    const formData = {
      company_name: document.getElementById('company_name').value.trim(),
      region: companyLocation,
      city_town: companyLocation,
      street_landmark: companyLocation,
      contact_person: 'THE HUMAN RESOURCE MANAGER',
      company_contact_phone: studentProfile.phone,
      verification_code: verificationCode,
      generated_at: nowIso,
      season_id: season.id,
    };

    await new Promise((r) => setTimeout(r, 600));
    updateProgress(55, 'Saving letter request and generating security code...');

    // 3. Save to database for reference & audit log
    try {
      const { data: dbData, error: dbError } = await createLetter({
        ...formData,
        full_name: studentProfile.full_name,
        index_number: studentProfile.index_number,
        programme: studentProfile.programme,
        phone: studentProfile.phone,
        student_id: null,
      });

      if (dbError) {
        console.warn('[public-letter] DB insert note:', dbError);
      } else if (dbData?.created_at) {
        formData.generated_at = dbData.created_at;
      }
    } catch (e) {
      console.warn('[public-letter] DB save warning:', e);
    }

    await new Promise((r) => setTimeout(r, 600));
    updateProgress(90, 'Building document preview and preparing PDF package...');

    // 4. Save letter state in sessionStorage for instant preview
    const payload = {
      formData,
      studentProfile,
      season,
    };
    sessionStorage.setItem('last_generated_letter', JSON.stringify(payload));

    await new Promise((r) => setTimeout(r, 500));
    updateProgress(100, 'Letter generated successfully! Redirecting...');

    // 5. Redirect to Preview & Download page
    window.location.href = `/src/modules/student/preview-letter.html?code=${verificationCode}`;

  } catch (err) {
    console.error('[public-letter] Form handler error:', err);
    showToast(`An unexpected error occurred: ${err.message || err}`, 'error');
    if (loaderContainer) loaderContainer.classList.add('hidden');
    if (form) form.classList.remove('hidden');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
