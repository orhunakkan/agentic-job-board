import assert from 'node:assert/strict';
import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import type { Tab } from '../../../../src/domain/board-tabs.ts';
import type { Origin } from '../../../../src/domain/job-source.ts';
import type { Status } from '../../../../src/domain/status.ts';
import { JobDetailSchema, JobListResponseSchema } from '../../../../src/schemas/api.ts';
import { changeStatus, jobDetail, putOnBoard } from '../../support/board-api.ts';
import { jobRow, jobRows } from '../../support/board-data.ts';
import { statusNamed } from '../../support/parameter-types.ts';
import type { BoardWorld } from '../../support/world.ts';
import { lastResponse, refusal } from './answers.ts';

// The board's jobs over the JSON API: putting them on the board, listing them, changing their status and notes, and
// reading their details (FR-07 to FR-10, FR-17).

Given('the board has these jobs:', async function (this: BoardWorld, table: DataTable) {
  await putOnBoard(this, jobRows(table));
});

Given('the board has a job {string}', async function (this: BoardWorld, title: string) {
  await putOnBoard(this, [jobRow({ title })]);
});

Given('a job is {status}', async function (this: BoardWorld, status: Status) {
  await putOnBoard(this, [jobRow({ title: 'Senior SDET', status })]);
});

Given('I saved {string}', async function (this: BoardWorld, title: string) {
  const response = await changeStatus(await this.app(), this.jobId(title), 'saved');
  assert.equal(response.status, 200, response.text);
});

When('I change it to {status}', async function (this: BoardWorld, to: Status) {
  this.response = await changeStatus(await this.app(), this.theJob(), to);
});

Then('the change succeeds', function (this: BoardWorld) {
  const response = lastResponse(this);
  assert.equal(response.status, 200, response.text);
});

Then('the change is refused as not allowed', function (this: BoardWorld) {
  refusal(this, 409, 'invalid_transition');
});

Then('the job is (still ){status}', async function (this: BoardWorld, status: Status) {
  assert.equal((await jobDetail(await this.app(), this.theJob())).status, status);
});

// --- Notes (FR-09) ---

async function writeNote(world: BoardWorld, title: string, notes: string): Promise<void> {
  world.current = title;
  world.note = notes;
  world.response = await (await world.app()).call('PATCH', `/api/jobs/${String(world.jobId(title))}`, { notes });
}

When('I write the note {string} on {string}', async function (this: BoardWorld, notes: string, title: string) {
  await writeNote(this, title, notes);
});

When(
  'I write a note of {count} characters on {string}',
  async function (this: BoardWorld, length: number, title: string) {
    await writeNote(this, title, 'n'.repeat(length));
  },
);

Then('the note is saved', async function (this: BoardWorld) {
  const response = lastResponse(this);
  assert.equal(response.status, 200, response.text);
  // The whole note, as the scenario wrote it: none of it cut off.
  assert.equal(JobDetailSchema.parse(response.body).notes, this.note);
  assert.equal((await jobDetail(await this.app(), this.theJob())).notes, this.note);
});

Then('the note is refused', async function (this: BoardWorld) {
  refusal(this, 400, 'validation_failed');
  assert.equal((await jobDetail(await this.app(), this.theJob())).notes, '');
});

Then('{string} shows the note {string}', async function (this: BoardWorld, title: string, notes: string) {
  const app = await this.app();
  assert.equal((await jobDetail(app, this.jobId(title))).notes, notes);
  const page = await app.get(`/jobs/${String(this.jobId(title))}`);
  assert.ok(page.text.includes(`\n${notes}</textarea>`), 'the job page does not show the note');
});

// --- Details (FR-10) ---

When('I look at {string}', async function (this: BoardWorld, title: string) {
  this.current = title;
  this.response = await (await this.app()).get(`/api/jobs/${String(this.jobId(title))}`);
});

When("I look at a job that doesn't exist", async function (this: BoardWorld) {
  this.response = await (await this.app()).get('/api/jobs/999999');
});

function lookedAt(world: BoardWorld) {
  const response = lastResponse(world);
  assert.equal(response.status, 200, response.text);
  return JobDetailSchema.parse(response.body);
}

Then('it has {int} sighting(s), by the searches {titles}', function (this: BoardWorld, count: number, names: string[]) {
  const { listingSightings } = lookedAt(this);
  assert.equal(listingSightings.length, count);
  assert.deepEqual(
    listingSightings.map((sighting) => sighting.searchName),
    names,
  );
});

Then('its status history is:', function (this: BoardWorld, table: DataTable) {
  const expected = table.hashes().map((row) => ({
    fromStatus: row['from'] === '' || row['from'] === undefined ? null : statusNamed(row['from']),
    toStatus: statusNamed(row['to'] ?? ''),
  }));
  assert.deepEqual(
    lookedAt(this).history.map(({ fromStatus, toStatus }) => ({ fromStatus, toStatus })),
    expected,
  );
});

Then('the job is not found', function (this: BoardWorld) {
  refusal(this, 404, 'not_found');
});

// --- The job list (FR-07, FR-17) ---

async function list(world: BoardWorld, tab: Tab, view: Origin, query: Record<string, string> = {}): Promise<void> {
  const params = new URLSearchParams({ origin: view, tab, ...query });
  world.response = await (await world.app()).get(`/api/jobs?${params.toString()}`);
}

function listed(world: BoardWorld): string[] {
  const response = lastResponse(world);
  assert.equal(response.status, 200, response.text);
  return JobListResponseSchema.parse(response.body).items.map((job) => job.title);
}

When('I list the {tab} tab of the {view} view', async function (this: BoardWorld, tab: Tab, view: Origin) {
  await list(this, tab, view);
});

When(
  'I list the {tab} tab of the {view} view with a minimum score of {int}',
  async function (this: BoardWorld, tab: Tab, view: Origin, minScore: number) {
    await list(this, tab, view, { minScore: String(minScore) });
  },
);

When(
  'I list the {tab} tab of the {view} view, searching for {string}',
  async function (this: BoardWorld, tab: Tab, view: Origin, q: string) {
    await list(this, tab, view, { q });
  },
);

When(
  'I list the {tab} tab of the {view} view, newest first',
  async function (this: BoardWorld, tab: Tab, view: Origin) {
    await list(this, tab, view, { sort: 'recent' });
  },
);

Then('the list is {titles}, in that order', function (this: BoardWorld, titles: string[]) {
  assert.deepEqual(listed(this), titles);
});

Then('the list is {titles}', function (this: BoardWorld, titles: string[]) {
  assert.deepEqual(listed(this).toSorted(), titles.toSorted());
});

Then('the {tab} tab of the {view} view is empty', async function (this: BoardWorld, tab: Tab, view: Origin) {
  await list(this, tab, view);
  assert.deepEqual(listed(this), []);
});

Then(
  'the {tab} tab of the {view} view lists {titles}',
  async function (this: BoardWorld, tab: Tab, view: Origin, titles: string[]) {
    await list(this, tab, view);
    assert.deepEqual(listed(this).toSorted(), titles.toSorted());
  },
);
