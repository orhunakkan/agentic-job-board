import assert from 'node:assert/strict';
import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import { z } from 'zod';
import type { IncomingListing } from '../../../../src/ingest/listing-ingest.ts';
import { ingestListings } from '../../../../src/ingest/listing-ingest.ts';
import { countRows, seedEmailYearsJob } from '../../../integration/helpers/test-database.ts';
import { jobRow } from '../../support/board-data.ts';
import type { BoardWorld } from '../../support/world.ts';
import { JOB_SQL, JobRowSql, sqlRow, sqlRows } from './sql.ts';

// Runs and the listings they receive, through the ingest service on a temporary database (FR-11, FR-16, FR-18).

function startRun(world: BoardWorld): number {
  world.runId = world.database.repos.runs.create(world.clock());
  return world.runId;
}

function openRun(world: BoardWorld): number {
  assert.ok(world.runId !== undefined, 'no run has started');
  return world.runId;
}

/** Sends the listings to the open run, as the scripts do, and remembers each job by its title. */
export function receive(world: BoardWorld, listings: readonly IncomingListing[]): void {
  const { db, repos } = world.database;
  ingestListings(db, repos, openRun(world), listings, world.clock);
  for (const listing of listings) {
    const id = repos.jobs.findId(listing.source, listing.sourceJobId);
    assert.ok(id !== null, `"${listing.title}" was not stored`);
    world.remember(listing.title, id);
  }
}

/** A job from the free feeds, or the listing the scenario already sent under that title. */
function feedListings(world: BoardWorld, titles: readonly string[]): IncomingListing[] {
  return titles.map((title) => world.listing(jobRow({ title, source: 'greenhouse' })));
}

Given('an earlier run received {titles}', function (this: BoardWorld, titles: string[]) {
  startRun(this);
  receive(this, feedListings(this, titles));
  this.database.repos.runs.finish(openRun(this), this.clock());
});

When('a (later )run receives {titles}', function (this: BoardWorld, titles: string[]) {
  startRun(this);
  receive(this, feedListings(this, titles));
});

When('a run receives {string} twice', function (this: BoardWorld, title: string) {
  startRun(this);
  const [listing] = feedListings(this, [title]);
  assert.ok(listing);
  receive(this, [listing, listing]);
});

When('a run receives a Greenhouse listing and a Lever listing with the same job ID', function (this: BoardWorld) {
  startRun(this);
  receive(this, [
    { ...this.listing(jobRow({ title: 'Greenhouse SDET', source: 'greenhouse' })), sourceJobId: '5550001' },
    { ...this.listing(jobRow({ title: 'Lever SDET', source: 'lever' })), sourceJobId: '5550001' },
  ]);
});

Given('the board has the LinkedIn job {string} from an alert email', function (this: BoardWorld, title: string) {
  const { db } = this.database;
  const id = seedEmailYearsJob(db);
  const stored = sqlRow(db, z.object({ title: z.string() }), 'SELECT title FROM jobs WHERE id = ?', id);
  assert.equal(stored.title, title);
  this.remember(title, id);
});

When('a LinkedIn search finds {string} again', function (this: BoardWorld, title: string) {
  const { db } = this.database;
  const { sourceJobId } = sqlRow(
    db,
    z.object({ sourceJobId: z.string() }),
    'SELECT source_job_id AS sourceJobId FROM jobs WHERE id = ?',
    this.jobId(title),
  );
  const listing = this.listing(jobRow({ title, source: 'linkedin' }));
  startRun(this);
  receive(this, [{ ...listing, sourceJobId, url: `https://www.linkedin.com/jobs/view/${sourceJobId}/` }]);
});

When('the run stores scores for {titles}', function (this: BoardWorld, titles: string[]) {
  const { repos } = this.database;
  for (const title of titles) {
    repos.jobs.setScore(this.jobId(title), {
      score: 80,
      label: 'strong',
      reason: 'Matches the profile.',
      rubricVersion: 'match-v1',
      scoredAt: this.clock(),
    });
  }
});

When('the run finishes', function (this: BoardWorld) {
  this.database.repos.runs.finish(openRun(this), this.clock());
});

Then('the board has {int} job(s)', function (this: BoardWorld, count: number) {
  assert.equal(countRows(this.database.db, 'jobs'), count);
});

Then(
  '{string} is {status} and has been seen {int} time(s)',
  function (this: BoardWorld, title: string, status: string, times: number) {
    const job = sqlRow(this.database.db, JobRowSql, JOB_SQL, this.jobId(title));
    assert.deepEqual([job.status, job.seenCount], [status, times]);
  },
);

Then('{string} has been seen {int} time(s)', function (this: BoardWorld, title: string, times: number) {
  assert.equal(sqlRow(this.database.db, JobRowSql, JOB_SQL, this.jobId(title)).seenCount, times);
});

const SightingSql = z.object({ runId: z.number(), seenAt: z.string() });
const SIGHTINGS_SQL =
  'SELECT run_id AS runId, seen_at AS seenAt FROM listing_sightings WHERE job_id = ? ORDER BY run_id';

Then('{string} has {int} sighting(s)', function (this: BoardWorld, title: string, count: number) {
  assert.equal(sqlRows(this.database.db, SightingSql, SIGHTINGS_SQL, this.jobId(title)).length, count);
});

Then('{string} has one sighting for each run', function (this: BoardWorld, title: string) {
  const { db } = this.database;
  const runs = sqlRows(db, z.object({ id: z.number() }), 'SELECT id FROM runs ORDER BY id').map((run) => run.id);
  const sightings = sqlRows(db, SightingSql, SIGHTINGS_SQL, this.jobId(title)).map((sighting) => sighting.runId);
  assert.ok(runs.length > 1, 'the scenario has only one run');
  assert.deepEqual(sightings, runs);
});

Then('{string} was last seen by the later run', function (this: BoardWorld, title: string) {
  const { db } = this.database;
  const job = sqlRow(db, JobRowSql, JOB_SQL, this.jobId(title));
  const latest = sqlRows(db, SightingSql, SIGHTINGS_SQL, this.jobId(title)).at(-1);
  assert.ok(latest, `"${title}" has no sighting`);
  assert.equal(latest.runId, openRun(this));
  assert.equal(job.lastSeenAt, latest.seenAt);
});

const RUN_COUNTS: Readonly<Record<string, string>> = {
  'listings received': 'listings_seen',
  'new jobs': 'jobs_new',
  'jobs seen again': 'jobs_seen_again',
};

Then("the run's counts are:", function (this: BoardWorld, table: DataTable) {
  const expected = Object.entries(table.rowsHash()).map(([name, value]) => {
    const column = RUN_COUNTS[name];
    assert.ok(column, `a run has no count called "${name}"`);
    return [name, column, Number(value)] as const;
  });
  // The column names come from the fixed list above, never from the scenario.
  const columns = expected.map(([name, column]) => `${column} AS "${name}"`).join(', ');
  const stored = sqlRow(
    this.database.db,
    z.record(z.string(), z.number()),
    `SELECT ${columns} FROM runs WHERE id = ?`,
    openRun(this),
  );
  assert.deepEqual(stored, Object.fromEntries(expected.map(([name, , value]) => [name, value])));
});

Then('the run has a finish time', function (this: BoardWorld) {
  const run = sqlRow(
    this.database.db,
    z.object({ finishedAt: z.string().nullable() }),
    'SELECT finished_at AS finishedAt FROM runs WHERE id = ?',
    openRun(this),
  );
  assert.ok(run.finishedAt !== null, 'the run has not finished');
});

Then(
  '{titles} have a score, and {titles} have none',
  function (this: BoardWorld, scored: string[], unscored: string[]) {
    const scoreOf = (title: string) =>
      sqlRow(
        this.database.db,
        z.object({ score: z.number().nullable(), rubric: z.string().nullable() }),
        'SELECT score, rubric_version AS rubric FROM jobs WHERE id = ?',
        this.jobId(title),
      );
    for (const title of scored) assert.deepEqual(scoreOf(title), { score: 80, rubric: 'match-v1' }, title);
    for (const title of unscored) assert.deepEqual(scoreOf(title), { score: null, rubric: null }, title);
  },
);
