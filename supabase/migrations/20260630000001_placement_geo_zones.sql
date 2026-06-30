-- supabase/migrations/20260630000001_placement_geo_zones.sql
-- Adds Google-geocoded administrative classification to placements,
-- kept fully separate from the existing student-entered `region` /
-- `city_town` address fields (those stay as-is; this is a second,
-- independently-derived classification of the same lat/lng).

alter table public.placements
  add column if not exists geo_region        text,
  add column if not exists geo_district      text,
  add column if not exists geo_town          text,
  add column if not exists geocode_status    text not null default 'pending',
  add column if not exists geocoded_at       timestamptz;

alter table public.placements
  add constraint placements_geocode_status_check
  check (geocode_status in ('pending', 'success', 'failed'));

-- Supports GROUP BY region/district/town efficiently as the dataset grows
-- nationally. Partial index — most queries filter on geo_region is not null.
create index if not exists idx_placements_geo
  on public.placements (geo_region, geo_district, geo_town)
  where geo_region is not null;

-- Supports the "Unresolved Locations" admin view.
create index if not exists idx_placements_geocode_status
  on public.placements (geocode_status)
  where geocode_status != 'success';

comment on column public.placements.geo_region is
  'Google Geocoding API administrative_area_level_1 result. Independent of the student-entered `region` text field — do not confuse the two.';
comment on column public.placements.geo_district is
  'Google Geocoding API administrative_area_level_2 result.';
comment on column public.placements.geo_town is
  'Google Geocoding API locality/sublocality result.';
comment on column public.placements.geocode_status is
  'Geocoding pipeline status: pending (not yet attempted), success, or failed.';
comment on column public.placements.geocoded_at is
  'Timestamp of the last successful geocoding attempt.';
