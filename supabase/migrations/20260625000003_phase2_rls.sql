-- =============================================================================
-- IAMS — 20260625000003_phase2_rls.sql
-- Phase 2 — Complete RLS Policies for Logbook, Attendance & Related Tables
-- =============================================================================
-- Companion to 20260622000003_phase2_schema.sql which created the tables
-- with stub policies. This migration adds the missing admin-read, supervisor-read,
-- and update-blocking policies for locked/submitted logbook weeks.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: reusable admin check (avoids repetitive sub-selects)
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql security definer stable
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_school_supervisor()
returns boolean language sql security definer stable
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'school_supervisor'
  );
$$;

-- ---------------------------------------------------------------------------
-- logbook_weeks
-- ---------------------------------------------------------------------------

-- Admin: read all logbook weeks
create policy "logbook_weeks: admin reads all"
  on public.logbook_weeks
  for select
  using (public.is_admin());

-- School supervisor: read weeks for students in their zones
create policy "logbook_weeks: supervisor reads assigned zone"
  on public.logbook_weeks
  for select
  using (
    public.is_school_supervisor()
    and exists (
      select 1
      from public.placement_supervisors ps
      where ps.placement_id in (
        select id from public.placements
        where student_id = logbook_weeks.student_id
          and season_id  = logbook_weeks.season_id
      )
      and ps.school_supervisor_id = auth.uid()
    )
  );

-- Student: BLOCK updates on submitted/certified weeks (student cannot edit after submit)
-- The existing "logbook_weeks: student access own" policy allows ALL — we need to
-- restrict UPDATE specifically. We drop and recreate with separate SELECT/INSERT/UPDATE/DELETE.
drop policy if exists "logbook_weeks: student access own" on public.logbook_weeks;

create policy "logbook_weeks: student selects own"
  on public.logbook_weeks
  for select
  using (auth.uid() = student_id);

create policy "logbook_weeks: student inserts own"
  on public.logbook_weeks
  for insert
  with check (auth.uid() = student_id);

create policy "logbook_weeks: student updates own draft"
  on public.logbook_weeks
  for update
  using (auth.uid() = student_id and status = 'draft')
  with check (auth.uid() = student_id);

-- Student may set status=submitted from draft only (allow update to status=submitted)
create policy "logbook_weeks: student submits own week"
  on public.logbook_weeks
  for update
  using (auth.uid() = student_id and status = 'draft')
  with check (auth.uid() = student_id and status in ('draft', 'submitted'));

-- Admin: update any logbook week (for certification / finalization)
create policy "logbook_weeks: admin updates all"
  on public.logbook_weeks
  for update
  using (public.is_admin());

-- Supervisor: certify submitted weeks
create policy "logbook_weeks: supervisor certifies"
  on public.logbook_weeks
  for update
  using (
    public.is_school_supervisor()
    and status = 'submitted'
    and exists (
      select 1
      from public.placement_supervisors ps
      where ps.placement_id in (
        select id from public.placements
        where student_id = logbook_weeks.student_id
          and season_id  = logbook_weeks.season_id
      )
      and ps.school_supervisor_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- logbook_daily_entries
-- ---------------------------------------------------------------------------

-- Admin: read all daily entries
create policy "logbook_daily_entries: admin reads all"
  on public.logbook_daily_entries
  for select
  using (public.is_admin());

-- Supervisor: read entries where parent week's student is in their zone
create policy "logbook_daily_entries: supervisor reads assigned"
  on public.logbook_daily_entries
  for select
  using (
    public.is_school_supervisor()
    and exists (
      select 1
      from public.logbook_weeks lw
      join public.placement_supervisors ps
        on ps.placement_id in (
          select id from public.placements
          where student_id = lw.student_id
            and season_id  = lw.season_id
        )
      where lw.id = logbook_daily_entries.week_id
        and ps.school_supervisor_id = auth.uid()
    )
  );

-- Restrict student daily entry updates to draft weeks only
drop policy if exists "logbook_daily_entries: student access own" on public.logbook_daily_entries;

create policy "logbook_daily_entries: student selects own"
  on public.logbook_daily_entries
  for select
  using (
    exists (
      select 1 from public.logbook_weeks
      where id = logbook_daily_entries.week_id
        and student_id = auth.uid()
    )
  );

create policy "logbook_daily_entries: student inserts on draft week"
  on public.logbook_daily_entries
  for insert
  with check (
    exists (
      select 1 from public.logbook_weeks
      where id = logbook_daily_entries.week_id
        and student_id = auth.uid()
        and status = 'draft'
    )
  );

create policy "logbook_daily_entries: student updates on draft week"
  on public.logbook_daily_entries
  for update
  using (
    exists (
      select 1 from public.logbook_weeks
      where id = logbook_daily_entries.week_id
        and student_id = auth.uid()
        and status = 'draft'
    )
  );

-- ---------------------------------------------------------------------------
-- logbook_monthly_summaries
-- ---------------------------------------------------------------------------

-- Admin: read all monthly summaries
create policy "logbook_monthly_summaries: admin reads all"
  on public.logbook_monthly_summaries
  for select
  using (public.is_admin());

-- Supervisor: read summaries for students in their zone
create policy "logbook_monthly_summaries: supervisor reads assigned"
  on public.logbook_monthly_summaries
  for select
  using (
    public.is_school_supervisor()
    and exists (
      select 1
      from public.placement_supervisors ps
      where ps.placement_id in (
        select id from public.placements
        where student_id = logbook_monthly_summaries.student_id
          and season_id  = logbook_monthly_summaries.season_id
      )
      and ps.school_supervisor_id = auth.uid()
    )
  );

-- Restrict student monthly summary writes
drop policy if exists "logbook_monthly_summaries: student access own" on public.logbook_monthly_summaries;

create policy "logbook_monthly_summaries: student selects own"
  on public.logbook_monthly_summaries
  for select
  using (auth.uid() = student_id);

create policy "logbook_monthly_summaries: student inserts own"
  on public.logbook_monthly_summaries
  for insert
  with check (auth.uid() = student_id and status = 'draft');

create policy "logbook_monthly_summaries: student updates draft"
  on public.logbook_monthly_summaries
  for update
  using (auth.uid() = student_id and status = 'draft')
  with check (auth.uid() = student_id);

-- Supervisor: assess monthly summaries
create policy "logbook_monthly_summaries: supervisor assesses"
  on public.logbook_monthly_summaries
  for update
  using (
    public.is_school_supervisor()
    and exists (
      select 1
      from public.placement_supervisors ps
      where ps.placement_id in (
        select id from public.placements
        where student_id = logbook_monthly_summaries.student_id
          and season_id  = logbook_monthly_summaries.season_id
      )
      and ps.school_supervisor_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- attendance_logs
-- ---------------------------------------------------------------------------

-- Admin: read all attendance logs
create policy "attendance_logs: admin reads all"
  on public.attendance_logs
  for select
  using (public.is_admin());

-- Admin: update any attendance log (for manual absent marking)
create policy "attendance_logs: admin updates all"
  on public.attendance_logs
  for update
  using (public.is_admin());

-- Supervisor: read attendance logs for students in their zone
create policy "attendance_logs: supervisor reads assigned"
  on public.attendance_logs
  for select
  using (
    public.is_school_supervisor()
    and exists (
      select 1
      from public.placement_supervisors ps
      where ps.placement_id = attendance_logs.placement_id
        and ps.school_supervisor_id = auth.uid()
    )
  );

-- Student: update own log for today only (add check-out)
drop policy if exists "attendance_logs: student updates own" on public.attendance_logs;

create policy "attendance_logs: student updates own today"
  on public.attendance_logs
  for update
  using (
    auth.uid() = student_id
    and log_date = current_date
    and check_out_time is null
  )
  with check (auth.uid() = student_id);

-- ---------------------------------------------------------------------------
-- attendance_flags
-- ---------------------------------------------------------------------------

-- Student: read own flags
create policy "attendance_flags: student reads own"
  on public.attendance_flags
  for select
  using (auth.uid() = student_id);

-- Admin: update (resolve) flags
create policy "attendance_flags: admin updates all"
  on public.attendance_flags
  for update
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- updated_at triggers for Phase 2 tables (if not already present)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'logbook_weeks_touch_updated_at'
  ) then
    create trigger logbook_weeks_touch_updated_at
      before update on public.logbook_weeks
      for each row execute function public.touch_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'logbook_daily_entries_touch_updated_at'
  ) then
    create trigger logbook_daily_entries_touch_updated_at
      before update on public.logbook_daily_entries
      for each row execute function public.touch_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'logbook_monthly_summaries_touch_updated_at'
  ) then
    create trigger logbook_monthly_summaries_touch_updated_at
      before update on public.logbook_monthly_summaries
      for each row execute function public.touch_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'attendance_logs_touch_updated_at'
  ) then
    create trigger attendance_logs_touch_updated_at
      before update on public.attendance_logs
      for each row execute function public.touch_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Indexes for Phase 2 tables (performance)
-- ---------------------------------------------------------------------------

create index if not exists logbook_weeks_student_idx  on public.logbook_weeks (student_id);
create index if not exists logbook_weeks_season_idx   on public.logbook_weeks (season_id);
create index if not exists logbook_daily_week_idx     on public.logbook_daily_entries (week_id);
create index if not exists logbook_monthly_student_idx on public.logbook_monthly_summaries (student_id, season_id);
create index if not exists attendance_student_idx     on public.attendance_logs (student_id, season_id);
create index if not exists attendance_date_idx        on public.attendance_logs (log_date);
