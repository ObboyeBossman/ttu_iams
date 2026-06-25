-- =============================================================================
-- IAMS — Industrial Attachment Management System
-- Phase 1 Schema
-- Takoradi Technical University
-- =============================================================================
-- Run order matters:
--   1. schema.sql   (this file)
--   2. rls-policies.sql
--   3. seed.sql     (optional)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------

create extension if not exists "uuid-ossp";  -- uuid_generate_v4()
create extension if not exists "pgcrypto";   -- gen_random_uuid() (Supabase default)


-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

create type user_role as enum (
  'student',
  'admin',
  'school_supervisor',
  'company_supervisor'
);

create type season_status as enum (
  'upcoming',
  'open',
  'closed',
  'archived'
);

-- Valid status transitions (Phase 1):
--
--   submitted ──→ assigned   (admin: valid placement, zone + supervisor set)
--             ──→ flagged    (admin: needs clarification; student contacted externally)
--             ──→ rejected   (admin: invalid or fraudulent)
--
--   flagged   ──→ assigned   (admin: resolved, placement accepted)
--             ──→ rejected   (admin: resolved, placement invalid)
--
-- There is no transition back to 'submitted' in Phase 1.
-- Flagged/rejected placements are resolved outside the system (phone/email).
create type placement_status as enum (
  'submitted',   -- initial state on student registration
  'flagged',     -- queued for clarification; blocks assignment
  'rejected',    -- terminal; no in-system resubmission in Phase 1
  'assigned'     -- terminal for valid placements; zone + supervisor set
);

create type location_source as enum (
  'gps',     -- captured from device GPS while physically at the company
  'manual'   -- GPS unavailable/denied/timed out; placement relies on the structured
             -- text address alone. Not student-typed coordinates — there is no
             -- manual coordinate-entry fallback in Phase 1 (see FR3).
);


-- ---------------------------------------------------------------------------
-- TABLE: profiles
-- One row per auth.users entry, regardless of role.
-- Contains only identity fields common to every role.
-- Role-specific fields live in their own tables (e.g. students).
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role   not null,
  full_name   text        not null,
  phone       text        not null,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Common identity record for every user. Role-specific data is in role-specific tables.';


-- Trigger functions: verify that a profile referenced by a foreign key
-- actually has the expected role. Foreign keys alone can't enforce this
-- (they don't know about enum values on a different table), so
-- role-specific child tables and junctions use these to stop, e.g., an
-- admin's profile ending up in zone_supervisors, or a supervisor's profile
-- ending up in students.
--
-- Written as one small function per relationship rather than a single
-- generic/parameterized version — easier to read and debug later, and
-- avoids dynamic SQL for what is otherwise a one-line check.

create or replace function public.enforce_student_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select role from public.profiles where id = new.id) is distinct from 'student' then
    raise exception 'students.id (%) must reference a profile with role = student', new.id;
  end if;
  return new;
end;
$$;

comment on function public.enforce_student_role is
  'Guards students.id: the referenced profile must have role = student.';

create or replace function public.enforce_school_supervisor_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select role from public.profiles where id = new.school_supervisor_id) is distinct from 'school_supervisor' then
    raise exception 'zone_supervisors.school_supervisor_id (%) must reference a profile with role = school_supervisor', new.school_supervisor_id;
  end if;
  return new;
end;
$$;

comment on function public.enforce_school_supervisor_role is
  'Guards zone_supervisors.school_supervisor_id: the referenced profile must have role = school_supervisor.';


-- ---------------------------------------------------------------------------
-- TABLE: students
-- One row per student profile only (profiles.role = 'student').
-- Admin and supervisor profiles have no row here.
-- ---------------------------------------------------------------------------

create table public.students (
  id           uuid primary key references public.profiles (id) on delete cascade,
  index_number text not null unique,  -- e.g. TTU/CSC/23/001
  department   text not null,
  programme    text not null,
  level        text not null          -- e.g. HND 1, HND 2, B-Tech 3
);

comment on table public.students is
  'Student-specific academic identity. Only exists when profiles.role = ''student''.';

create trigger students_enforce_student_role
  before insert or update on public.students
  for each row execute function public.enforce_student_role();


-- ---------------------------------------------------------------------------
-- TABLE: seasons
-- One row per attachment season.
-- Business rule: at most one season may have status = 'open' at any time.
-- Enforced by a partial unique index below AND at the application layer.
-- ---------------------------------------------------------------------------

create table public.seasons (
  id                      uuid          primary key default gen_random_uuid(),
  name                    text          not null,           -- e.g. "2024/2025 Semester 1"
  start_date              date          not null,
  end_date                date          not null,
  status                  season_status not null default 'upcoming',
  placement_window_start  date          not null,
  placement_window_end    date          not null,
  created_at              timestamptz   not null default now(),
  updated_at              timestamptz,
  updated_by              uuid          references public.profiles (id) on delete set null,

  constraint seasons_window_within_season
    check (
      placement_window_start >= start_date and
      placement_window_end   <= end_date   and
      placement_window_start <= placement_window_end
    ),

  constraint seasons_dates_ordered
    check (start_date <= end_date)
);

-- Enforces the single-open-season business rule at the database level.
-- Only one row may exist where status = 'open'.
create unique index seasons_one_open
  on public.seasons (status)
  where status = 'open';

comment on table public.seasons is
  'Attachment seasons. At most one season may be open at a time (partial unique index).';


-- ---------------------------------------------------------------------------
-- TABLE: zones
-- Geographical zones managed by the admin.
-- Zones exist independently of any single season.
-- ---------------------------------------------------------------------------

create table public.zones (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,  -- e.g. "Takoradi Central", "Sekondi"
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  updated_by  uuid        references public.profiles (id) on delete set null
);

comment on table public.zones is
  'Geographical supervision zones. Independent of seasons.';


-- ---------------------------------------------------------------------------
-- TABLE: zone_supervisors
-- Junction: a school supervisor may be assigned to one or more zones.
-- ---------------------------------------------------------------------------

create table public.zone_supervisors (
  zone_id               uuid not null references public.zones    (id) on delete cascade,
  school_supervisor_id  uuid not null references public.profiles (id) on delete cascade,

  primary key (zone_id, school_supervisor_id)
);

comment on table public.zone_supervisors is
  'Many-to-many: school supervisors assigned to zones.';

create trigger zone_supervisors_enforce_supervisor_role
  before insert or update on public.zone_supervisors
  for each row execute function public.enforce_school_supervisor_role();


-- ---------------------------------------------------------------------------
-- TABLE: placements
-- One row per student per season.
-- draft_id is a client-generated UUID (idempotency key):
--   the client creates it when the form is first opened and includes it
--   in every sync attempt. The UNIQUE constraint means duplicate inserts
--   (from retries, duplicate tabs, or Background Sync) are silently rejected.
-- ---------------------------------------------------------------------------

create table public.placements (
  id                    uuid             primary key default gen_random_uuid(),

  -- Idempotency key — generated on the client, never changed for this draft.
  draft_id              uuid             not null unique,

  student_id            uuid             not null references public.profiles (id) on delete restrict,
  season_id             uuid             not null references public.seasons  (id) on delete restrict,

  -- Company information (denormalised per-placement; no shared companies table).
  company_name          text             not null,
  nature_of_business    text             not null,
  region                text             not null,
  city_town             text             not null,
  street_landmark       text             not null,
  contact_person        text             not null,
  company_contact_phone text             not null,

  -- GPS capture (non-blocking; latitude/longitude may be null if GPS was unavailable).
  -- location_source is always set: 'gps' when coordinates were captured,
  -- 'manual' when GPS failed/was unavailable and the text address alone was used.
  latitude              numeric(9, 6),
  longitude             numeric(9, 6),
  location_source       location_source  not null,

  -- Attachment period at this company.
  start_date            date             not null,
  end_date              date             not null,

  -- Status lifecycle: submitted → assigned | flagged | rejected
  --                   flagged  → assigned | rejected
  -- No transition back to submitted in Phase 1.
  status                placement_status not null default 'submitted',

  -- Set by admin during batch review.
  -- The assigned supervisor is NOT stored here — it is derived via
  -- zone_id → zone_supervisors → school_supervisor_id. This keeps a single
  -- source of truth: reassigning a zone's supervisor automatically updates
  -- every placement in that zone, with no risk of a stale snapshot.
  zone_id               uuid             references public.zones    (id) on delete set null,

  -- Sync audit: NULL while the record lives only in IndexedDB;
  -- populated by the server (via trigger below) on confirmed insert.
  synced_at             timestamptz,

  created_at            timestamptz      not null default now(),
  updated_at            timestamptz,
  updated_by            uuid             references public.profiles (id) on delete set null,

  constraint placements_dates_ordered
    check (start_date <= end_date),

  -- A student may only have one placement per season.
  constraint placements_one_per_student_per_season
    unique (student_id, season_id),

  -- location_source must match coordinate presence exactly:
  --   no coordinates  → location_source = 'manual'
  --   coordinates set → location_source = 'gps'
  -- This removes the previously-allowed third state (null coordinates,
  -- null source), which Phase 1 never produces and the spec disallows.
  constraint placements_location_consistency
    check (
      (latitude is null and longitude is null and location_source = 'manual') or
      (latitude is not null and longitude is not null and location_source = 'gps')
    )
);

comment on table public.placements is
  'Student placement registrations. draft_id is a client UUID enforcing insert idempotency.';

comment on column public.placements.draft_id is
  'Client-generated UUID. Stays constant through all edits and retry attempts. UNIQUE constraint makes duplicate inserts safe to ignore.';

comment on column public.placements.synced_at is
  'NULL while record exists only in IndexedDB. Set to now() on the first confirmed server insert via trigger.';


-- Trigger: stamp synced_at on insert (the client sends NULL; the server fills it in).
create or replace function public.stamp_synced_at()
returns trigger language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

create trigger placements_stamp_synced_at
  before insert on public.placements
  for each row execute function public.stamp_synced_at();


-- Trigger: keep updated_at current on any table that has it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger seasons_touch_updated_at
  before update on public.seasons
  for each row execute function public.touch_updated_at();

create trigger zones_touch_updated_at
  before update on public.zones
  for each row execute function public.touch_updated_at();

create trigger placements_touch_updated_at
  before update on public.placements
  for each row execute function public.touch_updated_at();


-- Trigger: stamp updated_by with the acting user on every update.
-- Removes the need for every client/service call to remember to set it
-- explicitly, and prevents a client from claiming false attribution by
-- passing an arbitrary updated_by value — the server always overwrites it.
create or replace function public.stamp_updated_by()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

comment on function public.stamp_updated_by is
  'Overwrites updated_by with auth.uid() on every update, regardless of what the client sent.';

create trigger seasons_stamp_updated_by
  before update on public.seasons
  for each row execute function public.stamp_updated_by();

create trigger zones_stamp_updated_by
  before update on public.zones
  for each row execute function public.stamp_updated_by();

create trigger placements_stamp_updated_by
  before update on public.placements
  for each row execute function public.stamp_updated_by();


-- Trigger: enforce the documented placement status lifecycle at the
-- database level, mirroring how the single-open-season rule is already
-- enforced here rather than left to client/application discipline.
--
-- Valid transitions:
--   submitted → assigned | flagged | rejected
--   flagged   → assigned | rejected
-- No other transition is permitted (including any reversion to
-- 'submitted', and no transition out of 'rejected' or 'assigned' —
-- both are terminal in Phase 1). A row may also be updated without
-- changing status at all (e.g. admin editing zone_id) — that is not a
-- transition and is always allowed.
create or replace function public.validate_placement_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'submitted' and new.status in ('assigned', 'flagged', 'rejected') then
    return new;
  end if;

  if old.status = 'flagged' and new.status in ('assigned', 'rejected') then
    return new;
  end if;

  raise exception
    'invalid placement status transition: % → % (placement %)',
    old.status, new.status, old.id;
end;
$$;

comment on function public.validate_placement_status_transition is
  'Enforces the Phase 1 placement status lifecycle: submitted → assigned/flagged/rejected; flagged → assigned/rejected. No reversion to submitted; assigned and rejected are terminal.';

create trigger placements_validate_status_transition
  before update on public.placements
  for each row execute function public.validate_placement_status_transition();


-- Trigger: when a student updates their own placement (RLS already
-- restricts this to rows where status = 'submitted'), lock the fields
-- that only the admin's batch-review process should ever set. RLS's
-- WITH CHECK only constrains student_id and status; a student calling
-- the REST API directly (not through the HTML form) could otherwise
-- still smuggle in a change to zone_id, synced_at, or updated_by on an
-- update that RLS would otherwise allow. This trigger closes that gap
-- regardless of which role performs the update — for an admin update,
-- old and new values legitimately differ and nothing is reverted.
create or replace function public.lock_admin_only_placement_fields()
returns trigger language plpgsql as $$
begin
  if public.current_role() = 'student' then
    new.zone_id    := old.zone_id;
    new.synced_at  := old.synced_at;
  end if;

  return new;
end;
$$;

comment on function public.lock_admin_only_placement_fields is
  'When the acting user is a student, silently reverts zone_id and synced_at to their prior values, regardless of what the client sent. updated_by is already overwritten unconditionally by stamp_updated_by, and status changes are independently constrained by validate_placement_status_transition + RLS.';

create trigger placements_lock_admin_only_fields
  before update on public.placements
  for each row execute function public.lock_admin_only_placement_fields();


-- ---------------------------------------------------------------------------
-- TABLE: letters
-- Metadata record for every generated attachment letter.
-- The PDF itself is never stored — it is generated client-side and
-- downloaded immediately. This table exists for audit only.
-- Letter count per student is computed live: COUNT(*) scoped to season.
-- ---------------------------------------------------------------------------

create table public.letters (
  id                    uuid        primary key default gen_random_uuid(),
  student_id            uuid        not null references public.profiles (id) on delete restrict,
  season_id             uuid        not null references public.seasons  (id) on delete restrict,

  -- Snapshot of the company details at the time of generation.
  -- Stored here so the audit record is self-contained even if the
  -- student later registers a different placement.
  company_name          text        not null,
  region                text        not null,
  city_town             text        not null,
  street_landmark       text        not null,
  contact_person        text        not null,
  company_contact_phone text        not null,

  -- Short alphanumeric code printed on the letter for verification.
  -- Format: 8 uppercase alphanumeric characters, e.g. "TTU-A3F9".
  -- No expiry in Phase 1. Verified via /verify/{code} public page.
  verification_code     text        not null unique,

  generated_at          timestamptz not null default now(),

  -- Enforces the documented format: exactly 8 uppercase letters/digits.
  -- Note: the stored value has no separator; any "TTU-XXXX"-style
  -- prefix shown on the printed letter is a display-layer concern, not
  -- part of the stored code. Adjust the pattern here if that changes.
  constraint letters_verification_code_format
    check (verification_code ~ '^[A-Z0-9]{8}$')
);

comment on table public.letters is
  'Audit log of generated letters. PDFs are not stored — generated client-side. Letter count = COUNT(*) per student per season.';

comment on column public.letters.verification_code is
  '8-char uppercase alphanumeric code printed on each letter. Verified at /verify/{code}. No expiry in Phase 1.';


-- ---------------------------------------------------------------------------
-- TABLE: settings
-- Single-row system configuration table.
-- Stores signed-URL paths for letterhead, stamp, and signature assets.
-- The CHECK constraint enforces exactly one row (id must always be 1).
-- ---------------------------------------------------------------------------

create table public.settings (
  id              int         primary key default 1,
  letterhead_path text,       -- storage path for TTU letterhead image
  stamp_path      text,       -- storage path for official stamp image
  signature_path  text,       -- storage path for authorised signature image
  updated_at      timestamptz,
  updated_by      uuid        references public.profiles (id) on delete set null,

  constraint settings_single_row check (id = 1)
);

-- Seed the one-and-only settings row so the admin page can UPDATE rather than INSERT.
insert into public.settings (id) values (1);

create trigger settings_touch_updated_at
  before update on public.settings
  for each row execute function public.touch_updated_at();

create trigger settings_stamp_updated_by
  before update on public.settings
  for each row execute function public.stamp_updated_by();

comment on table public.settings is
  'Single-row system config. Admin updates stamp/signature/letterhead paths here.';


-- ---------------------------------------------------------------------------
-- INDEXES
-- (Primary keys and UNIQUE constraints already create indexes above.)
-- ---------------------------------------------------------------------------

-- Admin dashboard: filter placements by status and zone.
create index placements_status_idx  on public.placements (status);
create index placements_zone_idx    on public.placements (zone_id);
create index placements_season_idx  on public.placements (season_id);
create index placements_student_idx on public.placements (student_id);

-- Letter audit: look up by student or season.
create index letters_student_idx on public.letters (student_id);
create index letters_season_idx  on public.letters (season_id);

-- Student lookup by index number (admin search).
create index students_index_number_idx on public.students (index_number);


-- ---------------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------------

-- Convenience: join profile + student fields in one row.
-- Used by admin pages and RLS policies that need both identity and academics.
create or replace view public.student_profiles as
  select
    p.id,
    p.full_name,
    p.phone,
    p.created_at,
    s.index_number,
    s.department,
    s.programme,
    s.level
  from public.profiles p
  join public.students s on s.id = p.id;

-- Convenience: derive each placement's current supervisor(s) via zone_id.
-- Replaces the removed placements.school_supervisor_id column — this view
-- is always live, so reassigning a zone's supervisor is reflected
-- immediately for every placement in that zone, with no stale snapshot.
-- A zone may have more than one supervisor in Phase 1 (zone_supervisors is
-- many-to-many), so this can return more than one row per placement.
create or replace view public.placement_supervisors as
  select
    pl.id as placement_id,
    pl.zone_id,
    zs.school_supervisor_id
  from public.placements pl
  join public.zone_supervisors zs on zs.zone_id = pl.zone_id;

comment on view public.placement_supervisors is
  'Derives the current supervisor(s) for each placement from zone_id + zone_supervisors. Always live — no stale snapshot risk.';

comment on view public.student_profiles is
  'profiles + students joined. Use for any query that needs both identity and academic fields.';
