import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Given, Then, When } from '@cucumber/cucumber';
import type { Origin } from '../../../../src/domain/job-source.ts';
import { HealthResponseSchema } from '../../../../src/schemas/api.ts';
import { ORIGIN_LABELS } from '../../../../src/ui/format.ts';
import { fakeClaudeCommand, findNowLogPath } from '../../../helpers/fake-claude.ts';
import type { BoardWorld } from '../../support/world.ts';
import { lastResponse, textOf } from './answers.ts';

// The board's two buttons as the browser posts them, Clear All (FR-21) and Find Now (FR-22), and the app's health
// (NFR-01). Find Now runs tests/helpers/fake-claude.ts in place of Claude Code.

async function press(world: BoardWorld, button: 'clear' | 'find', view: Origin): Promise<void> {
  world.response = await (await world.app()).form(`/board/${button}`, { origin: view });
  assert.equal(world.response.status, 303, world.response.text);
}

Given('I pressed Clear All on the {view} view', async function (this: BoardWorld, view: Origin) {
  await press(this, 'clear', view);
});

When('I press Clear All on the {view} view', async function (this: BoardWorld, view: Origin) {
  await press(this, 'clear', view);
});

Then('the board says {string}', async function (this: BoardWorld, message: string) {
  // Where the form sent the browser: the view's New tab, with the notice.
  const location = lastResponse(this).headers.get('location');
  assert.ok(location !== null, 'the form did not lead back to the board');
  const page = await (await this.app()).get(location);
  assert.equal(textOf(page.text, 'notice'), message);
});

// --- Find Now ---

function beforeTheAppStarts(world: BoardWorld): void {
  assert.ok(!world.appStarted, "Find Now's stand-in must be set before the app starts");
}

Given('a Find Now run takes a moment', function (this: BoardWorld) {
  beforeTheAppStarts(this);
  this.claudeCommand = fakeClaudeCommand(1500);
});

Given('the next Find Now run will fail with exit code {int}', function (this: BoardWorld, exitCode: number) {
  beforeTheAppStarts(this);
  this.claudeCommand = fakeClaudeCommand(0, exitCode);
});

When('I press Find Now on the {view} view', async function (this: BoardWorld, view: Origin) {
  await press(this, 'find', view);
});

async function findNowLine(world: BoardWorld): Promise<{ text: string; running: boolean }> {
  const board = (await (await world.app()).get('/')).text;
  return { text: textOf(board, 'find-now'), running: board.includes('data-outcome="running"') };
}

/** The Find Now line once the run has ended (the stand-in ends within seconds). */
async function endedLine(world: BoardWorld): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const line = await findNowLine(world);
    if (!line.running) return line.text;
    assert.ok(Date.now() < deadline, 'the Find Now run did not end');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

Then('the board says Find Now is running for {view}', async function (this: BoardWorld, view: Origin) {
  const line = await findNowLine(this);
  assert.ok(line.running, `Find Now is not running: ${line.text}`);
  assert.ok(line.text.startsWith(`Find Now is running for ${ORIGIN_LABELS[view]} since`), line.text);
});

Then(
  'when the run ends, the board says Find Now for {view} finished, and names its log',
  async function (this: BoardWorld, view: Origin) {
    const app = await this.app();
    const line = await endedLine(this);
    assert.ok(line.startsWith(`Find Now for ${ORIGIN_LABELS[view]} finished at`), line);
    assert.ok(line.includes(findNowLogPath(app.dbPath, view)), line);
  },
);

Then(
  'when the run ends, the board says Find Now for {view} stopped: exit code {int}',
  async function (this: BoardWorld, view: Origin, exitCode: number) {
    const line = await endedLine(this);
    assert.match(
      line,
      new RegExp(`^Find Now for ${ORIGIN_LABELS[view]} stopped at .+: exit code ${String(exitCode)}\\.`),
    );
  },
);

Then('only one run was started', async function (this: BoardWorld) {
  const { logs } = await this.app();
  assert.equal(logs.filter((line) => line.includes('find now started')).length, 1);
});

// --- Health (NFR-01) ---

When('I ask the app whether it is healthy', async function (this: BoardWorld) {
  this.response = await (await this.app()).get('/api/health');
});

Then('it answers on the loopback address only', async function (this: BoardWorld) {
  const { app, url } = await this.app();
  assert.equal((app.server.address() as AddressInfo).address, '127.0.0.1');
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

Then('it reports itself and its database as ok', function (this: BoardWorld) {
  const response = lastResponse(this);
  assert.equal(response.status, 200, response.text);
  const health = HealthResponseSchema.parse(response.body);
  assert.deepEqual([health.status, health.db], ['ok', 'ok']);
});
