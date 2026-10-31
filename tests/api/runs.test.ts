import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CreateRunResponseSchema,
  IngestStateResponseSchema,
  RunListResponseSchema,
  RunSummarySchema,
} from '../../src/schemas/api.ts';
import { jobAt, LINKEDIN_LISTINGS, seedBoard, seedLinkedInListings, seedListings } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// The alert email the old POST /api/runs/:id/emails took, before the Gmail track retired (DEC-041).
const EMAIL = {
  gmailMessageId: 'msganniversary',
  receivedAt: '2026-10-23T09:00:00Z',
  sender: 'jobalerts-noreply@linkedin.com',
  subject: 'New jobs for you',
  plainText: 'Your job alert for dispatcher in United States',
};

describe('the /find-jobs run API', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await startTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  async function newRun(): Promise<number> {
    const response = await testApp.post('/api/runs');
    expect(response.status).toBe(201);
    return CreateRunResponseSchema.parse(response.body).runId;
  }

  describe('GET /api/ingest/state', () => {
    it('FR-18: is null before any LinkedIn search stored a job', async () => {
      const response = await testApp.get('/api/ingest/state');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ lastLinkedInSearchAt: null });
    });

    it('FR-18: is when a run last stored a job a LinkedIn search found; the feeds and email years do not count', async () => {
      const { runId } = await seedBoard(testApp);
      await seedListings(testApp, runId);
      expect((await testApp.get('/api/ingest/state')).body).toEqual({ lastLinkedInSearchAt: null });

      await seedLinkedInListings(testApp, runId);
      const { lastLinkedInSearchAt } = IngestStateResponseSchema.parse((await testApp.get('/api/ingest/state')).body);
      await seedListings(testApp, await newRun());

      expect(lastLinkedInSearchAt).not.toBeNull();
      expect((await testApp.get('/api/ingest/state')).body).toEqual({ lastLinkedInSearchAt });
    });
  });

  describe('POST /api/runs', () => {
    it('FR-11: starts runs with increasing IDs', async () => {
      expect(await newRun()).toBe(1);
      expect(await newRun()).toBe(2);
    });

    it('NFR-09: the body must be an empty object', async () => {
      const response = await testApp.post('/api/runs', { dryRun: true });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
    });
  });

  describe('POST /api/runs/:id/emails (retired, DEC-041)', () => {
    it('FR-18: the alert-email endpoint is gone: 404 for an open run, an unknown run and any body', async () => {
      const runId = await newRun();

      for (const path of [`/api/runs/${String(runId)}/emails`, '/api/runs/99/emails']) {
        const response = await testApp.post(path, { emails: [EMAIL] });
        expect(response.status, path).toBe(404);
        expect(response.body).toMatchObject({ error: { code: 'not_found' } });
      }
      expect((await testApp.get('/api/runs')).body).toMatchObject([{ id: runId, emailsSeen: 0, jobsNew: 0 }]);
    });
  });

  describe('sending to a run', () => {
    const listings = { listings: [LINKEDIN_LISTINGS[0]] };

    it('FR-11: an unknown run is 404 and a finished run is 409', async () => {
      const runId = await newRun();
      await testApp.post(`/api/runs/${String(runId)}/finish`);

      const unknown = await testApp.post('/api/runs/99/listings', listings);
      const finished = await testApp.post(`/api/runs/${String(runId)}/listings`, listings);

      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual({ error: { code: 'not_found', message: 'run 99 does not exist' } });
      expect(finished.status).toBe(409);
      expect(finished.body).toEqual({
        error: { code: 'run_finished', message: `run ${String(runId)} is already finished` },
      });
    });

    it.each(['abc', '0', '-1', '1.5', '99999999999999999'])('NFR-09: run ID "%s" is a 400', async (id) => {
      const response = await testApp.post(`/api/runs/${id}/listings`, listings);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'validation_failed', message: 'The run ID is invalid' } });
    });
  });

  describe('POST /api/runs/:id/scores', () => {
    it('FR-06: stores scores with their label, reason and rubric version', async () => {
      const { runId, jobs } = await seedBoard(testApp);
      const job = jobAt(jobs, '4Corners');

      const response = await testApp.post(`/api/runs/${String(runId)}/scores`, {
        rubricVersion: 'v1',
        scores: [{ jobId: job.id, score: 92, label: 'strong', reason: 'Exact stack match, senior, US-wide.' }],
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ stored: 1 });
      expect((await testApp.get(`/api/jobs/${String(job.id)}`)).body).toMatchObject({
        score: 92,
        scoreLabel: 'strong',
        scoreReason: 'Exact stack match, senior, US-wide.',
        rubricVersion: 'v1',
        scoredAt: expect.any(String) as unknown,
      });
    });

    it.each<[string, Record<string, unknown>, string]>([
      ['a label outside its score band', { score: 80, label: 'weak' }, 'scores.0.label'],
      ['a score above 100', { score: 101, label: 'strong' }, 'scores.0.score'],
      ['a fractional score', { score: 74.5, label: 'possible' }, 'scores.0.score'],
      ['a reason over 200 characters', { reason: 'x'.repeat(201) }, 'scores.0.reason'],
      ['an empty reason', { reason: '   ' }, 'scores.0.reason'],
    ])('FR-06: rejects %s', async (_case, override, path) => {
      const { runId, jobs } = await seedBoard(testApp);
      const score = { jobId: jobs[0]?.id, score: 60, label: 'possible', reason: 'ok', ...override };

      const response = await testApp.post(`/api/runs/${String(runId)}/scores`, {
        rubricVersion: 'v1',
        scores: [score],
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'validation_failed',
          details: expect.arrayContaining([expect.objectContaining({ path })]) as unknown,
        },
      });
    });

    it('FR-06: scoring the same job twice in one request is rejected', async () => {
      const { runId, jobs } = await seedBoard(testApp);
      const entry = { jobId: jobs[0]?.id, score: 60, label: 'possible', reason: 'ok' };

      const response = await testApp.post(`/api/runs/${String(runId)}/scores`, {
        rubricVersion: 'v1',
        scores: [entry, entry],
      });

      expect(response.status).toBe(400);
      expect(response.text).toContain('only once per request');
    });

    it('FR-06: one unknown job ID stores nothing at all, and names the bad IDs', async () => {
      const { runId, jobs } = await seedBoard(testApp);
      const known = jobs[0]?.id ?? 0;

      const response = await testApp.post(`/api/runs/${String(runId)}/scores`, {
        rubricVersion: 'v1',
        scores: [
          { jobId: known, score: 90, label: 'strong', reason: 'ok' },
          { jobId: 9001, score: 10, label: 'weak', reason: 'ok' },
          { jobId: 9002, score: 10, label: 'weak', reason: 'ok' },
        ],
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'unknown_jobs',
          message: 'Some jobs do not exist, so no score was stored',
          details: { jobIds: [9001, 9002] },
        },
      });
      expect((await testApp.get(`/api/jobs/${String(known)}`)).body).toMatchObject({ score: null });
    });
  });

  describe('POST /api/runs/:id/finish and GET /api/runs', () => {
    it('FR-11, FR-13: finishing returns the counts and the top 5 new jobs by score', async () => {
      const { runId, jobs } = await seedBoard(testApp);
      const scored = [
        ['Ledgerly', 70, 'possible'],
        ['4Corners', 92, 'strong'],
        ['Lakeshore Freight', 88, 'strong'],
        ['ShopperVoice', 85, 'strong'],
        ['Medway', 40, 'weak'],
        ['Harbor Claims Services', 65, 'possible'],
      ] as const;
      await testApp.post(`/api/runs/${String(runId)}/scores`, {
        rubricVersion: 'v1',
        scores: scored.map(([company, score, label]) => ({
          jobId: jobAt(jobs, company).id,
          score,
          label,
          reason: 'r',
        })),
      });

      const response = await testApp.post(`/api/runs/${String(runId)}/finish`);

      expect(response.status).toBe(200);
      const summary = RunSummarySchema.parse(response.body);
      expect(summary).toMatchObject({
        id: runId,
        finishedAt: expect.any(String) as unknown,
        emailsSeen: 3,
        emailsNew: 3,
        emailsDuplicate: 0,
        emailsUnrecognized: 0,
        jobsNew: 18,
        jobsSeenAgain: 0,
        jobsScored: 6,
      });
      expect(summary.topNewJobs.map((job) => [job.company, job.score])).toEqual([
        ['4Corners', 92],
        ['Lakeshore Freight', 88],
        ['ShopperVoice', 85],
        ['Ledgerly', 70],
        ['Harbor Claims Services', 65],
      ]);
    });

    it('FR-11: a run can be finished only once', async () => {
      const runId = await newRun();
      await testApp.post(`/api/runs/${String(runId)}/finish`);

      const again = await testApp.post(`/api/runs/${String(runId)}/finish`);

      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ error: { code: 'run_finished' } });
    });

    it('FR-11: lists runs newest first, honouring limit', async () => {
      for (let created = 0; created < 3; created += 1) await newRun();

      const all = await testApp.get('/api/runs');
      const two = await testApp.get('/api/runs?limit=2');

      expect(all.status).toBe(200);
      expect(RunListResponseSchema.parse(all.body).map((run) => run.id)).toEqual([3, 2, 1]);
      expect(RunListResponseSchema.parse(two.body).map((run) => run.id)).toEqual([3, 2]);
    });

    it.each(['limit=0', 'limit=101', 'limit=ten', 'limit=1&limit=2', 'page=2'])(
      'NFR-09: GET /api/runs?%s is a 400',
      async (query) => {
        const response = await testApp.get(`/api/runs?${query}`);

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
      },
    );
  });
});
