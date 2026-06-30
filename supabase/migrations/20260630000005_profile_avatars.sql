-- supabase/migrations/20260630000005_profile_avatars.sql

alter table public.profiles
  add column if not exists avatar_path text;

comment on column public.profiles.avatar_path is
  'Storage path in the avatars bucket, e.g. "avatars/<user_id>.jpg". Null = no avatar uploaded; UI falls back to initials.';

-- -----------------------------------------------------------------------------
-- Storage: dedicated 'avatars' bucket.
-- This is intentionally separate from 'branding' (which has no committed
-- policy at all). Avatars need the opposite access shape from branding:
-- self-write, broad-read, rather than admin-write, broad-read.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- Anyone authenticated may read any avatar (topbar, popover, and the admin
-- Users list all need to display other users' avatars, not just their own).
create policy "avatars: authenticated users read all"
  on storage.objects for select
  using (bucket_id = 'avatars' and auth.uid() is not null);

-- A user may only upload to a path prefixed with their own user id —
-- enforced by requiring the first path segment to equal auth.uid(), the
-- same ownership-by-path-prefix pattern Supabase Storage examples use when
-- there's no separate metadata table backing the object.
create policy "avatars: user uploads own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: user replaces own"
  on storage.objects for update
  using (
    bucket_id = 'avatars' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: user deletes own"
  on storage.objects for delete
  using (
    bucket_id = 'avatars' and
    (storage.foldername(name))[1] = auth.uid()::text
  );
