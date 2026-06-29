-- =============================================================================
-- Migration: 20260629000002_auto_create_profile.sql
-- Creates a trigger so every new auth.users row automatically
-- gets a corresponding public.profiles row.
-- =============================================================================

-- Function that fires on INSERT to auth.users
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    -- Read role from user_metadata if provided (e.g. 'admin', 'student', etc.)
    -- Falls back to 'student' if not set
    coalesce(
      (new.raw_user_meta_data->>'role')::user_role,
      'student'
    ),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing; -- safe to re-run / idempotent
  return new;
end;
$$;

comment on function public.handle_new_user is
  'Auto-creates a public.profiles row whenever a new auth.users row is inserted.
   Pass role, full_name, phone in user_metadata when creating the user.';

-- Attach trigger to auth.users
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
