import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { Origin } from '../../../../src/domain/job-source.ts';
import { HealthResponseSchema } from '../../../../src/schemas/api.ts';
import { ORIGIN_LABELS } from '../../../../src/ui/format.ts';
import { fakeClaudeCommand, findNowLogPath } from '../../../helpers/fake-claude.ts';
import type { BoardWorld } from '../../support/world.ts';
import { submit } from './navigate.ts';

// Clear All (FR-21) and Find Now (FR-22) in a browser, and the smoke checks (NFR-01, FR-07, FR-11). Find Now runs
// tests/helpers/fake-claude.ts in place of Claude Code.

When('I press Clear All', async function (this: BoardWorld) {
  await this.page.locator('summary', { hasText: 'Clear All' }).click();
});

Then('the board asks {string}', async function (this: BoardWorld, question: string) {
  await expect(this.page.locator('.clear-all-form p')).toHaveText(question);
});

When('I confirm with {string}', async function (this: BoardWorld, button: string) {
  await submit(this, this.page.getByRole('button', { name: button, exact: true }));
});

Then('the New tab is empty', async function (this: BoardWorld) {
  await expect(this.page.locator('.card-title')).toHaveCount(0);
  await expect(this.page.getByText(/^\s*No new jobs\./)).toBeVisible();
});

Given('a Find Now run takes a few seconds', function (this: BoardWorld) {
  assert.ok(!this.appStarted, "Find Now's stand-in must be set before the app starts");
  this.claudeCommand = fakeClaudeCommand(8000);
});

When('I press Find Now', async function (this: BoardWorld) {
  await submit(this, this.page.getByRole('button', { name: 'Find Now' }));
});

Then('the board says Find Now is running for {view}', async function (this: BoardWorld, view: Origin) {
  await expect(this.page.locator('#find-now')).toContainText(`Find Now is running for ${ORIGIN_LABELS[view]} since`);
});

Then('Find Now is disabled', async function (this: BoardWorld) {
  await expect(this.page.getByRole('button', { name: 'Find Now' })).toBeDisabled();
});

Then('Find Now is enabled', async function (this: BoardWorld) {
  await expect(this.page.getByRole('button', { name: 'Find Now' })).toBeEnabled();
});

When('the run has ended', async function (this: BoardWorld) {
  // The board doesn't refresh itself; the owner reloads it, as its Find Now line says.
  await expect(async () => {
    await this.page.reload();
    await expect(this.page.locator('#find-now')).not.toHaveAttribute('data-outcome', 'running', { timeout: 500 });
  }).toPass({ timeout: 15_000 });
});

Then('the board says Find Now for {view} finished, and names its log', async function (this: BoardWorld, view: Origin) {
  const line = this.page.locator('#find-now');
  await expect(line).toContainText(`Find Now for ${ORIGIN_LABELS[view]} finished at`);
  await expect(line.locator('code')).toHaveText(findNowLogPath((await this.app()).dbPath, view));
});

// --- Smoke ---

When('I ask the app whether it is healthy', async function (this: BoardWorld) {
  const response = await this.page.request.get(new URL('/api/health', (await this.app()).url).href);
  this.response = {
    status: response.status(),
    headers: new Headers(response.headers()),
    text: await response.text(),
    body: await response.json(),
  };
});

Then('it answers on the loopback address and reports itself and its database as ok', async function (this: BoardWorld) {
  assert.match((await this.app()).url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(this.response?.status, 200);
  const health = HealthResponseSchema.parse(this.response.body);
  assert.deepEqual([health.status, health.db], ['ok', 'ok']);
});

Then('I see the board with the tabs {titles}', async function (this: BoardWorld, tabs: string[]) {
  await expect(this.page).toHaveTitle('Board · Job Board');
  await expect(this.page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
  await expect(this.page.getByRole('navigation', { name: 'Board tabs' }).getByRole('link')).toHaveText(
    tabs.map((tab) => new RegExp(`^\\s*${tab}\\s+\\d+\\s*$`)),
  );
});

When('I go to Runs', async function (this: BoardWorld) {
  await this.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Runs' }).click();
});

Then('I see the list of runs, with {int} run(s)', async function (this: BoardWorld, count: number) {
  await expect(this.page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
  const runs = this.page.getByRole('table', { name: 'Every /find-jobs run, newest first' });
  await expect(runs.locator('tbody tr')).toHaveCount(count);
});
