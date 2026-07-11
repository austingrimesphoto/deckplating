-- Remove the redundant explicit integer-loop declaration reported by plpgsql_check.
create or replace function create_checkin_batch(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_device_id uuid,
  p_client_batch_id uuid,
  p_request_fingerprint text,
  p_occurred_at timestamptz,
  p_location_id uuid,
  p_unit_ids uuid[],
  p_geofence_verified boolean[],
  p_distance_meters integer[],
  p_confidential_care_provided boolean,
  p_referral_provided boolean
)
returns table (batch jsonb, checkin_rows jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.checkin_batches%rowtype;
  v_checkin_rows jsonb;
  v_existing_unit_ids uuid[];
  v_requested_unit_ids uuid[];
  v_unit_id uuid;
  v_interval integer;
  v_prior_at timestamptz;
  v_has_cooldown_visit boolean;
  v_days integer;
  v_score integer;
begin
  if p_organization_id is null
    or p_team_member_id is null
    or p_device_id is null
    or p_client_batch_id is null
    or p_request_fingerprint is null
    or p_occurred_at is null
    or coalesce(cardinality(p_unit_ids), 0) = 0
    or cardinality(p_unit_ids) > 100
    or cardinality(p_geofence_verified) <> cardinality(p_unit_ids)
    or cardinality(p_distance_meters) <> cardinality(p_unit_ids) then
    raise exception 'checkin_request_invalid' using errcode = 'P0001';
  end if;

  select array_agg(unit_id order by unit_id)
  into v_requested_unit_ids
  from (select distinct unnest(p_unit_ids) as unit_id) as requested;
  if cardinality(v_requested_unit_ids) <> cardinality(p_unit_ids) then
    raise exception 'checkin_request_invalid' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('deckplating:batch:' || p_organization_id::text || ':' || p_client_batch_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('deckplating:unit:' || p_organization_id::text || ':' || locked_unit.unit_id::text, 0)
  )
  from (select unnest(p_unit_ids) as unit_id order by unit_id) as locked_unit;

  perform 1
  from public.devices
  where id = p_device_id
    and organization_id = p_organization_id
    and team_member_id = p_team_member_id
    and active is true
  for update;
  if not found then
    raise exception 'checkin_device_inactive' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(p_unit_ids) as requested(unit_id)
    left join public.units as unit
      on unit.id = requested.unit_id
      and unit.organization_id = p_organization_id
      and unit.active is true
    left join public.locations as location
      on location.id = unit.location_id
      and location.organization_id = p_organization_id
      and location.active is true
    where unit.id is null
      or location.id is distinct from p_location_id
  ) then
    raise exception 'checkin_units_invalid' using errcode = 'P0001';
  end if;
  if p_location_id is null and cardinality(p_unit_ids) > 1 then
    raise exception 'checkin_units_invalid' using errcode = 'P0001';
  end if;

  select * into v_batch
  from public.checkin_batches
  where organization_id = p_organization_id
    and client_batch_id = p_client_batch_id
  for update;

  if found then
    if v_batch.team_member_id <> p_team_member_id
      or v_batch.device_id <> p_device_id then
      raise exception 'checkin_batch_owner_mismatch' using errcode = 'P0001';
    end if;
    if v_batch.request_fingerprint is not null
      and v_batch.request_fingerprint <> p_request_fingerprint then
      raise exception 'checkin_batch_conflict' using errcode = 'P0001';
    end if;
    if v_batch.location_id is distinct from p_location_id
      or v_batch.occurred_at <> p_occurred_at then
      raise exception 'checkin_batch_conflict' using errcode = 'P0001';
    end if;
    select array_agg(checkin.unit_id order by checkin.unit_id)
    into v_existing_unit_ids
    from public.checkins as checkin
    where checkin.organization_id = p_organization_id
      and checkin.batch_id = v_batch.id;
    if v_existing_unit_ids is distinct from v_requested_unit_ids then
      raise exception 'checkin_batch_conflict' using errcode = 'P0001';
    end if;

    update public.checkin_batches
    set request_fingerprint = coalesce(request_fingerprint, p_request_fingerprint),
        confidential_care_provided = p_confidential_care_provided,
        referral_provided = p_referral_provided,
        outcomes_recorded_at = case
          when p_confidential_care_provided is true or p_referral_provided is true then pg_catalog.now()
          else null
        end,
        updated_by_team_member_id = p_team_member_id
    where id = v_batch.id
      and organization_id = p_organization_id
    returning * into v_batch;
  else
    insert into public.checkin_batches (
      organization_id,
      client_batch_id,
      request_fingerprint,
      location_id,
      team_member_id,
      device_id,
      occurred_at,
      confidential_care_provided,
      referral_provided,
      outcomes_recorded_at,
      updated_by_team_member_id
    ) values (
      p_organization_id,
      p_client_batch_id,
      p_request_fingerprint,
      p_location_id,
      p_team_member_id,
      p_device_id,
      p_occurred_at,
      p_confidential_care_provided,
      p_referral_provided,
      case
        when p_confidential_care_provided is true or p_referral_provided is true then pg_catalog.now()
        else null
      end,
      p_team_member_id
    )
    returning * into v_batch;

    for v_index in 1..cardinality(p_unit_ids) loop
      v_unit_id := p_unit_ids[v_index];
      select visit_interval_days into v_interval
      from public.units
      where id = v_unit_id
        and organization_id = p_organization_id;

      select checkin.checked_in_at into v_prior_at
      from public.checkins as checkin
      where checkin.organization_id = p_organization_id
        and checkin.unit_id = v_unit_id
        and checkin.voided_at is null
        and checkin.checked_in_at <= p_occurred_at
      order by checkin.checked_in_at desc, checkin.created_at desc, checkin.id desc
      limit 1;

      select exists (
        select 1
        from public.checkins as checkin
        where checkin.organization_id = p_organization_id
          and checkin.unit_id = v_unit_id
          and checkin.voided_at is null
          and checkin.checked_in_at between p_occurred_at - interval '14 days' and p_occurred_at + interval '14 days'
      ) into v_has_cooldown_visit;

      v_score := 0;
      if not v_has_cooldown_visit then
        if v_prior_at is null then
          v_score := 3;
        else
          v_days := floor(extract(epoch from (p_occurred_at - v_prior_at)) / 86400)::integer;
          v_score := 1;
          if v_days::numeric / v_interval >= 1 then
            v_score := v_score + 2;
          elsif v_days::numeric / v_interval >= 0.75 then
            v_score := v_score + 1;
          end if;
        end if;
      end if;

      insert into public.checkins (
        organization_id,
        batch_id,
        unit_id,
        location_id,
        team_member_id,
        device_id,
        checked_in_at,
        geofence_verified,
        distance_meters,
        score_awarded
      ) values (
        p_organization_id,
        v_batch.id,
        v_unit_id,
        p_location_id,
        p_team_member_id,
        p_device_id,
        p_occurred_at,
        p_geofence_verified[v_index],
        p_distance_meters[v_index],
        v_score
      );
    end loop;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', checkin.id,
        'unit_id', checkin.unit_id,
        'score_awarded', checkin.score_awarded
      ) order by checkin.created_at, checkin.id
    ),
    '[]'::jsonb
  ) into v_checkin_rows
  from public.checkins as checkin
  where checkin.organization_id = p_organization_id
    and checkin.batch_id = v_batch.id;

  return query select
    jsonb_build_object(
      'id', v_batch.id,
      'location_id', v_batch.location_id,
      'confidential_care_provided', v_batch.confidential_care_provided,
      'referral_provided', v_batch.referral_provided
    ),
    v_checkin_rows;
end;
$$;

revoke all on function create_checkin_batch(uuid, uuid, uuid, uuid, text, timestamptz, uuid, uuid[], boolean[], integer[], boolean, boolean) from public, anon, authenticated;
grant execute on function create_checkin_batch(uuid, uuid, uuid, uuid, text, timestamptz, uuid, uuid[], boolean[], integer[], boolean, boolean) to service_role;
