# Industrial Attachment Management System (IAMS)
## Project Scope & System Specification

**Institution:** Takoradi Technical University
**Faculty:** Faculty of Applied Science
**Department:** Computer Science
**Document Type:** End of Semester Project — Scope & Specification (incl. Technical Architecture)
**Academic Year:** 2025/2026
**Development Model:** Single-developer build, no-framework / no-build-step stack, phased delivery
**Last Updated:** June 21, 2026 — Rev. 8 (see Section 11, Revision History)

---

## 1. Background

Takoradi Technical University (TTU) requires students to undergo Industrial Attachment as part of their academic programme. The process is coordinated by the Industrial Liaison Office, which currently manages the entire attachment lifecycle manually — producing letters by hand, collecting physical logbooks, and tracking student progress with no central system.

This manual approach leads to lost or damaged logbooks, difficulty monitoring students dispersed across multiple companies and zones, delayed supervisor assignments, and inefficient reporting. A digital system is therefore necessary to streamline and modernize the entire process.

---

## 2. Project Objectives

1. To digitize and automate the generation of official industrial attachment request letters.
2. To provide a centralized platform for registering and tracking student placements.
3. To implement GPS-based daily attendance verification for students at their respective companies.
4. To replace the physical logbook with a structured digital equivalent covering daily logs, weekly certifications, and monthly assessments.
5. To facilitate efficient supervision by enabling school-based supervisors to manage their assigned zones and record visit observations.
6. To enable company-based supervisors to assess and certify student performance digitally.
7. To provide the Industrial Liaison Office with a real-time dashboard for monitoring, flagging anomalies, and generating reports.
8. To maintain a complete, auditable record of all attachment seasons for institutional reference.

---

## 3. Project Scope

### 3.1 What the System Will Do (Full Vision)

- Generate official PDF attachment request letters with TTU letterhead, digital stamp, and signature.
- Allow students to submit company details for letter generation and track the number of letters produced per student.
- Enable students to register their accepted placement details, including company name, location, and company supervisor information.
- Verify student physical presence at their company daily using GPS-based check-in and check-out.
- Host a digital logbook per student, capturing daily activity logs, weekly summaries, weekly industry certification, monthly summaries, and monthly industry assessments.
- Manage school supervisor zone assignments and record visit observations and assessments per student.
- Allow company supervisors to certify weekly logs and submit monthly performance assessments.
- Provide an admin dashboard with real-time statistics, alerts, and flags for anomalies such as absences, location mismatches, and excessive letter generation.
- Support multiple attachment seasons and multiple student year groups concurrently.
- Allow the Liaison Office to generate and export attachment reports per student, zone, or season.

### 3.2 What the System Will Not Do

- The system will not allow companies to post vacancies or initiate recruitment of students.
- The system will not replace the final physical submission of the logbook to the department where required.
- The system will not handle financial transactions, stipends, or student allowances.
- The system will not manage general academic records, course registrations, or examinations outside the attachment context.

### 3.3 Phased Delivery

Given a single-developer build, the system is delivered in phases rather than all at once.

**Phase 1 (current build):**
- Attachment letter generation (FR2)
- Placement registration — student submits the company that accepted them (FR3, revised)
- Zone and school-supervisor assignment by the Liaison Office, in batch, after a defined submission window closes (FR6, partial)
- A minimal admin dashboard covering only what Phase 1 produces (FR7, partial)

**Deferred to later phases:**
- Daily GPS attendance check-in/check-out and anomaly flagging (FR4)
- The full digital logbook — daily logs, weekly certification, monthly assessments (FR5)
- School supervisor visit logging and company supervisor certification workflows (remainder of FR6)
- Full dashboard reporting, exports, and notifications (remainder of FR7)

Sections 5 and 7 below mark each requirement and flow step with its phase.

---

## 4. User Roles

| Role | Description & Responsibilities | Active in Phase 1? |
|---|---|---|
| **Admin** (Industrial Liaison Office) | Full control of the system. Manages students, supervisors, zones, and attachment seasons. Assigns zones/supervisors after the submission window closes, audits letters generated. | Yes |
| **Student** | Generates attachment letters and registers their accepted placement. Daily logs, check-in, and logbook submission are added in a later phase. | Yes |
| **School Supervisor** (Lecturer) | Assigned to a zone by the admin. Visit logging and student monitoring are added in a later phase. | Account exists; no functional screens yet |
| **Company Supervisor** (Industry-Based) | Certifies weekly logs and monthly assessments. Added in a later phase. | Account exists; no functional screens yet |

---

## 5. Functional Requirements

### FR1 — Authentication & Account Management *(Phase 1)*

- All users log in with an email address and password through a single shared login page.
- The Admin creates and manages accounts for students, school supervisors, and company supervisors; role is set at account creation and looked up after login to route the user to their dashboard.
- Role-based access control (Row Level Security) ensures each user only sees data relevant to their role.
- Password reset is supported via email verification.

### FR2 — Attachment Letter Generation *(Phase 1)*

- Students access a form to enter company name, address, and optional contact details.
- The system instantly generates a professionally formatted PDF letter per company, embedding the TTU letterhead, official digital stamp, and liaison officer signature.
- Structured address fields (region, city/town, street/landmark) are enforced to ensure valid data entry.
- The system records the total number of letters generated per student, scoped to the active season.
- There is no enforced generation limit and no admin alert tied to the count. The student's letter-generation screen instead displays their own running count, with its visual styling escalating (neutral → amber → red) as the count rises — a self-regulating nudge against overuse, not a hard restriction.
- The admin can still view and audit all letters generated by any student at any time; this audit capability is independent of the (removed) threshold/alert mechanic.
- Letters are generated client-side and downloaded immediately; they are not stored in Supabase Storage. The `letters` table records metadata only (company name, address fields, timestamp). If a student loses the downloaded file, they may regenerate the letter — this will increment their letter count.
- Each generated letter embeds a short verification code (and optionally a QR code) linking to a public lookup page that displays the letter's recorded metadata (student name, company, date) — allowing a receiving company to confirm authenticity without the system storing the actual PDF.
- The TTU letterhead, digital stamp, and signature images are served via short-lived signed URLs at the moment of generation, not from a publicly readable bucket, preventing the underlying assets from being lifted and reused to forge letters outside the system.

### FR3 — Placement Registration *(Phase 1, revised)*

- After a company accepts them, the student opens placement registration **while physically present at the company**.
- The student enters the company's details directly on their own placement record: company name, nature of business, and structured address (region, city/town, street/landmark). There is no shared company directory and no search-and-reuse step — each placement carries its own independent copy of the company's information, even if another student is attached to the same employer.

**Draft auto-save and form durability:**
- When the registration page is first opened (and no existing draft is found), a `draft_id` — a client-generated UUID — is created and stored with the draft. This ID persists for the entire lifetime of the draft: through field edits, page reloads, and sync retries. It is included as a column on the `placements` row when the record is finally written to Supabase, and the database enforces a `UNIQUE` constraint on it. This means that if synchronization is attempted more than once for the same draft — due to a retry, a duplicate tab, or a Background Sync firing after an earlier silent success — the second insert is rejected as a duplicate rather than creating a second placement record.
- The form writes a local draft to IndexedDB (via Dexie.js) as the student fills it in — field by field, not only on final submission. This means the draft survives accidental tab closure, browser crashes, device restarts, and unintentional page refreshes without any action required from the student.
- When the registration page loads, it immediately checks IndexedDB for an existing draft belonging to the current student. If one is found, the form is pre-populated with the saved values so the student can resume exactly where they left off.

**GPS capture (non-blocking):**
- At the moment the student is ready to submit, the device attempts to capture exact coordinates via the browser's geolocation API. If successful, the draft in IndexedDB is updated with the captured coordinates and `location_source` is set to `gps`.
- Location capture does not require an internet connection. Once network connectivity becomes available, the placement is synchronized automatically with the server.
- If GPS is unavailable (permission denied, weak signal, unsupported browser, or no fix within a defined timeout), the student is **not** blocked. The placement proceeds using the structured text address alone, and `location_source` is set to `manual`. There is no manual coordinate-entry fallback — the student never types latitude/longitude; only the text address fields are used in that case.
- GPS is therefore an enhancement layered on top of the always-required text address, not a precondition for submission.

**Submission and sync:**
- On submission, if the device is online, the data is sent to Supabase immediately. The local draft is deleted only after Supabase returns a confirmed success response — not after merely sending the request. If connectivity is lost mid-flight, the draft remains in IndexedDB and the sync is retried automatically when connectivity returns.
- If the device is offline at the moment of submission, the draft remains stored locally with a "Pending sync" status and is synchronized automatically once connectivity is restored — no manual retry required.
- While a draft is pending synchronization, the registration page displays a **"Pending sync"** indicator and the form remains editable. Any field change continues to update the local draft. When synchronization eventually fires, the most recent locally saved version is what gets submitted to the server — not the version that was queued at the moment of the original submission attempt. Once the server confirms receipt, the indicator changes to **"Submitted"** and the form is locked to prevent duplicate submission.

**Private browsing detection:**
- On page load, the system attempts a small test write to IndexedDB to verify that local storage is available. If the test fails — indicating private or incognito browsing — a visible warning banner is displayed: *"You appear to be in private browsing mode. Your placement draft will not be saved if you close this tab."* The student may continue, but does so aware of the risk.

**Window and review:**
- Registration is only accepted while the active season's placement submission window is open.
- There is no individual approval/rejection gate at this stage — submission is acknowledgment that the student has secured a placement. The Liaison Office reviews all placements together once the window closes (see FR6).

### FR4 — Daily Attendance & GPS Verification *(Deferred — Phase 2)*

- Students check in and check out daily through the system using the device's GPS.
- The system compares the student's GPS coordinates against the registered company location and flags entries outside the accepted radius.
- Check-in time, check-out time, hours worked, and location status are recorded for every working day.
- The system automatically flags anomalies including three or more consecutive absences, check-in from an unverified location, unusually short working hours, and missing check-out entries.
- Students may log an absence with a reason when unable to attend.
- Admin and supervisors can view daily attendance records for all relevant students.

### FR5 — Digital Logbook *(Deferred — Phase 2)*

- Each student has a personal digital logbook tied to their active attachment season.
- The logbook includes: student information, organisation profile, weekly daily activity logs (Monday to Sunday), weekly department/section and student remarks, weekly certification by the company supervisor, monthly written summaries, monthly assessment by the company supervisor, and school supervisor visit records.
- The company supervisor certifies each week by submitting their name and confirmation.
- The company supervisor submits a monthly written assessment including an overall rating.
- The school supervisor logs visit observations, remarks, and an assessment score per visit.
- Logbook status progresses through: **Draft → Submitted → Locked (post-certification) → Finalized**. Once a week is certified, the student can no longer edit that week's entries.

### FR6 — Supervision & Zone Management *(Phase 1: assignment only; rest deferred)*

- The Admin defines a fixed set of geographical zones and assigns school supervisors to one or more zones. Zones exist independently of any single attachment season.
- Each attachment season defines a placement submission window (start and end date) during which students may register their placements (see FR3).
- Once the submission window closes, the Admin reviews every submitted placement in a single list and assigns each one to a zone, using that placement's own region/city-town (and GPS coordinates, where captured) to judge which zone it falls into — there is no shared company record to consult. The placement's supervisor is not chosen separately; it follows automatically from whichever school supervisor(s) are linked to that zone.
- During this review, the Admin may instead mark a placement **flagged** (needs more information from the student) or **rejected** (invalid or fraudulent) rather than assigning it. Resolving a flagged or rejected placement in Phase 1 happens outside the system — the Admin contacts the student directly; there is no in-system resubmission flow yet.
- Assignment happens in batch, after the Liaison Office has full visibility of every student's company — not one at a time as each student submits.
- *(Deferred — Phase 2): School supervisors viewing their assigned students, logging visit records, and recording assessment scores.*

### FR7 — Admin Dashboard & Reporting *(Phase 1: minimal subset)*

- **Phase 1:** the admin dashboard shows total submitted placements, placements grouped by status (submitted / assigned / flagged / rejected) and by zone, together with total letters generated per season and per student for audit purposes.
- The admin manages attachment seasons by opening and closing them, including setting the placement submission window.
- The admin can update the digital stamp and signature images used in generated letters.
- *(Deferred — Phase 2): logbook submission status, supervisor visit completion tracking, attendance-based anomaly flags, exportable reports.*

---

## 6. Non-Functional Requirements

| Ref | Requirement | Description | Priority |
|---|---|---|---|
| NFR1 | Mobile Accessibility | The system must be fully usable on mobile browsers, as most students will access it via smartphone. | High |
| NFR2 | Security | All data must be protected with role-based access control and secure authentication. Student location data must be handled with privacy in mind. The TTU letterhead, digital stamp, and signature assets are served via short-lived signed URLs rather than a public bucket, preventing them from being lifted and reused to forge letters outside the system. | High |
| NFR3 | Performance | PDF letter generation should complete within 3 seconds under normal network conditions. GPS capture has no fixed time limit — it is a non-blocking enhancement (see FR3) — but the UI must show a spinner immediately and offer a retry after a defined timeout rather than appearing to hang. | High |
| NFR4 | Usability | The interface must be simple and intuitive enough for students with basic digital literacy to use without training. | High |
| NFR5 | Reliability | Placement registration (Phase 1) and, later, log entries must be capturable offline. Form data is written to local storage incrementally as the student fills the form — not only on submit — so data is preserved across accidental refreshes, browser crashes, and device restarts. Synchronization to the server is automatic the moment connectivity is restored, with no manual retry required. The Background Sync API (where supported) makes this best-effort, not guaranteed — OS-level battery-saver and background restrictions can still delay a pending sync even on its primary target platform (Android Chrome); see Section 9.5. | High |
| NFR6 | Data Integrity | All form inputs must be validated to prevent incomplete or invalid data from being saved. | High |
| NFR7 | Maintainability | The system must be buildable and maintainable by a single developer, with minimal tooling overhead so features can be added quickly without compiler or bundler configuration. | High |

*Note: NFR5 was originally scoped to the digital logbook only; it now applies starting in Phase 1, since placement registration itself depends on offline-capable GPS capture and durable local drafts.*

---

## 7. System Flow Overview — Phase 1

1. The Admin opens an attachment season and defines its placement submission window (e.g. a 1–2 week period).
2. Independently, the Admin pre-configures zones and assigns school supervisors to zones.
3. The Student logs in and generates attachment request letters for preferred companies. The system records the count per student.
4. The Student secures a placement, then — while physically at the company — opens placement registration. The form immediately checks for and restores any existing local draft. The student enters the company's name, nature of business, and structured address directly on their own placement record (no shared company directory), while the system attempts to capture GPS coordinates live as a non-blocking enhancement — falling back to the text address alone if GPS is unavailable. Every field change is auto-saved to IndexedDB. On submission, data is sent to Supabase if online, or held as "Pending sync" if offline, and synchronized automatically when connectivity returns. The local draft is deleted only after the server confirms receipt.
5. Once the submission window closes, the Admin reviews all submitted placements together and assigns each to a zone and school supervisor in a single batch pass.

*(Phase 2 onward: daily GPS check-in/check-out, logbook entries, weekly certification, monthly assessments, supervisor visits, and full reporting.)*

---

## 8. Key Constraints & Assumptions

- Students must have access to a smartphone or computer with internet connectivity to submit a placement. GPS capability is not strictly required — if location capture fails or is unavailable, the student proceeds using the structured text address alone (see FR3); GPS *capture*, when available, works offline, but *submission* always requires connectivity at some point afterward.
- Company supervisors and school supervisors must be issued login credentials by the admin; in Phase 1, these accounts exist but have no functional screens yet.
- The digital stamp and signature used in generated letters are managed exclusively by the Admin.
- A tolerance radius of approximately 200 metres will apply to GPS-based attendance verification once it is built in Phase 2.
- Because GPS capture is non-blocking (FR3), some Phase 1 placements will have no recorded coordinates (`location_source = manual`) — only a text address. Phase 2's daily GPS check-in/check-out (FR4) will need a defined behavior for these cases, since there is nothing to verify a check-in against otherwise (e.g. capturing a reference location during the school supervisor's first visit). This is noted now as a known forward dependency, not solved in Phase 1.
- The system assumes each student is attached to one company per attachment season.
- The system is intended for use by the Department of Computer Science, Takoradi Technical University, and is designed around TTU's existing attachment processes and logbook structure.
- The system is built and maintained by a single developer; technology choices throughout this document prioritize simplicity and build speed over scalability for large engineering teams.
- Placement registration drafts are stored locally in the browser (IndexedDB) and survive accidental refreshes, tab closure, browser crashes, and device restarts. If the user manually clears browser storage before synchronization completes, any unsynchronized data may be permanently lost. The system detects private or incognito browsing on page load and displays a warning to the student when reliable local storage cannot be guaranteed.

---

## 9. Technical Architecture & Stack

### 9.1 Frontend

- Plain HTML, CSS, and vanilla JavaScript (ES modules) — **modernized with Vite**.
- Tailwind CSS loaded via CDN for styling.
- Vite-based Progressive Web App (PWA) with service worker caching for offline resilience.
- Multi-page architecture: entry points at `index.html` and `src/modules/auth/login.html`.
- Organized `src/` directory separating `shell`, `modules`, `shared`, and `styles`.
- Shared logic (Supabase client, auth/role guard, navigation injection, utility functions) lives in `src/shared/`.

### 9.2 Backend — Supabase

A single Supabase project provides:

- **PostgreSQL** for all application data.
- **Supabase Auth** (email/password) implementing FR1.
- **Row Level Security (RLS)** policies enforcing role-based access, scoped to Phase 1 needs first.
- **Supabase Storage** for the digital stamp, signature, and letterhead images, served via short-lived signed URLs generated at the moment of letter generation rather than a publicly readable bucket — preventing these assets from being lifted and reused to forge letters outside the system.
- **Supabase Realtime**, added once the Phase 1 dashboard needs live updates.

The `supabase-js` client is loaded client-side via its CDN/ESM build — no `npm install` or bundler required.

### 9.3 GPS & Location Capture (FR3, Phase 1)

- Browser-native `navigator.geolocation` attempts to capture the company's exact coordinates **at the moment of placement registration**, while the student is physically present — not as a separate step, and not a manually-placed map pin.
- This capture is a non-blocking enhancement, not a precondition for submission. If it succeeds, `latitude`/`longitude` are stored and `location_source` is set to `gps`. If it fails or times out (permission denied, weak signal, unsupported browser), the placement proceeds on the structured text address alone and `location_source` is set to `manual`. There is no manual coordinate-entry fallback — the student never types latitude/longitude.
- Location capture does not require an internet connection. Once network connectivity becomes available, the placement is synchronized automatically with the server.
- Leaflet + OpenStreetMap remain reserved for later phases (e.g. visualizing zones or placements on a map), not for manual pinning.
- A Haversine distance calculation will be used in Phase 2 to verify daily check-ins fall within the ~200 metre tolerance radius defined in Section 8 — for placements with no captured coordinates, Phase 2 will need a defined fallback (see Section 8).

### 9.4 PDF Generation (FR2)

- jsPDF, loaded via CDN, generates attachment letters client-side, overlaying the TTU letterhead, digital stamp, and liaison officer signature images onto a letter template.
- Letters are not stored server-side; only their metadata is recorded. See FR2 for implications.
- Each letter embeds a short verification code (and optionally a QR code) generated alongside the `letters` row. The code resolves to a public lookup page that displays the recorded metadata (student name, company, date) so a receiving company can confirm a letter is genuine without the system ever storing the PDF itself.

### 9.5 Offline Support & Draft Durability (NFR5, Phase 1)

- A hand-written service worker caches static assets for offline page loads.
- Dexie.js (an IndexedDB wrapper, loaded via CDN) manages local draft storage for placement registration. Rather than writing to IndexedDB only on submit, **the form writes a draft on every meaningful field change**, ensuring data is preserved even if the page is closed mid-form. On page reload, the form checks for an existing draft and pre-populates itself automatically so the student can resume exactly where they left off.
- The sync sequence is strict: **send to Supabase → receive confirmed success response → delete local draft**. The local draft is never removed before a confirmed success response. If the request is sent but the connection drops mid-flight, the draft remains intact and the sync is retried on the next connectivity event.
- The **Background Sync API** — supported on Android Chrome, the primary target platform — is registered via the service worker so that a pending sync fires even if the user closes the browser tab while offline. Even on Android Chrome, this is best-effort rather than guaranteed — OS-level battery-saver and background-process restrictions can delay a registered sync — so the `window online` listener also runs as a backstop whenever the tab is open, regardless of platform. Where Background Sync is unavailable entirely (e.g. Safari, Firefox), that `window online` listener is the only mechanism.
- On page load, the system attempts a small test write to IndexedDB to detect whether storage is available. If the attempt fails (indicating private or incognito browsing), a warning banner is shown to the student before they begin filling the form.
- Successfully synchronized drafts are marked as complete and removed from the local queue.
- The same Dexie.js draft mechanism will be reused for offline logbook entries in Phase 2.

**Known limitation:** If a user manually clears browser storage before synchronization completes, any unsynced draft will be permanently lost. This cannot be prevented by a web application and is documented as a known constraint in Section 8.

### 9.6 Hosting & Deployment

- **Vercel**, deploying the `dist/` directory produced by `npm run build`.
- Local development served via **Vite Dev Server** (`npm run dev`).
- A single Supabase project covers both development and production, appropriate for a single-developer academic project.

### 9.7 Phase 1 Data Model

Eight tables cover everything in Phase 1 scope. There is no separate `companies` table — company information is captured directly on each student's `placements` row rather than shared and reused across students.

- **`profiles`** — `id` (FK → `auth.users.id`), `role`, `full_name`, `phone`, `created_at`. Contains only data common to every user regardless of role; no nullable role-specific fields.
- **`students`** — `id` (PK, FK → `profiles.id`), `index_number`, `department`, `programme`, `level`. A row exists here only when `profiles.role = 'student'`; admin and supervisor profiles have no corresponding row in this table.
- **`seasons`** — `id`, `name`, `start_date`, `end_date`, `status` (upcoming/open/closed/archived), `placement_window_start`, `placement_window_end`. **Constraint:** at most one season may carry the `open` status at any time; this is enforced at the application layer (Admin UI prevents opening a second season while one is already open) and documented as a business rule.
- **`zones`** — `id`, `name`, `description`
- **`zone_supervisors`** — `zone_id`, `school_supervisor_id` (junction table)
- **`placements`** — `id`, `draft_id` (client-generated UUID, `UNIQUE` — idempotency key preventing duplicate inserts on retry), `student_id`, `season_id`, `company_name`, `nature_of_business`, `region`, `city_town`, `street_landmark`, `contact_person`, `company_contact_phone`, `latitude` (nullable), `longitude` (nullable), `location_source` (`gps`/`manual`, `NOT NULL` — every row declares one or the other, see constraint below), `start_date`, `end_date`, `status` (`submitted`/`flagged`/`rejected`/`assigned`), `zone_id`, `synced_at` (timestamp, set by the server on confirmed insert — `NULL` while the record exists only in IndexedDB, populated once the row is written to Supabase), `created_at`. There is no `school_supervisor_id` column on `placements` — the assigned supervisor is derived from `zone_id` via `zone_supervisors`, never stored redundantly (see `placement_supervisors` view below). **Status lifecycle:** a placement always enters as `submitted`; the Admin batch review then moves it to either `assigned` (valid, zone set), `flagged` (needs clarification — student contacted externally), or `rejected` (invalid/fraudulent). A `flagged` placement may subsequently be moved to `assigned` or `rejected` once resolved. There is no transition back to `submitted` in Phase 1, and `assigned`/`rejected` are terminal. This lifecycle is enforced at the database level by a status-transition trigger, not left to client discipline alone.
- **`letters`** — `id`, `student_id`, `season_id`, `company_name`, `region`, `city_town`, `street_landmark`, `contact_person`, `company_contact_phone`, `verification_code` (8-char uppercase alphanumeric, unique; verified at `/verify/{code}`), `generated_at`
- **`settings`** — single-row table (enforced by `CHECK (id = 1)`); `letterhead_path`, `stamp_path`, `signature_path`, `updated_at`, `updated_by`. Seeded with one empty row at migration time so the admin page always uses `UPDATE`, never `INSERT`.

No `letter_threshold` column exists anywhere — the per-student letter count shown in the UI (FR2) is computed live (`COUNT(*)` scoped to the active season), not persisted or enforced. `draft_id` on `placements` is client-generated and carries a `UNIQUE` constraint; `synced_at` is `NULL` while the record lives only in IndexedDB and is populated by the server on confirmed insert. Student-specific academic identity fields (`index_number`, `department`, `programme`, `level`) live in the `students` table rather than `profiles`, keeping `profiles` as a clean common-identity table with no nullable role-specific columns.

**`placement_supervisors` view:** since `placements` carries no `school_supervisor_id`, this view joins `placements.zone_id` against `zone_supervisors` to derive the current supervisor(s) for any placement at query time. It is always live — reassigning a zone's supervisor is reflected immediately for every placement in that zone, with no stale snapshot to update.

**Database-enforced integrity (beyond RLS):** a handful of business rules that would otherwise depend on client/application discipline are instead enforced by triggers, the same way the single-open-season rule is enforced by a partial unique index rather than left to the Admin UI alone:
- *Role integrity* — `students.id` must reference a `profiles` row with `role = 'student'`, and `zone_supervisors.school_supervisor_id` must reference a `profiles` row with `role = 'school_supervisor'`. Foreign keys alone can't express this, since they don't know about enum values on a different table.
- *Status transitions* — the `placements.status` lifecycle described above is validated on every update; any transition not in that list is rejected, including reversion to `submitted` and any change attempted on a terminal `assigned`/`rejected` row.
- *Field locking* — when a student updates their own `submitted` placement, `zone_id` and `synced_at` are silently reverted to their prior values regardless of what the client sends. RLS's `WITH CHECK` on that policy only constrains `student_id` and `status`; this trigger closes the remaining gap for anyone calling the REST API directly rather than through the HTML form.
- *Attribution* — `updated_by` is stamped with the acting user's ID on every update to `seasons`, `zones`, `placements`, and `settings`, overwriting whatever the client sends. This removes any reliance on the client remembering to set it correctly.

**Future Schema Evolution:** Additional Phase 2 tables (attendance, logbook entries, supervisor visits, assessments, anomaly flags, notifications, and application settings) will reference the Phase 1 `placements` table rather than duplicating student or company information, preserving normalization while allowing the schema to grow incrementally.

Tables needed only for Phase 2 (attendance, daily/weekly/monthly logbook entries, supervisor visits, anomaly flags, stamp/signature settings) are intentionally left out of this phase's schema and will be added when that work begins.

### 9.8 Stack Rationale

This modernized Vite-based stack was chosen to balance developer experience with production performance. By using Vite for multi-page bundling and PWA support, we maintain rapid iteration while ensuring the application is installable and resilient offline. The `src/` reorganization separates core shell logic from domain-specific modules, keeping the codebase maintainable as Phase 2 features are added.

---

## 10. Project Structure — Phase 1

```
iams/
├── package.json                       → scripts (dev, build, preview)
├── vite.config.js                    → multi-page config + PWA settings
├── index.html                        → authenticated app entrance (redirects to auth if signed out)
│
├── public/                           → static assets copied to dist/
│   ├── manifest.webmanifest
│   └── assets/
│       └── logo/ttu_logo.png
│
├── src/
│   ├── shared/
│   │   ├── supabase-client.js        → Supabase init
│   │   ├── utils.js                 → shared validation, helpers
│   │   ├── services/                → Supabase service layer
│   │   ├── sync/                    → Dexie/Sync logic
│   │   └── pdf/                     → jsPDF generation
│   │
│   ├── shell/                       → core UI framework
│   │   ├── nav.js                   → shell renderer + navigation
│   │   ├── shell-config.js          → role-based menu layouts
│   │   └── shell.css                → shell-specific styles
│   │
│   ├── styles/                      → core design system
│   │   └── theme.css                → custom properties + component tokens
│   │
│   └── modules/                      → domain-specific pages/logic
│       ├── auth/
│       │   ├── login.html           → public sign-in page
│       │   ├── login.js             → auth UI logic
│       │   └── auth-guard.js        → role-based routing guard
│       ├── admin/                   → role-specific dashboards
│       │   └── ...
└── ...docs, etc.
│
└── supabase/
    ├── schema.sql                     → Phase 1 table definitions
    ├── rls-policies.sql               → Phase 1 RLS rules
    └── seed.sql                       → optional test data
```

`shared/sync/offline-queue.js` carries four responsibilities: the Dexie.js draft store and auto-save logic, sync-on-reconnect (via `window online` event), Background Sync API registration (via the service worker), and incognito/private-browsing detection on page load. `shared/services/` modules are the only layer that calls Supabase — student and admin page scripts call services, never the Supabase client directly. `shared/pdf/generate-letter.js` handles jsPDF assembly and signed-URL asset fetching, keeping letter logic out of the student page script.

`company-supervisor/` and `school-supervisor/` folders are intentionally not created yet — those accounts exist (FR1), but no functional pages are built for them until Phase 2.

No `node_modules`, build config, or compiled output directory exists in this repository: what's committed is exactly what gets deployed.

---

## 11. Revision History

| Date | Change |
|---|---|
| 2026-06-21 | (Rev. 8) `placements.school_supervisor_id` removed. The assigned supervisor is now derived from `zone_id` via `zone_supervisors` rather than stored redundantly — eliminates the risk of a placement pointing to a supervisor who has since been reassigned off that zone. Added `placement_supervisors` view to compute this at query time. No RLS policy changes required; the existing supervisor-scoped policies already joined through `zone_id`. |
| 2026-06-21 | (Rev. 8) Added role-integrity triggers: `students.id` must reference a profile with `role = 'student'`; `zone_supervisors.school_supervisor_id` must reference a profile with `role = 'school_supervisor'`. Foreign keys cannot express this across tables, so it was previously unenforced. |
| 2026-06-21 | (Rev. 8) Added `validate_placement_status_transition()` trigger enforcing the documented status lifecycle (`submitted → assigned/flagged/rejected`; `flagged → assigned/rejected`) at the database level. Previously the lifecycle was documented but not enforced — any transition, including reversion to `submitted`, was technically possible. |
| 2026-06-21 | (Rev. 8) Added `lock_admin_only_placement_fields()` trigger. RLS's `WITH CHECK` on the student self-update policy only constrained `student_id` and `status`; a direct API call could still alter `zone_id` or `synced_at` on a `submitted` placement. The trigger now reverts both to their prior value whenever the acting user is a student. |
| 2026-06-21 | (Rev. 8) Added `stamp_updated_by()` trigger on `seasons`, `zones`, `placements`, and `settings`, overwriting `updated_by` with the acting user's ID on every update. Corrects the Rev. 7 entry below, which stated this was already automatic — it was not; only `updated_at` was previously stamped automatically. |
| 2026-06-21 | (Rev. 8) Added `verification_code` format constraint: `CHECK (verification_code ~ '^[A-Z0-9]{8}$')`. Previously documented but not enforced at the database level. |
| 2026-06-21 | (Rev. 8) `location_source` made `NOT NULL`; `placements_location_consistency` tightened to a deterministic pairing — no coordinates → `manual`, coordinates present → `gps` — removing a third state (null coordinates, null source) that Phase 1 should never produce but the constraint previously allowed. Enum comment corrected: `manual` is the Phase 1 GPS-fallback state (text address only), not a deferred manual coordinate-entry feature. |
| 2026-06-21 | (Rev. 7) Added `settings` table (single-row, `CHECK (id=1)`): stores `letterhead_path`, `stamp_path`, `signature_path`, `updated_at`, `updated_by`. Row seeded at migration time. |
| 2026-06-21 | (Rev. 7) Added `updated_at` + `updated_by` audit fields to `seasons`, `zones`, `placements`. *(Correction, see Rev. 8 above: only `updated_at` was stamped automatically at the time; `updated_by` required the client to set it until the Rev. 8 trigger was added.)* |
| 2026-06-21 | (Rev. 7) Project structure refactored: `shared/services/` (one file per domain), `shared/sync/`, `shared/pdf/`. Pages are thin controllers; no Supabase calls outside services. |
| 2026-06-21 | (Rev. 7) `verification_code` format documented: 8-char uppercase alphanumeric, verified at `/verify/{code}`, no expiry in Phase 1. |
| 2026-06-21 | (Rev. 6) Schema normalised: student-specific academic fields (`index_number`, `department`, `programme`, `level`) moved out of `profiles` into a dedicated `students` table (PK/FK → `profiles.id`). `profiles` now contains only data common to every role; no nullable role-specific columns. Table count updated to seven. |
| 2026-06-21 | (Rev. 5) `profiles` expanded: student academic fields added — superseded by Rev. 6 split. |
| 2026-06-21 | (Rev. 5) `seasons`: documented single-open-season rule — at most one season may have `open` status at a time, enforced at the application layer. |
| 2026-06-21 | (Rev. 5) `placements.status`: defined valid lifecycle transitions — `submitted` → `assigned` / `flagged` / `rejected`; `flagged` → `assigned` / `rejected`. No reversion to `submitted` in Phase 1. |
| 2026-06-21 | (Rev. 5) `contact_phone` renamed `company_contact_phone` on both `placements` and `letters` tables to avoid ambiguity with student and supervisor phone fields. |
| 2026-06-21 | (Rev. 5) `utils.js` file tree: removed stale "company search" reference; updated to "shared validation, date helpers, formatting utilities". |
| 2026-06-21 | (Rev. 5) Section 9.7: added Future Schema Evolution note explaining how Phase 2 tables will extend Phase 1 via foreign keys rather than duplication. | Prevents duplicate rows if sync fires more than once for the same draft (retry, duplicate tab, Background Sync after silent success). |
| 2026-06-21 | (Rev. 4) Section 9.7: added `synced_at` (nullable timestamp) to `placements`. NULL while the record is local only; populated by the server on confirmed insert. Provides an auditable record of when each placement left the client. |
| 2026-06-21 | (Rev. 4) Section 9.3 / FR3: rephrased GPS/connectivity sentence to focus on user-visible behavior rather than implementation detail. |
| 2026-06-21 | (Rev. 3) FR3 clarified: a placement in Pending Sync state remains editable; the most recent local draft version is submitted when sync fires, not the version at the time of the original queue. |
| 2026-06-21 | (Rev. 3) FR7 corrected: removed stale reference to "threshold alerts" (removed in FR2); admin dashboard now described as showing total letters generated per season and per student for audit purposes. |
| 2026-06-21 | Removed the shared `companies` table. Company information is now captured per-student directly on `placements`; the company search/reuse step is dropped from FR3. |
| 2026-06-21 | GPS capture in FR3 changed from blocking (hard error if unavailable) to non-blocking — falls back to the structured text address alone, never to manual coordinate entry. |
| 2026-06-21 | FR2's letter-generation threshold and admin alert removed; replaced with a student-facing live count with escalating visual styling (no enforcement). |
| 2026-06-21 | Added a letter verification code (FR2/9.4) and moved stamp/signature/letterhead assets to signed-URL delivery (NFR2/9.2), addressing letter-forgery and asset-leak risk. |
| 2026-06-21 | NFR3 reframed from a hard 3-second GPS+PDF SLA to a UX requirement (spinner, timeout, retry), since GPS is no longer blocking. |
| 2026-06-21 | NFR5 / Section 9.5 clarified that Background Sync is best-effort even on its primary target platform, not guaranteed delivery. |
| 2026-06-21 | Added `flagged` and `rejected` states to placement `status` (FR6) for invalid/incomplete submissions caught during batch review. |
| 2026-06-22 | (Rev. 9) **Modernized with Vite & PWA**. Reorganized project into a `src/` modular structure. `login.html` moved to `src/modules/auth/`. Service Worker + Manifest added for PWA support. Build step introduced for production optimization while maintaining dev speed. |
