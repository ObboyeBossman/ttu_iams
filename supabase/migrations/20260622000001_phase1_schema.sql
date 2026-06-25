-- =============================================================================
-- Migration: 20260622000001_phase1_schema.sql
-- IAMS Phase 1 — Schema, triggers, indexes, views
-- Takoradi Technical University
-- =============================================================================
-- Managed by Supabase CLI. Do not run manually if using `supabase db push`.
-- For a manual SQL Editor run, execute supabase/schema.sql instead.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";


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

create type placement_status as enum (
  'submitted',
  'flagged',
  'rejected',
  'assigned'
);

create type location_source as enum (
  'gps',
  'manual'
);


-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role   not null,
  full_name   text        not null,
  phone       text        not null,
  created_at  timestamptz not null default now()
);
comment on table public.profiles is 'Common identity record for every user. Role-specific data is in role-specific tables.';

create table public.students (
  id           uuid primary key references public.profiles (id) on delete cascade,
  index_number text not null unique,
  department   text not null,
  programme    text not null,
  level        text not null
);
comment on table public.students is 'Student-specific academic identity. Only exists when profiles.role = ''student''.';

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
    placement_window_start >= start_date and
    placement_window_end   <= end_date   and
    placement_window_start <= placement_window_end
  ),
  constraint seasons_dates_ordered check (start_date <= end_date)
);
comment on table public.seasons is 'Attachment seasons. At most one season may be open at a time (partial unique index).';

create unique index seasons_one_open on public.seasons (status) where status = 'open';

create table public.zones (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  updated_by  uuid        references public.profiles (id) on delete set null
);
comment on table public.zones is 'Geographical supervision zones. Independent of seasons.';

create table public.zone_supervisors (
  zone_id               uuid not null references public.zones    (id) on delete cascade,
  school_supervisor_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (zone_id, school_supervisor_id)
);
comment on table public.zone_supervisors is 'Many-to-many: school supervisors assigned to zones.';

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
  latitude              numeric(9, 6),
  longitude             numeric(9, 6),
  location_source       location_source  not null,
  start_date            date             not null,
  end_date              date             not null,
  status                placement_status not null default 'submitted',
  zone_id               uuid             references public.zones    (id) on delete set null,
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
comment on table public.placements is 'Student placement registrations. draft_id is a client UUID enforcing insert idempotency.';
comment on column public.placements.draft_id is 'Client-generated UUID. Stays constant through all edits and retry attempts. UNIQUE constraint makes duplicate inserts safe to ignore.';
comment on column public.placements.synced_at is 'NULL while record exists only in IndexedDB. Set to now() on the first confirmed server insert via trigger.';

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
comment on table public.letters is 'Audit log of generated letters. PDFs are not stored — generated client-side. Letter count = COUNT(*) per student per season.';
comment on column public.letters.verification_code is '8-char uppercase alphanumeric code printed on each letter. Verified at /verify/{code}. No expiry in Phase 1.';

create table public.settings (
  id              int         primary key default 1,
  letterhead_path text,
  stamp_path      text,
  signature_path  text,
  updated_at      timestamptz,
  updated_by      uuid        references public.profiles (id) on delete set null,
  constraint settings_single_row check (id = 1)
);
comment on table public.settings is 'Single-row system config. Admin updates stamp/signature/letterhead paths here.';

insert into public.settings (id) values (1);


-- ---------------------------------------------------------------------------
-- TRIGGER FUNCTIONS
-- ---------------------------------------------------------------------------

create or replace function public.enforce_student_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select role from public.profiles where id = new.id) is distinct from 'student' then
    raise exception 'students.id (%) must reference a profile with role = student', new.id;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_school_supervisor_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select role from public.profiles where id = new.school_supervisor_id) is distinct from 'school_supervisor' then
    raise exception 'zone_supervisors.school_supervisor_id (%) must reference a profile with role = school_supervisor', new.school_supervisor_id;
  end if;
  return new;
end;
$$;

create or replace function public.stamp_synced_at()
returns trigger language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.stamp_updated_by()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;
comment on function public.stamp_updated_by is 'Overwrites updated_by with auth.uid() on every update, regardless of what the client sent.';

create or replace function public.validate_placement_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if old.status = 'submitted' and new.status in ('assigned', 'flagged', 'rejected') then return new; end if;
  if old.status = 'flagged'   and new.status in ('assigned', 'rejected')            then return new; end if;
  raise exception 'invalid placement status transition: % → % (placement %)', old.status, new.status, old.id;
end;
$$;
comment on function public.validate_placement_status_transition is 'Enforces the Phase 1 placement status lifecycle: submitted → assigned/flagged/rejected; flagged → assigned/rejected. No reversion to submitted; assigned and rejected are terminal.';

create or replace function public.lock_admin_only_placement_fields()
returns trigger language plpgsql as $$
begin
  if public.current_role() = 'student' then
    new.zone_id   := old.zone_id;
    new.synced_at := old.synced_at;
  end if;
  return new;
end;
$$;
comment on function public.lock_admin_only_placement_fields is 'When the acting user is a student, silently reverts zone_id and synced_at to their prior values, regardless of what the client sent.';


-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------

create trigger students_enforce_student_role
  before insert or update on public.students
  for each row execute function public.enforce_student_role();

create trigger zone_supervisors_enforce_supervisor_role
  before insert or update on public.zone_supervisors
  for each row execute function public.enforce_school_supervisor_role();

create trigger placements_stamp_synced_at
  before insert on public.placements
  for each row execute function public.stamp_synced_at();

create trigger seasons_touch_updated_at   before update on public.seasons   for each row execute function public.touch_updated_at();
create trigger zones_touch_updated_at     before update on public.zones     for each row execute function public.touch_updated_at();
create trigger placements_touch_updated_at before update on public.placements for each row execute function public.touch_updated_at();
create trigger settings_touch_updated_at  before update on public.settings  for each row execute function public.touch_updated_at();

create trigger seasons_stamp_updated_by   before update on public.seasons   for each row execute function public.stamp_updated_by();
create trigger zones_stamp_updated_by     before update on public.zones     for each row execute function public.stamp_updated_by();
create trigger placements_stamp_updated_by before update on public.placements for each row execute function public.stamp_updated_by();
create trigger settings_stamp_updated_by  before update on public.settings  for each row execute function public.stamp_updated_by();

create trigger placements_validate_status_transition
  before update on public.placements
  for each row execute function public.validate_placement_status_transition();

create trigger placements_lock_admin_only_fields
  before update on public.placements
  for each row execute function public.lock_admin_only_placement_fields();


-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

create index placements_status_idx  on public.placements (status);
create index placements_zone_idx    on public.placements (zone_id);
create index placements_season_idx  on public.placements (season_id);
create index placements_student_idx on public.placements (student_id);
create index letters_student_idx    on public.letters    (student_id);
create index letters_season_idx     on public.letters    (season_id);
create index students_index_number_idx on public.students (index_number);


-- ---------------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------------

create or replace view public.student_profiles as
  select p.id, p.full_name, p.phone, p.created_at,
         s.index_number, s.department, s.programme, s.level
  from public.profiles p
  join public.students s on s.id = p.id;
comment on view public.student_profiles is 'profiles + students joined. Use for any query that needs both identity and academic fields.';

create or replace view public.placement_supervisors as
  select pl.id as placement_id, pl.zone_id, zs.school_supervisor_id
  from public.placements pl
  join public.zone_supervisors zs on zs.zone_id = pl.zone_id;
comment on view public.placement_supervisors is 'Derives the current supervisor(s) for each placement from zone_id + zone_supervisors. Always live — no stale snapshot risk.';
