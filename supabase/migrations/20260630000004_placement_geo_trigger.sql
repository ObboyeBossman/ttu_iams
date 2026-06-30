-- =============================================================================
-- IAMS — Update lock_admin_only_placement_fields() to also lock geo_* columns
-- =============================================================================

-- Extend the existing trigger to revert geo_region, geo_district, geo_town,
-- geocode_status, geocoded_at when student is the acting user — same pattern
-- as zone_id/synced_at, since those are also admin-managed fields.

create or replace function public.lock_admin_only_placement_fields()
returns trigger language plpgsql as $$
begin
  if public.current_role() = 'student' then
    new.zone_id         := old.zone_id;
    new.synced_at       := old.synced_at;
    new.geo_region      := old.geo_region;
    new.geo_district     := old.geo_district;
    new.geo_town         := old.geo_town;
    new.geocode_status   := old.geocode_status;
    new.geocoded_at      := old.geocoded_at;
  end if;

  return new;
end;
$$;

comment on function public.lock_admin_only_placement_fields is
  'When the acting user is a student, silently reverts zone_id, synced_at, geo_region, geo_district, geo_town, geocode_status, and geocoded_at to their prior values, regardless of what the client sent. updated_by is already overwritten unconditionally by stamp_updated_by, and status changes are independently constrained by validate_placement_status_transition + RLS.';
