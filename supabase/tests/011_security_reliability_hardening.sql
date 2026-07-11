do $test$
declare
  v_organization_id uuid := gen_random_uuid();
  v_area_id uuid := gen_random_uuid();
  v_location_id uuid := gen_random_uuid();
  v_unit_id uuid := gen_random_uuid();
  v_member_id uuid := gen_random_uuid();
  v_device_id uuid := gen_random_uuid();
  v_client_batch_id uuid := gen_random_uuid();
  v_second_batch_id uuid := gen_random_uuid();
  v_setup_code_id uuid := gen_random_uuid();
  v_request_id uuid := gen_random_uuid();
  v_occurred_at timestamptz := now() - interval '1 hour';
  v_batch jsonb;
  v_checkins jsonb;
  v_organization_updated_at timestamptz;
  v_admin_credential_updated_at timestamptz;
  v_registered_device_id uuid;
  v_count integer;
  v_conflict_seen boolean := false;
begin
  insert into public.organizations (id, name, slug, active)
  values (v_organization_id, 'Migration 011 Test', 'migration-011-' || substr(v_organization_id::text, 1, 8), true);

  insert into public.organization_setup_codes (
    id,
    organization_id,
    code_hash,
    label,
    purpose,
    active,
    expires_at
  ) values (
    v_setup_code_id,
    v_organization_id,
    'migration-' || v_setup_code_id::text,
    'Migration test',
    'pilot_setup',
    true,
    now() + interval '1 day'
  );

  select organization_updated_at, admin_credential_updated_at
  into v_organization_updated_at, v_admin_credential_updated_at
  from public.activate_deckplating_workspace(
    v_setup_code_id,
    v_organization_id,
    'Migration test',
    'Migration 011 Test',
    'Migration Test Installation',
    24.57,
    -81.78,
    'test-admin-hash',
    now()
  );
  if v_organization_updated_at is null or v_admin_credential_updated_at is null then
    raise exception 'activation did not return exact credential versions';
  end if;

  insert into public.areas (id, organization_id, name, sort_order)
  values (v_area_id, v_organization_id, 'Migration Test Area', 1);
  insert into public.locations (
    id,
    organization_id,
    area_id,
    name,
    latitude,
    longitude,
    radius_meters,
    active
  ) values (
    v_location_id,
    v_organization_id,
    v_area_id,
    'Migration Test Location',
    24.57,
    -81.78,
    120,
    true
  );
  insert into public.units (
    id,
    organization_id,
    location_id,
    name,
    unit_type,
    visit_interval_days,
    active
  ) values (
    v_unit_id,
    v_organization_id,
    v_location_id,
    'Migration Test Unit',
    'department',
    30,
    true
  );
  insert into public.team_members (id, organization_id, name, active, pin_hash)
  values (v_member_id, v_organization_id, 'Migration Test Member', true, 'expected-pin-hash');
  insert into public.devices (
    id,
    organization_id,
    team_member_id,
    device_token_hash,
    active,
    last_seen_at
  ) values (
    v_device_id,
    v_organization_id,
    v_member_id,
    repeat('a', 64),
    true,
    now()
  );

  select batch, checkin_rows
  into v_batch, v_checkins
  from public.create_checkin_batch(
    v_organization_id,
    v_member_id,
    v_device_id,
    v_client_batch_id,
    repeat('b', 64),
    v_occurred_at,
    v_location_id,
    array[v_unit_id],
    array[true],
    array[10],
    null,
    null
  );
  if v_batch->>'id' is null or jsonb_array_length(v_checkins) <> 1 or (v_checkins->0->>'score_awarded')::integer <> 3 then
    raise exception 'first transactional check-in did not return the expected batch and score';
  end if;

  perform *
  from public.create_checkin_batch(
    v_organization_id,
    v_member_id,
    v_device_id,
    v_client_batch_id,
    repeat('b', 64),
    v_occurred_at,
    v_location_id,
    array[v_unit_id],
    array[true],
    array[10],
    null,
    null
  );
  select count(*) into v_count
  from public.checkins
  where organization_id = v_organization_id
    and batch_id = (v_batch->>'id')::uuid;
  if v_count <> 1 then
    raise exception 'idempotent check-in retry inserted duplicate rows';
  end if;

  select batch, checkin_rows
  into v_batch, v_checkins
  from public.create_checkin_batch(
    v_organization_id,
    v_member_id,
    v_device_id,
    v_second_batch_id,
    repeat('c', 64),
    v_occurred_at + interval '1 minute',
    v_location_id,
    array[v_unit_id],
    array[true],
    array[10],
    null,
    null
  );
  if (v_checkins->0->>'score_awarded')::integer <> 0 then
    raise exception 'cooldown serialization awarded duplicate points';
  end if;

  begin
    perform *
    from public.create_checkin_batch(
      v_organization_id,
      v_member_id,
      v_device_id,
      v_client_batch_id,
      repeat('d', 64),
      v_occurred_at,
      v_location_id,
      array[v_unit_id],
      array[true],
      array[10],
      null,
      null
    );
  exception when sqlstate 'P0001' then
    if sqlerrm = 'checkin_batch_conflict' then v_conflict_seen := true; end if;
  end;
  if not v_conflict_seen then
    raise exception 'changed idempotency payload was not rejected';
  end if;

  select device_id into v_registered_device_id
  from public.register_member_device(
    v_organization_id,
    v_member_id,
    'expected-pin-hash',
    'upgraded-pin-hash',
    repeat('e', 64),
    'Migration registration',
    now()
  );
  if v_registered_device_id is null then
    raise exception 'locked device registration did not succeed';
  end if;
  select count(*) into v_count
  from public.register_member_device(
    v_organization_id,
    v_member_id,
    'expected-pin-hash',
    'stale-overwrite',
    repeat('f', 64),
    'Stale registration',
    now()
  );
  if v_count <> 0 then
    raise exception 'stale PIN registration was not rejected';
  end if;

  insert into public.workspace_requests (
    id,
    installation_or_command,
    preferred_workspace_slug,
    lead_name,
    lead_role,
    official_contact_email,
    rmt_size,
    expected_pilot_start_date,
    short_use_case,
    safe_use_boundaries_confirmed,
    no_sensitive_data_acknowledged
  ) values (
    v_request_id,
    'Migration Request',
    'migration-request-' || substr(v_request_id::text, 1, 8),
    'Migration Lead',
    'Tester',
    'migration@example.mil',
    1,
    current_date,
    'Validate serialized request rejection.',
    true,
    true
  );
  perform * from public.reject_workspace_request(v_request_id, 'Migration rejection test', now());
  v_conflict_seen := false;
  begin
    perform *
    from public.approve_workspace_request(
      v_request_id,
      gen_random_uuid(),
      'Should Not Approve',
      'should-not-approve-' || substr(v_request_id::text, 1, 8),
      gen_random_uuid(),
      repeat('1', 64),
      'Should not issue',
      now() + interval '1 day',
      'Should fail',
      now()
    );
  exception when sqlstate 'P0001' then
    if sqlerrm = 'workspace_request_not_pending' then v_conflict_seen := true; end if;
  end;
  if not v_conflict_seen then
    raise exception 'approved a request after serialized rejection';
  end if;

  select count(*) into v_count
  from pg_catalog.pg_constraint
  where conrelid = 'public.checkins'::regclass
    and conname = 'checkins_unit_id_fkey'
    and cardinality(conkey) = 2;
  if v_count <> 1 then
    raise exception 'legacy PostgREST relationship name does not reference the composite tenant key';
  end if;
end;
$test$;
