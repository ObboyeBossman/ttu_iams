# Task: Rewrite `generate-letter.js` to match the real TTU letter format

You are rewriting `src/shared/pdf/generate-letter.js` from scratch. The current stub generates a generic PDF. You must replace it with a jsPDF implementation that exactly reproduces the official TTU Industrial Liaison Office attachment request letter.

---

## What you have available

### Three assets in Supabase Storage (fetched as signed URLs via the `get-signed-urls` Edge Function)

| Storage key | Description | Source dimensions |
|---|---|---|
| `letterhead` | Full-width banner: TTU logo left, "INDUSTRIAL LIAISON OFFICE / P.O. BOX 256..." right, separator rule at bottom | 1391 × 298 px JPEG |
| `stamp` | Combined signature + ILO circular stamp image: "Industrial Liaison Office / Takoradi Technical University / Takoradi" with handwritten signature overlaid | 354 × 106 px JPEG |
| `footer` | Full-width footer: tri-colour rule at top, "Powered by Directorate of ICT Services" left, phone number + TTU crest right | 1393 × 152 px PNG |

The `get-signed-urls` Edge Function already exists and accepts `{ paths: ['letterhead', 'stamp', 'footer'] }`. It returns `{ letterhead, stamp, footer }` — short-lived signed URLs. Fetch all three before building the PDF. If any signed URL fetch fails, throw a descriptive error — do not generate a letter with a missing asset.

### Data passed into the function

```js
generateAndDownloadLetter(formData, studentProfile)
```

`formData` (already inserted into the `letters` table before this function is called — do not re-insert):
```js
{
  student_id,
  season_id,
  company_name,          // e.g. "GHANA PORTS AND HARBOURS AUTHORITY"
  region,                // e.g. "Western Region"
  city_town,             // e.g. "Takoradi"
  street_landmark,       // captured but NOT shown in addressee block (see layout below)
  contact_person,        // captured but NOT shown in addressee block
  company_contact_phone, // captured but NOT shown in addressee block
  verification_code,     // 8-char uppercase alphanumeric, e.g. "A3F9B1C2"
  generated_at,          // ISO timestamp
}
```

`studentProfile` (fetched from `student_profiles` view before calling this function):
```js
{
  full_name,    // e.g. "KWAME ASANTE"
  index_number, // e.g. "TTU/CSC/23/001"
  programme,    // e.g. "HND Computer Science"
  phone,        // student's phone number
}
```

`season` (also passed in — fetch from `seasons` service before calling):
```js
{
  start_date,  // e.g. "2026-01-06"
  end_date,    // e.g. "2026-06-27"
}
```

Update the function signature to: `generateAndDownloadLetter(formData, studentProfile, season)`.

---

## Exact letter layout — implement this precisely

The real letter is A4 portrait. Use jsPDF with `format: 'a4'`, `unit: 'mm'`. A4 = 210 mm wide × 297 mm tall. Use left margin 20 mm, right margin 15 mm (content width = 175 mm), matching the tight original margins.

### Block 1 — Letterhead image
- Position: x=15, y=5, width=180, height=30.5 mm
- Fetch signed URL, convert to base64 via `fetch → arrayBuffer → Uint8Array`, pass to `doc.addImage(data, 'JPEG', 15, 5, 180, 30.5)`

### Block 2 — Reference number
- y=40, left-aligned at x=20
- Text: `TTU/ILO/IAP/VOL.2/16`  ← this is a fixed institutional reference; do not make it dynamic
- Font: Times New Roman, normal, 11pt, color #000000

### Block 3 — Date
- Same y=40, right-aligned at x=195
- Format: `12TH AUGUST, 2025` style — use `formatLetterDate(dateStr)` (implement this helper below)
- Font: Times New Roman, normal, 11pt

### Block 4 — Addressee block
- Starts y=52, left-aligned x=20, line height 6 mm
- Line 1: `THE MANAGER`
- Line 2: `company_name` (uppercase)
- Line 3: `city_town` (uppercase)
- Line 4: `Dear Sir/Madam,`
- Font: Times New Roman, normal, 11pt

### Block 5 — Subject heading
- y=82 (after a blank line gap)
- Centred at x=105
- Text: `PRACTICAL INDUSTRIAL TRAINING PROGRAMME FOR STUDENTS`
- Font: Times New Roman, **bold**, 11pt, underlined
- Draw underline manually: `doc.line(x_start, y+1, x_end, y+1)` where x_start/end are computed from `doc.getTextWidth()`

### Block 6 — Body paragraph 1
- y=93, justified text, width=175 mm
- Text: `Students of Takoradi Technical University pursuing {programme} are expected to undergo practical industrial training in industry as part of the requirements for the award of their certificate.`
- Replace `{programme}` with `studentProfile.programme`
- Font: Times New Roman, normal, 11pt
- Use `doc.splitTextToSize(text, 175)` then `doc.text(lines, 20, 93, { align: 'justify' })`

### Block 7 — Body paragraph 2
- y after para 1 + 5 mm gap
- Text: `It is believed that the attachment programme would bring positive industrial exposure to students. This exercise would enable students to put theory into practice and acquaint themselves with current technological development in industry and commerce.`
- Same font + justified

### Block 8 — Body paragraph 3 (with bold dates)
- y after para 2 + 5 mm gap
- This paragraph has mixed formatting — build it in segments:
  1. Normal: `The University would, therefore, be grateful if you could consider the under-mentioned student to undertake his/her industrial attachment programme in your organization from `
  2. **Bold**: `{ordinal(start_date)} to {ordinal(end_date)}`  (e.g. `25th August, 2026 to 27th June, 2026`)
  3. Normal: `.`
- Use `doc.setFont('times', 'normal')` / `doc.setFont('times', 'bold')` per segment, tracking x position manually for inline bold. Wrap the full paragraph using pre-computation of where bold starts/ends within `splitTextToSize` output — or use a word-by-word approach. Either is acceptable as long as the bold dates render correctly.
- Implement `formatAttachmentDate(isoDate)` → `"25th August, 2026"` using ordinal suffixes (1st, 2nd, 3rd, 4th–20th, 21st, 22nd, 23rd, 24th–30th, 31st).

### Block 9 — Particulars intro
- y after para 3 + 5 mm gap
- Text: `The student's particulars are as follows:`
- Font: Times New Roman, normal, 11pt

### Block 10 — Student particulars (bold labels + values, each on own line)
- y after intro + 6 mm, line height 7 mm
- 4 lines, each bold:
  ```
  REGISTRATION NUMBER: {index_number}
  NAME: {full_name} (uppercase)
  PROGRAMME: {programme} (uppercase)
  CONTACT NUMBER: {phone}
  ```
- Font: Times New Roman, **bold**, 11pt

### Block 11 — Closing paragraphs (3, each separated by 5 mm)
- After a 5 mm gap after particulars:
  1. `We request that the student should be made to familiarize him/herself with all the related sections available in your organization.`
  2. `For your information, all students at the University are covered by Group Personal Accident Insurance policy.`
  3. `We count on your usual cooperation.`
- Font: Times New Roman, normal, 11pt, justified

### Block 12 — Sign-off
- 5 mm after final closing paragraph
- Text: `Yours faithfully,`
- Font: Times New Roman, normal, 11pt

### Block 13 — Signature/stamp image
- 5 mm after sign-off
- Fetch signed URL, convert to base64
- `doc.addImage(data, 'JPEG', 20, y, 43, 13)` — maintain 354:106 aspect ratio at ~40% scale
- This image already contains the circular stamp overlay; no separate stamp image is needed

### Block 14 — Signatory name and title
- 4 mm after signature image bottom edge
- Line 1: `MARK KOFI O. AREMU (ESQ)` — bold 11pt  ← fixed; do not make dynamic
- Line 2: `Head, Industrial Liaison Office` — normal 11pt

### Block 15 — Verification code box
- Positioned at the bottom of the page: y=255 (above footer)
- A thin-bordered rectangle: `doc.rect(20, 255, 175, 10)`
- Inside: `Verification Code: {verification_code}  |  Verify at: ttu.edu.gh/verify/{verification_code}`
- Font: Times New Roman, normal, 9pt, centred
- Border color: #888888 (use `doc.setDrawColor(136, 136, 136)`)
- Text color: #444444

### Block 16 — Footer image
- Fixed position: y=268, x=15, width=180, height=19 mm
- `doc.addImage(data, 'PNG', 15, 268, 180, 19)`

---

## Helper functions to implement

```js
// Returns "25th August, 2026"
function formatAttachmentDate(isoDateStr) { … }

// Returns "12TH AUGUST, 2025" (for the date line at top)
function formatLetterDate(isoDateStr) { … }

// Ordinal suffix: 1 → "st", 2 → "nd", 3 → "rd", else "th"
function ordinalSuffix(n) { … }
```

---

## Function signature and return contract

```js
/**
 * Generates and triggers download of the official TTU attachment letter PDF.
 *
 * @param {Object} formData        - Letter metadata (already inserted into `letters` table)
 * @param {Object} studentProfile  - { full_name, index_number, programme, phone }
 * @param {Object} season          - { start_date, end_date }
 * @returns {{ data: { letterRow: true }, error: null }}  on full success
 * @returns {{ data: { letterRow: true }, error: Error }} if PDF generation fails after DB insert
 * @throws  if signed URL fetch fails (caller shows blocking error, no download attempted)
 */
export async function generateAndDownloadLetter(formData, studentProfile, season) { … }
```

The function must:
1. Call the `get-signed-urls` Edge Function for `['letterhead', 'stamp', 'footer']`
2. Fetch each signed URL and convert to base64 (`arrayBuffer → Uint8Array → base64 string`)
3. Build the jsPDF document following the layout above
4. Call `doc.save(`TTU_Attachment_Letter_${formData.verification_code}.pdf`)`
5. Return `{ data: { letterRow: true }, error: null }` on success
6. Catch jsPDF/rendering errors and return `{ data: { letterRow: true }, error: err }` — the DB row already exists; only the download failed

---

## What NOT to do

- Do not re-insert into the `letters` table — the caller does that before invoking this function
- Do not import `supabase-client.js` directly — call the Edge Function via `fetch` with the anon key from `import.meta.env`
- Do not use `localStorage` or any persistent storage
- Do not generate a QR code in Phase 1 — the verification code as text is sufficient
- Do not use any npm package other than jsPDF (loaded via CDN in the HTML, available as `window.jspdf.jsPDF`)
- Do not show the `contact_person`, `street_landmark`, or `company_contact_phone` in the addressee block — these are stored in the DB for audit but do not appear in the letter body

---

## Caller changes required in `letters.js`

Update `handleSubmit` to:
1. First insert the `letters` row via `createLetter(formData)` from `letters.service.js` — get back `{ data: letterRow, error }`
2. If insert fails, show error and stop
3. Then call `generateAndDownloadLetter({ ...formData, verification_code: letterRow.verification_code, generated_at: letterRow.generated_at }, studentProfile, currentSeason)`
4. Handle the two-tier error response as before

Update `letters.service.js` to export a `createLetter(formData)` function that:
- Generates `verification_code` client-side using `generateVerificationCode()` from `utils.js`
- Inserts into `letters` table
- Returns `{ data: insertedRow, error }`

Update `getStudentProfile` call in `letters.js` to use `students.service.js` (not `auth.service.js`) and ensure it returns `{ full_name, index_number, programme, phone }`.

---

## Output

Produce the complete rewritten files in full — no stubs, no TODOs:

1. `src/shared/pdf/generate-letter.js`
2. `src/shared/services/letters.service.js` (updated)
3. `src/modules/student/letters.js` (updated `handleSubmit` and import for `getStudentProfile`)
