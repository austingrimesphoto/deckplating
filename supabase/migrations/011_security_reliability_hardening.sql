create table if not exists api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  expires_at timestamptz not null,
  primary key (scope, key_hash)
);

alter table api_rate_limits enable row level security;

create index if not exists idx_api_rate_limits_expiry
  on api_rate_limits(expires_at);

revoke all on table api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table api_rate_limits to service_role;

create or replace function consume_api_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_expires_at timestamptz;
begin
  if length(p_scope) < 1 or length(p_scope) > 80
    or length(p_key_hash) <> 64
    or p_limit < 1 or p_limit > 10000
    or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit policy.' using errcode = '22023';
  end if;

  insert into public.api_rate_limits as current_limit (
    scope,
    key_hash,
    window_started_at,
    request_count,
    expires_at
  ) values (
    p_scope,
    p_key_hash,
    v_now,
    1,
    v_now + make_interval(secs => p_window_seconds)
  )
  on conflict (scope, key_hash) do update set
    window_started_at = case
      when current_limit.expires_at <= v_now then v_now
      else current_limit.window_started_at
    end,
    request_count = case
      when current_limit.expires_at <= v_now then 1
      else current_limit.request_count + 1
    end,
    expires_at = case
      when current_limit.expires_at <= v_now then v_now + make_interval(secs => p_window_seconds)
      else current_limit.expires_at
    end
  returning request_count, expires_at into v_count, v_expires_at;

  if random() < 0.01 then
    delete from public.api_rate_limits
    where expires_at < v_now - interval '1 day';
  end if;

  allowed := v_count <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_expires_at - v_now)))::integer)
  end;
  return next;
end;
$$;

revoke all on function consume_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function consume_api_rate_limit(text, text, integer, integer) to service_role;

create index if not exists idx_checkins_org_unit_active_latest
  on checkins(organization_id, unit_id, checked_in_at desc, created_at desc)
  where voided_at is null;

alter table checkin_batches
  add column if not exists request_fingerprint text;

alter table checkin_batches
  add constraint checkin_batches_request_fingerprint_valid
  check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$') not valid;

alter table checkin_batches validate constraint checkin_batches_request_fingerprint_valid;

create or replace function get_latest_active_checkins(p_organization_id uuid)
returns table (unit_id uuid, checked_in_at timestamptz, visitor text)
language sql
stable
set search_path = ''
as $$
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
  order by checkin.unit_id, checkin.checked_in_at desc, checkin.created_at desc, checkin.id desc;
$$;

create or replace function get_first_active_checkins_before(
  p_organization_id uuid,
  p_before timestamptz
)
returns table (unit_id uuid, checked_in_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select distinct on (checkin.unit_id)
    checkin.unit_id,
    checkin.checked_in_at
  from public.checkins as checkin
  where checkin.organization_id = p_organization_id
    and checkin.voided_at is null
    and checkin.checked_in_at < p_before
  order by checkin.unit_id, checkin.checked_in_at asc, checkin.created_at asc, checkin.id asc;
$$;

revoke all on function get_latest_active_checkins(uuid) from public, anon, authenticated;
revoke all on function get_first_active_checkins_before(uuid, timestamptz) from public, anon, authenticated;
grant execute on function get_latest_active_checkins(uuid) to service_role;
grant execute on function get_first_active_checkins_before(uuid, timestamptz) to service_role;

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
  v_index integer;
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

create or replace function approve_workspace_request(
  p_request_id uuid,
  p_organization_id uuid,
  p_organization_name text,
  p_organization_slug text,
  p_setup_code_id uuid,
  p_setup_code_hash text,
  p_setup_label text,
  p_setup_expires_at timestamptz,
  p_operator_note text,
  p_approved_at timestamptz
)
returns table (organization jsonb, setup_code jsonb, workspace_request jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.workspace_requests%rowtype;
  v_organization public.organizations%rowtype;
  v_setup_code public.organization_setup_codes%rowtype;
begin
  select * into v_request
  from public.workspace_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'workspace_request_not_found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'workspace_request_not_pending' using errcode = 'P0001';
  end if;

  insert into public.organizations (id, name, slug, active)
  values (p_organization_id, p_organization_name, p_organization_slug, true)
  returning * into v_organization;

  insert into public.organization_setup_codes (
    id,
    organization_id,
    code_hash,
    label,
    purpose,
    active,
    expires_at
  ) values (
    p_setup_code_id,
    p_organization_id,
    p_setup_code_hash,
    p_setup_label,
    'pilot_setup',
    true,
    p_setup_expires_at
  )
  returning * into v_setup_code;

  update public.workspace_requests set
    status = 'approved',
    organization_id = p_organization_id,
    setup_code_id = p_setup_code_id,
    approved_at = p_approved_at,
    rejected_at = null,
    operator_note = p_operator_note
  where id = p_request_id
  returning * into v_request;

  return query select
    to_jsonb(v_organization),
    to_jsonb(v_setup_code) - 'code_hash',
    to_jsonb(v_request);
end;
$$;

revoke all on function approve_workspace_request(uuid, uuid, text, text, uuid, text, text, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function approve_workspace_request(uuid, uuid, text, text, uuid, text, text, timestamptz, text, timestamptz) to service_role;

create or replace function reject_workspace_request(
  p_request_id uuid,
  p_operator_note text,
  p_rejected_at timestamptz
)
returns table (workspace_request jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.workspace_requests%rowtype;
begin
  select * into v_request
  from public.workspace_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'workspace_request_not_found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'workspace_request_not_pending' using errcode = 'P0001';
  end if;

  update public.workspace_requests set
    status = 'rejected',
    rejected_at = p_rejected_at,
    operator_note = p_operator_note
  where id = p_request_id
  returning * into v_request;

  return query select to_jsonb(v_request);
end;
$$;

revoke all on function reject_workspace_request(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function reject_workspace_request(uuid, text, timestamptz) to service_role;

create or replace function activate_deckplating_workspace(
  p_setup_code_id uuid,
  p_organization_id uuid,
  p_used_by_label text,
  p_organization_name text,
  p_installation_name text,
  p_installation_latitude double precision,
  p_installation_longitude double precision,
  p_admin_passphrase_hash text,
  p_activated_at timestamptz
)
returns table (organization_updated_at timestamptz, admin_credential_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_updated_at timestamptz;
  v_admin_credential_updated_at timestamptz;
begin
  perform 1
  from public.organization_setup_codes as setup_code
  join public.organizations as organization
    on organization.id = setup_code.organization_id
  where setup_code.id = p_setup_code_id
    and setup_code.organization_id = p_organization_id
    and setup_code.active is true
    and setup_code.used_at is null
    and (setup_code.expires_at is null or setup_code.expires_at > p_activated_at)
    and organization.active is true
  for update of setup_code, organization;
  if not found then return; end if;

  update public.organization_setup_codes
  set used_at = p_activated_at,
      used_by_label = p_used_by_label,
      active = false
  where id = p_setup_code_id
    and organization_id = p_organization_id;

  if p_organization_name is not null then
    update public.organizations
    set name = p_organization_name
    where id = p_organization_id;
  end if;

  if p_installation_name is not null
    and p_installation_latitude is not null
    and p_installation_longitude is not null then
    insert into public.app_settings (organization_id, key, value)
    values
      (p_organization_id, 'installation_name', p_installation_name),
      (p_organization_id, 'map_default_latitude', p_installation_latitude::text),
      (p_organization_id, 'map_default_longitude', p_installation_longitude::text)
    on conflict (organization_id, key) do update
    set value = excluded.value;
  end if;

  insert into public.organization_admin_credentials (organization_id, passphrase_hash, active)
  values (p_organization_id, p_admin_passphrase_hash, true)
  on conflict (organization_id) do update
  set passphrase_hash = excluded.passphrase_hash,
      active = true
  returning updated_at into v_admin_credential_updated_at;

  select updated_at into v_organization_updated_at
  from public.organizations
  where id = p_organization_id;

  return query select v_organization_updated_at, v_admin_credential_updated_at;
end;
$$;

revoke all on function activate_deckplating_workspace(uuid, uuid, text, text, text, double precision, double precision, text, timestamptz) from public, anon, authenticated;
grant execute on function activate_deckplating_workspace(uuid, uuid, text, text, text, double precision, double precision, text, timestamptz) to service_role;

create or replace function delete_deckplating_organization(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then return false; end if;

  delete from public.checkins where organization_id = p_organization_id;
  delete from public.checkin_batches where organization_id = p_organization_id;
  delete from public.devices where organization_id = p_organization_id;
  delete from public.units where organization_id = p_organization_id;
  delete from public.locations where organization_id = p_organization_id;
  delete from public.team_members where organization_id = p_organization_id;
  delete from public.areas where organization_id = p_organization_id;
  delete from public.app_settings where organization_id = p_organization_id;
  delete from public.workspace_requests where organization_id = p_organization_id;
  delete from public.organization_setup_codes where organization_id = p_organization_id;
  delete from public.organization_admin_credentials where organization_id = p_organization_id;
  delete from public.organizations where id = p_organization_id;
  return true;
end;
$$;

revoke all on function delete_deckplating_organization(uuid) from public, anon, authenticated;
grant execute on function delete_deckplating_organization(uuid) to service_role;

create or replace function register_member_device(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_expected_pin_hash text,
  p_next_pin_hash text,
  p_device_token_hash text,
  p_device_label text,
  p_last_seen_at timestamptz
)
returns table (device_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.team_members%rowtype;
  v_device_id uuid;
begin
  select * into v_member
  from public.team_members
  where id = p_team_member_id
    and organization_id = p_organization_id
    and active is true
  for update;

  if not found or v_member.pin_hash is distinct from p_expected_pin_hash then
    return;
  end if;

  if p_next_pin_hash is not null then
    update public.team_members
    set pin_hash = p_next_pin_hash
    where id = p_team_member_id
      and organization_id = p_organization_id;
  end if;

  insert into public.devices (
    organization_id,
    team_member_id,
    device_token_hash,
    device_label,
    active,
    last_seen_at
  ) values (
    p_organization_id,
    p_team_member_id,
    p_device_token_hash,
    p_device_label,
    true,
    p_last_seen_at
  )
  on conflict (organization_id, device_token_hash) do update
  set team_member_id = excluded.team_member_id,
      device_label = excluded.device_label,
      active = true,
      last_seen_at = excluded.last_seen_at
  returning id into v_device_id;

  return query select v_device_id;
end;
$$;

revoke all on function register_member_device(uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function register_member_device(uuid, uuid, text, text, text, text, timestamptz) to service_role;

create or replace function change_member_pin(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_current_device_id uuid,
  p_expected_pin_hash text,
  p_pin_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.team_members%rowtype;
begin
  select * into v_member
  from public.team_members
  where id = p_team_member_id
    and organization_id = p_organization_id
    and active is true
  for update;

  if not found or v_member.pin_hash is distinct from p_expected_pin_hash then
    return false;
  end if;

  if not exists (
    select 1
    from public.devices
    where id = p_current_device_id
      and organization_id = p_organization_id
      and team_member_id = p_team_member_id
      and active is true
  ) then
    return false;
  end if;

  update public.team_members
  set pin_hash = p_pin_hash
  where id = p_team_member_id
    and organization_id = p_organization_id;

  update public.devices
  set active = false
  where organization_id = p_organization_id
    and team_member_id = p_team_member_id
    and id <> p_current_device_id;
  return true;
end;
$$;

revoke all on function change_member_pin(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function change_member_pin(uuid, uuid, uuid, text, text) to service_role;

create or replace function reset_member_pin(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_pin_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_members
  set pin_hash = p_pin_hash
  where id = p_team_member_id
    and organization_id = p_organization_id
    and active is true;
  if not found then return false; end if;

  update public.devices
  set active = false
  where organization_id = p_organization_id
    and team_member_id = p_team_member_id;
  return true;
end;
$$;

revoke all on function reset_member_pin(uuid, uuid, text) from public, anon, authenticated;
grant execute on function reset_member_pin(uuid, uuid, text) to service_role;

create or replace function set_team_member_active(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_members
  set active = p_active
  where id = p_team_member_id
    and organization_id = p_organization_id;
  if not found then return false; end if;

  update public.devices
  set active = false
  where organization_id = p_organization_id
    and team_member_id = p_team_member_id;
  return true;
end;
$$;

revoke all on function set_team_member_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function set_team_member_active(uuid, uuid, boolean) to service_role;

create unique index if not exists idx_areas_id_org_unique on areas(id, organization_id);
create unique index if not exists idx_team_members_id_org_unique on team_members(id, organization_id);
create unique index if not exists idx_devices_id_org_unique on devices(id, organization_id);
create unique index if not exists idx_locations_id_org_unique on locations(id, organization_id);
create unique index if not exists idx_units_id_org_unique on units(id, organization_id);
create unique index if not exists idx_checkin_batches_id_org_unique on checkin_batches(id, organization_id);
create unique index if not exists idx_setup_codes_id_org_unique on organization_setup_codes(id, organization_id);

alter table devices
  add constraint devices_team_member_organization_fkey
  foreign key (team_member_id, organization_id) references team_members(id, organization_id) not valid;
alter table locations
  add constraint locations_area_organization_fkey
  foreign key (area_id, organization_id) references areas(id, organization_id) not valid;
alter table units
  add constraint units_location_organization_fkey
  foreign key (location_id, organization_id) references locations(id, organization_id) not valid;
alter table checkin_batches
  add constraint checkin_batches_location_organization_fkey
  foreign key (location_id, organization_id) references locations(id, organization_id) not valid,
  add constraint checkin_batches_team_member_organization_fkey
  foreign key (team_member_id, organization_id) references team_members(id, organization_id) not valid,
  add constraint checkin_batches_device_organization_fkey
  foreign key (device_id, organization_id) references devices(id, organization_id) not valid,
  add constraint checkin_batches_updated_by_organization_fkey
  foreign key (updated_by_team_member_id, organization_id) references team_members(id, organization_id) not valid;
alter table checkins
  add constraint checkins_unit_organization_fkey
  foreign key (unit_id, organization_id) references units(id, organization_id) not valid,
  add constraint checkins_location_organization_fkey
  foreign key (location_id, organization_id) references locations(id, organization_id) not valid,
  add constraint checkins_team_member_organization_fkey
  foreign key (team_member_id, organization_id) references team_members(id, organization_id) not valid,
  add constraint checkins_device_organization_fkey
  foreign key (device_id, organization_id) references devices(id, organization_id) not valid,
  add constraint checkins_batch_organization_fkey
  foreign key (batch_id, organization_id) references checkin_batches(id, organization_id) not valid,
  add constraint checkins_voided_by_organization_fkey
  foreign key (voided_by_team_member_id, organization_id) references team_members(id, organization_id) not valid,
  add constraint checkins_updated_by_organization_fkey
  foreign key (updated_by_team_member_id, organization_id) references team_members(id, organization_id) not valid;
alter table workspace_requests
  add constraint workspace_requests_setup_code_organization_fkey
  foreign key (setup_code_id, organization_id) references organization_setup_codes(id, organization_id) not valid;

alter table devices validate constraint devices_team_member_organization_fkey;
alter table locations validate constraint locations_area_organization_fkey;
alter table units validate constraint units_location_organization_fkey;
alter table checkin_batches validate constraint checkin_batches_location_organization_fkey;
alter table checkin_batches validate constraint checkin_batches_team_member_organization_fkey;
alter table checkin_batches validate constraint checkin_batches_device_organization_fkey;
alter table checkin_batches validate constraint checkin_batches_updated_by_organization_fkey;
alter table checkins validate constraint checkins_unit_organization_fkey;
alter table checkins validate constraint checkins_location_organization_fkey;
alter table checkins validate constraint checkins_team_member_organization_fkey;
alter table checkins validate constraint checkins_device_organization_fkey;
alter table checkins validate constraint checkins_batch_organization_fkey;
alter table checkins validate constraint checkins_voided_by_organization_fkey;
alter table checkins validate constraint checkins_updated_by_organization_fkey;
alter table workspace_requests validate constraint workspace_requests_setup_code_organization_fkey;

-- Retaining both relationship sets makes PostgREST embeds ambiguous. Once the
-- tenant-consistent constraints validate, they fully supersede the original
-- single-column foreign keys.
alter table devices drop constraint devices_team_member_id_fkey;
alter table locations drop constraint locations_area_id_fkey;
alter table units drop constraint units_location_id_fkey;
alter table checkin_batches
  drop constraint checkin_batches_location_id_fkey,
  drop constraint checkin_batches_team_member_id_fkey,
  drop constraint checkin_batches_device_id_fkey,
  drop constraint checkin_batches_updated_by_team_member_id_fkey;
alter table checkins
  drop constraint checkins_unit_id_fkey,
  drop constraint checkins_location_id_fkey,
  drop constraint checkins_team_member_id_fkey,
  drop constraint checkins_device_id_fkey,
  drop constraint checkins_batch_id_fkey,
  drop constraint checkins_voided_by_team_member_id_fkey,
  drop constraint checkins_updated_by_team_member_id_fkey;
alter table workspace_requests drop constraint workspace_requests_setup_code_id_fkey;

-- Keep the established PostgREST relationship names so the currently deployed
-- API remains compatible while the application release follows this migration.
alter table devices rename constraint devices_team_member_organization_fkey to devices_team_member_id_fkey;
alter table locations rename constraint locations_area_organization_fkey to locations_area_id_fkey;
alter table units rename constraint units_location_organization_fkey to units_location_id_fkey;
alter table checkin_batches
  rename constraint checkin_batches_location_organization_fkey to checkin_batches_location_id_fkey;
alter table checkin_batches
  rename constraint checkin_batches_team_member_organization_fkey to checkin_batches_team_member_id_fkey;
alter table checkin_batches
  rename constraint checkin_batches_device_organization_fkey to checkin_batches_device_id_fkey;
alter table checkin_batches
  rename constraint checkin_batches_updated_by_organization_fkey to checkin_batches_updated_by_team_member_id_fkey;
alter table checkins rename constraint checkins_unit_organization_fkey to checkins_unit_id_fkey;
alter table checkins rename constraint checkins_location_organization_fkey to checkins_location_id_fkey;
alter table checkins rename constraint checkins_team_member_organization_fkey to checkins_team_member_id_fkey;
alter table checkins rename constraint checkins_device_organization_fkey to checkins_device_id_fkey;
alter table checkins rename constraint checkins_batch_organization_fkey to checkins_batch_id_fkey;
alter table checkins rename constraint checkins_voided_by_organization_fkey to checkins_voided_by_team_member_id_fkey;
alter table checkins rename constraint checkins_updated_by_organization_fkey to checkins_updated_by_team_member_id_fkey;
alter table workspace_requests
  rename constraint workspace_requests_setup_code_organization_fkey to workspace_requests_setup_code_id_fkey;

alter table locations
  add constraint locations_latitude_valid check (latitude between -90 and 90) not valid,
  add constraint locations_longitude_valid check (longitude between -180 and 180) not valid,
  add constraint locations_radius_valid check (radius_meters between 25 and 750) not valid;
alter table units
  add constraint units_visit_interval_valid check (visit_interval_days between 1 and 3650) not valid;

alter table locations validate constraint locations_latitude_valid;
alter table locations validate constraint locations_longitude_valid;
alter table locations validate constraint locations_radius_valid;
alter table units validate constraint units_visit_interval_valid;
