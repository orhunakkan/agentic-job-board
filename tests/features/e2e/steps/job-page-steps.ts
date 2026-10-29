import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { Status } from '../../../../src/domain/status.ts';
import { jobDetail } from '../../support/board-api.ts';
import type { BoardWorld } from '../../support/world.ts';
import { open, submit } from './navigate.ts';

// A job's own page in a browser: its status form and history, and its notes (FR-08 to FR-10).

When('I open {string}', async function (this: BoardWorld, title: string) {
  this.current = title;
  await open(this, `/jobs/${String(this.jobId(title))}`);
});

When('I open {string} from its card', async function (this: BoardWorld, title: string) {
  this.current = title;
  await this.page.getByRole('link', { name: title, exact: true }).click();
});

When('I change its status to {status}', async function (this: BoardWorld, status: Status) {
  await this.page.getByLabel('Change to').selectOption(status);
  await submit(this, this.page.getByRole('button', { name: 'Update' }));
});

Then('its page offers {titles}', async function (this: BoardWorld, statuses: string[]) {
  await expect(this.page.getByLabel('Change to').locator('option')).toHaveText(statuses);
});

Then('its page explains {string}', async function (this: BoardWorld, text: string) {
  await expect(this.page.getByText(text, { exact: true })).toBeVisible();
});

Then('its page offers no other status', async function (this: BoardWorld) {
  await expect(this.page.getByLabel('Change to')).toHaveCount(0);
});

Then('its status history reads {titles}', async function (this: BoardWorld, changes: string[]) {
  const history = this.page.getByRole('region', { name: 'Status history' }).getByRole('listitem');
  await expect(history).toHaveCount(changes.length);
  for (const [index, change] of changes.entries()) await expect(history.nth(index)).toContainText(change);
});

When('I save these notes:', async function (this: BoardWorld, notes: string) {
  await this.page.getByRole('textbox', { name: 'Notes' }).fill(notes);
  await submit(this, this.page.getByRole('button', { name: 'Save notes' }));
});

When('I reload the page', async function (this: BoardWorld) {
  await this.page.reload();
});

Then('the notes read:', async function (this: BoardWorld, notes: string) {
  await expect(this.page.getByRole('textbox', { name: 'Notes' })).toHaveValue(notes);
});

Then(
  'I see the page of {string} with its score and the reason for it',
  async function (this: BoardWorld, title: string) {
    const job = await jobDetail(await this.app(), this.jobId(title));
    await expect(this.page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(this.page.locator('.score-value').first()).toHaveText(String(job.score));
    await expect(this.page.getByText(`Reason: ${job.scoreReason ?? ''}`)).toBeVisible();
  },
);
