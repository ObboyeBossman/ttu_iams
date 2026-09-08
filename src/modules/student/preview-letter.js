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

  if (!codeParam) {
    showToast('Access Denied. Invalid or missing verification code.', 'error');
    setTimeout(() => {
      window.location.href = '/src/modules/auth/login.html';
    }, 1500);
    return;
  }

  // Strictly verify against Supabase DB
  try {
    const { data, error } = await supabase
      .from('letters')
      .select('*')
      .eq('verification_code', codeParam)
      .maybeSingle();

    if (data && !error) {
      const currentYear = new Date().getFullYear();
      let studentProfile = {
        full_name: data.full_name,
        index_number: data.index_number,
        programme: data.programme,
        phone: data.phone,
      };

      // If student_id is set and programme/name is missing on data, query student_profiles
      if (data.student_id && (!studentProfile.full_name || !studentProfile.programme)) {
        const { data: sp } = await supabase
          .from('student_profiles')
          .select('*')
          .eq('id', data.student_id)
          .maybeSingle();

        if (sp) {
          studentProfile.full_name = studentProfile.full_name || sp.full_name;
          studentProfile.index_number = studentProfile.index_number || sp.index_number;
          studentProfile.programme = studentProfile.programme || sp.programme || (sp.programme_type && sp.programme_name ? (sp.programme_name.toLowerCase().startsWith(sp.programme_type.toLowerCase()) ? sp.programme_name : `${sp.programme_type} in ${sp.programme_name}`) : sp.programme_name);
          studentProfile.phone = studentProfile.phone || sp.phone;
          studentProfile.level = sp.level;
          studentProfile.programme_type = sp.programme_type;
          studentProfile.programme_name = sp.programme_name;
        }
      }

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
          full_name: studentProfile.full_name || 'STUDENT NAME',
          index_number: studentProfile.index_number || 'REG NUMBER',
          programme: studentProfile.programme || '',
          phone: studentProfile.phone || 'PHONE NUMBER',
          level: studentProfile.level || '',
          programme_type: studentProfile.programme_type || '',
          programme_name: studentProfile.programme_name || '',
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

  if (!letterData) {
    showToast('Access Denied. Verified letter not found in database. Redirecting...', 'error');
    setTimeout(() => {
      window.location.href = '/src/modules/auth/login.html';
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

  const ATTACHMENT_DATE_RANGE = 'Monday, 7th September, 2026 to Friday, 9th October, 2026';

  setText('prev-ref-no', formData.reference_number || 'TTU/ILO/IAP/VOL.8/001');
  setText('prev-letter-date', dateStr);
  setText('prev-contact-person', (formData.contact_person || 'THE HUMAN RESOURCE MANAGER').toUpperCase());
  setText('prev-company-name', (formData.company_name || 'GHANA REVENUE AUTHORITY').toUpperCase());
  setText('prev-city-town', (formData.city_town || 'TAKORADI').toUpperCase());

  const rawProg = getProgrammeString(studentProfile);
  const progUppercase = rawProg ? rawProg.toUpperCase() : 'PROGRAMME OF STUDY';
  const degreeOnly = getDegreeOnly(rawProg, studentProfile.level);

  setText('prev-programme', degreeOnly);
  setText('prev-programme-particulars', progUppercase);
  setText('prev-dates', ATTACHMENT_DATE_RANGE);

  setText('prev-index-number', studentProfile.index_number || 'BC/ITN/24/238');
  setText('prev-full-name', (studentProfile.full_name || 'RAFIA YAKUBU').toUpperCase());
  setText('prev-phone', studentProfile.phone || '0555728295');

  setText('prev-code', formData.verification_code || '0256895983');
}

function getProgrammeString(sp) {
  if (!sp) return '';
  if (sp.programme) return sp.programme;
  if (sp.programme_type || sp.programme_name) {
    const type = (sp.programme_type || '').trim();
    const name = (sp.programme_name || '').trim();
    if (type && name) {
      if (name.toLowerCase().startsWith(type.toLowerCase())) return name;
      return `${type} in ${name}`;
    }
    return type || name;
  }
  if (sp.level) {
    const lvl = String(sp.level).toLowerCase();
    if (lvl.includes('hnd')) return 'Higher National Diploma';
    if (lvl.includes('btech') || lvl.includes('b-tech') || lvl.includes('b.tech')) return 'Bachelor of Technology';
  }
  return '';
}

function getDegreeOnly(str, level = '') {
  const s = String(str || '').trim();
  const l = String(level || '').trim();
  const sLower = s.toLowerCase();
  const lLower = l.toLowerCase();

  if (sLower.includes('higher national diploma') || sLower.includes('hnd') || lLower.includes('hnd')) {
    return 'Higher National Diploma (HND)';
  }
  if (
    sLower.includes('bachelor of technology') ||
    sLower.includes('btech') ||
    sLower.includes('b.tech') ||
    sLower.includes('b-tech') ||
    lLower.includes('btech') ||
    lLower.includes('b-tech') ||
    lLower.includes('b.tech')
  ) {
    return 'Bachelor of Technology (B. Tech.)';
  }
  if (sLower.includes('diploma') || lLower.includes('diploma')) {
    return 'Diploma';
  }

  if (s) {
    const parts = s.split(/\s+in\s+/i);
    return toTitleCase(parts[0]);
  }

  return 'Higher National Diploma (HND)';
}

function toTitleCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      if (['hnd', 'btech', 'b-tech', 'b.tech', 'b.tech.'].includes(lower)) {
        return word.toUpperCase();
      }
      if (['in', 'of', 'and', 'for', 'the', 'or', 'to', '&'].includes(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
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
    const cardEl = document.querySelector('.a4-page');
    if (cardEl) {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('https://esm.sh/html2canvas@1.4.1'),
        import('https://esm.sh/jspdf@2'),
      ]);

      // Clone the element off-screen with all clipping constraints removed
      const clone = cardEl.cloneNode(true);
      clone.style.cssText = `
        position: fixed !important;
        left: -9999px !important;
        top: 0 !important;
        width: ${cardEl.offsetWidth}px !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        box-shadow: none !important;
        z-index: -1 !important;
      `;
      document.body.appendChild(clone);

      // Wait two animation frames to guarantee full reflow + repaint
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const fullH = clone.scrollHeight;
      const fullW = clone.scrollWidth;

      const canvas = await html2canvas(clone, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: fullW,
        height: fullH,
        windowWidth: fullW,
        windowHeight: fullH,
      });

      document.body.removeChild(clone);

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      
      const fileName = `TTU_Attachment_Letter_${letterData.formData.verification_code || 'ILO'}.pdf`;
      pdf.save(fileName);
      showToast('PDF downloaded successfully!', 'success');
      return;
    }

    // Fallback to programmatic generator
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
    console.error('[preview-letter] Exception during DOM PDF export, trying generator fallback:', err);
    try {
      await generateAndDownloadLetter(
        letterData.formData,
        letterData.studentProfile,
        letterData.season
      );
      showToast('PDF downloaded successfully!', 'success');
    } catch (fallbackErr) {
      showToast(`Failed to generate PDF: ${fallbackErr.message}`, 'error');
    }
  } finally {
    setButtonsLoading(false);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
