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

  // Setup download & print handlers
  const topBtn = document.getElementById('download-pdf-btn');
  const bottomBtn = document.getElementById('download-pdf-btn-bottom');
  const printBtn = document.getElementById('print-btn');

  if (topBtn) topBtn.addEventListener('click', handleDownload);
  if (bottomBtn) bottomBtn.addEventListener('click', handleDownload);
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}

function renderPreview({ formData, studentProfile, season }) {
  const genIso = (formData.generated_at || new Date().toISOString()).slice(0, 10);
  const dateStr = formatLetterDate(genIso);

  const startDateFormatted = formatAttachmentDate(season?.start_date || '2026-09-01');
  const endDateFormatted = formatAttachmentDate(season?.end_date || '2026-11-30');

  setText('prev-ref-no', formData.reference_number || 'TTU/ILO/IAP/VOL.8/001');
  setText('prev-letter-date', dateStr);
  setText('prev-contact-person', (formData.contact_person || 'THE HUMAN RESOURCE MANAGER').toUpperCase());
  setText('prev-company-name', (formData.company_name || 'GHANA REVENUE AUTHORITY').toUpperCase());
  setText('prev-city-town', (formData.city_town || 'TAKORADI').toUpperCase());

  const progName = (studentProfile.programme || 'BACHELOR OF TECHNOLOGY IN INFORMATION TECHNOLOGY').toUpperCase();
  setText('prev-programme', progName);
  setText('prev-programme-particulars', progName);
  setText('prev-dates', `${startDateFormatted} to ${endDateFormatted}`);

  setText('prev-index-number', studentProfile.index_number || 'BC/ITN/24/238');
  setText('prev-full-name', (studentProfile.full_name || 'RAFIA YAKUBU').toUpperCase());
  setText('prev-phone', studentProfile.phone || '0555728295');

  setText('prev-code', formData.verification_code || '0256895983');
}

function formatLetterDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const suffix = (day % 100 >= 11 && day % 100 <= 13) ? 'TH' : (day % 10 === 1 ? 'ST' : (day % 10 === 2 ? 'ND' : (day % 10 === 3 ? 'RD' : 'TH')));
  return `${day}${suffix} ${months[d.getMonth()]}, ${d.getFullYear()}`;
}

function formatAttachmentDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const suffix = (day % 100 >= 11 && day % 100 <= 13) ? 'th' : (day % 10 === 1 ? 'st' : (day % 10 === 2 ? 'nd' : (day % 10 === 3 ? 'rd' : 'th')));
  return `${daysOfWeek[d.getDay()]}, ${day}${suffix} ${months[d.getMonth()]}, ${d.getFullYear()}`;
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
