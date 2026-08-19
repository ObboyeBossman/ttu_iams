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

  const submitBtn = document.getElementById('submit-btn');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <span class="inline-block animate-spin border-2 border-slate-900 border-t-transparent rounded-full w-5 h-5"></span>
    Generating PDF...
  `;

  try {
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

    // 3. Attempt DB insert (optional for unauthenticated guest mode)
    try {
      await createLetter({
        ...formData,
        student_id: null,
      });
    } catch {
      // Ignored for unauthenticated users if RLS rejects anon insert
    }

    // 4. Generate & trigger PDF download
    const { error: pdfError } = await generateAndDownloadLetter(
      formData,
      studentProfile,
      currentSeason
    );

    if (pdfError) {
      console.error('[public-letter] PDF generation error:', pdfError);
      showToast(`Letter generation failed: ${pdfError.message || pdfError}`, 'error');
    } else {
      showToast('Attachment letter generated and downloaded successfully!', 'success');
    }
  } catch (err) {
    console.error('[public-letter] Form handler error:', err);
    showToast(`An unexpected error occurred: ${err.message || err}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

document.addEventListener('DOMContentLoaded', init);
