-- =============================================================================
-- IAMS — Industrial Attachment Management System
-- Phase 1 RLS Policies
-- Takoradi Technical University
-- =============================================================================
-- Run AFTER schema.sql.
-- Every table has RLS enabled. Default = deny. Only explicitly granted
-- operations are permitted.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------------

-- Returns the role of the currently authenticated user.
-- Reads from profiles so every policy stays in one place.
create or replace function public.current_role()
returns user_role language sql stable security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid()
$$;

comment on function public.current_role is
  'Returns the user_role of the currently authenticated user from profiles.';


-- ---------------------------------------------------------------------------
-- ENABLE RLS ON ALL TABLES
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.students         enable row level security;
alter table public.seasons          enable row level security;
alter table public.zones            enable row level security;
alter table public.zone_supervisors enable row level security;
alter table public.placements       enable row level security;
alter table public.letters          enable row level security;


-- =============================================================================
-- profiles
-- =============================================================================

-- Every authenticated user can read their own profile.
create policy "profiles: user reads own row"
  on public.profiles for select
  using (id = auth.uid());

-- Admin can read all profiles (needed for student lists, supervisor assignment).
create policy "profiles: admin reads all"
  on public.profiles for select
  using (public.current_role() = 'admin');

-- Admin can insert profiles (account creation on behalf of students/supervisors).
create policy "profiles: admin inserts"
  on public.profiles for insert
  with check (public.current_role() = 'admin');

-- Admin can update any profile.
create policy "profiles: admin updates"
  on public.profiles for update
  using (public.current_role() = 'admin');

-- A user may update their own profile (phone, full_name).
-- They cannot change their own role.
create policy "profiles: user updates own row"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid() and
    role = (select role from public.profiles where id = auth.uid())
  );


-- =============================================================================
-- students
-- =============================================================================

-- A student can read their own academic record.
create policy "students: student reads own row"
  on public.students for select
  using (id = auth.uid());

-- Admin can read all student records.
create policy "students: admin reads all"
  on public.students for select
  using (public.current_role() = 'admin');

-- School supervisors can read students in their zones.
-- (Resolved via placements → zone_supervisors join.)
create policy "students: supervisor reads assigned"
  on public.students for select
  using (
    public.current_role() = 'school_supervisor' and
    exists (
      select 1
      from public.placements pl
      join public.zone_supervisors zs on zs.zone_id = pl.zone_id
      where pl.student_id = students.id
        and zs.school_supervisor_id = auth.uid()
    )
  );

-- Admin inserts student rows (at account creation).
create policy "students: admin inserts"
  on public.students for insert
  with check (public.current_role() = 'admin');

-- Admin can update student academic details.
create policy "students: admin updates"
  on public.students for update
  using (public.current_role() = 'admin');


-- =============================================================================
-- seasons
-- =============================================================================

-- All authenticated users can read seasons (students need to know if window is open).
create policy "seasons: all authenticated users read"
  on public.seasons for select
  using (auth.uid() is not null);

-- Only admin can create, update, or archive seasons.
create policy "seasons: admin inserts"
  on public.seasons for insert
  with check (public.current_role() = 'admin');

create policy "seasons: admin updates"
  on public.seasons for update
  using (public.current_role() = 'admin');


-- =============================================================================
-- zones
-- =============================================================================

-- All authenticated users can read zones (students see zone name on their placement).
create policy "zones: all authenticated users read"
  on public.zones for select
  using (auth.uid() is not null);

-- Only admin manages zones.
create policy "zones: admin inserts"
  on public.zones for insert
  with check (public.current_role() = 'admin');

create policy "zones: admin updates"
  on public.zones for update
  using (public.current_role() = 'admin');

create policy "zones: admin deletes"
  on public.zones for delete
  using (public.current_role() = 'admin');


-- =============================================================================
-- zone_supervisors
-- =============================================================================

-- Admin reads all assignments.
create policy "zone_supervisors: admin reads all"
  on public.zone_supervisors for select
  using (public.current_role() = 'admin');

-- A school supervisor can see which zones they are assigned to.
create policy "zone_supervisors: supervisor reads own"
  on public.zone_supervisors for select
  using (school_supervisor_id = auth.uid());

-- Only admin manages zone-supervisor assignments.
create policy "zone_supervisors: admin inserts"
  on public.zone_supervisors for insert
  with check (public.current_role() = 'admin');

create policy "zone_supervisors: admin deletes"
  on public.zone_supervisors for delete
  using (public.current_role() = 'admin');


-- =============================================================================
-- placements
-- =============================================================================

-- A student can only see their own placements.
create policy "placements: student reads own"
  on public.placements for select
  using (student_id = auth.uid());

-- Admin can read all placements.
create policy "placements: admin reads all"
  on public.placements for select
  using (public.current_role() = 'admin');

-- School supervisor can see placements assigned to their zones.
create policy "placements: supervisor reads assigned zone"
  on public.placements for select
  using (
    public.current_role() = 'school_supervisor' and
    exists (
      select 1
      from public.zone_supervisors zs
      where zs.zone_id = placements.zone_id
        and zs.school_supervisor_id = auth.uid()
    )
  );

-- A student can insert their own placement (sync from IndexedDB).
-- Enforced conditions:
--   * student_id must match the authenticated user
--   * status must be 'submitted' on insert (the only valid initial state)
--   * The placement window for the chosen season must currently be open
create policy "placements: student inserts own"
  on public.placements for insert
  with check (
    student_id = auth.uid() and
    public.current_role() = 'student' and
    status = 'submitted' and
    exists (
      select 1
      from public.seasons s
      where s.id = season_id
        and s.status = 'open'
        and current_date between s.placement_window_start and s.placement_window_end
    )
  );

-- A student may update their own placement ONLY while it is still 'submitted'.
-- Once flagged/rejected/assigned, the student cannot change anything.
-- They may not change student_id, season_id, or status themselves.
create policy "placements: student updates own while submitted"
  on public.placements for update
  using (
    student_id = auth.uid() and
    public.current_role() = 'student' and
    status = 'submitted'
  )
  with check (
    student_id = auth.uid() and
    status = 'submitted'
  );

-- Admin can update any placement (batch assignment of zone + supervisor,
-- status transitions to assigned/flagged/rejected).
create policy "placements: admin updates all"
  on public.placements for update
  using (public.current_role() = 'admin');


-- =============================================================================
-- letters
-- =============================================================================

-- A student can only see their own letter records.
create policy "letters: student reads own"
  on public.letters for select
  using (student_id = auth.uid());

-- Admin can read all letter records (audit).
create policy "letters: admin reads all"
  on public.letters for select
  using (public.current_role() = 'admin');

-- A student may insert their own letter metadata (at generation time).
-- Conditions:
--   * student_id must match the authenticated user
--   * The chosen season must be open
create policy "letters: student inserts own"
  on public.letters for insert
  with check (
    student_id = auth.uid() and
    public.current_role() = 'student' and
    exists (
      select 1
      from public.seasons s
      where s.id = season_id
        and s.status = 'open'
    )
  );

-- Letters are never updated or deleted — the audit log is immutable.
-- (Regenerating a letter creates a new row with a new verification_code.)


-- =============================================================================
-- settings
-- =============================================================================

alter table public.settings enable row level security;

-- All authenticated users can read settings (needed to fetch asset paths for letter generation).
create policy "settings: all authenticated users read"
  on public.settings for select
  using (auth.uid() is not null);

-- Only admin can update settings (stamp, signature, letterhead paths).
create policy "settings: admin updates"
  on public.settings for update
  using (public.current_role() = 'admin');

-- No insert or delete — the single row is seeded in schema.sql.
