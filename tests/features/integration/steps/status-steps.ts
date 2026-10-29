import assert from 'node:assert/strict';
import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import { z } from 'zod';
import { sourcesForOrigin, type Origin } from '../../../../src/domain/job-source.ts';
import { labelForScore } from '../../../../src/domain/score.ts';
import type { Status } from '../../../../src/domain/status.ts';
import { changeJobStatus, dismissNewJobs, InvalidTransitionError } from '../../../../src/jobs/status-service.ts';
import { jobRow, jobRows, pathFromNew, type JobRow } from '../../support/board-data.ts';
import { statusNamed } from '../../support/parameter-types.ts';
import type { BoardWorld } from '../../support/world.ts';
import { receive } from './listing-steps.ts';
import { JOB_SQL, JobRowSql, sqlRow, sqlRows } from './sql.ts';

// Status changes and Clear All through the status service on a temporary database (FR-08, FR-21).

/** Puts the jobs on the board in one finished run, scores those with a score, and moves each to its status. */
function putOnBoard(world: BoardWorld, rows: readonly JobRow[]): void {
  const { repos } = world.database;
  world.runId = repos.runs.create(world.clock());
  receive(
    world,
    rows.map((row) => world.listing(row)),
  );
  for (const row of rows) {
    if (row.score === null) continue;
    repos.jobs.setScore(world.jobId(row.title), {
      score: row.score,
      label: labelForScore(row.score),
      reason: 'Matches the profile.',
      rubricVersion: row.description === null ? 'triage-v1' : 'match-v1',
      scoredAt: world.clock(),
    });
  }
  repos.runs.finish(world.runId, world.clock());
  for (const row of rows) {
    for (const status of pathFromNew(row.status)) change(world, world.jobId(row.title), status);
  }
}

function change(world: BoardWorld, jobId: number, to: Status): void {
  const { db, repos } = world.database;
  changeJobStatus(db, repos, jobId, to, world.clock);
}

const HistorySql = z.object({ fromStatus: z.string().nullable(), toStatus: z.string() });
const HISTORY_SQL =
  'SELECT from_status AS fromStatus, to_status AS toStatus FROM status_history WHERE job_id = ? ORDER BY id';

function history(world: BoardWorld, jobId: number) {
  return sqlRows(world.database.db, HistorySql, HISTORY_SQL, jobId);
}

function statusOf(world: BoardWorld, jobId: number): string {
  return sqlRow(world.database.db, JobRowSql, JOB_SQL, jobId).status;
}

Given('the board has these jobs:', function (this: BoardWorld, table: DataTable) {
  putOnBoard(this, jobRows(table));
});

Given('a job is {status}', function (this: BoardWorld, status: Status) {
  putOnBoard(this, [jobRow({ title: 'Senior SDET', status })]);
});

When('I change it to {status}', function (this: BoardWorld, to: Status) {
  const jobId = this.theJob();
  this.historyLength = history(this, jobId).length;
  try {
    change(this, jobId, to);
    this.error = undefined;
  } catch (error) {
    this.error = error;
  }
});

Then('the job is {status}', function (this: BoardWorld, status: Status) {
  assert.equal(this.error, undefined, `the change was refused: ${String(this.error)}`);
  assert.equal(statusOf(this, this.theJob()), status);
});

Then('the job is still {status}', function (this: BoardWorld, status: Status) {
  assert.equal(statusOf(this, this.theJob()), status);
});

Then('its history gains one row, from {status} to {status}', function (this: BoardWorld, from: Status, to: Status) {
  const rows = history(this, this.theJob());
  assert.equal(rows.length, (this.historyLength ?? 0) + 1);
  assert.deepEqual(rows.at(-1), { fromStatus: from, toStatus: to });
});

Then('the change is refused as not allowed', function (this: BoardWorld) {
  assert.ok(this.error instanceof InvalidTransitionError, `expected a refused change, got ${String(this.error)}`);
});

Then('its history is unchanged', function (this: BoardWorld) {
  assert.equal(history(this, this.theJob()).length, this.historyLength);
});

function clearAll(world: BoardWorld, view: Origin): void {
  const { db, repos } = world.database;
  world.dismissed = dismissNewJobs(db, repos, sourcesForOrigin(view), world.clock);
}

Given('I used Clear All on the {view} view', function (this: BoardWorld, view: Origin) {
  clearAll(this, view);
});

When('I use Clear All on the {view} view', function (this: BoardWorld, view: Origin) {
  clearAll(this, view);
});

Then('{int} job(s) is/are dismissed', function (this: BoardWorld, count: number) {
  assert.equal(this.dismissed, count);
});

Then('the jobs have these statuses:', function (this: BoardWorld, table: DataTable) {
  const expected = table.hashes().map((row) => [row['title'] ?? '', statusNamed(row['status'] ?? '')]);
  const stored = expected.map(([title = '']) => [title, statusOf(this, this.jobId(title))]);
  assert.deepEqual(stored, expected);
});

Then(
  '{titles} each have one history row from {status} to {status}',
  function (this: BoardWorld, titles: string[], from: Status, to: Status) {
    for (const title of titles) {
      const rows = history(this, this.jobId(title)).filter((row) => row.fromStatus === from && row.toStatus === to);
      assert.equal(rows.length, 1, `"${title}" has ${String(rows.length)} history rows from ${from} to ${to}`);
    }
  },
);
