import crypto from 'node:crypto';

const baseUrl = (process.env.DECKPLATING_SMOKE_BASE_URL ?? '').replace(/\/$/, '');
const operatorPassphrase = process.env.DECKPLATING_SMOKE_OPERATOR_PASSPHRASE ?? '';
const allowProd = process.env.DECKPLATING_SMOKE_ALLOW_PROD === 'YES';

if (!baseUrl || !operatorPassphrase) {
  console.error('Set DECKPLATING_SMOKE_BASE_URL and DECKPLATING_SMOKE_OPERATOR_PASSPHRASE to run this smoke check.');
  process.exit(1);
}

if (baseUrl.includes('deckplating.netlify.app') && !allowProd) {
  console.error('Refusing to run against production unless DECKPLATING_SMOKE_ALLOW_PROD=YES is set.');
  process.exit(1);
}

const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const slug = `smoke-${suffix}`.toLowerCase();
let organization = null;
let operatorToken = '';

async function request(path, { method = 'GET', token, body, expected = [200] } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${data.error ?? 'Unexpected response.'}`);
  }
  return data;
}

async function cleanup() {
  if (!operatorToken || !organization) return;
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
  }
}

try {
  const login = await request('/api/operator/login', {
    method: 'POST',
    body: { passphrase: operatorPassphrase },
  });
  operatorToken = login.token;
  console.log('PASS operator login.');

  const created = await request('/api/operator/organizations', {
    method: 'POST',
    token: operatorToken,
    expected: [201],
    body: { name: `Smoke Workspace ${suffix}`, slug },
  });
  organization = created.organization;
  console.log('PASS workspace creation.');

  const issued = await request(`/api/operator/organizations/${organization.id}/setup-codes`, {
    method: 'POST',
    token: operatorToken,
    expected: [201],
    body: { label: 'First pilot smoke', expiresInDays: 1 },
  });
  console.log('PASS setup-code issuance.');

  const activated = await request('/api/workspaces/activate', {
    method: 'POST',
    body: {
      setupCode: issued.code ?? issued.setupCode?.code,
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
  const registered = await request('/api/device/register', {
    method: 'POST',
    body: {
      teamMemberId: member.teamMember.id,
      pin: '2468',
      deviceToken,
      deviceLabel: 'first-pilot-smoke',
      organizationId: organization.id,
    },
  });
  console.log('PASS member registration.');

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
      confidentialCareProvided: true,
      referralProvided: true,
    },
  });
  console.log('PASS Admin Activity Log can edit counseling/referral indicators.');

  const editedActivity = await request('/api/admin/checkins?includeVoided=true', {
    token: adminToken,
  });
  const editedCheckin = editedActivity.checkins.find((candidate) => candidate.id === checkin.id);
  if (editedCheckin?.confidential_care_provided !== true || editedCheckin?.referral_provided !== true) {
    throw new Error('Edited indicators were not visible in Admin Activity Log.');
  }
  console.log('PASS edited indicators are visible in Admin Activity Log.');

  const report = await request('/api/reports/indicators', {
    token: registered.sessionToken,
  });
  const reportRow = report.rows.find((row) => row.location_id === location.location.id);
  if (!reportRow || reportRow.confidential_care_count < 1 || reportRow.referral_count < 1) {
    throw new Error('Edited indicators were not reflected in the indicator report.');
  }
  console.log('PASS edited indicators are reflected in Reports.');

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
  await cleanup();
}
