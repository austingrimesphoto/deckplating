import crypto from 'node:crypto';
import { createJsonClient, liveCheckSuffix, normalizeLiveCheckBaseUrl } from './lib/live-check.mjs';

const operatorPassphrase = process.env.DECKPLATING_SMOKE_OPERATOR_PASSPHRASE ?? '';
const allowProd = process.env.DECKPLATING_SMOKE_ALLOW_PROD === 'YES';

if (!process.env.DECKPLATING_SMOKE_BASE_URL || !operatorPassphrase) {
  console.error('Set DECKPLATING_SMOKE_BASE_URL and DECKPLATING_SMOKE_OPERATOR_PASSPHRASE to run this smoke check.');
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = normalizeLiveCheckBaseUrl(process.env.DECKPLATING_SMOKE_BASE_URL, {
    allowProduction: allowProd,
    productionHostname: 'deckplating.netlify.app',
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const suffix = liveCheckSuffix();
const slug = `smoke-${suffix}`.toLowerCase();
let organization = null;
let operatorToken = '';
let workspaceRequestId = '';
const request = createJsonClient(baseUrl);

async function findSmokeOrganization() {
  const result = await request('/api/operator/organizations', { token: operatorToken });
  return result.organizations.find((candidate) => candidate.slug === slug) ?? null;
}

async function findPendingSmokeRequest() {
  let offset = 0;
  while (offset <= 100_000) {
    const result = await request(`/api/operator/workspace-requests?status=pending&limit=250&offset=${offset}`, {
      token: operatorToken,
    });
    const match = result.requests.find((candidate) => candidate.preferred_workspace_slug === slug);
    if (match) return match;
    if (!result.page?.hasMore || !result.page.returned) return null;
    offset += result.page.returned;
  }
  throw new Error('Workspace request cleanup exceeded the supported queue range.');
}

async function cleanup() {
  if (!operatorToken) return true;
  try {
    organization = organization ?? (await findSmokeOrganization());
  } catch (error) {
    console.error(`CLEANUP could not inspect workspaces for ${slug}: ${error.message}`);
    return false;
  }
  if (!organization && !workspaceRequestId) {
    try {
      const pendingRequest = await findPendingSmokeRequest();
      workspaceRequestId = pendingRequest?.id ?? '';
    } catch (error) {
      console.error(`CLEANUP could not inspect pending workspace requests for ${slug}: ${error.message}`);
      return false;
    }
  }
  if (!organization && workspaceRequestId) {
    try {
      await request(`/api/operator/workspace-requests/${workspaceRequestId}/reject`, {
        method: 'POST',
        token: operatorToken,
        body: { operatorNote: 'Smoke cleanup for unapproved request.' },
        expected: [200, 404, 409],
      });
      console.log(`CLEANUP rejected workspace request ${workspaceRequestId}`);
    } catch (error) {
      console.error(`CLEANUP failed for workspace request ${workspaceRequestId}: ${error.message}`);
      return false;
    }
    try {
      organization = await findSmokeOrganization();
    } catch (error) {
      console.error(`CLEANUP could not confirm rejection for ${slug}: ${error.message}`);
      return false;
    }
  }
  if (!organization) return true;
  try {
    await request(`/api/operator/organizations/${organization.id}/delete`, {
      method: 'DELETE',
      token: operatorToken,
      body: { confirmSlug: organization.slug },
      expected: [200, 404],
    });
    console.log(`CLEANUP deleted ${organization.slug}`);
  } catch (error) {
    console.error(`CLEANUP failed for ${organization.slug}: ${error.message}`);
    return false;
  }
  return true;
}

try {
  const login = await request('/api/operator/login', {
    method: 'POST',
    body: { passphrase: operatorPassphrase },
  });
  operatorToken = login.token;
  if (typeof operatorToken !== 'string' || !operatorToken) throw new Error('Operator login did not return a token.');
  console.log('PASS operator login.');

  const submittedRequest = await request('/api/workspace-requests', {
    method: 'POST',
    expected: [201],
    body: {
      installation_or_command: `Smoke Workspace ${suffix}`,
      preferred_workspace_slug: slug,
      lead_name: 'Smoke lead',
      lead_role: 'Smoke tester',
      official_contact_email: `smoke-${suffix}@example.mil`,
      rmt_size: 2,
      expected_pilot_start_date: new Date().toISOString().slice(0, 10),
      short_use_case: 'Smoke test request for managed workspace approval.',
      safe_use_boundaries_confirmed: true,
      no_sensitive_data_acknowledged: true,
    },
  });
  workspaceRequestId = submittedRequest.request.id;
  console.log('PASS workspace request submission.');

  const requestQueue = await request('/api/operator/workspace-requests?status=pending', {
    token: operatorToken,
  });
  if (!requestQueue.requests.some((candidate) => candidate.id === workspaceRequestId)) {
    throw new Error('Submitted workspace request was not visible in the operator approval queue.');
  }
  console.log('PASS operator approval queue includes the request.');

  const approved = await request(`/api/operator/workspace-requests/${workspaceRequestId}/approve`, {
    method: 'POST',
    token: operatorToken,
    body: {
      workspaceName: `Smoke Workspace ${suffix}`,
      workspaceSlug: slug,
      expiresInDays: 1,
      operatorNote: 'Approved by first-pilot smoke check.',
    },
  });
  organization = approved.organization;
  console.log('PASS workspace request approval creates workspace and setup code.');

  const activated = await request('/api/workspaces/activate', {
    method: 'POST',
    body: {
      setupCode: approved.code ?? approved.setupCode?.code,
      adminPassphrase: `smoke-admin-${suffix}`,
      organizationName: organization.name,
      leadLabel: 'Smoke lead',
      installationName: 'Smoke Test Installation',
      installationLatitude: 24.57,
      installationLongitude: -81.78,
    },
  });
  const adminToken = activated.token;
  console.log('PASS workspace activation.');

  const area = await request('/api/admin/areas', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Smoke Area', sort_order: 1 },
  });
  const location = await request('/api/admin/locations', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Smoke Location',
      area_id: area.area.id,
      latitude: 24.57,
      longitude: -81.78,
      radius_meters: 120,
      active: true,
    },
  });
  const unit = await request('/api/admin/units', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `Smoke Unit ${suffix}`,
      unit_type: 'department',
      visit_interval_days: 30,
      location_id: location.location.id,
      active: true,
    },
  });
  const member = await request('/api/admin/team-members', {
    method: 'POST',
    token: adminToken,
    body: { name: `Smoke Member ${suffix}`, role: 'Smoke tester', active: true },
  });
  console.log('PASS local setup creation.');

  const deviceToken = crypto.randomUUID();
  const memberPin = member.temporaryPin ?? '2468';
  const registered = await request('/api/device/register', {
    method: 'POST',
    body: {
      teamMemberId: member.teamMember.id,
      pin: memberPin,
      deviceToken,
      deviceLabel: 'first-pilot-smoke',
      organizationId: organization.id,
    },
  });
  console.log('PASS member registration.');

  const rejectedAdminAccess = await request('/api/admin/settings', {
    token: registered.sessionToken,
    expected: [403],
  });
  if (!/admin authorization required/i.test(String(rejectedAdminAccess.error ?? ''))) {
    throw new Error('A normal member token was not explicitly rejected by the Admin API.');
  }
  console.log('PASS member session cannot access Admin API.');

  const replacementPin = '1357';
  await request('/api/device/change-pin', {
    method: 'POST',
    token: registered.sessionToken,
    body: { currentPin: memberPin, newPin: replacementPin, deviceToken },
  });
  await request('/api/device/register', {
    method: 'POST',
    expected: [403],
    body: {
      teamMemberId: member.teamMember.id,
      pin: memberPin,
      deviceToken: crypto.randomUUID(),
      deviceLabel: 'first-pilot-old-pin-check',
      organizationId: organization.id,
    },
  });
  await request('/api/device/register', {
    method: 'POST',
    body: {
      teamMemberId: member.teamMember.id,
      pin: replacementPin,
      deviceToken: crypto.randomUUID(),
      deviceLabel: 'first-pilot-new-pin-check',
      organizationId: organization.id,
    },
  });
  console.log('PASS member can rotate the issued PIN and the previous PIN is rejected.');

  await request('/api/checkins', {
    method: 'POST',
    token: registered.sessionToken,
    body: {
      teamMemberId: member.teamMember.id,
      deviceToken,
      clientBatchId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      locationId: location.location.id,
      unitIds: [unit.unit.id],
      manual: true,
      confidentialCareProvided: null,
      referralProvided: null,
    },
  });
  console.log('PASS check-in creation.');

  const activity = await request('/api/admin/checkins?includeVoided=true', {
    token: adminToken,
  });
  const checkin = activity.checkins.find((candidate) => candidate.unit_id === unit.unit.id);
  if (!checkin) throw new Error('Created check-in was not visible in Admin Activity Log.');
  if (checkin.confidential_care_provided !== null || checkin.referral_provided !== null) {
    throw new Error('Created check-in should start with empty indicators.');
  }
  console.log('PASS Admin Activity Log can read the check-in.');

  const pagedActivity = await request(`/api/admin/checkins?includeVoided=true&limit=1&search=${encodeURIComponent(unit.unit.name)}`, {
    token: adminToken,
  });
  if (!pagedActivity.page || pagedActivity.page.limit !== 1 || pagedActivity.checkins[0]?.unit_id !== unit.unit.id) {
    throw new Error('Admin Activity Log pagination/search did not return the expected check-in.');
  }
  console.log('PASS Admin Activity Log pagination/search returns the expected check-in.');

  await request(`/api/admin/checkins/${checkin.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: {
      adminTeamMemberId: member.teamMember.id,
      unit_id: unit.unit.id,
      team_member_id: member.teamMember.id,
      checked_in_at: checkin.checked_in_at,
    },
  });
  console.log('PASS Admin Activity Log can edit basic check-in fields.');

  const leaderboard = await request(`/api/leaderboard?month=${new Date().toISOString().slice(0, 7)}`, {
    token: registered.sessionToken,
  });
  if (!leaderboard.winners?.month || !leaderboard.winners.month.winner || !leaderboard.winners?.weeks?.some((week) => week.winner)) {
    throw new Error('Mission Board did not return weekly and monthly winner data.');
  }
  console.log('PASS Mission Board returns weekly and monthly winners.');

  const safeExport = await request(`/api/operator/organizations/${organization.id}/export`, {
    token: operatorToken,
  });
  const serializedExport = JSON.stringify(safeExport);
  for (const forbidden of ['pin_hash', 'passphrase_hash', 'device_token_hash', 'code_hash', 'device_id']) {
    if (serializedExport.includes(forbidden)) throw new Error(`Safe export included forbidden field ${forbidden}.`);
  }
  if (safeExport.format !== 'deckplating-safe-operator-export-v1' || !safeExport.checkins?.some((row) => row.id === checkin.id)) {
    throw new Error('Safe export did not include expected non-sensitive workspace data.');
  }
  console.log('PASS safe operator export excludes stored secrets and includes workspace data.');

  const audit = await request(`/api/operator/audit-events?limit=10&search=${encodeURIComponent(organization.slug)}`, {
    token: operatorToken,
  });
  if (!audit.page || !audit.events.some((event) => event.action === 'workspace_safe_export_downloaded')) {
    throw new Error('Operator audit search did not include the safe export event.');
  }
  console.log('PASS operator audit pagination/search includes the safe export event.');

  console.log('\nFirst-pilot smoke check passed.');
} finally {
  if (!(await cleanup())) process.exitCode = 1;
}
