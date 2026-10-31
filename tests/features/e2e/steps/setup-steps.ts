import { readFileSync, writeFileSync } from 'node:fs';
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { ProfileSchema, type Profile } from '../../../../src/schemas/profile.ts';
import { TEST_SOURCES } from '../../../helpers/test-app.ts';
import type { BoardWorld } from '../../support/world.ts';
import { open, submit } from './navigate.ts';

// Setup comes first (FR-24) and the profile form (FR-01) in a browser, with the same labels as tests/e2e/setup.spec.ts.
// The ICU nurse is the sample profile of the scoring rubric's calibration set (tests/fixtures/calibration/).

const NURSE: Profile = ProfileSchema.parse(
  (
    JSON.parse(readFileSync(new URL('../../../fixtures/calibration/calibration.json', import.meta.url), 'utf8')) as {
      profiles: Record<string, unknown>;
    }
  ).profiles['icu-nurse'],
);

const LINE_OF_WORK = 'Your line of work';

/** The form's labels and what the nurse types into each; lists one item per line. */
const NURSE_FORM: readonly [string, string][] = [
  [LINE_OF_WORK, NURSE.field],
  ['Job titles you want', NURSE.targetRoles.join('\n')],
  ['Years of experience in this line of work', String(NURSE.yearsExperience)],
  ['Your main skills, tools or specialties', NURSE.coreSkills.join('\n')],
  ['Licenses, certifications or clearances you hold', NURSE.credentials.join('\n')],
  ['Cities or areas where you’d work on-site', NURSE.locations.onsiteAreas.join('\n')],
  ['Where you can work, and whether you need sponsorship', NURSE.workAuthorization],
];

async function fillInNurse(world: BoardWorld, leaveOut: string | null): Promise<void> {
  for (const [label, value] of NURSE_FORM) {
    if (label !== leaveOut) await world.page.getByLabel(label, { exact: true }).fill(value);
  }
  await world.page.getByLabel('Your level').selectOption('Senior');
  await submit(world, world.page.getByRole('button', { name: 'Save profile' }));
}

function setupItem(world: BoardWorld, name: string) {
  return world.page.getByRole('heading', { level: 2, name: new RegExp(name) });
}

function findNow(world: BoardWorld) {
  return world.page.getByRole('button', { name: 'Find Now' });
}

Given('the board has never been set up', function (this: BoardWorld) {
  this.setup = 'none';
});

Given('I have filled in my profile as an ICU nurse', async function (this: BoardWorld) {
  const response = await (await this.app()).call('PUT', '/api/profile', NURSE);
  expect(response.status).toBe(200);
});

Given('my free job feeds are ready', async function (this: BoardWorld) {
  writeFileSync((await this.app()).sourcesPath, JSON.stringify(TEST_SOURCES));
});

When('I fill in my profile as an ICU nurse', async function (this: BoardWorld) {
  await this.page.getByRole('link', { name: 'Fill in your profile' }).click();
  await fillInNurse(this, null);
});

When('I fill in my profile as an ICU nurse, but leave out my line of work', async function (this: BoardWorld) {
  await open(this, '/profile/edit');
  await fillInNurse(this, LINE_OF_WORK);
});

When(
  "I edit my profile and add {string} as an area where I'd work on-site",
  async function (this: BoardWorld, area: string) {
    await open(this, '/profile');
    await this.page.getByRole('link', { name: 'Edit', exact: true }).click();
    const areas = this.page.getByLabel('Cities or areas where you’d work on-site');
    await areas.fill(`${await areas.inputValue()}\n${area}`);
    await submit(this, this.page.getByRole('button', { name: 'Save profile' }));
  },
);

Then('I see the setup checklist', async function (this: BoardWorld) {
  await expect(this.page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
});

Then('my profile reads {string} there', async function (this: BoardWorld, status: string) {
  await expect(setupItem(this, 'Your profile')).toContainText(status);
});

Then('the LinkedIn searches read {string} there', async function (this: BoardWorld, status: string) {
  await expect(setupItem(this, 'LinkedIn searches')).toContainText(status);
});

Then('the free job feeds read {string} there', async function (this: BoardWorld, status: string) {
  await expect(setupItem(this, 'Free job feeds')).toContainText(status);
});

Then('the board says there is nothing to search yet', async function (this: BoardWorld) {
  await expect(this.page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
  await expect(this.page.locator('#setup-notice')).toContainText('Nothing to search yet');
});

Then('Find Now is off, because it needs my LinkedIn searches', async function (this: BoardWorld) {
  await expect(findNow(this)).toBeDisabled();
  await expect(findNow(this)).toHaveAccessibleDescription(/Find Now needs your LinkedIn searches/);
});

Then('Find Now is on', async function (this: BoardWorld) {
  await expect(findNow(this)).toBeEnabled();
});

Then('my profile is saved, with {string} as my line of work', async function (this: BoardWorld, lineOfWork: string) {
  await expect(this.page.locator('#notice')).toContainText('Your profile is saved.');
  await expect(this.page.locator('main')).toContainText(lineOfWork);
});

Then('I see the board', async function (this: BoardWorld) {
  await expect(this.page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
});

Then('the form says {string} next to my line of work', async function (this: BoardWorld, error: string) {
  const field = this.page.getByLabel(LINE_OF_WORK, { exact: true });
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(new RegExp(error.replace('.', '\\.')));
});

Then(
  'the job titles I want still read {string} and {string}',
  async function (this: BoardWorld, first: string, second: string) {
    await expect(this.page.getByLabel('Job titles you want')).toHaveValue(`${first}\n${second}`);
  },
);

Then('my profile shows {string}', async function (this: BoardWorld, text: string) {
  await expect(this.page.locator('main')).toContainText(text);
});
