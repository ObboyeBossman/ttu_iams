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

    // 4. Save letter state in sessionStorage for instant preview
    const payload = {
      formData,
      studentProfile,
      season: currentSeason,
    };
    sessionStorage.setItem('last_generated_letter', JSON.stringify(payload));

    // 5. Redirect to Preview & Download page
    showToast('Letter generated & saved! Loading preview...', 'success');
    setTimeout(() => {
      window.location.href = `/src/modules/student/preview-letter.html?code=${verificationCode}`;
    }, 500);

  } catch (err) {
    console.error('[public-letter] Form handler error:', err);
    showToast(`An unexpected error occurred: ${err.message || err}`, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

document.addEventListener('DOMContentLoaded', init);
