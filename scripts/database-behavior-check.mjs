import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;

class CheckFailure extends Error {}

const expectedMigrationVersions = Array.from({ length: 13 }, (_, index) => String(index + 1).padStart(3, '0'));
const expectedCompositeConstraints = [
  'devices_team_member_id_fkey',
  'locations_area_id_fkey',
  'units_location_id_fkey',
  'checkin_batches_location_id_fkey',
  'checkin_batches_team_member_id_fkey',
  'checkin_batches_device_id_fkey',
  'checkin_batches_updated_by_team_member_id_fkey',
  'checkins_unit_id_fkey',
  'checkins_location_id_fkey',
  'checkins_team_member_id_fkey',
  'checkins_device_id_fkey',
  'checkins_batch_id_fkey',
  'checkins_voided_by_team_member_id_fkey',
  'checkins_updated_by_team_member_id_fkey',
  'workspace_requests_setup_code_id_fkey',
];

const databaseUrl = requiredEnvironment('DECKPLATING_TEST_DATABASE_URL');
const supabaseUrl = requiredEnvironment('DECKPLATING_TEST_SUPABASE_URL');
const anonKey = requiredEnvironment('DECKPLATING_TEST_ANON_KEY');
const serviceRoleKey = requiredEnvironment('DECKPLATING_TEST_SERVICE_ROLE_KEY');
const controlledFailure = process.env.DECKPLATING_TEST_CONTROLLED_FAILURE ?? '';

assertLoopbackUrl(databaseUrl, ['postgres:', 'postgresql:'], 'database');
assertLoopbackUrl(supabaseUrl, ['http:'], 'Supabase API');
expectCondition(!controlledFailure || controlledFailure === 'idempotency', 'unsupported controlled-failure mode');

const serviceApi = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anonApi = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const fixture = createFixture();
const cleanupOrganizationIds = new Set([fixture.organizationA, fixture.organizationB]);
const cleanupRequestIds = new Set();

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new CheckFailure(`required ephemeral environment variable is missing: ${name}`);
  return value;
}

function assertLoopbackUrl(value, protocols, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new CheckFailure(`${label} URL is invalid`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!protocols.includes(parsed.protocol) || !['127.0.0.1', '::1', 'localhost'].includes(hostname)) {
    throw new CheckFailure(`${label} must target the disposable loopback stack`);
  }
}

function expectCondition(condition, label) {
  if (!condition) throw new CheckFailure(label);
}

function randomSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function createFixture() {
  return {
    organizationA: crypto.randomUUID(),
    organizationB: crypto.randomUUID(),
    areaA: crypto.randomUUID(),
    areaB: crypto.randomUUID(),
    locationA: crypto.randomUUID(),
    locationB: crypto.randomUUID(),
    unitA: crypto.randomUUID(),
    unitB: crypto.randomUUID(),
    retryUnit: crypto.randomUUID(),
    memberA: crypto.randomUUID(),
    memberB: crypto.randomUUID(),
    deviceA: crypto.randomUUID(),
    deviceB: crypto.randomUUID(),
    batchB: crypto.randomUUID(),
    adminCredentialA: crypto.randomUUID(),
    adminHashA: randomSecret(),
  };
}

function databaseClient(label) {
  return new Client({
    connectionString: databaseUrl,
    application_name: `deckplating-ci-${label}`,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
    statement_timeout: 20_000,
  });
}

async function withClient(label, callback) {
  const client = databaseClient(label);
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function runCheck(label, callback) {
  const startedAt = performance.now();
  try {
    await callback();
  } catch (error) {
    if (error instanceof CheckFailure) throw error;
    const code = typeof error?.code === 'string' ? ` [${error.code}]` : '';
    throw new CheckFailure(`${label} failed with a sanitized database error${code}`);
  }
  console.log(`PASS ${label} (${Math.round(performance.now() - startedAt)}ms)`);
}

async function expectSqlState(label, expectedCode, operation) {
  try {
    await operation();
  } catch (error) {
    if (error?.code === expectedCode) return;
    const actualCode = typeof error?.code === 'string' ? error.code : 'unknown';
    throw new CheckFailure(`${label} returned SQLSTATE ${actualCode}, expected ${expectedCode}`);
  }
  throw new CheckFailure(`${label} unexpectedly succeeded`);
}

async function runOverlapping(label, operations) {
  const clients = operations.map((_, index) => databaseClient(`${label}-${index + 1}`));
  await Promise.all(clients.map((client) => client.connect()));
  const started = [];
  const finished = [];
  try {
    const results = await Promise.allSettled(
      operations.map(async (operation, index) => {
        started[index] = performance.now();
        try {
          return await operation(clients[index]);
        } finally {
          finished[index] = performance.now();
        }
      }),
    );
    expectCondition(
      Math.max(...started) < Math.min(...finished),
      `${label} did not execute with overlapping database sessions`,
    );
    return results;
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => {})));
  }
}

async function seedFixture(client) {
  await client.query(
    `insert into public.organizations (id, name, slug, active)
     values ($1, 'CI Workspace A', $2, true), ($3, 'CI Workspace B', $4, true)`,
    [
      fixture.organizationA,
      `ci-a-${fixture.organizationA.slice(0, 8)}`,
      fixture.organizationB,
      `ci-b-${fixture.organizationB.slice(0, 8)}`,
    ],
  );
  await client.query(
    `insert into public.areas (id, organization_id, name, sort_order)
     values ($1, $2, 'CI Area A', 1), ($3, $4, 'CI Area B', 1)`,
    [fixture.areaA, fixture.organizationA, fixture.areaB, fixture.organizationB],
  );
  await client.query(
    `insert into public.locations
       (id, organization_id, area_id, name, latitude, longitude, radius_meters, active)
     values
       ($1, $2, $3, 'CI Location A', 24.57, -81.78, 120, true),
       ($4, $5, $6, 'CI Location B', 24.58, -81.79, 120, true)`,
    [
      fixture.locationA,
      fixture.organizationA,
      fixture.areaA,
      fixture.locationB,
      fixture.organizationB,
      fixture.areaB,
    ],
  );
  await client.query(
    `insert into public.units
       (id, organization_id, location_id, name, unit_type, visit_interval_days, active)
     values
       ($1, $2, $3, 'CI Unit A', 'department', 30, true),
       ($4, $5, $6, 'CI Unit B', 'department', 30, true),
       ($7, $2, $3, 'CI Retry Unit', 'division', 30, true)`,
    [
      fixture.unitA,
      fixture.organizationA,
      fixture.locationA,
      fixture.unitB,
      fixture.organizationB,
      fixture.locationB,
      fixture.retryUnit,
    ],
  );
  await client.query(
    `insert into public.team_members (id, organization_id, name, role, active, pin_hash)
     values ($1, $2, 'CI Member A', 'Tester', true, $3),
            ($4, $5, 'CI Member B', 'Tester', true, $6)`,
    [fixture.memberA, fixture.organizationA, randomSecret(), fixture.memberB, fixture.organizationB, randomSecret()],
  );
  await client.query(
    `insert into public.devices
       (id, organization_id, team_member_id, device_token_hash, device_label, active, last_seen_at)
     values ($1, $2, $3, $4, 'CI Device A', true, now()),
            ($5, $6, $7, $8, 'CI Device B', true, now())`,
    [
      fixture.deviceA,
      fixture.organizationA,
      fixture.memberA,
      randomSecret(),
      fixture.deviceB,
      fixture.organizationB,
      fixture.memberB,
      randomSecret(),
    ],
  );
  await client.query(
    `insert into public.checkin_batches
       (id, organization_id, client_batch_id, request_fingerprint, location_id, team_member_id, device_id, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      fixture.batchB,
      fixture.organizationB,
      crypto.randomUUID(),
      randomSecret(),
      fixture.locationB,
      fixture.memberB,
      fixture.deviceB,
    ],
  );
  await client.query(
    `insert into public.organization_admin_credentials
       (id, organization_id, passphrase_hash, active)
     values ($1, $2, $3, true)`,
    [fixture.adminCredentialA, fixture.organizationA, fixture.adminHashA],
  );
}

async function verifyMigrations(client) {
  const result = await client.query(
    `select version
     from supabase_migrations.schema_migrations
     order by version`,
  );
  const actual = result.rows.map((row) => row.version);
  expectCondition(
    actual.length === expectedMigrationVersions.length &&
      actual.every((version, index) => version === expectedMigrationVersions[index]),
    'empty database did not apply migrations 001 through 012 in order',
  );
}

async function verifyCompositeTenantConstraints(client) {
  const metadata = await client.query(
    `select conname, convalidated, cardinality(conkey) as local_columns, cardinality(confkey) as referenced_columns
     from pg_catalog.pg_constraint
     where connamespace = 'public'::regnamespace
       and conname = any($1::text[])`,
    [expectedCompositeConstraints],
  );
  expectCondition(metadata.rowCount === expectedCompositeConstraints.length, 'composite tenant constraints are incomplete');
  for (const row of metadata.rows) {
    expectCondition(
      row.convalidated === true && Number(row.local_columns) === 2 && Number(row.referenced_columns) === 2,
      `tenant constraint ${row.conname} is not a validated composite relationship`,
    );
  }

  await expectSqlState('cross-tenant device/member relationship', '23503', () =>
    client.query(
      `insert into public.devices
         (id, organization_id, team_member_id, device_token_hash, active)
       values ($1, $2, $3, $4, true)`,
      [crypto.randomUUID(), fixture.organizationB, fixture.memberA, randomSecret()],
    ),
  );
  await expectSqlState('cross-tenant location/area relationship', '23503', () =>
    client.query(
      `insert into public.locations
         (id, organization_id, area_id, name, latitude, longitude, radius_meters, active)
       values ($1, $2, $3, 'Invalid tenant location', 24.57, -81.78, 120, true)`,
      [crypto.randomUUID(), fixture.organizationB, fixture.areaA],
    ),
  );
  await expectSqlState('cross-tenant unit/location relationship', '23503', () =>
    client.query(
      `insert into public.units
         (id, organization_id, location_id, name, unit_type, visit_interval_days, active)
       values ($1, $2, $3, 'Invalid tenant unit', 'department', 30, true)`,
      [crypto.randomUUID(), fixture.organizationB, fixture.locationA],
    ),
  );
  await expectSqlState('cross-tenant check-in batch relationship', '23503', () =>
    client.query(
      `insert into public.checkin_batches
         (id, organization_id, client_batch_id, request_fingerprint, location_id, team_member_id, device_id, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        crypto.randomUUID(),
        fixture.organizationB,
        crypto.randomUUID(),
        randomSecret(),
        fixture.locationA,
        fixture.memberB,
        fixture.deviceB,
      ],
    ),
  );
  await expectSqlState('cross-tenant check-in relationship', '23503', () =>
    client.query(
      `insert into public.checkins
         (id, organization_id, batch_id, unit_id, location_id, team_member_id, device_id, checked_in_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        crypto.randomUUID(),
        fixture.organizationB,
        fixture.batchB,
        fixture.unitA,
        fixture.locationB,
        fixture.memberB,
        fixture.deviceB,
      ],
    ),
  );

  const setupCodeId = crypto.randomUUID();
  await client.query(
    `insert into public.organization_setup_codes
       (id, organization_id, code_hash, purpose, active, expires_at)
     values ($1, $2, $3, 'pilot_setup', true, now() + interval '1 day')`,
    [setupCodeId, fixture.organizationA, randomSecret()],
  );
  await expectSqlState('cross-tenant workspace/setup-code relationship', '23503', () =>
    client.query(
      `insert into public.workspace_requests
         (id, organization_id, setup_code_id, installation_or_command, preferred_workspace_slug,
          lead_name, lead_role, official_contact_email, rmt_size, expected_pilot_start_date,
          short_use_case, safe_use_boundaries_confirmed, no_sensitive_data_acknowledged)
       values ($1, $2, $3, 'Invalid tenant request', $4, 'CI Lead', 'Tester',
               'ci-invalid@example.invalid', 1, current_date, 'Constraint check', true, true)`,
      [crypto.randomUUID(), fixture.organizationB, setupCodeId, `invalid-${crypto.randomUUID()}`],
    ),
  );
}

async function verifyAtomicApprovalRollback(client) {
  const existingCodeHash = randomSecret();
  const existingCodeId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const attemptedOrganizationId = crypto.randomUUID();
  cleanupRequestIds.add(requestId);
  await client.query(
    `insert into public.organization_setup_codes
       (id, organization_id, code_hash, purpose, active, expires_at)
     values ($1, $2, $3, 'pilot_setup', true, now() + interval '1 day')`,
    [existingCodeId, fixture.organizationA, existingCodeHash],
  );
  await client.query(
    `insert into public.workspace_requests
       (id, installation_or_command, preferred_workspace_slug, lead_name, lead_role,
        official_contact_email, rmt_size, expected_pilot_start_date, short_use_case,
        safe_use_boundaries_confirmed, no_sensitive_data_acknowledged)
     values ($1, 'Atomic rollback request', $2, 'CI Lead', 'Tester', 'ci-atomic@example.invalid',
             1, current_date, 'Atomic rollback test', true, true)`,
    [requestId, `ci-atomic-${requestId.slice(0, 8)}`],
  );

  await expectSqlState('workspace approval rollback', '23505', () =>
    client.query(
      `select * from public.approve_workspace_request(
         $1, $2, 'Should Roll Back', $3, $4, $5, 'CI duplicate setup code',
         now() + interval '1 day', 'Expected failure', now()
       )`,
      [
        requestId,
        attemptedOrganizationId,
        `ci-rollback-${attemptedOrganizationId.slice(0, 8)}`,
        crypto.randomUUID(),
        existingCodeHash,
      ],
    ),
  );
  const state = await client.query(
    `select
       (select count(*)::integer from public.organizations where id = $1) as organizations,
       (select status from public.workspace_requests where id = $2) as request_status`,
    [attemptedOrganizationId, requestId],
  );
  expectCondition(
    state.rows[0].organizations === 0 && state.rows[0].request_status === 'pending',
    'failed workspace approval left a partial state',
  );
}

const delayedCheckinSql = `
  with delay as materialized (select pg_sleep(0.25))
  select result.batch, result.checkin_rows
  from delay
  cross join lateral public.create_checkin_batch(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::timestamptz,
    $7::uuid, $8::uuid[], $9::boolean[], $10::integer[], $11::boolean, $12::boolean
  ) as result`;

function checkinParameters({ clientBatchId, fingerprint, unitId, occurredAt }) {
  return [
    fixture.organizationA,
    fixture.memberA,
    fixture.deviceA,
    clientBatchId,
    fingerprint,
    occurredAt,
    fixture.locationA,
    [unitId],
    [true],
    [10],
    null,
    null,
  ];
}

async function verifyConcurrentScoring() {
  const occurredAt = new Date(Date.now() - 60_000).toISOString();
  const parameters = [
    checkinParameters({
      clientBatchId: crypto.randomUUID(),
      fingerprint: randomSecret(),
      unitId: fixture.unitA,
      occurredAt,
    }),
    checkinParameters({
      clientBatchId: crypto.randomUUID(),
      fingerprint: randomSecret(),
      unitId: fixture.unitA,
      occurredAt,
    }),
  ];
  const results = await runOverlapping('concurrent-scoring', [
    (client) => client.query(delayedCheckinSql, parameters[0]),
    (client) => client.query(delayedCheckinSql, parameters[1]),
  ]);
  expectCondition(results.every((result) => result.status === 'fulfilled'), 'concurrent scoring returned an error');
  const scores = results
    .flatMap((result) => result.value.rows[0].checkin_rows)
    .map((row) => Number(row.score_awarded))
    .sort((left, right) => left - right);
  expectCondition(scores.length === 2 && scores[0] === 0 && scores[1] === 3, 'concurrent scoring awarded unstable points');
}

async function verifyConcurrentIdempotentRetry(client) {
  const clientBatchId = crypto.randomUUID();
  const fingerprint = randomSecret();
  const occurredAt = new Date(Date.now() - 30_000).toISOString();
  const parameters = checkinParameters({ clientBatchId, fingerprint, unitId: fixture.retryUnit, occurredAt });
  const results = await runOverlapping('concurrent-idempotent-retry', [
    (queryClient) => queryClient.query(delayedCheckinSql, parameters),
    (queryClient) => queryClient.query(delayedCheckinSql, parameters),
  ]);
  expectCondition(results.every((result) => result.status === 'fulfilled'), 'idempotent retries returned an error');
  const returnedBatchIds = results.map((result) => result.value.rows[0].batch.id);
  expectCondition(returnedBatchIds[0] === returnedBatchIds[1], 'idempotent retries returned different batches');

  const counts = await client.query(
    `select
       (select count(*)::integer from public.checkin_batches
        where organization_id = $1 and client_batch_id = $2) as batches,
       (select count(*)::integer from public.checkins as checkin
        join public.checkin_batches as batch on batch.id = checkin.batch_id
          and batch.organization_id = checkin.organization_id
        where batch.organization_id = $1 and batch.client_batch_id = $2) as checkins`,
    [fixture.organizationA, clientBatchId],
  );
  expectCondition(counts.rows[0].batches === 1 && counts.rows[0].checkins === 1, 'idempotent retry created duplicate effects');
  if (controlledFailure === 'idempotency') {
    expectCondition(counts.rows[0].checkins === 2, 'controlled failure: intentionally false idempotency expectation');
  }
}

async function verifyDeviceRegistrationPinResetRace(client) {
  const memberId = crypto.randomUUID();
  const initialHash = randomSecret();
  const upgradedHash = randomSecret();
  const recoveryHash = randomSecret();
  await client.query(
    `insert into public.team_members (id, organization_id, name, role, active, pin_hash)
     values ($1, $2, 'CI Device Race Member', 'Tester', true, $3)`,
    [memberId, fixture.organizationA, initialHash],
  );

  const registrationSql = `
    with delay as materialized (select pg_sleep(0.25))
    select registration.device_id
    from delay
    cross join lateral public.register_member_device($1, $2, $3, $4, $5, 'CI race device', now()) registration`;
  const resetSql = `
    with delay as materialized (select pg_sleep(0.25))
    select public.reset_member_pin($1, $2, $3) as reset from delay`;
  const results = await runOverlapping('device-registration-pin-reset', [
    (queryClient) =>
      queryClient.query(registrationSql, [
        fixture.organizationA,
        memberId,
        initialHash,
        upgradedHash,
        randomSecret(),
      ]),
    (queryClient) => queryClient.query(resetSql, [fixture.organizationA, memberId, recoveryHash]),
  ]);
  expectCondition(results.every((result) => result.status === 'fulfilled'), 'device/PIN race returned an error');
  expectCondition(results[1].value.rows[0].reset === true, 'administrator PIN reset did not succeed');

  const finalState = await client.query(
    `select member.pin_hash,
            (select count(*)::integer from public.devices
             where organization_id = $1 and team_member_id = $2 and active is true) as active_devices
     from public.team_members member
     where member.id = $2 and member.organization_id = $1`,
    [fixture.organizationA, memberId],
  );
  expectCondition(
    finalState.rows[0].pin_hash === recoveryHash && finalState.rows[0].active_devices === 0,
    'device/PIN race left a stale PIN or active device',
  );
}

async function verifyAdminRecoveryLoginRace(client) {
  const loginRead = await client.query(
    `select id, passphrase_hash
     from public.organization_admin_credentials
     where id = $1 and organization_id = $2 and active is true`,
    [fixture.adminCredentialA, fixture.organizationA],
  );
  expectCondition(loginRead.rowCount === 1, 'administrator login fixture is missing');
  const verifiedHash = loginRead.rows[0].passphrase_hash;
  const loginUpgradeHash = randomSecret();
  const recoveryHash = randomSecret();

  const loginCasSql = `
    with delay as materialized (select pg_sleep(0.25))
    update public.organization_admin_credentials credential
    set passphrase_hash = $1
    from delay
    where credential.id = $2
      and credential.organization_id = $3
      and credential.passphrase_hash = $4
    returning credential.updated_at::text as updated_at`;
  const recoverySql = `
    with delay as materialized (select pg_sleep(0.25))
    insert into public.organization_admin_credentials (organization_id, passphrase_hash, active)
    select $1, $2, true from delay
    on conflict (organization_id) do update
    set passphrase_hash = excluded.passphrase_hash,
        active = true
    returning updated_at::text as updated_at`;
  const results = await runOverlapping('admin-recovery-login', [
    (queryClient) =>
      queryClient.query(loginCasSql, [
        loginUpgradeHash,
        fixture.adminCredentialA,
        fixture.organizationA,
        verifiedHash,
      ]),
    (queryClient) => queryClient.query(recoverySql, [fixture.organizationA, recoveryHash]),
  ]);
  expectCondition(results.every((result) => result.status === 'fulfilled'), 'admin recovery/login race returned an error');

  const finalState = await client.query(
    `select passphrase_hash, updated_at::text as updated_at
     from public.organization_admin_credentials
     where organization_id = $1`,
    [fixture.organizationA],
  );
  expectCondition(finalState.rows[0].passphrase_hash === recoveryHash, 'in-flight login overwrote administrator recovery');
  const loginUpdate = results[0].value.rows[0];
  if (loginUpdate) {
    expectCondition(
      loginUpdate.updated_at !== finalState.rows[0].updated_at,
      'recovery did not invalidate the in-flight login credential version',
    );
  }
}

async function verifyApproveRejectRace(client) {
  const requestId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const setupCodeId = crypto.randomUUID();
  cleanupRequestIds.add(requestId);
  cleanupOrganizationIds.add(organizationId);
  await client.query(
    `insert into public.workspace_requests
       (id, installation_or_command, preferred_workspace_slug, lead_name, lead_role,
        official_contact_email, rmt_size, expected_pilot_start_date, short_use_case,
        safe_use_boundaries_confirmed, no_sensitive_data_acknowledged)
     values ($1, 'Concurrent request', $2, 'CI Lead', 'Tester', 'ci-race@example.invalid',
             1, current_date, 'Approval/rejection race', true, true)`,
    [requestId, `ci-race-${requestId.slice(0, 8)}`],
  );

  const approveSql = `
    with delay as materialized (select pg_sleep(0.25))
    select approval.*
    from delay
    cross join lateral public.approve_workspace_request(
      $1, $2, 'CI Race Workspace', $3, $4, $5, 'CI race setup',
      now() + interval '1 day', 'Concurrent approval', now()
    ) approval`;
  const rejectSql = `
    with delay as materialized (select pg_sleep(0.25))
    select rejection.*
    from delay
    cross join lateral public.reject_workspace_request($1, 'Concurrent rejection', now()) rejection`;
  const results = await runOverlapping('workspace-approve-reject', [
    (queryClient) =>
      queryClient.query(approveSql, [
        requestId,
        organizationId,
        `ci-approved-${organizationId.slice(0, 8)}`,
        setupCodeId,
        randomSecret(),
      ]),
    (queryClient) => queryClient.query(rejectSql, [requestId]),
  ]);
  const successes = results.filter((result) => result.status === 'fulfilled');
  const failures = results.filter((result) => result.status === 'rejected');
  expectCondition(successes.length === 1 && failures.length === 1, 'approval/rejection race did not choose one winner');
  expectCondition(failures[0].reason?.code === 'P0001', 'approval/rejection conflict returned an unstable SQLSTATE');

  const state = await client.query(
    `select request.status,
            (select count(*)::integer from public.organizations where id = $2) as organizations,
            (select count(*)::integer from public.organization_setup_codes where id = $3) as setup_codes
     from public.workspace_requests request
     where request.id = $1`,
    [requestId, organizationId, setupCodeId],
  );
  const row = state.rows[0];
  const consistentApproved = row.status === 'approved' && row.organizations === 1 && row.setup_codes === 1;
  const consistentRejected = row.status === 'rejected' && row.organizations === 0 && row.setup_codes === 0;
  expectCondition(consistentApproved || consistentRejected, 'approval/rejection race left a partial state');
}

async function verifyPostgrestRelationshipsAndRls() {
  await new Promise((resolve) => setTimeout(resolve, 750));

  const anonymousRead = await anonApi.from('organizations').select('id').limit(1);
  const anonymousBlocked = anonymousRead.error
    ? [401, 403].includes(anonymousRead.status) || anonymousRead.error.code === '42501'
    : Array.isArray(anonymousRead.data) && anonymousRead.data.length === 0;
  expectCondition(anonymousBlocked, 'anonymous PostgREST access bypassed RLS');

  const invalidWrite = await serviceApi.from('locations').insert({
    id: crypto.randomUUID(),
    organization_id: fixture.organizationB,
    area_id: fixture.areaA,
    name: 'Invalid PostgREST tenant location',
    latitude: 24.57,
    longitude: -81.78,
    radius_meters: 120,
    active: true,
  });
  expectCondition(invalidWrite.error?.code === '23503', 'PostgREST cross-tenant write bypassed composite foreign key');

  const locationEmbed = await serviceApi
    .from('locations')
    .select('id,organization_id,areas!locations_area_id_fkey(id,organization_id)')
    .eq('id', fixture.locationA)
    .single();
  expectCondition(!locationEmbed.error && locationEmbed.data, 'PostgREST location/area embed did not resolve');
  expectCondition(
    locationEmbed.data.organization_id === fixture.organizationA &&
      locationEmbed.data.areas?.organization_id === fixture.organizationA,
    'PostgREST location/area embed crossed tenant scope',
  );

  const checkinEmbed = await serviceApi
    .from('checkins')
    .select(
      'id,organization_id,units!checkins_unit_id_fkey(id,organization_id),locations!checkins_location_id_fkey(id,organization_id),team_members!checkins_team_member_id_fkey(id,organization_id),devices!checkins_device_id_fkey(id,organization_id),checkin_batches!checkins_batch_id_fkey(id,organization_id)',
    )
    .eq('organization_id', fixture.organizationA)
    .limit(10);
  expectCondition(!checkinEmbed.error && checkinEmbed.data?.length >= 3, 'PostgREST check-in embeds did not resolve');
  for (const row of checkinEmbed.data) {
    expectCondition(
      row.organization_id === fixture.organizationA &&
        row.units?.organization_id === fixture.organizationA &&
        row.locations?.organization_id === fixture.organizationA &&
        row.team_members?.organization_id === fixture.organizationA &&
        row.devices?.organization_id === fixture.organizationA &&
        row.checkin_batches?.organization_id === fixture.organizationA,
      'PostgREST check-in embed crossed tenant scope',
    );
  }
}

async function verifyLargeWorkspaceReads(client) {
  const organizationId = crypto.randomUUID();
  const areaId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  cleanupOrganizationIds.add(organizationId);

  await client.query(
    `insert into public.organizations (id, name, slug, active) values ($1, 'CI Large Workspace', $2, true)`,
    [organizationId, `ci-large-${organizationId.slice(0, 8)}`],
  );
  await client.query(
    `insert into public.areas (id, organization_id, name, sort_order) values ($1, $2, 'CI Large Area', 1)`,
    [areaId, organizationId],
  );
  await client.query(
    `insert into public.locations (id, organization_id, area_id, name, latitude, longitude, radius_meters, active)
     values ($1, $2, $3, 'CI Large Location', 24.57, -81.78, 120, true)`,
    [locationId, organizationId, areaId],
  );
  await client.query(
    `insert into public.team_members (id, organization_id, name, role, active, pin_hash)
     values ($1, $2, 'CI Large Member', 'Tester', true, $3)`,
    [memberId, organizationId, randomSecret()],
  );
  await client.query(
    `insert into public.devices (id, organization_id, team_member_id, device_token_hash, device_label, active)
     values ($1, $2, $3, $4, 'CI Large Device', true)`,
    [deviceId, organizationId, memberId, randomSecret()],
  );
  await client.query(
    `insert into public.units
       (id, organization_id, location_id, name, unit_type, visit_interval_days, active)
     select md5($1::text || ':unit:' || sequence_number)::uuid, $1::uuid, $2::uuid,
            'CI Large Unit ' || lpad(sequence_number::text, 4, '0'), 'department', 30, true
     from generate_series(1, 1205) as generated(sequence_number)`,
    [organizationId, locationId],
  );
  await client.query(
    `insert into public.checkin_batches
       (id, organization_id, client_batch_id, location_id, team_member_id, device_id, occurred_at, received_at,
        confidential_care_provided, referral_provided)
     select md5($1::text || ':batch:' || sequence_number)::uuid, $1::uuid,
            md5($1::text || ':client:' || sequence_number)::uuid, $2::uuid, $3::uuid, $4::uuid,
            '2026-06-15T12:00:00Z'::timestamptz + sequence_number * interval '1 second',
            '2026-06-15T12:00:00Z'::timestamptz + sequence_number * interval '1 second', true, null
     from generate_series(1, 1205) as generated(sequence_number)`,
    [organizationId, locationId, memberId, deviceId],
  );
  await client.query(
    `insert into public.checkins
       (id, organization_id, unit_id, location_id, team_member_id, checked_in_at,
        geofence_verified, score_awarded, batch_id)
     select md5($1::text || ':checkin:' || sequence_number)::uuid, $1::uuid,
            md5($1::text || ':unit:' || sequence_number)::uuid, $2::uuid, $3::uuid,
            '2026-06-15T12:00:00Z'::timestamptz + sequence_number * interval '1 second',
            true, 1, md5($1::text || ':batch:' || sequence_number)::uuid
     from generate_series(1, 1205) as generated(sequence_number)`,
    [organizationId, locationId, memberId],
  );

  const latestIds = [];
  let afterUnitId = null;
  for (;;) {
    const result = await serviceApi.rpc('get_latest_active_checkins_page', {
      p_organization_id: organizationId,
      p_after_unit_id: afterUnitId,
      p_page_size: 500,
    });
    expectCondition(!result.error, 'large coverage cursor RPC failed');
    const page = result.data ?? [];
    latestIds.push(...page.map((row) => row.id));
    if (page.length < 500) break;
    afterUnitId = page.at(-1).id;
  }
  expectCondition(latestIds.length === 1205, 'large coverage cursor omitted rows');
  expectCondition(new Set(latestIds).size === 1205, 'large coverage cursor duplicated rows');

  const leaderboard = await client.query(
    `select public.get_leaderboard_period($1, '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', 'UTC', array[$2]::uuid[]) as result`,
    [organizationId, areaId],
  );
  const leaderboardResult = leaderboard.rows[0].result;
  expectCondition(leaderboardResult.distinct_units_covered === 1205, 'large leaderboard omitted distinct units');
  expectCondition(leaderboardResult.rows?.[0]?.qualifying_checkins === 1205, 'large leaderboard omitted check-ins');
  expectCondition(leaderboardResult.rows?.[0]?.gray_to_green_units === 1205, 'large leaderboard first-visit total is incomplete');

  const indicators = await client.query(
    `select * from public.get_indicator_report_page($1, '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', null, 500)`,
    [organizationId],
  );
  expectCondition(indicators.rows.length === 1, 'large indicator aggregation returned an unexpected group count');
  expectCondition(Number(indicators.rows[0].visits) === 1205, 'large indicator aggregation omitted visits');
  expectCondition(Number(indicators.rows[0].single_unit_indicator_visits) === 1205, 'large indicator aggregation miscounted batches');
}

async function cleanup(client) {
  for (const organizationId of Array.from(cleanupOrganizationIds).reverse()) {
    await client.query('select public.delete_deckplating_organization($1)', [organizationId]).catch(() => {});
  }
  if (cleanupRequestIds.size > 0) {
    await client
      .query('delete from public.workspace_requests where id = any($1::uuid[])', [Array.from(cleanupRequestIds)])
      .catch(() => {});
  }
}

async function main() {
  await withClient('orchestrator', async (client) => {
    try {
      await runCheck('empty migration chain applies 001-013 in order', () => verifyMigrations(client));
      await seedFixture(client);
      await runCheck('tenant composite foreign keys reject cross-workspace records', () =>
        verifyCompositeTenantConstraints(client),
      );
      await runCheck('failed workspace approval rolls back every write', () => verifyAtomicApprovalRollback(client));
      await runCheck('concurrent check-in scoring serializes per unit', verifyConcurrentScoring);
      await runCheck('concurrent idempotent retries create one effect', () => verifyConcurrentIdempotentRetry(client));
      await runCheck('device registration racing PIN reset fails closed', () =>
        verifyDeviceRegistrationPinResetRace(client),
      );
      await runCheck('administrator recovery invalidates an in-flight login', () =>
        verifyAdminRecoveryLoginRace(client),
      );
      await runCheck('workspace approval and rejection select one atomic winner', () => verifyApproveRejectRace(client));
      await client.query("notify pgrst, 'reload schema'");
      await runCheck('PostgREST embeds resolve composite relationships and RLS blocks anon',
        verifyPostgrestRelationshipsAndRls,
      );
      await runCheck('large workspace cursors and aggregates preserve more than 1,000 rows', () =>
        verifyLargeWorkspaceReads(client),
      );
    } finally {
      await cleanup(client);
    }
  });
}

main().catch((error) => {
  const message = error instanceof CheckFailure ? error.message : 'unexpected sanitized test-runner failure';
  console.error(`Database behavior suite failed: ${message}`);
  process.exitCode = 1;
});
