// =============================================================================
// IAMS — src/shared/pdf/generate-letter.js
// FR2: Attachment Letter Generation
// =============================================================================
//
// Generates and downloads the official TTU Industrial Liaison Office
// attachment-request letter as a jsPDF A4 PDF.
//
// Asset resolution (two-tier, automatic, never throws):
//   PRIMARY  — Supabase Storage via get-letter-assets Edge Function.
//              Active once admin uploads assets through the Settings panel.
//   FALLBACK — Local files bundled in public/assets/letters/.
//              Used during development and before admin configures storage.
//
// Caller contract:
//   generateAndDownloadLetter(formData, studentProfile, season)
//   Returns: { data: { letterRow: true }, error: null }   — success
//            { data: { letterRow: true }, error: Error }  — PDF build/save failed
//   Never throws — all errors are returned, not thrown.
//
// The `letters` row is inserted by the CALLER before calling this function.
// This file does not touch the database.
// =============================================================================

// ---------------------------------------------------------------------------
// jsPDF — lazy-loaded so pages that never generate letters don't pay the cost
// ---------------------------------------------------------------------------

let _jsPDF = null;

async function getJsPDF() {
  if (_jsPDF) return _jsPDF;
  const mod = await import('https://esm.sh/jspdf@2');
  _jsPDF = mod.jsPDF ?? mod.default?.jsPDF ?? mod.default;
  if (!_jsPDF) throw new Error('generate-letter: could not load jsPDF from CDN.');
  return _jsPDF;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/** '2026-08-25' → '25th August, 2026'  (used in body paragraph) */
function formatAttachmentDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  return `${day}${ordinalSuffix(day)} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
}

/** '2025-08-12' → '12TH AUGUST, 2025'  (used in top-right date line) */
function formatLetterDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  return `${day}${ordinalSuffix(day).toUpperCase()} ${MONTHS[d.getMonth()].toUpperCase()}, ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Asset resolution — Supabase Storage first, local files as fallback
// ---------------------------------------------------------------------------

const LOCAL_ASSETS = {
  letterhead: '/assets/letters/ttu_letterhead.jpeg',
  stamp:      '/assets/letters/ttu_signature_stamp.jpeg',
  footer:     '/assets/letters/ttu_footer.png',
};

/**
 * Fetches any URL and returns a raw base64 string, or null on any failure.
 * Chunked to avoid call-stack overflow on large images.
 */
async function toBase64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf   = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  } catch {
    return null;
  }
}

/**
 * Resolves all three letter assets.
 *
 * Each asset object: { data: string|null, format: 'JPEG'|'PNG' }
 * `data` is null only if both Supabase and the local file both fail —
 * buildPdf guards each addImage call so the PDF still renders without it.
 */
async function resolveAssets() {
  // ── Try Supabase Storage (get-letter-assets Edge Function) ──────────────
  let remote = null;
  try {
    const url    = import.meta.env.VITE_SUPABASE_URL;
    const anon   = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const { data: { session } } = await createClient(url, anon).auth.getSession();
    const jwt = session?.access_token;

    if (jwt) {
      const res = await fetch(`${url}/functions/v1/get-letter-assets`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${jwt}`,
          'apikey':         anon,
        },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const p = await res.json();
        if (p.letterhead_url && p.stamp_url && p.footer_url) {
          remote = { letterhead: p.letterhead_url, stamp: p.stamp_url, footer: p.footer_url };
        }
      }
    }
  } catch {
    // No session, Edge Function not deployed, or network error — use local files.
  }

  // ── Resolve each asset: remote first, local fallback ────────────────────
  async function resolve(key, localPath, format) {
    if (remote?.[key]) {
      const data = await toBase64(remote[key]);
      if (data) return { data, format };
    }
    const data = await toBase64(localPath);
    return { data, format };
  }

  const [letterhead, stamp, footer] = await Promise.all([
    resolve('letterhead', LOCAL_ASSETS.letterhead, 'JPEG'),
    resolve('stamp',      LOCAL_ASSETS.stamp,      'JPEG'),
    resolve('footer',     LOCAL_ASSETS.footer,     'PNG'),
  ]);

  return { letterhead, stamp, footer };
}

// ---------------------------------------------------------------------------
// Mixed-bold inline text helper
// ---------------------------------------------------------------------------

/**
 * Draws a justified paragraph where one contiguous run of text is bold.
 * Structure: [normal] prefix + [bold] boldText + [normal] suffix
 *
 * jsPDF can't mix font weights in a single doc.text() call, so we:
 *   1. Split the full concatenated string into wrapped lines.
 *   2. Walk each line, identifying which characters fall in the bold region.
 *   3. Draw each segment separately, tracking the x cursor manually.
 *
 * @returns {number} y position after the last line
 */
function drawMixedBoldPara(doc, prefix, boldText, suffix, x, y, width, lineHeight, fontSize) {
  doc.setFontSize(fontSize);
  doc.setFont('times', 'normal');

  const full      = prefix + boldText + suffix;
  const boldStart = prefix.length;
  const boldEnd   = boldStart + boldText.length;
  const lines     = doc.splitTextToSize(full, width);

  let charPos = 0;

  for (let li = 0; li < lines.length; li++) {
    const line      = lines[li];
    const lineStart = charPos;
    const lineEnd   = charPos + line.length;

    const seg1 = lineStart < Math.min(boldStart, lineEnd)
      ? full.slice(lineStart, Math.min(boldStart, lineEnd)) : '';
    const seg2 = Math.max(boldStart, lineStart) < Math.min(boldEnd, lineEnd)
      ? full.slice(Math.max(boldStart, lineStart), Math.min(boldEnd, lineEnd)) : '';
    const seg3 = Math.max(boldEnd, lineStart) < lineEnd
      ? full.slice(Math.max(boldEnd, lineStart), lineEnd) : '';

    let curX = x;

    if (seg1) {
      doc.setFont('times', 'normal');
      doc.text(seg1, curX, y);
      curX += doc.getTextWidth(seg1);
    }
    if (seg2) {
      doc.setFont('times', 'bold');
      doc.text(seg2, curX, y);
      curX += doc.getTextWidth(seg2);
    }
    if (seg3) {
      doc.setFont('times', 'normal');
      doc.text(seg3, curX, y);
    }

    y += lineHeight;
    // Advance past this line's characters plus the space splitTextToSize consumed
    charPos = lineEnd + (li < lines.length - 1 ? 1 : 0);
  }

  doc.setFont('times', 'normal');
  return y;
}

// ---------------------------------------------------------------------------
// PDF builder
// ---------------------------------------------------------------------------

async function buildPdf(formData, studentProfile, season, assets) {
  const jsPDF = await getJsPDF();
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Layout constants — A4 is 210 × 297 mm
  const LEFT   = 20;
  const RIGHT  = 195;   // 210 − 15 mm right margin
  const BODY_W = 175;   // RIGHT − LEFT
  const LH     = 5;     // line height in mm at 11 pt

  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);

  // ── Block 1 — Letterhead (x=15, y=3, 180×38 mm) ─────────────────────
  if (assets.letterhead.data) {
    doc.addImage(assets.letterhead.data, 'JPEG', 15, 3, 180, 38);
  }

  // ── Block 2 — Reference number  (left, y=45) ───────────────────────────
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('TTU/ILO/IAP/VOL.2/16', LEFT, 45);

  // ── Block 3 — Date  (right-aligned, same y=45) ─────────────────────────
  const dateStr = formatLetterDate(
    formData.generated_at
      ? formData.generated_at.slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  );
  doc.text(dateStr, RIGHT, 45, { align: 'right' });

  // ── Block 4 — Addressee block  (y=52, lh=5 mm) ────────────────────────
  let y = 52;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.text('THE MANAGER',                                        LEFT, y); y += LH;
  doc.text((formData.company_name ?? '').toUpperCase(),          LEFT, y); y += LH;
  doc.text((formData.city_town    ?? '').toUpperCase(),          LEFT, y); y += LH;
  doc.text('Dear Sir/Madam,',                                    LEFT, y);

  // ── Block 5 — Subject heading  (centred, bold, underlined) ───────
  y += 8;
  const subject = 'PRACTICAL INDUSTRIAL TRAINING PROGRAMME FOR STUDENTS';
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.text(subject, 105, y, { align: 'center' });
  const sw = doc.getTextWidth(subject);
  const sx = 105 - sw / 2;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(sx, y + 1, sx + sw, y + 1);

  // ── Block 6 — Body paragraph 1  (justified) ──────────────────────
  y += 8;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  const p1 = `Students of Takoradi Technical University pursuing ${studentProfile.programme} are expected to undergo practical industrial training in industry as part of the requirements for the award of their certificate.`;
  const p1lines = doc.splitTextToSize(p1, BODY_W);
  doc.text(p1lines, LEFT, y, { align: 'justify', maxWidth: BODY_W });
  y += p1lines.length * LH;

  // ── Block 7 — Body paragraph 2  (4 mm gap, justified) ──────────────────
  y += 4;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  const p2 =
    'It is believed that the attachment programme would bring positive industrial exposure to ' +
    'students. This exercise would enable students to put theory into practice and acquaint ' +
    'themselves with current technological development in industry and commerce.';
  const p2lines = doc.splitTextToSize(p2, BODY_W);
  doc.text(p2lines, LEFT, y, { align: 'justify', maxWidth: BODY_W });
  y += p2lines.length * LH;

  // ── Block 8 — Body paragraph 3  (4 mm gap, bold dates inline) ──────────
  y += 4;
  const boldDates = `${formatAttachmentDate(season.start_date)} to ${formatAttachmentDate(season.end_date)}`;
  const p3prefix  =
    'The University would, therefore, be grateful if you could consider the under-mentioned ' +
    'student to undertake his/her industrial attachment programme in your organization from ';
  y = drawMixedBoldPara(doc, p3prefix, boldDates, '.', LEFT, y, BODY_W, LH, 11);

  // ── Block 9 — Particulars intro  (4 mm gap) ────────────────────────────
  y += 4;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.text("The student's particulars are as follows:", LEFT, y);

  // ── Block 10 — Student particulars  (bold, lh=5.5 mm) ────────────────────
  y += LH;
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  for (const line of [
    `REGISTRATION NUMBER: ${studentProfile.index_number}`,
    `NAME: ${(studentProfile.full_name ?? '').toUpperCase()}`,
    `PROGRAMME: ${(studentProfile.programme ?? '').toUpperCase()}`,
    `CONTACT NUMBER: ${studentProfile.phone}`,
  ]) {
    doc.text(line, LEFT, y);
    y += LH;
  }

  // ── Block 11 — Closing paragraphs  (4 mm gap, justified) ───────────────
  y += 4;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  for (const para of [
    'We request that the student should be made to familiarize him/herself with all the related sections available in your organization.',
    'For your information, all students at the University are covered by Group Personal Accident Insurance policy.',
    'We count on your usual cooperation.',
  ]) {
    const lines = doc.splitTextToSize(para, BODY_W);
    doc.text(lines, LEFT, y, { align: 'justify', maxWidth: BODY_W });
    y += lines.length * LH + 3;
  }

  // ── Block 12 — Sign-off ─────────────────────────────────────────────────
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.text('Yours faithfully,', LEFT, y);

  // ── Block 13 — Signature/stamp image  (3 mm gap, 45×18 mm) ────────────
  y += 3;
  if (assets.stamp.data) {
    doc.addImage(assets.stamp.data, 'JPEG', LEFT, y, 45, 18);
  }
  y += 18;

  // ── Block 14 — Signatory name and title  (3 mm gap) ────────────────────
  y += 3;
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.text('MARK KOFI O. AREMU (ESQ)', LEFT, y);
  y += LH;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.text('Head, Industrial Liaison Office', LEFT, y);

  // ── Block 15 — Verification code box  (fixed y=258) ────────────────────
  doc.setDrawColor(136, 136, 136);
  doc.setLineWidth(0.3);
  doc.rect(LEFT, 258, BODY_W, 9);
  doc.setFont('times', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(68, 68, 68);
  doc.text(
    `Verification Code: ${formData.verification_code}  |  Verify at: ttu.edu.gh/verify/${formData.verification_code}`,
    LEFT + BODY_W / 2,
    264,
    { align: 'center' }
  );

  // ── Block 16 — Footer image  (fixed y=268, x=15, 180×19 mm) ───────────
  if (assets.footer.data) {
    doc.addImage(assets.footer.data, 'PNG', 15, 268, 180, 19);
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates and triggers a browser download of the official TTU ILO
 * attachment letter PDF.
 *
 * @param {Object} formData       - { student_id, season_id, company_name, region,
 *                                    city_town, street_landmark, contact_person,
 *                                    company_contact_phone, verification_code, generated_at }
 * @param {Object} studentProfile - { full_name, index_number, programme, phone }
 * @param {Object} season         - { start_date, end_date }
 * @returns {{ data: { letterRow: true }, error: null | Error }}
 */
export async function generateAndDownloadLetter(formData, studentProfile, season) {
  const assets = await resolveAssets();

  let doc;
  try {
    doc = await buildPdf(formData, studentProfile, season, assets);
  } catch (err) {
    return { data: { letterRow: true }, error: err instanceof Error ? err : new Error(String(err)) };
  }

  try {
    doc.save(`TTU_Attachment_Letter_${formData.verification_code}.pdf`);
  } catch (err) {
    return { data: { letterRow: true }, error: err instanceof Error ? err : new Error(String(err)) };
  }

  return { data: { letterRow: true }, error: null };
}