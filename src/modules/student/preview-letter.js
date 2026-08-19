// =============================================================================
// IAMS — src/modules/student/preview-letter.js
// Preview & Download Handler for Attachment Letters
// =============================================================================

import { generateAndDownloadLetter } from '/shared/pdf/generate-letter.js';
import { showToast } from '/shared/utils.js';
import { supabase } from '/shared/supabase-client.js';

let letterData = null;

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('code');

  // 1. Try loading from sessionStorage first (immediate submit state)
  const cachedStr = sessionStorage.getItem('last_generated_letter');
  if (cachedStr) {
    try {
      letterData = JSON.parse(cachedStr);
    } catch {
      letterData = null;
    }
  }

  // 2. If codeParam exists and cached letter code differs, query Supabase DB
  if (codeParam && (!letterData || letterData.formData?.verification_code !== codeParam)) {
    try {
      const { data, error } = await supabase
        .from('letters')
        .select('*')
        .eq('verification_code', codeParam)
        .maybeSingle();

      if (data && !error) {
        const currentYear = new Date().getFullYear();
        letterData = {
          formData: {
            company_name: data.company_name,
            region: data.region || data.city_town,
            city_town: data.city_town,
            street_landmark: data.street_landmark || data.city_town,
            contact_person: data.contact_person || 'THE HUMAN RESOURCE MANAGER',
            company_contact_phone: data.company_contact_phone || 'N/A',
            verification_code: data.verification_code,
            generated_at: data.generated_at,
            season_id: data.season_id,
          },
          studentProfile: {
            full_name: data.full_name || 'STUDENT NAME',
            index_number: data.index_number || 'REG NUMBER',
            programme: data.programme || 'PROGRAMME OF STUDY',
            phone: data.phone || 'PHONE NUMBER',
          },
          season: {
            start_date: `${currentYear}-09-01`,
            end_date: `${currentYear}-11-30`,
          },
        };
      }
    } catch (e) {
      console.warn('[preview-letter] DB lookup error:', e);
    }
  }

  if (!letterData) {
    showToast('No letter data found. Redirecting to form...', 'error');
    setTimeout(() => {
      window.location.href = '/src/modules/student/public-letter.html';
    }, 2000);
    return;
  }

  // Render document preview
  renderPreview(letterData);

  // Setup download handlers
  const topBtn = document.getElementById('download-pdf-btn');
  const bottomBtn = document.getElementById('download-pdf-btn-bottom');

  if (topBtn) topBtn.addEventListener('click', handleDownload);
  if (bottomBtn) bottomBtn.addEventListener('click', handleDownload);
}

function renderPreview({ formData, studentProfile, season }) {
  const dateStr = new Date(formData.generated_at || Date.now()).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).toUpperCase();

  const startDateFormatted = new Date((season?.start_date || '2026-09-01') + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const endDateFormatted = new Date((season?.end_date || '2026-11-30') + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  setText('prev-ref-no', formData.reference_number || 'TTU/ILO/IAP/VOL.8/001');
  setText('prev-letter-date', dateStr);
  setText('prev-contact-person', (formData.contact_person || 'THE HUMAN RESOURCE MANAGER').toUpperCase());
  setText('prev-company-name', (formData.company_name || 'COMPANY NAME').toUpperCase());
  setText('prev-city-town', (formData.city_town || 'TAKORADI').toUpperCase());

  setText('prev-programme', (studentProfile.programme || '').toUpperCase());
  setText('prev-programme-particulars', (studentProfile.programme || '').toUpperCase());
  setText('prev-dates', `${startDateFormatted} to ${endDateFormatted}`);

  setText('prev-index-number', studentProfile.index_number || '');
  setText('prev-full-name', (studentProfile.full_name || '').toUpperCase());
  setText('prev-phone', studentProfile.phone || '');

  setText('prev-code', formData.verification_code || '');
  setText('prev-code-link', formData.verification_code || '');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function handleDownload() {
  if (!letterData) return;

  const topBtn = document.getElementById('download-pdf-btn');
  const bottomBtn = document.getElementById('download-pdf-btn-bottom');

  const setButtonsLoading = (isLoading) => {
    [topBtn, bottomBtn].forEach((btn) => {
      if (btn) {
        btn.disabled = isLoading;
        btn.style.opacity = isLoading ? '0.7' : '1';
      }
    });
  };

  setButtonsLoading(true);
  showToast('Generating PDF attachment letter...', 'info');

  try {
    const { error } = await generateAndDownloadLetter(
      letterData.formData,
      letterData.studentProfile,
      letterData.season
    );

    if (error) {
      console.error('[preview-letter] PDF download error:', error);
      showToast(`Download failed: ${error.message || error}`, 'error');
    } else {
      showToast('PDF downloaded successfully!', 'success');
    }
  } catch (err) {
    console.error('[preview-letter] Exception:', err);
    showToast(`Failed to generate PDF: ${err.message}`, 'error');
  } finally {
    setButtonsLoading(false);
  }
}

document.addEventListener('DOMContentLoaded', init);
