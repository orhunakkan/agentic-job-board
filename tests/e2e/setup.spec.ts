import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { startTestApp, TEST_SOURCES, type TestApp } from '../helpers/test-app.ts';
import { expectNoViolations } from './axe.ts';

// Setup comes first (FR-24) and the profile form (FR-01) in a real browser, on every browser project. Each test
// starts its own empty app in this worker (tests/helpers/test-app.ts), as on a first run, so it never touches the
// shared E2E server, whose profile the other tests need.

let testApp: TestApp;

test.beforeEach(async () => {
  testApp = await startTestApp({ setup: 'none' });
});

test.afterEach(async () => {
  await testApp.close();
});

const open = (page: Page, path: string) => page.goto(`${testApp.url}${path}`);

/** Fills in an accountant's profile on the form, leaving out the fields named in `skip`. */
async function fillAccountant(page: Page, skip: readonly string[] = []): Promise<void> {
  const fields: [string, string][] = [
    ['Your line of work', 'Accounting'],
    ['Job titles you want', 'Senior Accountant\nStaff Accountant'],
    ['Years of experience in this line of work', '6'],
    ['Your main skills, tools or specialties', 'Month-end close\nReconciliations'],
    ['Licenses, certifications or clearances you hold', 'CPA'],
    ['Remote work: the countries or regions you can work remotely from', 'United States'],
    ['Where you can work, and whether you need sponsorship', 'US citizen, no sponsorship needed'],
  ];
  for (const [label, value] of fields) {
    if (!skip.includes(label)) await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel('Your level').selectOption('Senior');
}

test('FR-24, FR-01: an empty board opens on setup; filling in the profile opens the board', async ({ page }) => {
  await open(page, '/');

  await expect(page).toHaveURL(`${testApp.url}/setup`);
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Your profile/ })).toContainText('Not filled in');

  await page.getByRole('link', { name: 'Fill in your profile' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Fill in your profile' })).toBeVisible();
  await fillAccountant(page);
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page.locator('#notice')).toContainText('Your profile is saved.');
  await expect(page.locator('main')).toContainText('Accounting');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Board' }).click();
  await expect(page).toHaveURL(`${testApp.url}/`);
  await expect(page.locator('#setup-notice')).toContainText('Nothing to search yet');
  await expect(page.locator('#setup-notice').getByRole('link', { name: 'Setup' })).toHaveAttribute('href', '/setup');
});

test('FR-01: a wrong entry shows its error next to the field, the summary takes the focus, and the input stays', async ({
  page,
}) => {
  await open(page, '/profile/edit');
  await fillAccountant(page, ['Your line of work']);
  await page.getByLabel('Years of experience in this line of work').fill('61');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const summary = page.locator('#errors');
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Your line of work: Enter your line of work.');
  await expect(summary).toContainText('Years of experience in this line of work: Enter a whole number from 0 to 60.');
  const field = page.getByLabel('Your line of work', { exact: true });
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(/Enter your line of work\./);
  await expect(page.getByLabel('Job titles you want')).toHaveValue('Senior Accountant\nStaff Accountant');
  await expect(page.getByLabel('Your level')).toHaveValue('senior');

  await summary.getByRole('link', { name: /Your line of work/ }).click();
  await expect(field).toBeFocused();
  await field.fill('Accounting');
  await page.getByLabel('Years of experience in this line of work').fill('6');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('#notice')).toContainText('Your profile is saved.');
});

test('FR-01: the profile can be edited later from its page', async ({ page }) => {
  await open(page, '/profile/edit');
  await fillAccountant(page);
  await page.getByRole('button', { name: 'Save profile' }).click();

  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit your profile' })).toBeVisible();
  await expect(page.getByLabel('Your line of work', { exact: true })).toHaveValue('Accounting');
  await page.getByLabel('Cities or areas where you’d work hybrid').fill('Chicago, IL');
  await page.getByLabel('Open to relocating').check();
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page.locator('main')).toContainText('Hybrid: Chicago, IL');
  await expect(page.locator('main')).toContainText('Open to relocation.');
});

test('FR-24, FR-22: Find Now stays off, with its reason, until the view’s own source is there', async ({ page }) => {
  await testApp.call('PUT', '/api/profile', {
    field: 'Accounting',
    summary: '',
    targetRoles: ['Senior Accountant'],
    seniority: 'senior',
    yearsExperience: 6,
    coreSkills: ['Reconciliations'],
    secondarySkills: [],
    credentials: [],
    locations: { remote: ['United States'], hybridAreas: [], onsiteAreas: [], relocate: false },
    workAuthorization: 'US citizen',
    dealBreakers: [],
    excludedCompanies: [],
  });
  const findNow = page.getByRole('button', { name: 'Find Now' });

  await open(page, '/?origin=other');
  await expect(findNow).toBeDisabled();
  await expect(findNow).toHaveAccessibleDescription(/Find Now needs the free job feeds/);
  await page.locator('#find-now-reason').getByRole('link', { name: 'Setup' }).click();
  await expect(page.getByRole('heading', { name: /Free job feeds/ })).toContainText('Not there');

  writeFileSync(testApp.sourcesPath, JSON.stringify(TEST_SOURCES));
  await open(page, '/?origin=other');
  await expect(findNow).toBeEnabled();
  await open(page, '/');
  await expect(findNow).toBeDisabled();
  await expect(findNow).toHaveAccessibleDescription(/Find Now needs your LinkedIn searches/);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`NFR-06: setup and the profile form, empty, filled and with errors, have no axe violations (${scheme})`, async ({
    page,
  }) => {
    // Firefox drops the emulated scheme when the first page sends COOP (DEF-021); set again, it holds.
    await open(page, '/setup');
    await page.emulateMedia({ colorScheme: scheme });
    await expectNoViolations(page);

    await open(page, '/profile/edit');
    await expectNoViolations(page);
    await fillAccountant(page, ['Your line of work']);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.locator('#errors')).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel('Your line of work', { exact: true }).fill('Accounting');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.locator('#notice')).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expectNoViolations(page);
    await open(page, '/setup');
    await expectNoViolations(page);
  });
}
