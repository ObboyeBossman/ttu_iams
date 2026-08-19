// src/shared/pdf/generate-letter.js

// ─── Helper functions ────────────────────────────────────────────────────────

function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * "25th August, 2026" — for body paragraph dates (mixed case)
 */
function formatAttachmentDate(isoDateStr) {
  const date = new Date(isoDateStr + 'T00:00:00');
  const day = date.getDate();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}${ordinalSuffix(day)} ${month}, ${year}`;
}

/**
 * "Monday, 7th September, 2026" — with day name, for bold date range
 */
function formatAttachmentDateWithDay(isoDateStr) {
  const date = new Date(isoDateStr + 'T00:00:00');
  const day = date.getDate();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const dayName = days[date.getDay()];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${dayName}, ${day}${ordinalSuffix(day)} ${month}, ${year}`;
}

/**
 * "13TH AUGUST, 2026" — for the top-right date line
 */
function formatLetterDate(isoDateStr) {
  const date = new Date(isoDateStr + 'T00:00:00');
  const day = date.getDate();
  const months = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}${ordinalSuffix(day).toUpperCase()} ${month}, ${year}`;
}

/**
 * Convert a URL to a base64 string via fetch → arrayBuffer → Uint8Array → base64
 */
async function urlToBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch asset: ${url} (${response.status})`);
  const buffer = await response.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

/**
 * Build inline-bold text segments for the date paragraph.
 * Returns an array of { text, bold } segments for the full paragraph.
 */
function buildDateParagraphSegments(programme, startDate, endDate) {
  const startFormatted = formatAttachmentDateWithDay(startDate);
  const endFormatted = formatAttachmentDateWithDay(endDate);
  return [
    {
      text: `The University would, therefore, be grateful if you could consider the under-mentioned student to undertake his/her industrial attachment programme in your organization from `,
      bold: false,
    },
    { text: `${startFormatted} to ${endFormatted}`, bold: true },
    { text: `.`, bold: false },
  ];
}

/**
 * Draw a paragraph with mixed bold/normal runs, justified, with word-wrap.
 * Returns the y position after the last line.
 */
function drawMixedParagraph(doc, segments, x, y, maxWidth, lineHeight) {
  // Build full word list with bold flags
  const words = [];
  for (const seg of segments) {
    const segWords = seg.text.split(' ').filter((w) => w.length > 0);
    for (const w of segWords) {
      words.push({ word: w, bold: seg.bold });
    }
  }

  // Build lines by fitting words
  const lines = [];
  let currentLine = [];
  let currentWidth = 0;

  for (let i = 0; i < words.length; i++) {
    const { word, bold } = words[i];
    doc.setFont('times', bold ? 'bold' : 'normal');
    doc.setFontSize(11);
    const wordWidth = doc.getTextWidth(word);
    const spaceWidth = doc.getTextWidth(' ');

    const addWidth = currentLine.length === 0 ? wordWidth : spaceWidth + wordWidth;

    if (currentLine.length > 0 && currentWidth + addWidth > maxWidth) {
      lines.push(currentLine);
      currentLine = [{ word, bold, width: wordWidth }];
      currentWidth = wordWidth;
    } else {
      currentLine.push({ word, bold, width: wordWidth });
      currentWidth += addWidth;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Render each line
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const isLast = li === lines.length - 1;
    const totalWordWidth = line.reduce((acc, w) => acc + w.width, 0);
    const gaps = line.length - 1;

    let spaceWidth;
    if (isLast || gaps === 0) {
      spaceWidth = doc.getTextWidth(' ');
    } else {
      spaceWidth = (maxWidth - totalWordWidth) / gaps;
    }

    let cx = x;
    for (let wi = 0; wi < line.length; wi++) {
      const { word, bold, width } = line[wi];
      doc.setFont('times', bold ? 'bold' : 'normal');
      doc.setFontSize(11);
      doc.text(word, cx, y);
      cx += width + (wi < line.length - 1 ? spaceWidth : 0);
    }
    y += lineHeight;
  }

  return y;
}

/**
 * Draw a normal justified paragraph. Returns y after last line.
 */
function drawJustifiedParagraph(doc, text, x, y, maxWidth, lineHeight) {
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(text, maxWidth);
  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    doc.text(lines[i], x, y, { align: isLast ? 'left' : 'justify', maxWidth });
    y += lineHeight;
  }
  return y;
}

// ─── Reference number generation ─────────────────────────────────────────────

/**
 * Fetch total letter count from Supabase and compute reference number.
 * Vol starts at 8; rolls over every 1000 letters.
 * Sequence is 1-based, zero-padded to 3 digits.
 */
async function generateReferenceNumber() {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/letters?select=id`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    }
  );

  if (!res.ok) throw new Error(`Failed to fetch letter count: ${res.status}`);

  const contentRange = res.headers.get('content-range'); // e.g. "0-0/42"
  let totalCount = 0;
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)$/);
    if (match) totalCount = parseInt(match[1], 10);
  }

  // n is the count of existing letters (before this new one is inserted)
  const BASE_VOLUME = 8;
  const volume = BASE_VOLUME + Math.floor(totalCount / 1000);
  const sequence = (totalCount % 1000) + 1;
  const seqPadded = String(sequence).padStart(3, '0');

  return `TTU/ILO/IAP/VOL.${volume}/${seqPadded}`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generates and triggers download of the official TTU attachment letter PDF.
 *
 * @param {Object} formData        - Letter metadata (already inserted into `letters` table)
 * @param {Object} studentProfile  - { full_name, index_number, programme, phone }
 * @param {Object} season          - { start_date, end_date }
 * @returns {{ data: { letterRow: true }, error: null }}  on full success
 * @returns {{ data: { letterRow: true }, error: Error }} if PDF generation fails after DB insert
 * @throws  if signed URL fetch or asset fetch fails
 */
export async function generateAndDownloadLetter(formData, studentProfile, season) {
  // ── 1. Fetch signed URLs ──────────────────────────────────────────────────
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const signedUrlRes = await fetch(
    `${SUPABASE_URL}/functions/v1/get-signed-urls`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ paths: ['letterhead', 'stamp', 'footer'] }),
    }
  );

  if (!signedUrlRes.ok) {
    throw new Error(`get-signed-urls failed: ${signedUrlRes.status}`);
  }

  const { letterhead: letterheadUrl, stamp: stampUrl, footer: footerUrl } = await signedUrlRes.json();

  if (!letterheadUrl) throw new Error('Missing signed URL: letterhead');
  if (!stampUrl) throw new Error('Missing signed URL: stamp');
  if (!footerUrl) throw new Error('Missing signed URL: footer');

  // ── 2. Convert assets to base64 ───────────────────────────────────────────
  const [letterheadB64, stampB64, footerB64] = await Promise.all([
    urlToBase64(letterheadUrl),
    urlToBase64(stampUrl),
    urlToBase64(footerUrl),
  ]);

  // ── 3. Generate reference number ──────────────────────────────────────────
  const referenceNumber = await generateReferenceNumber();

  // ── 4. Build PDF ──────────────────────────────────────────────────────────
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' });

    const LEFT = 20;       // left margin
    const RIGHT_EDGE = 195; // right margin edge
    const CONTENT_W = 175; // content width
    const LINE_H = 6;      // standard line height

    doc.setTextColor(0, 0, 0);

    // ── Block 1: Letterhead ─────────────────────────────────────────────────
    doc.addImage(letterheadB64, 'JPEG', 15, 5, 180, 30.5);

    // ── Block 2: Reference number ───────────────────────────────────────────
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.text(referenceNumber, LEFT, 42);

    // ── Block 3 & 4: Addressee block + Date (side by side) ─────────────────
    // Date is right-aligned, vertically at the company_name line (y=48)
    const letterDate = formatLetterDate(new Date().toISOString().split('T')[0]);
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.text(letterDate, RIGHT_EDGE, 48, { align: 'right' });

    // Addressee block — starts at y=48
    let addrY = 48;
    const addressLines = [
      'THE HUMAN RESOURCE MANAGER',
      formData.company_name.toUpperCase(),
      formData.city_town.toUpperCase(),
      'GHANA',
    ];
    for (const line of addressLines) {
      doc.setFont('times', 'normal');
      doc.setFontSize(11);
      doc.text(line, LEFT, addrY);
      addrY += LINE_H;
    }

    // Blank line then Dear Sir/Madam
    addrY += 2;
    doc.text('Dear Sir/Madam,', LEFT, addrY);

    // ── Block 5: Subject heading ────────────────────────────────────────────
    const subjectY = addrY + 10;
    const subject = 'PRACTICAL INDUSTRIAL TRAINING PROGRAMME FOR STUDENTS';
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    const subjectWidth = doc.getTextWidth(subject);
    const subjectX = (210 - subjectWidth) / 2;
    doc.text(subject, 105, subjectY, { align: 'center' });
    // Manual underline
    doc.setLineWidth(0.3);
    doc.line(subjectX, subjectY + 0.8, subjectX + subjectWidth, subjectY + 0.8);

    // ── Block 6: Body paragraph 1 ───────────────────────────────────────────
    let bodyY = subjectY + 6;
    const para1 = `Students of Takoradi Technical University pursuing ${studentProfile.programme} are expected to undergo practical industrial training in industry as part of the requirements for the award of their certificate.`;
    bodyY = drawJustifiedParagraph(doc, para1, LEFT, bodyY, CONTENT_W, LINE_H);

    // ── Block 7: Body paragraph 2 ───────────────────────────────────────────
    bodyY += 4;
    const para2 = `It is believed that the attachment programme would bring positive industrial exposure to students. This exercise would enable students to put theory into practice and acquaint themselves with current technological development in industry and commerce.`;
    bodyY = drawJustifiedParagraph(doc, para2, LEFT, bodyY, CONTENT_W, LINE_H);

    // ── Block 8: Body paragraph 3 (mixed bold dates) ───────────────────────
    bodyY += 4;
    const segments = buildDateParagraphSegments(
      studentProfile.programme,
      season.start_date,
      season.end_date
    );
    bodyY = drawMixedParagraph(doc, segments, LEFT, bodyY, CONTENT_W, LINE_H);

    // ── Block 9: Particulars intro ──────────────────────────────────────────
    bodyY += 4;
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.text("The student's particulars are as follows:", LEFT, bodyY);
    bodyY += LINE_H + 2;

    // ── Block 10: Student particulars (label normal, value bold) ───────────
    const particulars = [
      { label: 'REGISTRATION NUMBER: ', value: studentProfile.index_number },
      { label: 'NAME: ', value: studentProfile.full_name.toUpperCase() },
      { label: 'PROGRAMME: ', value: studentProfile.programme.toUpperCase() },
      { label: 'CONTACT NUMBER: ', value: studentProfile.phone },
    ];

    for (const { label, value } of particulars) {
      doc.setFont('times', 'normal');
      doc.setFontSize(11);
      const labelWidth = doc.getTextWidth(label);
      doc.text(label, LEFT, bodyY);
      doc.setFont('times', 'bold');
      doc.text(value, LEFT + labelWidth, bodyY);
      bodyY += LINE_H + 1;
    }

    // ── Block 11: Closing paragraphs ────────────────────────────────────────
    bodyY += 3;
    const closingParas = [
      'We request that the student should be made to familiarize him/herself with all the related sections available in your organization.',
      'For your information, all students at the University are covered by Group Personal Accident Insurance policy.',
      'We count on your usual cooperation.',
    ];
    for (const para of closingParas) {
      bodyY = drawJustifiedParagraph(doc, para, LEFT, bodyY, CONTENT_W, LINE_H);
      bodyY += 3;
    }

    // ── Block 12: Sign-off ──────────────────────────────────────────────────
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.text('Yours faithfully,', LEFT, bodyY);
    bodyY += 5;

    // ── Block 13: Signature/stamp image ────────────────────────────────────
    doc.addImage(stampB64, 'JPEG', LEFT, bodyY, 43, 13);
    bodyY += 13 + 4;

    // ── Block 14: Signatory name and title ──────────────────────────────────
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.text('MARK KOFI O. AREMU (ESQ)', LEFT, bodyY);
    bodyY += LINE_H;
    doc.setFont('times', 'bold');
    doc.text('Head, Industrial Liaison Office', LEFT, bodyY);
    bodyY += LINE_H + 3;

    // ── Block 15: NB section ────────────────────────────────────────────────
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.text('NB: 1. DO NOT ACCEPT THIS LETTER IF IT DOES NOT BEAR THE ORIGINAL STAMP', LEFT, bodyY);
    bodyY += LINE_H;
    // Indent line 2 to align text after "NB: "
    const nbIndent = LEFT + doc.getTextWidth('NB: ');
    doc.text('2. DO NOT ACCEPT THIS LETTER IF THE STUDENT IS NOT PROPERLY DRESSED', nbIndent, bodyY);

    // ── Block 16: Footer image (fixed at bottom) ────────────────────────────
    doc.addImage(footerB64, 'PNG', 15, 268, 180, 19);

    // ── 5. Save ───────────────────────────────────────────────────────────
    doc.save(`TTU_Attachment_Letter_${formData.verification_code}.pdf`);

    return { data: { letterRow: true }, error: null };
  } catch (err) {
    console.error('PDF generation error:', err);
    return { data: { letterRow: true }, error: err };
  }
}
