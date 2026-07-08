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

const units = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Engineering Department',
    unit_type: 'department',
    visit_interval_days: 30,
    active: true,
    location_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    location_name: 'Pier Admin',
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: 24.57,
    longitude: -81.78,
    radius_meters: 120,
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
    location_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    location_name: 'Pier Admin',
    area_id: areas[0].id,
    area_name: areas[0].name,
    latitude: 24.57,
    longitude: -81.78,
    radius_meters: 120,
    last_visit_at: new Date().toISOString(),
    last_visitor: 'CH Doe',
    days_since_last_visit: 0,
    status: 'green',
  },
];

async function mockAppApi(page: import('@playwright/test').Page) {
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
        mapTileUrl: '',
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
        matches: [
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            area_id: areas[0].id,
            area_name: areas[0].name,
            name: 'Pier Admin',
            latitude: 24.57,
            longitude: -81.78,
            radius_meters: 120,
            distance_meters: 12,
            status: 'gray',
            units,
          },
        ],
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
          locationCount: 1,
          unitCount: 2,
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
        locations: [
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            name: 'Pier Admin',
            area_id: areas[0].id,
            latitude: 24.57,
            longitude: -81.78,
            radius_meters: 120,
            active: true,
          },
        ],
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
  await screenshot(page, testInfo.project.name, '05-admin-release-note');
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
  await screenshot(page, testInfo.project.name, '06-operator-console');
});
