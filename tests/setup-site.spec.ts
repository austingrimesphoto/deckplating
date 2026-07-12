import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectAccessibleSetupPage(page: import('@playwright/test').Page, testInfo: import('@playwright/test').TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  if (results.violations.length) {
    await testInfo.attach('axe-violations', {
      body: Buffer.from(JSON.stringify(results.violations, null, 2)),
      contentType: 'application/json',
    });
  }
  expect(results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({ target: node.target.join(' '), html: node.html, failureSummary: node.failureSummary })),
  }))).toEqual([]);
}

test('keeps setup and guide views accessible and stable at high zoom', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const widths = testInfo.project.name === 'desktop' ? [640, 320] : [390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/user-guide.html', '/workspace-request-thanks.html?queued=1']) {
      await page.goto(`http://127.0.0.1:4174${path}`);
      await expectAccessibleSetupPage(page, testInfo);
      const layout = await page.evaluate(() => ({
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
        clippedControls: Array.from(document.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'))
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 &&
              (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1);
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { name: element.textContent?.trim() || element.getAttribute('name') || element.tagName, left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
          }),
      }));
      expect(layout).toEqual({ overflow: 0, clippedControls: [] });
    }
  }
});

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
  const fieldFocusOrder = [
    form.getByLabel('Installation or command name'),
    form.getByLabel('Preferred workspace slug, if known'),
    form.getByLabel('Lead name'),
    form.getByLabel('Lead role'),
    form.getByLabel('Administrative contact email'),
    form.getByLabel('RMT size'),
    form.getByLabel('Expected demonstration start date'),
  ];
  const completionFocusOrder = [
    form.getByLabel('Short use case'),
    form.getByLabel(/I understand Deckplating is an unofficial prototype/),
    form.getByLabel(/I understand this form should not include secrets/),
    form.getByRole('button', { name: 'Send Workspace Request' }),
  ];
  await fieldFocusOrder[0].focus();
  for (let index = 0; index < fieldFocusOrder.length; index += 1) {
    await expect(fieldFocusOrder[index]).toBeFocused();
    if (index < fieldFocusOrder.length - 1) await page.keyboard.press('Tab');
  }
  await completionFocusOrder[0].focus();
  for (let index = 0; index < completionFocusOrder.length; index += 1) {
    await expect(completionFocusOrder[index]).toBeFocused();
    if (index < completionFocusOrder.length - 1) await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');

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
