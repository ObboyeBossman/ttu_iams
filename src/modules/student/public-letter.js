// =============================================================================
// IAMS — src/modules/student/public-letter.js
// Public (Unauthenticated) Attachment Letter Generator
// =============================================================================

import { getOpenSeason } from '/shared/services/seasons.js';
import { createLetter } from '/shared/services/letters.js';
import { generateAndDownloadLetter } from '/shared/pdf/generate-letter.js';
import { generateVerificationCode, showToast } from '/shared/utils.js';

let currentSeason = null;

async function init() {
  try {
    const { data } = await getOpenSeason();
    currentSeason = data;
  } catch (e) {
    console.warn('[public-letter] Could not fetch active season:', e);
  }

  // Fallback season dates if no active season is configured in DB
  if (!currentSeason) {
    const currentYear = new Date().getFullYear();
    currentSeason = {
      id: 'public-default-season',
      name: `${currentYear} Industrial Attachment`,
      start_date: `${currentYear}-09-01`,
      end_date: `${currentYear}-11-30`,
    };
  }

  const form = document.getElementById('public-letter-form');
  if (form) {
    form.addEventListener('submit', handleSubmit);
  }
}

async function handleSubmit(e) {
  e.preventDefault();

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
      season_id: currentSeason.id,
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
      season: currentSeason,
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

document.addEventListener('DOMContentLoaded', init);
