import assert from 'node:assert/strict';
import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import { z } from 'zod';
import type { IncomingListing } from '../../../../src/ingest/listing-ingest.ts';
import {
  IngestListingsResponseSchema,
  JobListResponseSchema,
  RunListResponseSchema,
  RunSummarySchema,
  ScoringQueueResponseSchema,
} from '../../../../src/schemas/api.ts';
import { finishRun, jobDetail, sendListings, startRun, storeScores, type ScoreEntry } from '../../support/board-api.ts';
import { jobRow, jobRows, type JobRow } from '../../support/board-data.ts';
import type { BoardWorld } from '../../support/world.ts';
import { explainedRefusal, lastResponse, refusal } from './answers.ts';

// A /find-jobs run over the JSON API, as the agent and its scripts drive it: start, send listings, store scores,
// finish (FR-06, FR-11, FR-16, FR-18, FR-20, NFR-09).

function openRun(world: BoardWorld): number {
  assert.ok(world.runId !== undefined, 'no run has started');
  return world.runId;
}

/** Sends the listings to the open run and remembers the new jobs by title. */
async function receive(world: BoardWorld, rows: readonly JobRow[]): Promise<void> {
  const app = await world.app();
  world.response = await sendListings(
    app,
    openRun(world),
    rows.map((row) => world.listing(row)),
  );
  assert.equal(world.response.status, 200, world.response.text);
  for (const job of IngestListingsResponseSchema.parse(world.response.body).newJobs) world.remember(job.title, job.id);
}

async function newRun(world: BoardWorld): Promise<void> {
  world.runId = await startRun(await world.app());
}

const feedJobs = (titles: readonly string[]) => titles.map((title) => jobRow({ title, source: 'greenhouse' }));

Given('a run has started', async function (this: BoardWorld) {
  await newRun(this);
});

Given('an earlier run received {titles}', async function (this: BoardWorld, titles: string[]) {
  await newRun(this);
  await receive(this, feedJobs(titles));
  await finishRun(await this.app(), openRun(this));
});

Given('an earlier run received the LinkedIn job {string}', async function (this: BoardWorld, title: string) {
  await newRun(this);
  await receive(this, [jobRow({ title })]);
  await finishRun(await this.app(), openRun(this));
});

Given(
  /^(?:an earlier|a later) run received the LinkedIn job "([^"]+)" from the search "([^"]+)"$/,
  async function (this: BoardWorld, title: string, searchName: string) {
    await newRun(this);
    const listing = this.listing(jobRow({ title }));
    this.listings.set(title, { ...listing, searchName });
    await receive(this, [jobRow({ title })]);
    await finishRun(await this.app(), openRun(this));
  },
);

When('a later run receives {titles}', async function (this: BoardWorld, titles: string[]) {
  await newRun(this);
  await receive(this, feedJobs(titles));
});

When('a later run receives the LinkedIn job {string}', async function (this: BoardWorld, title: string) {
  await newRun(this);
  await receive(this, [jobRow({ title })]);
});

Given('the run received these jobs:', async function (this: BoardWorld, table: DataTable) {
  const rows = jobRows(table);
  await receive(this, rows);
  const response = await storeScores(
    await this.app(),
    openRun(this),
    'triage-v2',
    rows.flatMap((row) => (row.score === null ? [] : [{ jobId: this.jobId(row.title), score: row.score }])),
  );
  assert.equal(response.status, 200, response.text);
});

When('the run is sent {int} listings at once', async function (this: BoardWorld, count: number) {
  const listings = Array.from({ length: count }, (_, index) =>
    this.listing(jobRow({ title: `Dispatcher ${String(index)}` })),
  );
  this.response = await sendListings(await this.app(), openRun(this), listings);
});

When('the run is sent a listing without a title', async function (this: BoardWorld) {
  const listing = Object.fromEntries(
    Object.entries(this.listing(jobRow({ title: 'Senior Dispatcher' }))).filter(([field]) => field !== 'title'),
  );
  this.response = await sendListings(await this.app(), openRun(this), [listing as unknown as IncomingListing]);
});

Then(
  'the run is told it received {int} listing(s): {int} new and {int} seen again',
  function (this: BoardWorld, received: number, fresh: number, seenAgain: number) {
    const answer = IngestListingsResponseSchema.parse(lastResponse(this).body);
    assert.deepEqual([answer.received, answer.new, answer.seenAgain], [received, fresh, seenAgain]);
  },
);

Then('the new job it is told about is {string}', function (this: BoardWorld, title: string) {
  const { newJobs } = IngestListingsResponseSchema.parse(lastResponse(this).body);
  assert.deepEqual(
    newJobs.map((job) => job.title),
    [title],
  );
});

Then('the listings/scores are refused with an explanation', function (this: BoardWorld) {
  explainedRefusal(this);
});

Then('the board has no jobs', async function (this: BoardWorld) {
  assert.equal(JobListResponseSchema.parse((await (await this.app()).get('/api/jobs')).body).total, 0);
});

// --- Scores (FR-06, FR-20) ---

async function score(world: BoardWorld, rubric: string, entries: readonly ScoreEntry[]): Promise<void> {
  await newRun(world);
  world.response = await storeScores(await world.app(), openRun(world), rubric, entries);
}

When(
  'a run scores {string} {int} with {word}, because {string}',
  async function (this: BoardWorld, title: string, value: number, rubric: string, reason: string) {
    await score(this, rubric, [{ jobId: this.jobId(title), score: value, reason }]);
  },
);

When(
  'a run scores {string} {int} but labels it {word}',
  async function (this: BoardWorld, title: string, value: number, label: string) {
    await score(this, 'match-v2', [{ jobId: this.jobId(title), score: value, label: label.toLowerCase() }]);
  },
);

When("a run scores {string} and a job that doesn't exist", async function (this: BoardWorld, title: string) {
  await score(this, 'match-v2', [
    { jobId: this.jobId(title), score: 80 },
    { jobId: 999999, score: 70 },
  ]);
});

Then('the scores are stored', function (this: BoardWorld) {
  const response = lastResponse(this);
  assert.equal(response.status, 200, response.text);
});

Then("the scores are refused, naming the job that doesn't exist", function (this: BoardWorld) {
  assert.deepEqual(refusal(this, 400, 'unknown_jobs'), { jobIds: [999999] });
});

Then(
  '{string} has the score {int}, labelled {word}, because {string}',
  async function (this: BoardWorld, title: string, value: number, label: string, reason: string) {
    const job = await jobDetail(await this.app(), this.jobId(title));
    assert.deepEqual([job.score, job.scoreLabel, job.scoreReason], [value, label.toLowerCase(), reason]);
  },
);

Then('{string} was scored with {word}', async function (this: BoardWorld, title: string, rubric: string) {
  assert.equal((await jobDetail(await this.app(), this.jobId(title))).rubricVersion, rubric);
});

Then('{string} is still unscored', async function (this: BoardWorld, title: string) {
  const job = await jobDetail(await this.app(), this.jobId(title));
  assert.deepEqual([job.score, job.scoreLabel, job.rubricVersion], [null, null, null]);
});

When('I ask which jobs need a score', async function (this: BoardWorld) {
  this.response = await (await this.app()).get('/api/scoring/queue');
});

Then('the queue holds:', function (this: BoardWorld, table: DataTable) {
  const { items } = ScoringQueueResponseSchema.parse(lastResponse(this).body);
  // Strict, so a column this step doesn't check fails instead of passing unread.
  const expected = z.array(z.strictObject({ job: z.string(), rubric: z.string() })).parse(table.hashes());
  assert.deepEqual(
    items.map((item) => ({ job: item.title, rubric: item.rubric })).toSorted((a, b) => a.job.localeCompare(b.job)),
    expected.toSorted((a, b) => a.job.localeCompare(b.job)),
  );
});

// --- Run history (FR-11) ---

When('the run finishes', async function (this: BoardWorld) {
  this.response = await finishRun(await this.app(), openRun(this));
});

Then(
  'the run reports {int} listings received, {int} new jobs, {int} seen again and {int} scored',
  function (this: BoardWorld, listings: number, fresh: number, seenAgain: number, scored: number) {
    const run = RunSummarySchema.parse(lastResponse(this).body);
    assert.ok(run.finishedAt !== null, 'the run has not finished');
    assert.deepEqual(
      [run.listingsSeen, run.jobsNew, run.jobsSeenAgain, run.jobsScored],
      [listings, fresh, seenAgain, scored],
    );
  },
);

Then('its top new jobs are {titles}, in that order', function (this: BoardWorld, titles: string[]) {
  const run = RunSummarySchema.parse(lastResponse(this).body);
  assert.deepEqual(
    run.topNewJobs.map((job) => job.title),
    titles,
  );
});

Then('the run history lists it first', async function (this: BoardWorld) {
  const runs = RunListResponseSchema.parse((await (await this.app()).get('/api/runs')).body);
  assert.ok(runs.length > 1, 'the scenario has only one run');
  assert.equal(runs[0]?.id, openRun(this));
});
