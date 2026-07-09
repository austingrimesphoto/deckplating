import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const screenshotsDir = path.join('test-results', 'ui-screenshots');

const workspace = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'demo',
  name: 'Demo Workspace',
  installationName: 'Demo Installation',
  mapDefaultLatitude: 24.57,
  mapDefaultLongitude: -81.78,
};

const teamMembers = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'CH Doe', role: 'Chaplain' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'RP Smith', role: 'Religious Program Specialist' },
];

const areas = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Waterfront', sort_order: 1 }];

const locations = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Pier Admin',
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: 24.57,
    longitude: -81.78,
    radius_meters: 120,
    active: true,
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    name: 'Trumbo Point Waterfront Operations and Support Annex With Long Location Name',
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: 24.5589,
    longitude: -81.8012,
    radius_meters: 180,
    active: true,
  },
  {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    name: 'Boca Chica Flight Line Chaplain Support Corridor',
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: 24.5761,
    longitude: -81.6887,
    radius_meters: 220,
    active: true,
  },
];

const units = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Engineering Department',
    unit_type: 'department',
    visit_interval_days: 30,
    active: true,
    location_id: locations[0].id,
    location_name: locations[0].name,
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: locations[0].latitude,
    longitude: locations[0].longitude,
    radius_meters: locations[0].radius_meters,
    last_visit_at: null,
    last_visitor: null,
    days_since_last_visit: null,
    status: 'gray',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    name: 'Operations Division',
    unit_type: 'division',
    visit_interval_days: 14,
    active: true,
    location_id: locations[0].id,
    location_name: locations[0].name,
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: locations[0].latitude,
    longitude: locations[0].longitude,
    radius_meters: locations[0].radius_meters,
    last_visit_at: new Date().toISOString(),
    last_visitor: 'CH Doe',
    days_since_last_visit: 0,
    status: 'green',
  },
  {
    id: '99999999-9999-4999-8999-999999999999',
    name: 'Expeditionary Maintenance Coordination Department With an Extremely Long Display Name',
    unit_type: 'department',
    visit_interval_days: 21,
    active: true,
    location_id: locations[1].id,
    location_name: locations[1].name,
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: locations[1].latitude,
    longitude: locations[1].longitude,
    radius_meters: locations[1].radius_meters,
    last_visit_at: new Date(Date.now() - 33 * 24 * 60 * 60 * 1000).toISOString(),
    last_visitor: 'RP Smith',
    days_since_last_visit: 33,
    status: 'red',
  },
  {
    id: 'abababab-abab-4aba-8bab-abababababab',
    name: 'Tenant Command Liaison and Family Readiness Support Element',
    unit_type: 'tenant',
    visit_interval_days: 14,
    active: true,
    location_id: locations[1].id,
    location_name: locations[1].name,
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: locations[1].latitude,
    longitude: locations[1].longitude,
    radius_meters: locations[1].radius_meters,
    last_visit_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    last_visitor: 'CH Doe',
    days_since_last_visit: 12,
    status: 'yellow',
  },
  {
    id: 'cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd',
    name: 'Aviation Support Division',
    unit_type: 'division',
    visit_interval_days: 10,
    active: true,
    location_id: locations[2].id,
    location_name: locations[2].name,
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: locations[2].latitude,
    longitude: locations[2].longitude,
    radius_meters: locations[2].radius_meters,
    last_visit_at: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    last_visitor: 'RP Smith',
    days_since_last_visit: 18,
    status: 'red',
  },
];

async function mockAppApi(page: import('@playwright/test').Page) {
  await page.route('**/blank-map-style.json', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dbe4eb' } }],
      },
    }),
  );
  await page.route('**/api/team-members**', (route) =>
    route.fulfill({ json: { organizationId: workspace.id, organization: workspace, teamMembers } }),
  );
  await page.route('**/api/device/register', (route) =>
    route.fulfill({
      json: {
        organizationId: workspace.id,
        organization: workspace,
        deviceId: '33333333-3333-4333-8333-333333333333',
        sessionToken: 'demo-session-token',
      },
    }),
  );
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({
      json: {
        organizationId: workspace.id,
        organization: workspace,
        areas,
        teamMembers,
        units,
        mapTileUrl: '/blank-map-style.json',
        mapDefaultLatitude: 24.57,
        mapDefaultLongitude: -81.78,
        installationName: 'Demo Installation',
        gamificationTone: 'professional',
      },
    }),
  );
  await page.route('**/api/nearby-locations**', (route) =>
    route.fulfill({
      json: {
        matches: locations.map((location, index) => ({
          ...location,
          distance_meters: index === 0 ? 12 : 220 + index * 60,
          status: units.find((unit) => unit.location_id === location.id)?.status ?? 'gray',
          units: units.filter((unit) => unit.location_id === location.id),
        })),
      },
    }),
  );
  await page.route('**/api/leaderboard**', (route) =>
    route.fulfill({
      json: {
        month: '2026-07',
        rows: [
          {
            team_member_id: teamMembers[0].id,
            name: teamMembers[0].name,
            qualifying_checkins: 4,
            distinct_units: 3,
            recovered_units: 2,
            gray_to_green_units: 1,
            coverage_sweep_areas: 0,
            active_days: 3,
            score: 14,
            badges: ['first_rounds', 'recovery_team'],
          },
        ],
        winners: {
          weeks: [
            {
              type: 'week',
              label: 'Jul 1-Jul 5',
              start: '2026-07-01T00:00:00.000Z',
              end: '2026-07-06T00:00:00.000Z',
              final: true,
              winner: {
                team_member_id: teamMembers[0].id,
                name: teamMembers[0].name,
                qualifying_checkins: 2,
                distinct_units: 2,
                recovered_units: 1,
                gray_to_green_units: 1,
                coverage_sweep_areas: 0,
                active_days: 2,
                score: 8,
                badges: ['first_rounds'],
              },
            },
          ],
          month: {
            type: 'month',
            label: 'July 2026',
            start: '2026-07-01T00:00:00.000Z',
            end: '2026-08-01T00:00:00.000Z',
            final: false,
            winner: {
              team_member_id: teamMembers[0].id,
              name: teamMembers[0].name,
              qualifying_checkins: 4,
              distinct_units: 3,
              recovered_units: 2,
              gray_to_green_units: 1,
              coverage_sweep_areas: 0,
              active_days: 3,
              score: 14,
              badges: ['first_rounds', 'recovery_team'],
            },
          },
        },
        summary: {
          units_recovered_this_month: 2,
          distinct_units_covered: 3,
          overdue_remaining: 1,
          never_visited_remaining: 1,
        },
      },
    }),
  );
  await page.route('**/api/admin/login', (route) =>
    route.fulfill({ json: { token: 'demo-admin-token', authMethod: 'organization', organization: workspace } }),
  );
  await page.route('**/api/admin/settings', (route) =>
    route.fulfill({
      json: {
        gamificationTone: 'professional',
        adminAuthMethod: 'organization',
        organizationAdminAvailable: true,
        onboarding: {
          areaCount: 1,
          locationCount: locations.length,
          unitCount: units.length,
          teamMemberCount: 2,
          organizationAdminConfigured: true,
          readyForCheckins: true,
          lastCheckinAt: new Date().toISOString(),
          lastCheckinTeamMemberName: teamMembers[0].name,
          lastCheckinUnitName: units[0].name,
        },
      },
    }),
  );
  await page.route('**/api/admin/locations', (route) =>
    route.fulfill({
      json: {
        areas,
        locations,
        units: units.map((unit) => ({
          id: unit.id,
          name: unit.name,
          unit_type: unit.unit_type,
          visit_interval_days: unit.visit_interval_days,
          location_id: unit.location_id,
          active: unit.active,
        })),
        teamMembers: teamMembers.map((member) => ({ ...member, active: true })),
      },
    }),
  );
  await page.route('**/api/admin/checkins**', (route) =>
    route.fulfill({
      json: {
        checkins: [],
        page: { limit: 75, offset: 0, returned: 0, total: 0, hasMore: false },
      },
    }),
  );
}

async function screenshot(page: import('@playwright/test').Page, projectName: string, name: string) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, `${projectName}-${name}.png`), fullPage: true });
}

test('captures core user and admin screens', async ({ page }, testInfo) => {
  await mockAppApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Select your name' })).toBeVisible();
  await screenshot(page, testInfo.project.name, '01-name-pin');

  await page.getByLabel('4-digit PIN').fill('2468');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'CH Doe' })).toBeVisible();
  await screenshot(page, testInfo.project.name, '02-check-in');

  await page.getByRole('button', { name: 'Coverage' }).click();
  await expect(page.getByRole('heading', { name: 'Needs attention first' })).toBeVisible();
  await screenshot(page, testInfo.project.name, '03-coverage');

  await page.getByRole('button', { name: 'Scores' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly and monthly leaders' })).toBeVisible();
  await screenshot(page, testInfo.project.name, '04-mission-winners');

  await page.getByRole('button', { name: 'Admin' }).click();
  await page.getByLabel('Local admin passphrase').fill('demo-admin-passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: /Quality controls/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete onboarding' })).toHaveCount(0);
  await screenshot(page, testInfo.project.name, '05-admin-release-note');
});

test('captures kiosk dashboard', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.setViewportSize({ width: 1366, height: 768 });
  await mockAppApi(page);
  await page.goto('/?kiosk=1');
  await page.getByLabel('4-digit PIN').fill('2468');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Demo Installation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Go here first' })).toBeVisible();
  await expect(page.getByText('Coverage picture')).toBeVisible();
  await expect(page.locator('.kiosk-map-stage')).toHaveAttribute('data-marker-count', String(locations.length));
  await expect(page.getByTestId('kiosk-map-marker')).toHaveCount(locations.length);
  for (const location of locations) {
    const marker = page.locator(`[data-testid="kiosk-map-marker"][data-location-id="${location.id}"]`);
    await expect(marker).toBeVisible();
    await expect(marker.locator('.kiosk-map-pin-count')).not.toHaveText('');
  }
  await expect(page.locator('[data-testid="kiosk-map-marker"][data-location-id="cccccccc-cccc-4ccc-8ccc-cccccccccccc"]')).toHaveClass(/gray/);
  await expect(page.locator('[data-testid="kiosk-map-marker"][data-location-id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]')).toHaveClass(/red/);
  await expect(page.locator('[data-testid="kiosk-map-marker"][data-location-id="ffffffff-ffff-4fff-8fff-ffffffffffff"]')).toHaveClass(/red/);
  await expect(page.locator('.kiosk-map-marker-label')).toHaveCount(0);
  await expect(page.locator('.kiosk-action')).toHaveCount(3);
  const mapBox = await page.locator('.kiosk-map-stage').boundingBox();
  expect(mapBox?.width ?? 0).toBeGreaterThan(100);
  expect(mapBox?.height ?? 0).toBeGreaterThan(100);
  const canvasFillsMap = await page.locator('.kiosk-map-stage').evaluate((stage) => {
    const stageRect = stage.getBoundingClientRect();
    const canvas = stage.querySelector('canvas');
    if (!canvas) return false;
    const canvasRect = canvas.getBoundingClientRect();
    return canvasRect.width > stageRect.width - 4 && canvasRect.height > stageRect.height - 4;
  });
  expect(canvasFillsMap).toBe(true);
  const markersAreInsideMap = () => page.locator('.kiosk-map-stage').evaluate((stage) => {
    const stageRect = stage.getBoundingClientRect();
    return Array.from(stage.querySelectorAll('[data-testid="kiosk-map-marker"]')).every((marker) => {
      const markerRect = marker.getBoundingClientRect();
      return (
        markerRect.width > 0 &&
        markerRect.height > 0 &&
        markerRect.left >= stageRect.left - 1 &&
        markerRect.right <= stageRect.right + 1 &&
        markerRect.top >= stageRect.top - 1 &&
        markerRect.bottom <= stageRect.bottom + 1
      );
    });
  });
  await expect.poll(markersAreInsideMap).toBe(true);
  const noHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 &&
      document.body.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(noHorizontalOverflow).toBe(true);
  const actionsStayInsidePanel = await page.locator('.kiosk-actions-panel').evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    return Array.from(panel.querySelectorAll('.kiosk-action')).every((action) => {
      const actionRect = action.getBoundingClientRect();
      return (
        actionRect.left >= panelRect.left - 1 &&
        actionRect.right <= panelRect.right + 1 &&
        actionRect.top >= panelRect.top - 1 &&
        actionRect.bottom <= panelRect.bottom + 1
      );
    });
  });
  expect(actionsStayInsidePanel).toBe(true);
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1180, height: 760 });
    await expect(page.getByTestId('kiosk-map-marker')).toHaveCount(locations.length);
    await expect.poll(markersAreInsideMap).toBe(true);
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect.poll(markersAreInsideMap).toBe(true);
  }
  await page.waitForTimeout(800);
  await screenshot(page, testInfo.project.name, '06-kiosk-dashboard');
});

test('captures operator console', async ({ page }, testInfo) => {
  await page.route('**/api/operator/login', (route) => route.fulfill({ json: { token: 'demo-operator-token' } }));
  await page.route('**/api/operator/organizations', (route) =>
    route.fulfill({
      json: {
        organizations: [
          {
            ...workspace,
            active: true,
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-08T00:00:00.000Z',
            onboarding: {
              areaCount: 1,
              locationCount: 1,
              unitCount: 2,
              teamMemberCount: 2,
              organizationAdminConfigured: true,
              readyForCheckins: true,
              lastCheckinAt: '2026-07-08T00:00:00.000Z',
              lastCheckinTeamMemberName: teamMembers[0].name,
              lastCheckinUnitName: units[0].name,
            },
            setupCodes: [],
            setupCodeSummary: { total: 0, activeUnused: 0, used: 0 },
          },
        ],
      },
    }),
  );
  await page.route('**/api/operator/workspace-requests**', (route) =>
    route.fulfill({
      json: {
        requests: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            installation_or_command: 'Demo Request Command',
            preferred_workspace_slug: 'demo-request',
            lead_name: 'CH Request',
            lead_role: 'Command chaplain',
            official_contact_email: 'request@example.mil',
            rmt_size: 4,
            expected_pilot_start_date: '2026-07-20',
            short_use_case: 'Track routine coverage across departments and tenant commands during a controlled demonstration.',
            safe_use_boundaries_confirmed: true,
            no_sensitive_data_acknowledged: true,
            status: 'pending',
            operator_note: null,
            organization_id: null,
            setup_code_id: null,
            approved_at: null,
            rejected_at: null,
            operator_notified_at: '2026-07-08T00:00:00.000Z',
            requestor_notified_at: null,
            operator_notification_status: 'sent',
            requestor_notification_status: null,
            created_at: '2026-07-08T00:00:00.000Z',
            updated_at: '2026-07-08T00:00:00.000Z',
          },
        ],
        page: { limit: 100, offset: 0, returned: 1, total: 1, hasMore: false },
      },
    }),
  );
  await page.route('**/api/operator/audit-events**', (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            organization_id: workspace.id,
            actor: 'central_operator',
            action: 'workspace_created',
            detail: { slug: workspace.slug },
            created_at: '2026-07-08T00:00:00.000Z',
            organization: workspace,
          },
        ],
        page: { limit: 50, offset: 0, returned: 1, total: 1, hasMore: false },
      },
    }),
  );

  await page.goto('/?operator=1');
  await page.getByLabel('Central operator passphrase').fill('demo-operator-passphrase');
  await page.getByRole('button', { name: 'Unlock operator console' }).click();
  await expect(page.getByRole('heading', { name: 'System Administration', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Quality controls/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Approval queue' })).toBeVisible();
  await expect(page.getByText('Demo Request Command')).toBeVisible();
  await screenshot(page, testInfo.project.name, '07-operator-console');
});
