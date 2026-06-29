-- =============================================================================
-- Migration: 20260629000001_placement_geocoding.sql
-- IAMS - Placement Geographic Zoning (Region -> District -> Town)
-- =============================================================================

alter table public.placements
  add column if not exists district text,
  add column if not exists town text,
  add column if not exists geocode_status text default 'pending',
  add column if not exists geocoded_at timestamptz;

-- Make region nullable if we want to allow pending geocodes without a region? 
-- The existing schema has region as NOT NULL. For now, we will leave it as is or alter it.
-- We will alter it to drop not null just in case it's needed for the geocoding flow where it could fail.
alter table public.placements
  alter column region drop not null;

create index if not exists idx_placements_geo
  on public.placements (region, district, town);

create or replace function public.get_placement_regions()
returns table (region text, total bigint, supervised_count bigint)
language sql security definer as $$
  select region, count(*) as total,
         count(*) filter (where zone_id is not null) as supervised_count
  from public.placements
  where region is not null
  group by region
  order by region;
$$;

create or replace function public.get_placement_districts(p_region text)
returns table (district text, total bigint, supervised_count bigint)
language sql security definer as $$
  select district, count(*) as total,
         count(*) filter (where zone_id is not null) as supervised_count
  from public.placements
  where region = p_region and district is not null
  group by district
  order by district;
$$;

create or replace function public.get_placement_towns(p_region text, p_district text)
returns table (town text, total bigint, supervised_count bigint)
language sql security definer as $$
  select town, count(*) as total,
         count(*) filter (where zone_id is not null) as supervised_count
  from public.placements
  where region = p_region and district = p_district and town is not null
  group by town
  order by town;
$$;
