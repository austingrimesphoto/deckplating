-- Large-workspace read paths. Record-returning functions use keyset cursors;
-- aggregate functions return one JSON document so PostgREST row caps cannot
-- truncate totals or leaderboard calculations.

create or replace function get_latest_active_checkins_page(
  p_organization_id uuid,
  p_after_unit_id uuid default null,
  p_page_size integer default 500
)
returns table (id uuid, unit_id uuid, checked_in_at timestamptz, visitor text)
language sql
stable
set search_path = ''
as $$
  select latest.unit_id as id, latest.unit_id, latest.checked_in_at, latest.visitor
  from (
    select distinct on (checkin.unit_id)
      checkin.unit_id,
      checkin.checked_in_at,
      member.name as visitor
    from public.checkins as checkin
    left join public.team_members as member
      on member.id = checkin.team_member_id
      and member.organization_id = checkin.organization_id
    where checkin.organization_id = p_organization_id
      and checkin.voided_at is null
      and (p_after_unit_id is null or checkin.unit_id > p_after_unit_id)
    order by checkin.unit_id, checkin.checked_in_at desc, checkin.created_at desc, checkin.id desc
  ) latest
  order by latest.unit_id
  limit least(greatest(coalesce(p_page_size, 500), 1), 1000);
$$;

create or replace function get_indicator_report_page(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_after_key text default null,
  p_page_size integer default 500
)
returns table (
  id text,
  key text,
  area_id uuid,
  area_name text,
  location_id uuid,
  location_name text,
  visits bigint,
  confidential_care_count bigint,
  referral_count bigint,
  single_unit_indicator_visits bigint,
  multi_unit_indicator_visits bigint
)
language sql
stable
set search_path = ''
as $$
  with batch_visits as (
    select
      batch.id as batch_id,
      batch.confidential_care_provided,
      batch.referral_provided,
      count(checkin.id)::integer as unit_count,
      coalesce(batch.location_id, min(checkin.location_id::text)::uuid, min(unit.location_id::text)::uuid) as resolved_location_id
    from public.checkin_batches batch
    join public.checkins checkin
      on checkin.batch_id = batch.id
      and checkin.organization_id = batch.organization_id
      and checkin.voided_at is null
    left join public.units unit
      on unit.id = checkin.unit_id
      and unit.organization_id = checkin.organization_id
    where batch.organization_id = p_organization_id
      and (p_from is null or checkin.checked_in_at >= p_from)
      and (p_to is null or checkin.checked_in_at <= p_to)
    group by batch.id
  ), grouped as (
    select
      coalesce(area.id::text, 'none') || ':' || coalesce(location.id::text, 'unmapped') as row_key,
      area.id as area_id,
      coalesce(area.name, 'Unassigned') as area_name,
      location.id as location_id,
      coalesce(location.name, 'Unmapped') as location_name,
      count(*)::bigint as visits,
      count(*) filter (where visit.confidential_care_provided is true)::bigint as confidential_care_count,
      count(*) filter (where visit.referral_provided is true)::bigint as referral_count,
      count(*) filter (
        where (visit.confidential_care_provided is true or visit.referral_provided is true)
          and visit.unit_count = 1
      )::bigint as single_unit_indicator_visits,
      count(*) filter (
        where (visit.confidential_care_provided is true or visit.referral_provided is true)
          and visit.unit_count > 1
      )::bigint as multi_unit_indicator_visits
    from batch_visits visit
    left join public.locations location
      on location.id = visit.resolved_location_id
      and location.organization_id = p_organization_id
    left join public.areas area
      on area.id = location.area_id
      and area.organization_id = p_organization_id
    group by area.id, area.name, location.id, location.name
  )
  select
    grouped.row_key as id,
    grouped.row_key as key,
    grouped.area_id,
    grouped.area_name,
    grouped.location_id,
    grouped.location_name,
    grouped.visits,
    grouped.confidential_care_count,
    grouped.referral_count,
    grouped.single_unit_indicator_visits,
    grouped.multi_unit_indicator_visits
  from grouped
  where p_after_key is null or grouped.row_key > p_after_key
  order by grouped.row_key
  limit least(greatest(coalesce(p_page_size, 500), 1), 1000);
$$;

create or replace function get_leaderboard_period(
  p_organization_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_time_zone text,
  p_swept_area_ids uuid[] default array[]::uuid[]
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with period_checkins as materialized (
    select
      checkin.unit_id,
      checkin.team_member_id,
      checkin.checked_in_at,
      checkin.score_awarded,
      member.name,
      location.area_id
    from public.checkins checkin
    join public.team_members member
      on member.id = checkin.team_member_id
      and member.organization_id = checkin.organization_id
    left join public.units unit
      on unit.id = checkin.unit_id
      and unit.organization_id = checkin.organization_id
    left join public.locations location
      on location.id = unit.location_id
      and location.organization_id = checkin.organization_id
    where checkin.organization_id = p_organization_id
      and checkin.voided_at is null
      and checkin.checked_in_at >= p_start
      and checkin.checked_in_at < p_end
  ), first_visits as (
    select checkin.unit_id, min(checkin.checked_in_at) as checked_in_at
    from public.checkins checkin
    where checkin.organization_id = p_organization_id
      and checkin.voided_at is null
      and checkin.checked_in_at < p_end
    group by checkin.unit_id
  ), member_rows as (
    select
      period.team_member_id,
      period.name,
      count(*) filter (where period.score_awarded > 0)::integer as qualifying_checkins,
      count(distinct period.unit_id)::integer as distinct_units,
      count(*) filter (where period.score_awarded >= 3)::integer as recovered_units,
      count(distinct period.unit_id) filter (
        where period.score_awarded > 0 and first_visit.checked_in_at = period.checked_in_at
      )::integer as gray_to_green_units,
      count(distinct period.area_id) filter (
        where period.score_awarded > 0 and period.area_id = any(coalesce(p_swept_area_ids, array[]::uuid[]))
      )::integer as coverage_sweep_areas,
      count(distinct (period.checked_in_at at time zone p_time_zone)::date)::integer as active_days,
      coalesce(sum(period.score_awarded), 0)::integer as score
    from period_checkins period
    left join first_visits first_visit on first_visit.unit_id = period.unit_id
    group by period.team_member_id, period.name
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(member_rows) order by score desc, recovered_units desc, distinct_units desc, name)
      from member_rows
    ), '[]'::jsonb),
    'units_recovered', (select count(distinct unit_id) from period_checkins where score_awarded >= 3),
    'distinct_units_covered', (select count(distinct unit_id) from period_checkins)
  );
$$;

create index if not exists idx_checkins_org_active_time_unit_member
  on checkins (organization_id, checked_in_at, unit_id, team_member_id)
  where voided_at is null;

revoke all on function get_latest_active_checkins_page(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function get_indicator_report_page(uuid, timestamptz, timestamptz, text, integer) from public, anon, authenticated;
revoke all on function get_leaderboard_period(uuid, timestamptz, timestamptz, text, uuid[]) from public, anon, authenticated;
grant execute on function get_latest_active_checkins_page(uuid, uuid, integer) to service_role;
grant execute on function get_indicator_report_page(uuid, timestamptz, timestamptz, text, integer) to service_role;
grant execute on function get_leaderboard_period(uuid, timestamptz, timestamptz, text, uuid[]) to service_role;
