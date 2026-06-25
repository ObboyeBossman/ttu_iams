# IAMS Full-Project Generation Prompt
## Industrial Attachment Management System — Takoradi Technical University
### For use with any capable AI coding assistant

---

## HOW TO USE THIS PROMPT

Paste everything from the `---BEGIN PROMPT---` marker to the `---END PROMPT---` marker into your AI assistant as a single message. The prompt is self-contained — it carries the full specification, database schema, RLS policies, and seed data inline so the AI has complete context without needing to read external files.

---BEGIN PROMPT---

# TASK: Generate the complete IAMS project — all phases

You are an expert full-stack developer. Your job is to generate the **complete, production-ready source code** for the Industrial Attachment Management System (IAMS) described in this prompt. Output every file in full — no placeholders, no "fill this in later", no stubs. The entire codebase must be immediately runnable after the developer pastes in their Supabase project URL and anon key.

---

## 1. SYSTEM OVERVIEW

**Institution:** Takoradi Technical University (TTU), Department of Computer Science  
**System:** Industrial Attachment Management System (IAMS)  
**Purpose:** Digitize TTU's student industrial attachment lifecycle — from generating official request letters, through placement registration and zone assignment, to daily GPS check-in, digital logbooks, supervisor assessments, and admin reporting.  
**Build model:** Single developer. Simplicity and build speed over enterprise scalability.

---

## 2. TECH STACK — MUST FOLLOW EXACTLY

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Plain HTML + CSS + Vanilla JavaScript (ES Modules) via **Vite** | No React, Vue, Angular, or other frameworks. Tailwind CSS via CDN for styling. |
| PDF | **jsPDF** via CDN | Client-side letter generation. Never server-side. |
| Local Storage | **Dexie.js** via CDN | IndexedDB wrapper for offline drafts. |
| Maps (Phase 2+) | **Leaflet + OpenStreetMap** via CDN | Zone/placement visualization only. Not for manual pin-drop. |
| Backend | **Supabase** (PostgreSQL + Auth + RLS + Storage + Realtime) | supabase-js loaded via CDN/ESM, no npm install needed for the client. |
| Build Tool | **Vite** | Multi-page app. PWA plugin for service worker + manifest. |
| Hosting | **Vercel** (deploys `dist/` from `npm run build`) | |
| GPS | Browser-native `navigator.geolocation` | Non-blocking. Falls back to text address silently. |

**Do NOT use:** React, Next.js, Vue, Angular, Express, any server-side rendering, any npm package that requires a bundler for the frontend beyond what Vite handles, `localStorage` for drafts (must use IndexedDB/Dexie.js).

---

## 3. PROJECT STRUCTURE

Generate all files inside this exact directory tree. Create every file completely.

```
iams/
├── package.json
├── vite.config.js
├── .env.example
├── vercel.json
├── index.html                          ← authenticated app shell (redirects to login if signed out)
├── verify.html                         ← PUBLIC letter verification page /verify/{code}
│
├── public/
│   ├── manifest.webmanifest
│   └── assets/
│       └── logo/
│           └── ttu_logo.png            ← placeholder SVG (real PNG dropped in by admin)
│
├── src/
│   ├── shared/
│   │   ├── supabase-client.js          ← Supabase init (reads from import.meta.env)
│   │   ├── utils.js                    ← validation, formatters, date helpers, Haversine
│   │   ├── services/
│   │   │   ├── auth.service.js
│   │   │   ├── seasons.service.js
│   │   │   ├── placements.service.js
│   │   │   ├── letters.service.js
│   │   │   ├── zones.service.js
│   │   │   ├── supervisors.service.js
│   │   │   ├── students.service.js
│   │   │   ├── settings.service.js
│   │   │   ├── attendance.service.js   ← Phase 2
│   │   │   └── logbook.service.js      ← Phase 2
│   │   ├── sync/
│   │   │   └── offline-queue.js        ← Dexie store, auto-save, sync-on-reconnect, BG Sync, incognito detect
│   │   └── pdf/
│   │       └── generate-letter.js      ← jsPDF assembly + signed URL asset fetching
│   │
│   ├── shell/
│   │   ├── nav.js                      ← shell renderer, navigation injection
│   │   ├── shell-config.js             ← role-based menu layouts
│   │   └── shell.css
│   │
│   ├── styles/
│   │   └── theme.css                   ← custom properties, component tokens, Tailwind extensions
│   │
│   └── modules/
│       ├── auth/
│       │   ├── login.html
│       │   ├── login.js
│       │   └── auth-guard.js           ← role-based routing guard
│       │
│       ├── student/
│       │   ├── dashboard.html
│       │   ├── dashboard.js
│       │   ├── letters.html            ← FR2 letter generation
│       │   ├── letters.js
│       │   ├── placement.html          ← FR3 placement registration (offline-capable)
│       │   ├── placement.js
│       │   ├── attendance.html         ← FR4 daily check-in/check-out (Phase 2)
│       │   ├── attendance.js
│       │   ├── logbook.html            ← FR5 digital logbook (Phase 2)
│       │   └── logbook.js
│       │
│       ├── admin/
│       │   ├── dashboard.html          ← FR7 admin dashboard
│       │   ├── dashboard.js
│       │   ├── seasons.html            ← season management
│       │   ├── seasons.js
│       │   ├── students.html           ← student account management
│       │   ├── students.js
│       │   ├── zones.html              ← zone + supervisor management
│       │   ├── zones.js
│       │   ├── placements.html         ← batch placement review + zone assignment (FR6)
│       │   ├── placements.js
│       │   ├── letters-audit.html      ← letter audit log per student/season
│       │   ├── letters-audit.js
│       │   └── settings.html           ← stamp / signature / letterhead upload
│       │   └── settings.js
│       │
│       ├── school-supervisor/
│       │   ├── dashboard.html          ← Phase 2 (stub with "coming soon" in Phase 1)
│       │   ├── dashboard.js
│       │   ├── students.html           ← view assigned students (Phase 2)
│       │   ├── students.js
│       │   ├── visits.html             ← log visit observations (Phase 2)
│       │   └── visits.js
│       │
│       └── company-supervisor/
│           ├── dashboard.html          ← Phase 2 (stub in Phase 1)
│           ├── dashboard.js
│           ├── certify.html            ← weekly certification (Phase 2)
│           └── certify.js
│
└── supabase/
    ├── migrations/
    │   ├── 20260622000001_phase1_schema.sql
    │   ├── 20260622000002_phase1_rls.sql
    │   └── 20260622000003_phase2_schema.sql   ← attendance, logbook, visits, assessments
    └── seed.sql
```

---

## 4. DATABASE — PHASE 1 SCHEMA (already written — reproduce exactly)

```sql
-- =============================================================================
-- Migration: 20260622000001_phase1_schema.sql
-- =============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create type user_role as enum ('student','admin','school_supervisor','company_supervisor');
create type season_status as enum ('upcoming','open','closed','archived');
create type placement_status as enum ('submitted','flagged','rejected','assigned');
create type location_source as enum ('gps','manual');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role   not null,
  full_name   text        not null,
  phone       text        not null,
  created_at  timestamptz not null default now()
);

create table public.students (
  id           uuid primary key references public.profiles (id) on delete cascade,
  index_number text not null unique,
  department   text not null,
  programme    text not null,
  level        text not null
);

create table public.seasons (
  id                      uuid          primary key default gen_random_uuid(),
  name                    text          not null,
  start_date              date          not null,
  end_date                date          not null,
  status                  season_status not null default 'upcoming',
  placement_window_start  date          not null,
  placement_window_end    date          not null,
  created_at              timestamptz   not null default now(),
  updated_at              timestamptz,
  updated_by              uuid          references public.profiles (id) on delete set null,
  constraint seasons_window_within_season check (
    placement_window_start >= start_date and placement_window_end <= end_date and
    placement_window_start <= placement_window_end
  ),
  constraint seasons_dates_ordered check (start_date <= end_date)
);

create unique index seasons_one_open on public.seasons (status) where status = 'open';

create table public.zones (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  updated_by  uuid        references public.profiles (id) on delete set null
);

create table public.zone_supervisors (
  zone_id               uuid not null references public.zones    (id) on delete cascade,
  school_supervisor_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (zone_id, school_supervisor_id)
);

create table public.placements (
  id                    uuid             primary key default gen_random_uuid(),
  draft_id              uuid             not null unique,
  student_id            uuid             not null references public.profiles (id) on delete restrict,
  season_id             uuid             not null references public.seasons  (id) on delete restrict,
  company_name          text             not null,
  nature_of_business    text             not null,
  region                text             not null,
  city_town             text             not null,
  street_landmark       text             not null,
  contact_person        text             not null,
  company_contact_phone text             not null,
  latitude              numeric(9,6),
  longitude             numeric(9,6),
  location_source       location_source  not null,
  start_date            date             not null,
  end_date              date             not null,
  status                placement_status not null default 'submitted',
  zone_id               uuid             references public.zones (id) on delete set null,
  synced_at             timestamptz,
  created_at            timestamptz      not null default now(),
  updated_at            timestamptz,
  updated_by            uuid             references public.profiles (id) on delete set null,
  constraint placements_dates_ordered check (start_date <= end_date),
  constraint placements_one_per_student_per_season unique (student_id, season_id),
  constraint placements_location_consistency check (
    (latitude is null and longitude is null and location_source = 'manual') or
    (latitude is not null and longitude is not null and location_source = 'gps')
  )
);

create table public.letters (
  id                    uuid        primary key default gen_random_uuid(),
  student_id            uuid        not null references public.profiles (id) on delete restrict,
  season_id             uuid        not null references public.seasons  (id) on delete restrict,
  company_name          text        not null,
  region                text        not null,
  city_town             text        not null,
  street_landmark       text        not null,
  contact_person        text        not null,
  company_contact_phone text        not null,
  verification_code     text        not null unique,
  generated_at          timestamptz not null default now(),
  constraint letters_verification_code_format check (verification_code ~ '^[A-Z0-9]{8}$')
);

create table public.settings (
  id              int         primary key default 1,
  letterhead_path text,
  stamp_path      text,
  signature_path  text,
  updated_at      timestamptz,
  updated_by      uuid        references public.profiles (id) on delete set null,
  constraint settings_single_row check (id = 1)
);
insert into public.settings (id) values (1);

-- Trigger functions
create or replace function public.enforce_student_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select role from public.profiles where id = new.id) is distinct from 'student' then
    raise exception 'students.id must reference role = student';
  end if; return new;
end;$$;

create or replace function public.enforce_school_supervisor_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select role from public.profiles where id = new.school_supervisor_id) is distinct from 'school_supervisor' then
    raise exception 'zone_supervisors.school_supervisor_id must reference role = school_supervisor';
  end if; return new;
end;$$;

create or replace function public.stamp_synced_at()
returns trigger language plpgsql as $$
begin new.synced_at := now(); return new; end;$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;$$;

-- IMPORTANT: current_role() must be defined BEFORE the trigger below that calls it
create or replace function public.current_role()
returns user_role language sql stable security definer
set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.stamp_updated_by()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin new.updated_by := auth.uid(); return new; end;$$;

create or replace function public.validate_placement_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if old.status = 'submitted' and new.status in ('assigned','flagged','rejected') then return new; end if;
  if old.status = 'flagged'   and new.status in ('assigned','rejected')           then return new; end if;
  raise exception 'invalid placement status transition: % → %', old.status, new.status;
end;$$;

create or replace function public.lock_admin_only_placement_fields()
returns trigger language plpgsql as $$
begin
  -- current_role() is defined above; calling it here is safe because both
  -- functions are in the same migration and current_role() is created first.
  if public.current_role() = 'student' then
    new.zone_id   := old.zone_id;
    new.synced_at := old.synced_at;
  end if;
  return new;
end;$$;

-- Triggers
create trigger students_enforce_student_role
  before insert or update on public.students for each row execute function public.enforce_student_role();
create trigger zone_supervisors_enforce_supervisor_role
  before insert or update on public.zone_supervisors for each row execute function public.enforce_school_supervisor_role();
create trigger placements_stamp_synced_at
  before insert on public.placements for each row execute function public.stamp_synced_at();
create trigger seasons_touch_updated_at   before update on public.seasons    for each row execute function public.touch_updated_at();
create trigger zones_touch_updated_at     before update on public.zones      for each row execute function public.touch_updated_at();
create trigger placements_touch_updated_at before update on public.placements for each row execute function public.touch_updated_at();
create trigger settings_touch_updated_at  before update on public.settings   for each row execute function public.touch_updated_at();
create trigger seasons_stamp_updated_by   before update on public.seasons    for each row execute function public.stamp_updated_by();
create trigger zones_stamp_updated_by     before update on public.zones      for each row execute function public.stamp_updated_by();
create trigger placements_stamp_updated_by before update on public.placements for each row execute function public.stamp_updated_by();
create trigger settings_stamp_updated_by  before update on public.settings   for each row execute function public.stamp_updated_by();
create trigger placements_validate_status_transition
  before update on public.placements for each row execute function public.validate_placement_status_transition();
create trigger placements_lock_admin_only_fields
  before update on public.placements for each row execute function public.lock_admin_only_placement_fields();

-- Indexes
create index placements_status_idx     on public.placements (status);
create index placements_zone_idx       on public.placements (zone_id);
create index placements_season_idx     on public.placements (season_id);
create index placements_student_idx    on public.placements (student_id);
create index letters_student_idx       on public.letters    (student_id);
create index letters_season_idx        on public.letters    (season_id);
create index students_index_number_idx on public.students   (index_number);

-- Views
create or replace view public.student_profiles as
  select p.id, p.full_name, p.phone, p.created_at,
         s.index_number, s.department, s.programme, s.level
  from public.profiles p join public.students s on s.id = p.id;

create or replace view public.placement_supervisors as
  select pl.id as placement_id, pl.zone_id, zs.school_supervisor_id
  from public.placements pl
  join public.zone_supervisors zs on zs.zone_id = pl.zone_id;
```

---

## 5. DATABASE — PHASE 1 RLS (already written — reproduce exactly)

```sql
-- =============================================================================
-- Migration: 20260622000002_phase1_rls.sql
-- NOTE: current_role() is defined in migration 000001 (schema). Do NOT redefine it here.
-- =============================================================================

alter table public.profiles         enable row level security;
alter table public.students         enable row level security;
alter table public.seasons          enable row level security;
alter table public.zones            enable row level security;
alter table public.zone_supervisors enable row level security;
alter table public.placements       enable row level security;
alter table public.letters          enable row level security;
alter table public.settings         enable row level security;

-- profiles
create policy "profiles: user reads own row"  on public.profiles for select using (id = auth.uid());
create policy "profiles: admin reads all"      on public.profiles for select using (public.current_role() = 'admin');
create policy "profiles: admin inserts"        on public.profiles for insert with check (public.current_role() = 'admin');
create policy "profiles: admin updates"        on public.profiles for update using (public.current_role() = 'admin');
create policy "profiles: user updates own row" on public.profiles for update
  using  (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- students
create policy "students: student reads own row"     on public.students for select using (id = auth.uid());
create policy "students: admin reads all"           on public.students for select using (public.current_role() = 'admin');
create policy "students: supervisor reads assigned" on public.students for select
  using (public.current_role() = 'school_supervisor' and exists (
    select 1 from public.placements pl join public.zone_supervisors zs on zs.zone_id = pl.zone_id
    where pl.student_id = students.id and zs.school_supervisor_id = auth.uid()
  ));
create policy "students: admin inserts" on public.students for insert with check (public.current_role() = 'admin');
create policy "students: admin updates" on public.students for update using  (public.current_role() = 'admin');

-- seasons
create policy "seasons: all authenticated users read" on public.seasons for select using (auth.uid() is not null);
create policy "seasons: admin inserts"                on public.seasons for insert with check (public.current_role() = 'admin');
create policy "seasons: admin updates"                on public.seasons for update using  (public.current_role() = 'admin');

-- zones
create policy "zones: all authenticated users read" on public.zones for select using (auth.uid() is not null);
create policy "zones: admin inserts"               on public.zones for insert with check (public.current_role() = 'admin');
create policy "zones: admin updates"               on public.zones for update using  (public.current_role() = 'admin');
create policy "zones: admin deletes"               on public.zones for delete using  (public.current_role() = 'admin');

-- zone_supervisors
create policy "zone_supervisors: admin reads all"      on public.zone_supervisors for select using (public.current_role() = 'admin');
create policy "zone_supervisors: supervisor reads own" on public.zone_supervisors for select using (school_supervisor_id = auth.uid());
create policy "zone_supervisors: admin inserts"        on public.zone_supervisors for insert with check (public.current_role() = 'admin');
create policy "zone_supervisors: admin deletes"        on public.zone_supervisors for delete using  (public.current_role() = 'admin');

-- placements
create policy "placements: student reads own"  on public.placements for select using (student_id = auth.uid());
create policy "placements: admin reads all"    on public.placements for select using (public.current_role() = 'admin');
create policy "placements: supervisor reads assigned zone" on public.placements for select
  using (public.current_role() = 'school_supervisor' and exists (
    select 1 from public.zone_supervisors zs where zs.zone_id = placements.zone_id and zs.school_supervisor_id = auth.uid()
  ));
create policy "placements: student inserts own" on public.placements for insert
  with check (
    student_id = auth.uid() and public.current_role() = 'student' and status = 'submitted' and
    exists (select 1 from public.seasons s where s.id = season_id and s.status = 'open'
              and current_date between s.placement_window_start and s.placement_window_end)
  );
create policy "placements: student updates own while submitted" on public.placements for update
  using  (student_id = auth.uid() and public.current_role() = 'student' and status = 'submitted')
  with check (student_id = auth.uid() and status = 'submitted');
create policy "placements: admin updates all" on public.placements for update using (public.current_role() = 'admin');

-- letters
create policy "letters: student reads own"   on public.letters for select using (student_id = auth.uid());
create policy "letters: admin reads all"     on public.letters for select using (public.current_role() = 'admin');
create policy "letters: student inserts own" on public.letters for insert
  with check (student_id = auth.uid() and public.current_role() = 'student' and
    exists (select 1 from public.seasons s where s.id = season_id and s.status = 'open'));

-- settings
create policy "settings: all authenticated users read" on public.settings for select using (auth.uid() is not null);
create policy "settings: admin updates"                on public.settings for update using  (public.current_role() = 'admin');
```

---

## 6. DATABASE — PHASE 2 SCHEMA (generate this)

Generate migration `20260622000003_phase2_schema.sql` covering:

### Attendance (FR4)
```
attendance_logs: id, student_id (→ profiles), placement_id (→ placements), season_id (→ seasons),
  log_date (date, not null), check_in_time (timestamptz), check_out_time (timestamptz),
  check_in_lat (numeric 9,6), check_in_lon (numeric 9,6), check_in_location_source (location_source),
  check_out_lat (numeric 9,6), check_out_lon (numeric 9,6), check_out_location_source (location_source),
  distance_from_placement_m (numeric),   ← computed and stored on write
  absence_reason (text),                 ← null unless absent
  status (enum: present / absent / flagged_location / flagged_missing_checkout / absent_with_reason),
  created_at, updated_at, updated_by
  UNIQUE (student_id, log_date)
```

Anomaly flags (denormalized for fast dashboard queries):
```
attendance_flags: id, student_id, season_id, flag_type (enum: consecutive_absences / location_mismatch /
  short_hours / missing_checkout), triggered_at, resolved_at (nullable), resolved_by (nullable)
```

### Digital Logbook (FR5)
```
logbook_weeks: id, student_id, placement_id, season_id, week_number (int), week_start (date), week_end (date),
  department_section (text), student_remarks (text),
  company_certified_by (text), company_certified_at (timestamptz),
  status (enum: draft / submitted / certified / locked),
  created_at, updated_at, updated_by

logbook_daily_entries: id, week_id (→ logbook_weeks), log_date (date), activities (text),
  created_at, updated_at
  UNIQUE (week_id, log_date)

logbook_monthly_summaries: id, student_id, placement_id, season_id, month_number (int),
  student_summary (text),
  company_supervisor_assessment (text), company_supervisor_rating (int CHECK 1..5),
  company_supervisor_name (text), company_supervisor_assessed_at (timestamptz),
  status (enum: draft / submitted / assessed),
  created_at, updated_at, updated_by

supervisor_visits: id, placement_id, school_supervisor_id (→ profiles), visit_date (date),
  observations (text), remarks (text), assessment_score (int CHECK 0..100),
  created_at, updated_at, updated_by
```

Add RLS to all Phase 2 tables following the same patterns as Phase 1:
- Students: read/write own rows only (write only when status allows editing).
- Admin: read all.
- School supervisor: read/write rows in their assigned zone.
- Company supervisor: read/write logbook rows for placements at their company (derive via `placements.student_id` and a new `company_supervisors` table linking supervisor → placement).

---

## 7. FUNCTIONAL REQUIREMENTS — IMPLEMENT ALL

### Phase 1

**FR1 — Auth & Account Management**
- Single `/src/modules/auth/login.html` sign-in page (email + password, Supabase Auth).
- On successful login, fetch `profiles.role` and redirect: admin → `/src/modules/admin/dashboard.html`, student → `/src/modules/student/dashboard.html`, school_supervisor → `/src/modules/school-supervisor/dashboard.html`, company_supervisor → `/src/modules/company-supervisor/dashboard.html`.
- `auth-guard.js` runs on every protected page: if not signed in, redirect to login; if wrong role for that page, redirect to their correct dashboard.
- Admin creates accounts via the students management page (calls Supabase Admin API via a Supabase Edge Function — include the Edge Function code).
- Password reset via Supabase's built-in email flow (just wire up the "Forgot password?" link).

**FR2 — Attachment Letter Generation**
- Student fills: company name, region, city/town, street/landmark, contact person, company phone.
- On submit: generate an 8-char uppercase alphanumeric verification code (crypto.getRandomValues, filtered to [A-Z0-9]), insert a row into `letters`, then call `generate-letter.js` to produce and download the PDF.
- `generate-letter.js` fetches short-lived signed URLs for letterhead, stamp, and signature from Supabase Storage, then uses jsPDF to lay them out over a professional letter template that includes: TTU letterhead image at top, date, "To Whom It May Concern", student name and index number, company address block, body text requesting attachment, verification code at bottom (and a QR code if jsPDF supports it, otherwise a visible text code), liaison officer signature image.
- The student's letter count for the current season is shown on the letters page as a live `COUNT(*)` with color escalation: ≤2 neutral, 3 amber, 4+ red. No hard limit.
- Admin letters-audit page shows every letter row, grouped by student, with the student's name, index number, letter count, and a table of each letter (company, date, verification code).

**FR3 — Placement Registration (offline-capable)**
- `offline-queue.js` must:
  1. Attempt a test write to IndexedDB on page load. If it fails, show the private-browsing banner.
  2. Create a Dexie database `iams_drafts` with a `placements` store keyed by `draft_id`.
  3. On first page open (no existing draft), generate a new `draft_id = crypto.randomUUID()` and save an empty draft immediately.
  4. On every meaningful field change (`input` events), save the full form state to Dexie under that `draft_id`.
  5. On page load, check Dexie for an existing draft for `auth.uid()`. If found, pre-populate the form.
  6. On submit: attempt GPS capture (navigator.geolocation, 10-second timeout). On success, add lat/lon to draft and set `location_source = 'gps'`. On failure/timeout, set `location_source = 'manual'`, lat/lon = null. Then call `sync()`.
  7. `sync()`: if offline, mark draft `status = 'pending'` and register a Background Sync event (`sw.sync.register('sync-placement')`). If online, call `placements.service.js:upsert(draft)`. On confirmed success: delete the Dexie draft, update UI to "Submitted", lock the form. On failure: keep draft, show error, retry on next `window online` event.
  8. The service worker handles the Background Sync event by calling the same `sync()` logic.
- The placement form fields: company name, nature of business, region (dropdown of Ghana regions), city/town, street/landmark, contact person, company phone, start date, end date.
- Show a "Pending sync" badge while the draft is unsynchronized. Show "Submitted (read-only)" once confirmed.
- Students can only register during an open season's placement window. Show a clear error if the window is closed.

**FR6 — Batch Placement Review (admin)**
- Admin placements page: list all placements for the current open season, grouped by status.
- Each placement row shows: student name, index number, company, region, city, status, GPS indicator (✓ if `location_source = 'gps'`, — if manual).
- Bulk actions: select multiple `submitted` placements → assign zone (dropdown of zones) → click "Assign". Also "Flag" and "Reject" bulk actions.
- Single-row actions: click a placement to expand details; assign, flag, or reject individually.
- On assign: update `placements.zone_id` and `placements.status = 'assigned'`. The supervisor follows from the zone automatically.

**FR7 — Admin Dashboard (Phase 1 subset)**
- Stat cards: Total students, Total placements this season, Submitted (pending review), Assigned, Flagged, Rejected.
- Placements by zone (bar chart using plain SVG or a lightweight CDN chart library — no webpack-required libraries).
- Letters generated this season (total count).
- Top 5 students by letter count (table).
- Quick links to: season management, zone management, batch placement review, letter audit.

**Season management (admin)**
- List all seasons with status badges.
- Create season form: name, start/end dates, placement window start/end.
- Open / Close / Archive actions. Enforce: cannot open a second season while one is already open (check DB; the partial unique index will also catch it).
- Edit existing season dates (only if status = upcoming or open).

**Zone + supervisor management (admin)**
- CRUD zones (name, description).
- Assign school supervisors to zones (multi-select from list of school_supervisor profiles).
- Remove supervisor from zone.

**Settings (admin)**
- Upload new letterhead, stamp, signature images → upload to Supabase Storage → update `settings` row with the new paths.
- Preview the current images (fetch signed URLs to display them).

**Letter verification page (public)**
- `verify.html` at `/verify` — no auth required.
- URL pattern: `/verify?code=A3F9B1C2` OR `/verify/A3F9B1C2` (handle both).
- Queries `letters` table for the code (Supabase RLS must allow anon reads on `letters` for verification — add a separate anon-only policy).
- Shows: student name, index number, company name, address, date generated. Or "Code not found" if invalid.

### Phase 2

**FR4 — Daily Attendance & GPS Check-in/Check-out**
- Student attendance page: two big buttons — CHECK IN and CHECK OUT.
- Check-in: capture GPS (required; if denied, show clear error — attendance requires GPS unlike placement). Compare against `placements.latitude/longitude` using Haversine. Store in `attendance_logs`. If distance > 200m, set `status = 'flagged_location'`.
- Check-out: similar GPS capture, compute hours worked.
- If no GPS coordinates on placement (`location_source = 'manual'`), show a warning: "Your placement has no registered GPS location. Your check-in will be recorded but cannot be automatically verified."
- Auto-flag logic (run as Supabase Edge Function on each insert):
  - 3+ consecutive absences → insert `attendance_flags` row with `flag_type = 'consecutive_absences'`.
  - Missing check-out by end of day → `flagged_missing_checkout`.
  - Distance > 200m → `flagged_location`.
  - Hours worked < 4 → `flagged_short_hours` (only if checked out).
- Admin dashboard Phase 2 additions: attendance anomaly flags panel, per-student attendance rate.
- School supervisor can view attendance records for students in their zone.

**FR5 — Digital Logbook**
- Student logbook page: weekly view. Each week has Monday–Sunday daily entry fields (text area per day).
- Student fills daily entries, saves (auto-save to IndexedDB, same pattern as FR3 offline queue).
- Weekly summary: department/section field, student remarks field.
- Submit week → changes `logbook_weeks.status` to `submitted`.
- Company supervisor certification: company supervisor logs in, sees a list of weeks pending their certification, enters their name, confirms → `status = 'certified'`, `company_certified_by`, `company_certified_at` set. Week is then locked — student cannot edit.
- Monthly summary: student writes a monthly summary. Company supervisor writes assessment + rating (1–5 stars). Once assessed, locked.
- School supervisor visit logging: supervisor selects a student in their zone, logs visit date, observations, remarks, assessment score (0–100).
- Logbook status progression: Draft → Submitted → Certified/Locked.

---

## 8. UI/UX REQUIREMENTS

- Tailwind CSS via CDN for all styling. No custom CSS frameworks.
- Mobile-first. All pages must be fully usable on a 375px-wide screen.
- Common shell (`nav.js`): top navbar with TTU logo, page title, and a hamburger menu on mobile. Sidebar nav on desktop. Role-specific nav items from `shell-config.js`.
- Role-specific color accents: admin = blue, student = green, school_supervisor = purple, company_supervisor = orange.
- All forms: inline validation on blur, submit button disabled until required fields are valid.
- Empty states: every list/table that can be empty must show a friendly illustration (inline SVG) and a helpful message.
- Loading states: every async operation must show a spinner or skeleton. No blank flickers.
- Toast notifications for all success/error feedback (implement a lightweight vanilla JS toast system).
- Phase 2 pages that aren't built yet show a "Coming soon" placeholder card, not a 404.

---

## 9. NON-FUNCTIONAL REQUIREMENTS

- **NFR1 Mobile:** All pages usable at 375px. Touch targets ≥ 44×44px.
- **NFR2 Security:** No Supabase credentials in frontend code beyond the public anon key. Signed URLs for all storage assets. Never expose service-role key to the client.
- **NFR3 Performance:** PDF generation < 3 seconds on a standard mobile connection. GPS has no fixed timeout shown to user — show spinner, offer retry after 15 seconds.
- **NFR4 Usability:** No jargon in student-facing copy. All error messages must say what to do, not just what went wrong.
- **NFR5 Reliability:** Dexie.js draft survives accidental tab close, browser crash, device restart. Sync only deletes local draft after confirmed server success. Background Sync + `window online` listener as backstop.
- **NFR6 Data Integrity:** All form inputs validated client-side AND server-side (CHECK constraints + RLS + triggers as defined in the schema above).
- **NFR7 Maintainability:** `shared/services/` is the ONLY layer that imports `supabase-client.js`. Page scripts call services, never the Supabase client directly.

---

## 10. SUPABASE EDGE FUNCTIONS TO GENERATE

1. **`create-user`** — called by the admin UI to create a new auth user + profile row. Accepts `{email, password, role, full_name, phone, index_number?, department?, programme?, level?}`. Uses the Supabase Admin API (service role key, server-side only). Returns the new user's UUID.
2. **`flag-attendance`** — triggered after each `attendance_logs` insert. Checks for anomaly conditions and inserts into `attendance_flags` as needed.
3. **`get-signed-urls`** — called by `generate-letter.js` at letter-generation time. Accepts `{paths: ['letterhead', 'stamp', 'signature']}`. Fetches current paths from `settings`, generates short-lived signed URLs (60 seconds), returns them. Never exposes the paths or bucket structure to the client.

Place Edge Functions under `supabase/functions/create-user/index.ts`, etc.

---

## 11. ADDITIONAL FILES TO GENERATE

- `package.json` — scripts: `dev`, `build`, `preview`. Dependencies: vite, `@vite-pwa/vite-plugin-pwa` (dev only).
- `vite.config.js` — multi-page input (all HTML entry points), PWA plugin configured with `manifest.webmanifest`, Workbox for asset caching.
- `vercel.json` — rewrites: `/verify/*` → `/verify.html`; all other `/*` paths → `/index.html` for client-side routing; headers for cache-control.
- `.env.example` — `VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`.
- `public/manifest.webmanifest` — name, short_name, icons, start_url, display standalone, theme_color (TTU institutional blue: #003087).
- `src/shared/utils.js` — exports: `validatePhone(str)`, `validateGhanaRegion(str)`, `formatDate(date)`, `generateVerificationCode()`, `haversineMetres(lat1,lon1,lat2,lon2)`, `debounce(fn, ms)`, `showToast(message, type)`.
- `supabase/seed.sql` — the seed data already provided above, with a note to create auth users first.

---

## 12. SEED DATA (reproduce and extend)

```sql
-- Create auth users first via Supabase Dashboard or CLI, then run this seed.
-- Test credentials: all users use password TestPass123!
-- admin@ttu.edu.gh, kwame.asante@ttu.edu.gh, ama.mensah@ttu.edu.gh,
-- dr.boateng@ttu.edu.gh, company.supervisor@example.com

do $$
declare
  v_admin_id       uuid := 'ea68174a-f2d4-4596-a023-93cb030a1d86';
  v_student1_id    uuid := '56d02c9f-f428-4310-a8c5-144423bdb726';
  v_student2_id    uuid := '3ae6f784-6390-4a85-b017-279e3d6045a1';
  v_supervisor_id  uuid := '2fd8cce6-c0ee-41bc-807a-268b6f49b43a';
  v_company_sup_id uuid := gen_random_uuid();
  v_season_id      uuid := gen_random_uuid();
  v_zone1_id       uuid := gen_random_uuid();
  v_zone2_id       uuid := gen_random_uuid();
  v_placement1_id  uuid := gen_random_uuid();
  v_placement2_id  uuid := gen_random_uuid();
begin
  insert into public.profiles (id, role, full_name, phone) values
    (v_admin_id,       'admin',              'Industrial Liaison Officer', '0244000001'),
    (v_student1_id,    'student',            'Kwame Asante',               '0244000002'),
    (v_student2_id,    'student',            'Ama Mensah',                 '0244000003'),
    (v_supervisor_id,  'school_supervisor',  'Dr. Kofi Boateng',           '0244000004'),
    (v_company_sup_id, 'company_supervisor', 'Mr. Ebo Turkson',            '0312000100')
  on conflict (id) do nothing;

  insert into public.students (id, index_number, department, programme, level) values
    (v_student1_id, 'TTU/CSC/23/001', 'Computer Science', 'HND Computer Science',          'HND 2'),
    (v_student2_id, 'TTU/CSC/23/002', 'Computer Science', 'B-Tech Information Technology', 'B-Tech 3')
  on conflict (id) do nothing;

  insert into public.seasons (id, name, start_date, end_date, status, placement_window_start, placement_window_end) values
    (v_season_id, '2025/2026 Semester 2', '2026-01-06', '2026-06-27', 'open', '2026-06-01', '2026-06-27')
  on conflict do nothing;

  insert into public.zones (id, name, description) values
    (v_zone1_id, 'Takoradi Central',      'Takoradi CBD, Harbour Area, Effia-Nkwanta.'),
    (v_zone2_id, 'Sekondi-Takoradi West', 'Sekondi, Kojokrom, New Takoradi.')
  on conflict (name) do nothing;

  insert into public.zone_supervisors (zone_id, school_supervisor_id) values
    (v_zone1_id, v_supervisor_id), (v_zone2_id, v_supervisor_id)
  on conflict do nothing;

  insert into public.placements (
    id, draft_id, student_id, season_id, company_name, nature_of_business,
    region, city_town, street_landmark, contact_person, company_contact_phone,
    latitude, longitude, location_source, start_date, end_date, status, zone_id
  ) values
  (v_placement1_id, gen_random_uuid(), v_student1_id, v_season_id,
    'Ghana Ports and Harbours Authority', 'Port Operations & Logistics',
    'Western Region', 'Takoradi', 'Harbour Road, off Commercial Street',
    'Mr. Ebo Turkson', '0312000100', 4.897895, -1.755132, 'gps',
    '2026-01-06', '2026-06-27', 'assigned', v_zone1_id),
  (v_placement2_id, gen_random_uuid(), v_student2_id, v_season_id,
    'Tullow Oil Ghana Limited', 'Oil and Gas Exploration',
    'Western Region', 'Takoradi', 'Airport Ridge, Jubilee House',
    'Ms. Abena Quansah', '0312000200', null, null, 'manual',
    '2026-01-06', '2026-06-27', 'submitted', null)
  on conflict (draft_id) do nothing;

  insert into public.letters (student_id, season_id, company_name, region, city_town,
    street_landmark, contact_person, company_contact_phone, verification_code) values
  (v_student1_id, v_season_id, 'Ghana Ports and Harbours Authority',
    'Western Region', 'Takoradi', 'Harbour Road, off Commercial Street',
    'Mr. Ebo Turkson', '0312000100', 'A3F9B1C2'),
  (v_student1_id, v_season_id, 'Volta River Authority',
    'Western Region', 'Takoradi', 'Liberation Road',
    'Mr. Yaw Darko', '0312000300', 'B7K2C4D8')
  on conflict (verification_code) do nothing;
end $$;
```

---

## 13. CRITICAL RULES FOR CODE GENERATION

1. **Every file must be complete.** No `// TODO`, no `// implement this`, no placeholder functions that do nothing.
2. **Services layer is the only Supabase caller.** Page scripts import from `services/`, never from `supabase-client.js` directly.
3. **Dexie.js for all offline storage.** No `localStorage` for drafts.
4. **Signed URLs for all storage assets.** Never a public bucket URL for letterhead, stamp, or signature.
5. **The `current_role()` function is defined in migration 000001 (before the trigger that calls it), and is NOT redefined in migration 000002.** This order must be preserved exactly as written.
6. **Phase 2 pages that are not yet fully implemented** render a polished "Coming soon" placeholder card (not a blank page, not a 404, not a console error).
7. **All HTML pages** must include the shell nav, the auth guard, and the theme.css + shell.css imports.
8. **Ghana regions dropdown** in the placement form must list all 16 regions of Ghana.
9. **The letter verification page** (`verify.html`) is fully public — no auth guard, but it reads from Supabase with the anon key. Add a separate RLS policy allowing `anon` role to `select` from `letters` where it only returns the minimum fields needed for verification (student name via join, company_name, city_town, generated_at). Do not expose the student's phone or the full address to unauthenticated users.
10. **PDF layout:** The generated PDF must look like an official TTU letter — not a plain text file. Use jsPDF's `addImage` for the letterhead, position text correctly, include the verification code in a box at the bottom.
11. **`haversineMetres` in utils.js** must use the correct formula with Earth radius 6371000 metres.
12. **Toast notifications** must auto-dismiss after 4 seconds and be stackable (multiple toasts can show simultaneously).
13. **Do not use `supabase.auth.admin` on the client side.** Admin user creation must go through the `create-user` Edge Function which uses the service role key server-side.

---

## 14. OUTPUT FORMAT

Output the files in this order, one after another, each prefaced with its full path:

```
=== FILE: package.json ===
<complete file content>

=== FILE: vite.config.js ===
<complete file content>

... and so on for every file in the project tree
```

Do not skip any file. Do not summarize file contents. Output the full content of every file.

Begin now.

---END PROMPT---
