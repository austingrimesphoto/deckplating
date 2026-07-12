-- Complete the remaining dependent administrator mutations inside
-- organization-scoped transactions. Stable application errors use P0001 for
-- invalid state and P0002 for missing tenant-scoped records.

create or replace function admin_correct_checkin(
  p_organization_id uuid,
  p_checkin_id uuid,
  p_admin_team_member_id uuid,
  p_has_unit boolean,
  p_unit_id uuid,
  p_has_checked_in_at boolean,
  p_checked_in_at timestamptz,
  p_has_team_member boolean,
  p_team_member_id uuid,
  p_has_voided boolean,
  p_voided boolean,
  p_void_reason text,
  p_has_indicators boolean,
  p_confidential_care_provided boolean,
  p_referral_provided boolean,
  p_changed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkin public.checkins%rowtype;
  v_unit public.units%rowtype;
  v_batch public.checkin_batches%rowtype;
begin
  select * into v_checkin
  from public.checkins
  where id = p_checkin_id
    and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'admin_checkin_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.team_members
  where id = p_admin_team_member_id
    and organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'admin_actor_not_found' using errcode = 'P0002';
  end if;

  if p_has_team_member then
    perform 1
    from public.team_members
    where id = p_team_member_id
      and organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'admin_replacement_member_not_found' using errcode = 'P0002';
    end if;
  end if;

  if p_has_unit then
    select * into v_unit
    from public.units
    where id = p_unit_id
      and organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'admin_replacement_unit_not_found' using errcode = 'P0002';
    end if;
  end if;

  if p_has_voided and p_voided and (
    p_void_reason is null or p_void_reason not in
      ('accidental', 'wrong_unit', 'duplicate', 'incorrect_datetime', 'incorrect_member')
  ) then
    raise exception 'admin_void_reason_invalid' using errcode = 'P0001';
  end if;

  if p_changed_at is null then
    raise exception 'admin_changed_at_required' using errcode = 'P0001';
  end if;

  if p_has_indicators then
    if v_checkin.batch_id is null then
      raise exception 'admin_checkin_batch_missing' using errcode = 'P0001';
    end if;
    select * into v_batch
    from public.checkin_batches
    where id = v_checkin.batch_id
      and organization_id = p_organization_id
    for update;
    if not found then
      raise exception 'admin_checkin_batch_not_found' using errcode = 'P0002';
    end if;
  end if;

  update public.checkins
  set
    unit_id = case when p_has_unit then p_unit_id else unit_id end,
    location_id = case when p_has_unit then v_unit.location_id else location_id end,
    checked_in_at = case when p_has_checked_in_at then p_checked_in_at else checked_in_at end,
    team_member_id = case when p_has_team_member then p_team_member_id else team_member_id end,
    geofence_verified = case when p_has_unit then false else geofence_verified end,
    score_awarded = case
      when p_has_unit or p_has_checked_in_at or p_has_team_member or (p_has_voided and p_voided) then 0
      else score_awarded
    end,
    voided_at = case
      when p_has_voided and p_voided then coalesce(voided_at, p_changed_at)
      when p_has_voided and not p_voided then null
      else voided_at
    end,
    voided_by_team_member_id = case
      when p_has_voided and p_voided then p_admin_team_member_id
      when p_has_voided and not p_voided then null
      else voided_by_team_member_id
    end,
    void_reason = case
      when p_has_voided and p_voided then p_void_reason
      when p_has_voided and not p_voided then null
      else void_reason
    end,
    updated_by_team_member_id = p_admin_team_member_id
  where id = p_checkin_id
    and organization_id = p_organization_id
  returning * into v_checkin;

  if p_has_indicators then
    update public.checkin_batches
    set
      confidential_care_provided = p_confidential_care_provided,
      referral_provided = p_referral_provided,
      outcomes_recorded_at = case
        when p_confidential_care_provided is true or p_referral_provided is true then p_changed_at
        else null
      end,
      updated_by_team_member_id = p_admin_team_member_id
    where id = v_checkin.batch_id
      and organization_id = p_organization_id
    returning * into v_batch;
  end if;

  return jsonb_build_object(
    'checkin', jsonb_build_object('id', v_checkin.id, 'updated_at', v_checkin.updated_at),
    'batch_updated', p_has_indicators
  );
end;
$$;

create or replace function admin_mutate_location(
  p_organization_id uuid,
  p_create boolean,
  p_location_id uuid,
  p_has_name boolean,
  p_name text,
  p_has_area boolean,
  p_area_id uuid,
  p_has_latitude boolean,
  p_latitude double precision,
  p_has_longitude boolean,
  p_longitude double precision,
  p_has_radius boolean,
  p_radius_meters integer,
  p_has_active boolean,
  p_active boolean,
  p_has_unit_ids boolean,
  p_unit_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.locations%rowtype;
  v_requested_count integer;
  v_found_count integer;
begin
  if p_has_area then
    perform 1
    from public.areas
    where id = p_area_id
      and organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'admin_location_area_not_found' using errcode = 'P0002';
    end if;
  end if;

  if p_has_unit_ids then
    select count(*), count(distinct requested.id)
    into v_requested_count, v_found_count
    from unnest(coalesce(p_unit_ids, array[]::uuid[])) requested(id);
    if v_requested_count <> v_found_count then
      raise exception 'admin_location_unit_ids_duplicate' using errcode = 'P0001';
    end if;

    perform unit.id
    from public.units unit
    where unit.organization_id = p_organization_id
      and unit.id = any(coalesce(p_unit_ids, array[]::uuid[]))
    order by unit.id
    for update;
    get diagnostics v_found_count = row_count;
    if v_found_count <> v_requested_count then
      raise exception 'admin_location_unit_not_found' using errcode = 'P0002';
    end if;
  end if;

  if p_create then
    if not p_has_name or not p_has_area or not p_has_latitude or not p_has_longitude or not p_has_radius then
      raise exception 'admin_location_required_fields_missing' using errcode = 'P0001';
    end if;
    insert into public.locations (
      organization_id, area_id, name, latitude, longitude, radius_meters, active
    ) values (
      p_organization_id, p_area_id, p_name, p_latitude, p_longitude, p_radius_meters,
      case when p_has_active then p_active else true end
    )
    returning * into v_location;
  else
    select * into v_location
    from public.locations
    where id = p_location_id
      and organization_id = p_organization_id
    for update;
    if not found then
      raise exception 'admin_location_not_found' using errcode = 'P0002';
    end if;

    update public.locations
    set
      name = case when p_has_name then p_name else name end,
      area_id = case when p_has_area then p_area_id else area_id end,
      latitude = case when p_has_latitude then p_latitude else latitude end,
      longitude = case when p_has_longitude then p_longitude else longitude end,
      radius_meters = case when p_has_radius then p_radius_meters else radius_meters end,
      active = case when p_has_active then p_active else active end
    where id = p_location_id
      and organization_id = p_organization_id
    returning * into v_location;
  end if;

  if p_has_unit_ids and v_requested_count > 0 then
    update public.units
    set location_id = v_location.id
    where organization_id = p_organization_id
      and id = any(p_unit_ids);
    if not found then
      raise exception 'admin_location_unit_assignment_failed' using errcode = 'P0001';
    end if;
  end if;

  return to_jsonb(v_location);
end;
$$;

create or replace function admin_update_team_member(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_has_name boolean,
  p_name text,
  p_has_role boolean,
  p_role text,
  p_has_active boolean,
  p_active boolean
)
returns jsonb
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
  for update;
  if not found then
    raise exception 'admin_team_member_not_found' using errcode = 'P0002';
  end if;

  update public.team_members
  set
    name = case when p_has_name then p_name else name end,
    role = case when p_has_role then p_role else role end,
    active = case when p_has_active then p_active else active end
  where id = p_team_member_id
    and organization_id = p_organization_id
  returning * into v_member;

  if p_has_active then
    update public.devices
    set active = false
    where organization_id = p_organization_id
      and team_member_id = p_team_member_id;
  end if;

  return jsonb_build_object(
    'id', v_member.id,
    'name', v_member.name,
    'role', v_member.role,
    'active', v_member.active
  );
end;
$$;

create or replace function revoke_setup_code_with_audit(p_setup_code_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.organization_setup_codes%rowtype;
begin
  select * into v_code
  from public.organization_setup_codes
  where id = p_setup_code_id
    and used_at is null
  for update;
  if not found then
    raise exception 'operator_setup_code_not_found' using errcode = 'P0002';
  end if;

  update public.organization_setup_codes
  set active = false
  where id = p_setup_code_id
  returning * into v_code;

  insert into public.operator_audit_events (organization_id, actor, action, detail)
  values (v_code.organization_id, 'central_operator', 'setup_code_revoked',
    jsonb_build_object('setupCodeId', v_code.id));
  return to_jsonb(v_code) - 'code_hash';
end;
$$;

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

  insert into public.operator_audit_events (organization_id, actor, action, detail)
  values (null, 'central_operator', 'workspace_request_rejected',
    jsonb_build_object('workspaceRequestId', p_request_id));
  return query select to_jsonb(v_request);
end;
$$;

create or replace function set_organization_status_with_audit(
  p_organization_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization public.organizations%rowtype;
begin
  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;
  if not found then
    raise exception 'operator_organization_not_found' using errcode = 'P0002';
  end if;

  update public.organizations
  set active = p_active
  where id = p_organization_id
  returning * into v_organization;

  insert into public.operator_audit_events (organization_id, actor, action, detail)
  values (
    p_organization_id,
    'central_operator',
    case when p_active then 'workspace_reactivated' else 'workspace_suspended' end,
    jsonb_build_object('slug', v_organization.slug)
  );
  return to_jsonb(v_organization);
end;
$$;

create or replace function recover_organization_admin_with_audit(
  p_organization_id uuid,
  p_passphrase_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization public.organizations%rowtype;
begin
  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;
  if not found then
    raise exception 'operator_organization_not_found' using errcode = 'P0002';
  end if;

  insert into public.organization_admin_credentials (organization_id, passphrase_hash, active)
  values (p_organization_id, p_passphrase_hash, true)
  on conflict (organization_id) do update
  set passphrase_hash = excluded.passphrase_hash,
      active = true;

  insert into public.operator_audit_events (organization_id, actor, action, detail)
  values (p_organization_id, 'central_operator', 'local_admin_recovery_passphrase_set',
    jsonb_build_object('slug', v_organization.slug));
  return to_jsonb(v_organization);
end;
$$;

create or replace function delete_deckplating_organization(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization public.organizations%rowtype;
begin
  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;
  if not found then return false; end if;

  insert into public.operator_audit_events (organization_id, actor, action, detail)
  values (p_organization_id, 'central_operator', 'workspace_deleted',
    jsonb_build_object('organizationId', p_organization_id, 'slug', v_organization.slug));

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

revoke all on function admin_correct_checkin(uuid, uuid, uuid, boolean, uuid, boolean, timestamptz, boolean, uuid, boolean, boolean, text, boolean, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function admin_mutate_location(uuid, boolean, uuid, boolean, text, boolean, uuid, boolean, double precision, boolean, double precision, boolean, integer, boolean, boolean, boolean, uuid[]) from public, anon, authenticated;
revoke all on function admin_update_team_member(uuid, uuid, boolean, text, boolean, text, boolean, boolean) from public, anon, authenticated;
revoke all on function revoke_setup_code_with_audit(uuid) from public, anon, authenticated;
revoke all on function reject_workspace_request(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function set_organization_status_with_audit(uuid, boolean) from public, anon, authenticated;
revoke all on function recover_organization_admin_with_audit(uuid, text) from public, anon, authenticated;
revoke all on function delete_deckplating_organization(uuid) from public, anon, authenticated;
grant execute on function admin_correct_checkin(uuid, uuid, uuid, boolean, uuid, boolean, timestamptz, boolean, uuid, boolean, boolean, text, boolean, boolean, boolean, timestamptz) to service_role;
grant execute on function admin_mutate_location(uuid, boolean, uuid, boolean, text, boolean, uuid, boolean, double precision, boolean, double precision, boolean, integer, boolean, boolean, boolean, uuid[]) to service_role;
grant execute on function admin_update_team_member(uuid, uuid, boolean, text, boolean, text, boolean, boolean) to service_role;
grant execute on function revoke_setup_code_with_audit(uuid) to service_role;
grant execute on function reject_workspace_request(uuid, text, timestamptz) to service_role;
grant execute on function set_organization_status_with_audit(uuid, boolean) to service_role;
grant execute on function recover_organization_admin_with_audit(uuid, text) to service_role;
grant execute on function delete_deckplating_organization(uuid) to service_role;
