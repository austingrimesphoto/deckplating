import crypto from 'node:crypto';

const baseUrl = (process.env.DECKPLATING_INTEGRATION_BASE_URL ?? '').replace(/\/$/, '');
const operatorPassphrase = process.env.DECKPLATING_INTEGRATION_OPERATOR_PASSPHRASE ?? '';
const allowProd = process.env.DECKPLATING_INTEGRATION_ALLOW_PROD === 'YES';

if (!baseUrl || !operatorPassphrase) {
  console.error('Set DECKPLATING_INTEGRATION_BASE_URL and DECKPLATING_INTEGRATION_OPERATOR_PASSPHRASE to run this live integration check.');
  process.exit(1);
}

if (baseUrl.includes('deckplating.netlify.app') && !allowProd) {
  console.error('Refusing to run against production unless DECKPLATING_INTEGRATION_ALLOW_PROD=YES is set.');
  process.exit(1);
}

const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const createdOrganizations = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
  return { status: response.status, data };
}

async function createWorkspace(operatorToken, label, pin) {
  const slug = `it-${label}-${suffix}`.toLowerCase();
  const created = await request('/api/operator/organizations', {
    method: 'POST',
    token: operatorToken,
    expected: [201],
    body: { name: `Integration ${label.toUpperCase()} ${suffix}`, slug },
  });
  const organization = created.data.organization;
  createdOrganizations.push(organization);

  const issued = await request(`/api/operator/organizations/${organization.id}/setup-codes`, {
    method: 'POST',
    token: operatorToken,
    expected: [201],
    body: { label: `Integration ${label}`, expiresInDays: 1 },
  });

  const activated = await request('/api/workspaces/activate', {
    method: 'POST',
    expected: [200],
    body: {
      setupCode: issued.data.code ?? issued.data.setupCode?.code,
      adminPassphrase: `integration-admin-${label}-${suffix}`,
      organizationName: organization.name,
      leadLabel: `Integration ${label}`,
      installationName: 'Integration Test Installation',
      installationLatitude: 24.57,
      installationLongitude: -81.78,
    },
  });

  const adminToken = activated.data.token;
  const area = await request('/api/admin/areas', {
    method: 'POST',
    token: adminToken,
    body: { name: `Area ${label.toUpperCase()}`, sort_order: 1 },
  });
  const location = await request('/api/admin/locations', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `Location ${label.toUpperCase()}`,
      area_id: area.data.area.id,
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
      name: `Unit ${label.toUpperCase()} ${suffix}`,
      unit_type: 'department',
      visit_interval_days: 30,
      location_id: location.data.location.id,
      active: true,
    },
  });
  const member = await request('/api/admin/team-members', {
    method: 'POST',
    token: adminToken,
    body: { name: `Member ${label.toUpperCase()} ${suffix}`, role: 'Integration tester', active: true },
  });

  const deviceToken = crypto.randomUUID();
  const registered = await request('/api/device/register', {
    method: 'POST',
    body: {
      teamMemberId: member.data.teamMember.id,
      pin,
      deviceToken,
      deviceLabel: `integration-${label}`,
      organizationId: organization.id,
    },
  });

  return {
    organization,
    adminToken,
    userToken: registered.data.sessionToken,
    deviceToken,
    area: area.data.area,
    location: location.data.location,
    unit: unit.data.unit,
    member: member.data.teamMember,
    pin,
  };
}

async function cleanup(operatorToken) {
  for (const organization of createdOrganizations.reverse()) {
    try {
      await request(`/api/operator/organizations/${organization.id}/delete`, {
        method: 'DELETE',
        token: operatorToken,
        expected: [200, 404],
        body: { confirmSlug: organization.slug },
      });
      console.log(`CLEANUP deleted ${organization.slug}`);
    } catch (error) {
      console.error(`CLEANUP failed for ${organization.slug}: ${error.message}`);
    }
  }
}

let operatorToken = '';

try {
  const login = await request('/api/operator/login', {
    method: 'POST',
    expected: [200],
    body: { passphrase: operatorPassphrase },
  });
  operatorToken = login.data.token;

  const alpha = await createWorkspace(operatorToken, 'alpha', '1234');
  const bravo = await createWorkspace(operatorToken, 'bravo', '5678');

  await request(`/api/admin/units/${bravo.unit.id}`, {
    method: 'PATCH',
    token: alpha.adminToken,
    expected: [404],
    body: { name: 'Cross-workspace mutation attempt' },
  });
  console.log('PASS Alpha admin cannot edit Bravo unit.');

  await request(`/api/admin/team-members/${bravo.member.id}/reset-pin`, {
    method: 'POST',
    token: alpha.adminToken,
    expected: [404],
  });
  console.log('PASS Alpha admin cannot reset Bravo member PIN.');

  await request(`/api/coverage-detail?unitId=${encodeURIComponent(bravo.unit.id)}`, {
    token: alpha.userToken,
    expected: [404],
  });
  console.log('PASS Alpha user cannot read Bravo coverage detail.');

  await request('/api/checkins', {
    method: 'POST',
    token: alpha.userToken,
    expected: [404],
    body: {
      teamMemberId: alpha.member.id,
      deviceToken: alpha.deviceToken,
      clientBatchId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      locationId: bravo.location.id,
      unitIds: [bravo.unit.id],
      manual: true,
      confidentialCareProvided: null,
      referralProvided: null,
    },
  });
  console.log('PASS Alpha user cannot check in against Bravo unit.');

  await request('/api/device/register', {
    method: 'POST',
    expected: [404],
    body: {
      teamMemberId: bravo.member.id,
      pin: bravo.pin,
      deviceToken: crypto.randomUUID(),
      deviceLabel: 'cross-workspace-registration',
      organizationId: alpha.organization.id,
    },
  });
  console.log('PASS Bravo member cannot register inside Alpha workspace.');

  console.log('\nTwo-workspace integration checks passed.');
} finally {
  if (operatorToken) await cleanup(operatorToken);
}
