import assert from 'node:assert/strict';
import type { Status } from '../../../src/domain/status.ts';
import { labelForScore } from '../../../src/domain/score.ts';
import type { IncomingListing } from '../../../src/ingest/listing-ingest.ts';
import {
  CreateRunResponseSchema,
  IngestListingsResponseSchema,
  JobDetailSchema,
  type JobDetail,
} from '../../../src/schemas/api.ts';
import type { ApiResponse, TestApp } from '../../helpers/test-app.ts';
import { pathFromNew, type JobRow } from './board-data.ts';
import type { BoardWorld } from './world.ts';

// The board's data over its JSON API, for the API and E2E steps: what /find-jobs and its scripts send (start a run,
// send listings, store scores, finish) and the status changes the owner makes.

export async function startRun(app: TestApp): Promise<number> {
  const response = await app.post('/api/runs');
  assert.equal(response.status, 201, response.text);
  return CreateRunResponseSchema.parse(response.body).runId;
}

export function sendListings(app: TestApp, runId: number, listings: readonly IncomingListing[]): Promise<ApiResponse> {
  return app.post(`/api/runs/${String(runId)}/listings`, { listings });
}

export async function finishRun(app: TestApp, runId: number): Promise<ApiResponse> {
  const response = await app.post(`/api/runs/${String(runId)}/finish`);
  assert.equal(response.status, 200, response.text);
  return response;
}

export interface ScoreEntry {
  jobId: number;
  score: number;
  label?: string;
  reason?: string;
}

/** Stores scores as /find-jobs does; the label follows the score unless the entry names one. */
export function storeScores(
  app: TestApp,
  runId: number,
  rubricVersion: string,
  entries: readonly ScoreEntry[],
): Promise<ApiResponse> {
  return app.post(`/api/runs/${String(runId)}/scores`, {
    rubricVersion,
    scores: entries.map((entry) => ({
      jobId: entry.jobId,
      score: entry.score,
      label: entry.label ?? labelForScore(entry.score),
      reason: entry.reason ?? 'Matches the profile.',
    })),
  });
}

export function changeStatus(app: TestApp, jobId: number, status: Status): Promise<ApiResponse> {
  return app.call('PATCH', `/api/jobs/${String(jobId)}`, { status });
}

export async function jobDetail(app: TestApp, jobId: number): Promise<JobDetail> {
  const response = await app.get(`/api/jobs/${String(jobId)}`);
  assert.equal(response.status, 200, response.text);
  return JobDetailSchema.parse(response.body);
}

/**
 * Puts the jobs on the board as a finished run leaves them: sent as listings, scored (match-v1 with a description,
 * triage-v1 without), then moved to their status by the owner, one allowed change at a time.
 */
export async function putOnBoard(world: BoardWorld, rows: readonly JobRow[]): Promise<void> {
  const app = await world.app();
  const runId = await startRun(app);
  const sent = await sendListings(
    app,
    runId,
    rows.map((row) => world.listing(row)),
  );
  assert.equal(sent.status, 200, sent.text);
  const { newJobs } = IngestListingsResponseSchema.parse(sent.body);
  for (const row of rows) {
    const job = newJobs.find((candidate) => candidate.title === row.title);
    assert.ok(job, `"${row.title}" was not stored as a new job`);
    world.remember(row.title, job.id);
  }

  for (const rubric of ['match-v1', 'triage-v1']) {
    const scored = rows.filter((row) => row.score !== null && (row.description !== null) === (rubric === 'match-v1'));
    if (scored.length === 0) continue;
    const response = await storeScores(
      app,
      runId,
      rubric,
      scored.map((row) => ({ jobId: world.jobId(row.title), score: row.score ?? 0 })),
    );
    assert.equal(response.status, 200, response.text);
  }
  await finishRun(app, runId);

  for (const row of rows) {
    for (const status of pathFromNew(row.status)) {
      const response = await changeStatus(app, world.jobId(row.title), status);
      assert.equal(response.status, 200, response.text);
    }
  }
}
