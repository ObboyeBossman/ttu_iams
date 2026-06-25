// =============================================================================
// IAMS — shared/pdf/generate-letter.js
// =============================================================================
// Owns the entire PDF assembly pipeline for FR2:
//   1. Calls letters.generateLetter() to insert the metadata row and receive
//      a verification_code back from the server.
//   2. Calls settings.getSettings() to get the three branding asset paths, then
//      getSignedAssetUrl() for each path individually (per-asset, not all-or-
//      nothing) so a missing stamp or signature degrades gracefully to a PDF
//      without that image rather than aborting entirely.
//   3. Resolves each signed URL to a renderable image source — handling both
//      real Supabase https:// URLs (fetch → base64) and the mock's
//      iams-mock-asset:// scheme (resolved via supabase._mock.resolveSignedUrl).
//   4. Builds the PDF layout with jsPDF (CDN/ESM) and triggers a browser
//      download.
//
// Nothing here talks to the `letters` table or `settings` table directly —
// that stays inside services/*.js per Section 10. This file only orchestrates
// the fetch → assemble → download sequence and owns the PDF layout decisions.
//
// NFR3: "PDF generation should complete within 3 seconds under normal network
// conditions." The main latency source is image fetch for three branding
// assets. We resolve all three concurrently (Promise.all) so the serial chain
// is as short as possible:
//   insert metadata → getSettings → resolve 3 signed URLs + fetch 3 images
//   (concurrent) → assemble PDF → download.
//
// Mock compatibility: mock-storage.js issues iams-mock-asset:// URLs that
// can't be fetched directly. resolveImageSource() detects the scheme and
// delegates to supabase._mock.resolveSignedUrl() to get the real data URL.
// Real deployments never reach that branch — the mock escape hatch is
// explicitly _mock-prefixed and never present on the live client.
// =============================================================================

import { supabase } from '../supabase-client.js';
import { generateLetter as insertLetterRow } from '../services/letters.js';
import { getSettings, getSignedAssetUrl } from '../services/settings.js';
import { formatDate, formatAddress } from '../utils.js';

// jsPDF is loaded via CDN. Since this file is always used as an ES module
// (Section 9.1 "no build step, ES modules"), we import the ESM build from
// esm.sh — same pattern as Dexie.js in offline-queue.js. The import is
// deferred inside getJsPDF() rather than at module load so pages that never
// trigger letter generation don't pay the CDN round-trip.
let _jsPDF = null;
async function getJsPDF() {
  if (_jsPDF) return _jsPDF;
  const mod = await import('https://esm.sh/jspdf@2');
  // jsPDF 2.x ESM build exports { jsPDF } as a named export.
  _jsPDF = mod.jsPDF ?? mod.default?.jsPDF ?? mod.default;
  if (!_jsPDF) {
    throw new Error(
      'generate-letter: failed to load jsPDF from CDN — check your internet connection.'
    );
  }
  return _jsPDF;
}

// -----------------------------------------------------------------------
// Image resolution
// -----------------------------------------------------------------------
// Converts a signed URL (real or mock) into a data URL that jsPDF can pass
// to addImage(). Always returns { data: string } | { data: null, error }.
// Never throws — callers check the return shape.

async function resolveImageSource(signedUrl) {
  if (!signedUrl) {
    return { data: null, error: { message: 'generate-letter: signedUrl is empty or null' } };
  }

  // Mock path: iams-mock-asset:// URLs are not real HTTP URLs. The mock
  // client exposes resolveSignedUrl() to turn them into data URLs with
  // proper expiry enforcement. Only present when USE_MOCK = true.
  if (signedUrl.startsWith('iams-mock-asset://')) {
    if (!supabase._mock?.resolveSignedUrl) {
      return {
        data: null,
        error: {
          message:
            'generate-letter: supabase._mock.resolveSignedUrl not available — is USE_MOCK = true in supabase-client.js?',
        },
      };
    }
    const resolved = supabase._mock.resolveSignedUrl(signedUrl);
    if (resolved.error) return { data: null, error: resolved.error };
    return { data: resolved.data.url, error: null };
  }

  // Real path: fetch the image and convert to a base64 data URL so jsPDF
  // can embed it. Supabase Storage enables CORS for the anon key's origin by
  // default, so the fetch itself is safe; the blob→dataURL step keeps the
  // asset embedded in the PDF rather than externally referenced.
  try {
    const resp = await fetch(signedUrl);
    if (!resp.ok) {
      return {
        data: null,
        error: { message: 'generate-letter: image fetch failed (HTTP ' + resp.status + ')' },
      };
    }
    const blob = await resp.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () =>
        reject(new Error('generate-letter: FileReader failed converting image to data URL'));
      reader.readAsDataURL(blob);
    });
    return { data: dataUrl, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message ?? 'generate-letter: unexpected error fetching image' },
    };
  }
}

// Convenience: getSignedAssetUrl → resolveImageSource in one step.
// Returns { data: dataUrl | null, error } — soft failure, never throws.
async function resolveAssetPath(assetPath) {
  const { data: urlData, error: urlError } = await getSignedAssetUrl(assetPath);
  if (urlError) return { data: null, error: urlError };
  return resolveImageSource(urlData.signedUrl);
}

// -----------------------------------------------------------------------
// PDF layout constants — A4 in mm (210 × 297), unit = 'mm'
// -----------------------------------------------------------------------

const PAGE_W  = 210;
const PAGE_H  = 297;
const MARGIN  = 20;
const BODY_W  = PAGE_W - MARGIN * 2;

// Letterhead: full-width band at the top of the page.
const LETTERHEAD_X = MARGIN;
const LETTERHEAD_Y = 10;
const LETTERHEAD_W = BODY_W;
const LETTERHEAD_H = 35;

// Body text starts below the letterhead.
const BODY_START_Y = LETTERHEAD_Y + LETTERHEAD_H + 12;

// Stamp + signature: fixed bottom zone so layout doesn't shift with body length.
const BOTTOM_ZONE_Y = PAGE_H - 60;
const STAMP_X = MARGIN;
const STAMP_W = 40;
const STAMP_H = 40;
const SIG_W   = 60;
const SIG_H   = 25;
const SIG_X   = PAGE_W - MARGIN - SIG_W;

// jsPDF font sizes (pt).
const FONT_BODY    = 11;
const FONT_SMALL   = 9;
const FONT_HEADING = 13;

// -----------------------------------------------------------------------
// PDF builder (internal)
// -----------------------------------------------------------------------

/**
 * Assembles the PDF document and returns the jsPDF instance.
 * All image sources (`urls.*`) must already be data URLs or null at this point.
 */
async function buildPdf(letterRow, studentName, urls, verifyBaseUrl) {
  const jsPDF = await getJsPDF();
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── 1. Letterhead ──────────────────────────────────────────────────────
  if (urls.letterheadUrl) {
    try {
      doc.addImage(
        urls.letterheadUrl, 'PNG',
        LETTERHEAD_X, LETTERHEAD_Y, LETTERHEAD_W, LETTERHEAD_H
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('generate-letter: could not embed letterhead:', e.message);
    }
  }

  // ── 2. Date (top-right) ────────────────────────────────────────────────
  let y = BODY_START_Y;
  doc.setFontSize(FONT_SMALL);
  doc.setTextColor(100);
  const dateStr = formatDate(letterRow.generated_at ?? new Date().toISOString());
  doc.text(dateStr, PAGE_W - MARGIN, y, { align: 'right' });
  y += 6;

  // ── 3. Recipient block ─────────────────────────────────────────────────
  doc.setFontSize(FONT_BODY);
  doc.setTextColor(0);
  doc.setFont(undefined, 'bold');
  doc.text('To,', MARGIN, y);
  y += 5;

  doc.setFont(undefined, 'normal');
  if (letterRow.contact_person) {
    doc.text(letterRow.contact_person, MARGIN, y);
    y += 5;
  }
  doc.text(letterRow.company_name, MARGIN, y);
  y += 5;

  const fullAddress = formatAddress({
    street_landmark: letterRow.street_landmark,
    city_town:       letterRow.city_town,
    region:          letterRow.region,
  });
  const addrLines = doc.splitTextToSize(fullAddress, BODY_W * 0.6);
  doc.text(addrLines, MARGIN, y);
  y += addrLines.length * 5 + 3;

  if (letterRow.company_contact_phone) {
    doc.setFontSize(FONT_SMALL);
    doc.text('Tel: ' + letterRow.company_contact_phone, MARGIN, y);
    doc.setFontSize(FONT_BODY);
    y += 5;
  }
  y += 4;

  // ── 4. Subject line ────────────────────────────────────────────────────
  doc.setFont(undefined, 'bold');
  doc.setFontSize(FONT_HEADING);
  doc.text('RE: INDUSTRIAL ATTACHMENT REQUEST', MARGIN, y);
  y += 8;

  // ── 5. Salutation ──────────────────────────────────────────────────────
  doc.setFont(undefined, 'normal');
  doc.setFontSize(FONT_BODY);
  doc.text('Dear Sir/Madam,', MARGIN, y);
  y += 8;

  // ── 6. Body paragraphs ─────────────────────────────────────────────────
  const para1 =
    'We write to formally introduce ' + studentName + ', a student of Takoradi Technical University ' +
    '(TTU), who is currently pursuing their academic programme and is required to undergo Industrial ' +
    'Attachment as part of their course of study.';
  const p1Lines = doc.splitTextToSize(para1, BODY_W);
  doc.text(p1Lines, MARGIN, y);
  y += p1Lines.length * 6 + 4;

  const para2 =
    'We respectfully request that your esteemed organisation provide an attachment placement for ' +
    studentName + '. The period of attachment is typically one academic semester. We trust that this ' +
    'opportunity will be mutually beneficial and help the student gain practical experience in an ' +
    'industry setting.';
  const p2Lines = doc.splitTextToSize(para2, BODY_W);
  doc.text(p2Lines, MARGIN, y);
  y += p2Lines.length * 6 + 4;

  const para3 =
    'Should you require any additional information, please do not hesitate to contact the Industrial ' +
    'Liaison Office. We thank you in advance for your consideration and cooperation.';
  const p3Lines = doc.splitTextToSize(para3, BODY_W);
  doc.text(p3Lines, MARGIN, y);
  y += p3Lines.length * 6 + 8;

  // ── 7. Closing ─────────────────────────────────────────────────────────
  doc.text('Yours faithfully,', MARGIN, y);
  doc.text('For: The Industrial Liaison Office', MARGIN, y + 5);
  doc.text('Takoradi Technical University', MARGIN, y + 10);

  // ── 8. Stamp (bottom-left, fixed zone) ────────────────────────────────
  if (urls.stampUrl) {
    try {
      doc.addImage(urls.stampUrl, 'PNG', STAMP_X, BOTTOM_ZONE_Y, STAMP_W, STAMP_H);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('generate-letter: could not embed stamp:', e.message);
    }
  }

  // ── 9. Signature (bottom-right, fixed zone) ───────────────────────────
  if (urls.signatureUrl) {
    try {
      doc.addImage(urls.signatureUrl, 'PNG', SIG_X, BOTTOM_ZONE_Y, SIG_W, SIG_H);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('generate-letter: could not embed signature:', e.message);
    }
  }
  doc.setFontSize(FONT_SMALL);
  doc.setTextColor(80);
  doc.text('Authorised Signatory', SIG_X + SIG_W / 2, BOTTOM_ZONE_Y + SIG_H + 4, {
    align: 'center',
  });

  // ── 10. Verification code footer ──────────────────────────────────────
  // FR2: "each letter embeds a short verification code linking to a public
  // lookup page." No QR code in Phase 1 (spec says "optionally" — the page
  // script can layer one on via a qrcode library if desired).
  const FOOTER_Y   = PAGE_H - 8;
  const verifyPath = verifyBaseUrl
    ? verifyBaseUrl.replace(/\/$/, '') + '/' + letterRow.verification_code
    : null;

  doc.setDrawColor(180);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, FOOTER_Y - 3, PAGE_W - MARGIN, FOOTER_Y - 3);

  doc.setFontSize(FONT_SMALL - 1);
  doc.setTextColor(120);
  doc.text('Verification code: ' + letterRow.verification_code, MARGIN, FOOTER_Y);
  if (verifyPath) {
    doc.text('Verify at: ' + verifyPath, MARGIN, FOOTER_Y + 4);
  }

  return doc;
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * The single function page scripts call. Handles the full pipeline:
 *   insert metadata row → fetch settings → resolve + fetch 3 branding images
 *   (concurrent) → build PDF → trigger browser download.
 *
 * @param {Object} letterInput  Fields from the student's form:
 *   { student_id, season_id, company_name, region, city_town, street_landmark,
 *     contact_person, company_contact_phone }
 *   Passed directly to letters.generateLetter() — see letters.js for validation.
 *
 * @param {string} studentName  The signed-in student's full_name, resolved by
 *   the calling page from modules/auth/auth-guard.js + getStudentById(). Not re-queried
 *   here so this function stays stateless and decoupled from auth state.
 *
 * @param {Object} [options]
 *   options.verifyBaseUrl — base URL for the public /verify/ page (defaults to
 *     window.location.origin + '/verify'). Override in tests or if the verify
 *     page lives at a different path.
 *
 * @returns {{ data: { letterRow, filename } | null, error: { message } | null }}
 *   On success: data.letterRow is the confirmed DB row (includes
 *     verification_code and generated_at) so the page can update its letter
 *     count display without a separate refetch. data.filename is the
 *     downloaded filename string.
 *   On any error after the row is inserted: data.letterRow is still returned
 *     (non-null) with data.filename = null, so the page can at minimum reflect
 *     the count update even if PDF assembly failed.
 *   On row-insert failure: data is null.
 */
export async function generateAndDownloadLetter(letterInput, studentName, options) {
  const verifyBaseUrl =
    (options && options.verifyBaseUrl) ||
    (typeof window !== 'undefined'
      ? window.location.origin + '/verify'
      : '/verify');

  // ── Step 1: Insert the metadata row ──────────────────────────────────
  // Must happen before image fetches so the verification_code exists in the
  // DB before we embed it in the PDF. Stop early on failure — no row means
  // no code to embed.
  const { data: letterRow, error: insertError } = await insertLetterRow(letterInput);
  if (insertError) {
    return { data: null, error: insertError };
  }

  // ── Step 2: Fetch settings ────────────────────────────────────────────
  const { data: settingsRow, error: settingsError } = await getSettings();
  if (settingsError) {
    return {
      data: { letterRow: letterRow, filename: null },
      error: {
        message:
          'Letter recorded but PDF could not be assembled: ' + settingsError.message,
      },
    };
  }

  // ── Step 3: Resolve all three branding assets concurrently ────────────
  // Per-asset resolution so a missing/unset path degrades softly rather
  // than aborting the whole pipeline. getSignedAssetUrl() returns an error
  // for a null/empty path (see settings.js), which resolveAssetPath()
  // passes through as { data: null, error } — buildPdf() skips addImage()
  // for any null URL.
  const [letterheadResult, stampResult, signatureResult] = await Promise.all([
    resolveAssetPath(settingsRow.letterhead_path),
    resolveAssetPath(settingsRow.stamp_path),
    resolveAssetPath(settingsRow.signature_path),
  ]);

  const resolvedUrls = {
    letterheadUrl: letterheadResult.data || null,
    stampUrl:      stampResult.data      || null,
    signatureUrl:  signatureResult.data  || null,
  };

  // Log any asset failures for the developer — don't surface to the student.
  for (const pair of [
    ['letterheadUrl', letterheadResult],
    ['stampUrl',      stampResult],
    ['signatureUrl',  signatureResult],
  ]) {
    if (pair[1].error) {
      // eslint-disable-next-line no-console
      console.warn('generate-letter: ' + pair[0] + ' could not be resolved:', pair[1].error.message);
    }
  }

  // ── Step 4: Build the PDF ─────────────────────────────────────────────
  let doc;
  try {
    doc = await buildPdf(letterRow, studentName, resolvedUrls, verifyBaseUrl);
  } catch (buildErr) {
    return {
      data: { letterRow: letterRow, filename: null },
      error: {
        message:
          'Letter recorded but PDF assembly failed: ' +
          (buildErr.message || String(buildErr)),
      },
    };
  }

  // ── Step 5: Trigger browser download ──────────────────────────────────
  // Filename includes verification code + date so re-generated letters for
  // the same company are distinguishable in the student's downloads folder.
  const datePart  = (letterRow.generated_at || new Date().toISOString()).slice(0, 10);
  const namePart  = studentName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const filename  =
    'ttu-attachment-letter-' + namePart + '-' + letterRow.verification_code + '-' + datePart + '.pdf';

  try {
    doc.save(filename);
  } catch (saveErr) {
    return {
      data: { letterRow: letterRow, filename: null },
      error: {
        message:
          'Letter recorded and PDF built but download failed: ' +
          (saveErr.message || String(saveErr)),
      },
    };
  }

  return { data: { letterRow: letterRow, filename: filename }, error: null };
}