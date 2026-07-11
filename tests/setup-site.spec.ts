import { expect, test } from '@playwright/test';

test('workspace request submits the documented payload and reaches confirmation', async ({ page }) => {
  let submittedBody: Record<string, unknown> | null = null;
  await page.route('https://deckplating.netlify.app/api/workspace-requests', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
      return;
    }
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      headers: { 'access-control-allow-origin': '*' },
      json: { request: { id: 'request-id' } },
    });
  });

  await page.goto('http://127.0.0.1:4174/#request');
  const form = page.locator('#workspace-request-form');
  await form.getByLabel('Installation or command name').fill('Demo Command');
  await form.getByLabel('Preferred workspace slug, if known').fill('demo-command');
  await form.getByLabel('Lead name').fill('CH Example');
  await form.getByLabel('Lead role').fill('Command chaplain');
  await form.getByLabel('Administrative contact email').fill('admin@example.mil');
  await form.getByLabel('RMT size').fill('3');
  await form.getByLabel('Expected demonstration start date').fill('2026-08-01');
  await form.getByLabel('Short use case').fill('Evaluate routine non-sensitive coverage workflows.');
  await form.getByLabel(/I understand Deckplating is an unofficial prototype/).check();
  await form.getByLabel(/I understand this form should not include secrets/).check();
  await form.getByRole('button', { name: 'Send Workspace Request' }).click();

  await expect(page).toHaveURL(/workspace-request-thanks\.html\?queued=1$/);
  await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
  expect(submittedBody).toMatchObject({
    installation_or_command: 'Demo Command',
    preferred_workspace_slug: 'demo-command',
    official_contact_email: 'admin@example.mil',
    rmt_size: '3',
    safe_use_boundaries_confirmed: 'on',
    no_sensitive_data_acknowledged: 'on',
  });
  expect(submittedBody).not.toHaveProperty('form-name');
  expect(submittedBody).not.toHaveProperty('bot-field');
});
