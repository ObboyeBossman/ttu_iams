// src/modules/student/letters.js

import { createLetter } from '../../shared/services/letters.service.js';
import { getStudentProfile } from '../../shared/services/students.service.js';
import { getCurrentSeason } from '../../shared/services/seasons.service.js';
import { generateAndDownloadLetter } from '../../shared/pdf/generate-letter.js';
import { showToast, showError } from '../../shared/utils/ui.js';

// ─── Form submission ──────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Generating...';

  try {
    // ── 1. Build form data from inputs ──────────────────────────────────────
    const formData = {
      student_id:           currentUser.id,           // set on page load
      season_id:            currentSeason.id,          // set on page load
      company_name:         document.getElementById('company_name').value.trim(),
      region:               document.getElementById('region').value.trim(),
      city_town:            document.getElementById('city_town').value.trim(),
      street_landmark:      document.getElementById('street_landmark').value.trim(),
      contact_person:       document.getElementById('contact_person').value.trim(),
      company_contact_phone: document.getElementById('company_contact_phone').value.trim(),
    };

    // ── 2. Fetch student profile ─────────────────────────────────────────────
    // Uses students.service.js (not auth.service.js) — returns
    // { full_name, index_number, programme, phone }
    const { data: studentProfile, error: profileError } = await getStudentProfile(currentUser.id);
    if (profileError || !studentProfile) {
      showError('Could not load your student profile. Please try again.');
      return;
    }

    // ── 3. Insert letter row ─────────────────────────────────────────────────
    const { data: letterRow, error: insertError } = await createLetter(formData);
    if (insertError || !letterRow) {
      showError('Failed to save your letter request. Please try again.');
      return;
    }

    // ── 4. Generate & download PDF ───────────────────────────────────────────
    // Pass verification_code and generated_at from the inserted row
    const { error: pdfError } = await generateAndDownloadLetter(
      {
        ...formData,
        verification_code: letterRow.verification_code,
        generated_at:      letterRow.created_at,
      },
      studentProfile,
      currentSeason   // { start_date, end_date }
    );

    if (pdfError) {
      // DB row was saved successfully — only the download failed
      showToast(
        'Your letter was saved but the PDF download failed. Please contact the ILO.',
        'warning'
      );
    } else {
      showToast('Letter generated and downloaded successfully!', 'success');
    }
  } catch (err) {
    // Thrown by get-signed-urls or asset fetch — no DB row yet (or row exists)
    console.error('Letter generation error:', err);
    showError(`Letter generation failed: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate Letter';
  }
}

// ─── Page initialisation ──────────────────────────────────────────────────────

let currentUser = null;
let currentSeason = null;

async function init() {
  // Fetch current authenticated user and active season on page load
  // (implementation depends on your auth helpers — adjust as needed)
  currentUser = await getCurrentUser();     // e.g. from auth.service.js
  currentSeason = await getCurrentSeason(); // e.g. from seasons.service.js

  if (!currentSeason) {
    showError('No active attachment season found. Please contact the ILO.');
    document.getElementById('submit-btn').disabled = true;
    return;
  }

  document.getElementById('letter-form').addEventListener('submit', handleSubmit);
}

document.addEventListener('DOMContentLoaded', init);
