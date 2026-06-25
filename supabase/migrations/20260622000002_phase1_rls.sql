-- =============================================================================
-- Migration: 20260622000002_phase1_rls.sql
-- IAMS Phase 1 — Row Level Security policies
-- Takoradi Technical University
-- =============================================================================
-- Managed by Supabase CLI. Do not run manually if using `supabase db push`.
-- For a manual SQL Editor run, execute supabase/rls-policies.sql instead.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- HELPER: current_role()
-- Returns the user_role of the authenticated caller from profiles.
-- Used in every policy so the role lookup stays in one place.
-- ---------------------------------------------------------------------------

create or replace function public.current_role()
returns user_role language sql stable security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid()
$$;
comment on function public.current_role is 'Returns the user_role of the currently authenticated user from profiles.';


-- ---------------------------------------------------------------------------
-- ENABLE RLS
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.students         enable row level security;
alter table public.seasons          enable row level security;
alter table public.zones            enable row level security;
alter table public.zone_supervisors enable row level security;
alter table public.placements       enable row level security;
alter table public.letters          enable row level security;
alter table public.settings         enable row level security;


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy "profiles: user reads own row"     on public.profiles for select using (id = auth.uid());
create policy "profiles: admin reads all"         on public.profiles for select using (public.current_role() = 'admin');
create policy "profiles: admin inserts"           on public.profiles for insert with check (public.current_role() = 'admin');
create policy "profiles: admin updates"           on public.profiles for update using (public.current_role() = 'admin');
create policy "profiles: user updates own row"    on public.profiles for update
  using  (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));


-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------

create policy "students: student reads own row"       on public.students for select using (id = auth.uid());
create policy "students: admin reads all"             on public.students for select using (public.current_role() = 'admin');
create policy "students: supervisor reads assigned"   on public.students for select
  using (
    public.current_role() = 'school_supervisor' and
    exists (
      select 1 from public.placements pl
      join public.zone_supervisors zs on zs.zone_id = pl.zone_id
      where pl.student_id = students.id and zs.school_supervisor_id = auth.uid()
    )
  );
create policy "students: admin inserts"  on public.students for insert with check (public.current_role() = 'admin');
create policy "students: admin updates"  on public.students for update using  (public.current_role() = 'admin');


-- ---------------------------------------------------------------------------
-- seasons
-- ---------------------------------------------------------------------------

create policy "seasons: all authenticated users read" on public.seasons for select using (auth.uid() is not null);
create policy "seasons: admin inserts"                on public.seasons for insert with check (public.current_role() = 'admin');
create policy "seasons: admin updates"                on public.seasons for update using  (public.current_role() = 'admin');


-- ---------------------------------------------------------------------------
-- zones
-- ---------------------------------------------------------------------------

create policy "zones: all authenticated users read" on public.zones for select using (auth.uid() is not null);
create policy "zones: admin inserts"               on public.zones for insert with check (public.current_role() = 'admin');
create policy "zones: admin updates"               on public.zones for update using  (public.current_role() = 'admin');
create policy "zones: admin deletes"               on public.zones for delete using  (public.current_role() = 'admin');


-- ---------------------------------------------------------------------------
-- zone_supervisors
-- ---------------------------------------------------------------------------

create policy "zone_supervisors: admin reads all"   on public.zone_supervisors for select using (public.current_role() = 'admin');
create policy "zone_supervisors: supervisor reads own" on public.zone_supervisors for select using (school_supervisor_id = auth.uid());
create policy "zone_supervisors: admin inserts"     on public.zone_supervisors for insert with check (public.current_role() = 'admin');
create policy "zone_supervisors: admin deletes"     on public.zone_supervisors for delete using  (public.current_role() = 'admin');


-- ---------------------------------------------------------------------------
-- placements
-- ---------------------------------------------------------------------------

create policy "placements: student reads own"            on public.placements for select using (student_id = auth.uid());
create policy "placements: admin reads all"              on public.placements for select using (public.current_role() = 'admin');
create policy "placements: supervisor reads assigned zone" on public.placements for select
  using (
    public.current_role() = 'school_supervisor' and
    exists (select 1 from public.zone_supervisors zs where zs.zone_id = placements.zone_id and zs.school_supervisor_id = auth.uid())
  );

create policy "placements: student inserts own" on public.placements for insert
  with check (
    student_id = auth.uid() and
    public.current_role() = 'student' and
    status = 'submitted' and
    exists (
      select 1 from public.seasons s
      where s.id = season_id
        and s.status = 'open'
        and current_date between s.placement_window_start and s.placement_window_end
    )
  );

create policy "placements: student updates own while submitted" on public.placements for update
  using  (student_id = auth.uid() and public.current_role() = 'student' and status = 'submitted')
  with check (student_id = auth.uid() and status = 'submitted');

create policy "placements: admin updates all" on public.placements for update using (public.current_role() = 'admin');


-- ---------------------------------------------------------------------------
-- letters
-- ---------------------------------------------------------------------------

create policy "letters: student reads own"   on public.letters for select using (student_id = auth.uid());
create policy "letters: admin reads all"     on public.letters for select using (public.current_role() = 'admin');
create policy "letters: student inserts own" on public.letters for insert
  with check (
    student_id = auth.uid() and
    public.current_role() = 'student' and
    exists (select 1 from public.seasons s where s.id = season_id and s.status = 'open')
  );
-- Letters are never updated or deleted — the audit log is immutable.


-- ---------------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------------

create policy "settings: all authenticated users read" on public.settings for select using (auth.uid() is not null);
create policy "settings: admin updates"                on public.settings for update using  (public.current_role() = 'admin');
-- No insert / delete — single row is seeded in migration 000001.
