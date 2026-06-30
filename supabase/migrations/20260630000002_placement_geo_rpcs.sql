-- supabase/migrations/20260630000002_placement_geo_rpcs.sql
-- The three RPC functions called by placement-zones.js but never created.
-- Written in the same style as the existing current_role() helper:
--   security definer, stable, search_path pinned.
--
-- "Supervised" = the placement's zone_id is set (a supervisor is then
-- derivable via zone_supervisors / placement_supervisors). There is no
-- supervisor_id column on placements — see schema comments.

create or replace function public.get_placement_regions()
returns table (region text, total bigint, supervised_count bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select
    geo_region                                          as region,
    count(*)                                            as total,
    count(*) filter (where zone_id is not null)         as supervised_count
  from public.placements
  where geo_region is not null
    and public.current_role() = 'admin'
  group by geo_region
  order by geo_region;
$$;

create or replace function public.get_placement_districts(p_region text)
returns table (district text, total bigint, supervised_count bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select
    geo_district                                        as district,
    count(*)                                            as total,
    count(*) filter (where zone_id is not null)         as supervised_count
  from public.placements
  where geo_region    = p_region
    and geo_district  is not null
    and public.current_role() = 'admin'
  group by geo_district
  order by geo_district;
$$;

create or replace function public.get_placement_towns(p_region text, p_district text)
returns table (town text, total bigint, supervised_count bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select
    geo_town                                            as town,
    count(*)                                            as total,
    count(*) filter (where zone_id is not null)         as supervised_count
  from public.placements
  where geo_region   = p_region
    and geo_district = p_district
    and geo_town     is not null
    and public.current_role() = 'admin'
  group by geo_town
  order by geo_town;
$$;

comment on function public.get_placement_regions is
  'Admin-only. Region-level placement counts for the Placement Zones page. Returns empty set for non-admins (defense in depth; the page itself is admin-routed).';
comment on function public.get_placement_districts is
  'Admin-only. District-level placement counts, scoped to a region.';
comment on function public.get_placement_towns is
  'Admin-only. Town-level placement counts, scoped to a region + district.';
