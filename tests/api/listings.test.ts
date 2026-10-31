import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CreateRunResponseSchema,
  IngestListingsResponseSchema,
  JobDetailSchema,
  JobListResponseSchema,
  RunSummarySchema,
  type JobSummary,
} from '../../src/schemas/api.ts';
import { jobAt, LISTINGS, seedBoard, seedListings } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// POST /api/runs/:id/listings and the origin filter (PLAN.md Phase 10; FR-15 to FR-17), over real HTTP.

describe('jobs from other sources over the API', () => {
  let testApp: TestApp;
  let runId: number;
  let linkedinJobs: JobSummary[];

  beforeEach(async () => {
    testApp = await startTestApp();
    ({ runId, jobs: linkedinJobs } = await seedBoard(testApp));
  });
  afterEach(async () => {
    await testApp.close();
  });

  const listingsPath = () => `/api/runs/${String(runId)}/listings`;

  describe('POST /api/runs/:id/listings', () => {
    it('FR-15: stores new listings and returns them as job summaries', async () => {
      const response = await testApp.post(listingsPath(), { listings: LISTINGS });

      expect(response.status).toBe(200);
      const body = IngestListingsResponseSchema.parse(response.body);
      expect(body).toMatchObject({ received: 3, new: 3, seenAgain: 0, repeated: 0 });
      expect(body.newJobs.map((job) => [job.source, job.sourceJobId, job.status, job.score])).toEqual([
        ['greenhouse', '5550001', 'new', null],
        ['himalayas', 'sample-co/jobs/nurse-lead', 'new', null],
        ['hackernews', '50012248', 'new', null],
      ]);
      expect(body.newJobs[0]).toMatchObject({
        url: 'https://job-boards.greenhouse.io/examplelabs/jobs/5550001',
        postedAt: '2026-10-20T13:00:00.000Z',
        salary: '$150K – $180K',
        activelyHiring: false,
        easyApply: false,
      });
    });

    it('FR-16: the same listings again in the same run are repeats that change nothing', async () => {
      await testApp.post(listingsPath(), { listings: LISTINGS });

      const again = IngestListingsResponseSchema.parse(
        (await testApp.post(listingsPath(), { listings: LISTINGS })).body,
      );

      expect(again).toEqual({ received: 3, new: 0, seenAgain: 0, repeated: 3, newJobs: [] });
    });

    it('FR-11: counts listings in the run summary', async () => {
      await testApp.post(listingsPath(), { listings: LISTINGS });

      const summary = RunSummarySchema.parse((await testApp.post(`/api/runs/${String(runId)}/finish`)).body);

      expect(summary).toMatchObject({ emailsSeen: 3, listingsSeen: 3, jobsNew: 21 });
    });

    it.each<[string, unknown]>([
      ['an empty list', { listings: [] }],
      [
        '26 listings',
        { listings: Array.from({ length: 26 }, (_, index) => ({ ...LISTINGS[1], sourceJobId: `x${String(index)}` })) },
      ],
      ['LinkedIn as the source', { listings: [{ ...LISTINGS[0], source: 'linkedin' }] }],
      ['an unknown source', { listings: [{ ...LISTINGS[0], source: 'monster' }] }],
      ['a plain http link', { listings: [{ ...LISTINGS[0], url: 'http://example.com/jobs/1' }] }],
      ['a javascript: link', { listings: [{ ...LISTINGS[0], url: 'javascript:alert(1)' }] }],
      ['a link with a password', { listings: [{ ...LISTINGS[0], url: 'https://u:p@example.com/jobs/1' }] }],
      ['an empty title', { listings: [{ ...LISTINGS[0], title: ' ' }] }],
      ['a title on two lines', { listings: [{ ...LISTINGS[0], title: 'Dispatcher\nfake second line' }] }],
      ['a description over 10,000 characters', { listings: [{ ...LISTINGS[0], description: 'x'.repeat(10_001) }] }],
      ['a date that is not ISO', { listings: [{ ...LISTINGS[0], postedAt: 'yesterday' }] }],
      ['an extra field', { listings: [{ ...LISTINGS[0], score: 99 }] }],
    ])('NFR-09: refuses %s with 400 and stores nothing', async (_case, body) => {
      const response = await testApp.post(listingsPath(), body);

      expect(response.status).toBe(400);
      expect(JobListResponseSchema.parse((await testApp.get('/api/jobs?origin=other')).body).total).toBe(0);
    });

    it('FR-11: refuses a run that does not exist (404) or is finished (409)', async () => {
      await testApp.post(`/api/runs/${String(runId)}/finish`);

      expect((await testApp.post('/api/runs/999/listings', { listings: LISTINGS })).status).toBe(404);
      expect((await testApp.post(listingsPath(), { listings: LISTINGS })).status).toBe(409);
    });
  });

  describe('GET /api/jobs?origin', () => {
    it('FR-17: lists LinkedIn jobs and jobs from other sources apart, or all together', async () => {
      await seedListings(testApp, runId);

      const list = async (query: string) => JobListResponseSchema.parse((await testApp.get(`/api/jobs${query}`)).body);

      expect((await list('?origin=linkedin')).total).toBe(18);
      expect((await list('?origin=other')).items.map((job) => job.company).sort()).toEqual([
        'Acme Exchange',
        'Example Labs',
        'Sample Co',
      ]);
      expect((await list('')).total).toBe(21);
      expect((await list('?origin=other&q=dispatcher')).total).toBe(2);
    });

    it('NFR-09: refuses an unknown origin', async () => {
      expect((await testApp.get('/api/jobs?origin=greenhouse')).status).toBe(400);
    });

    it('FR-06: other-source jobs are in the unscored backlog and take scores like any job', async () => {
      const [first] = await seedListings(testApp, runId);
      const backlog = JobListResponseSchema.parse((await testApp.get('/api/jobs?unscored=true&limit=100')).body);
      expect(backlog.total).toBe(21);

      const stored = await testApp.post(`/api/runs/${String(runId)}/scores`, {
        rubricVersion: 'triage-v2',
        scores: [
          { jobId: first?.id, score: 90, label: 'strong', reason: 'Senior Dispatcher with Playwright, remote US.' },
        ],
      });

      expect(stored.body).toEqual({ stored: 1 });
    });
  });

  describe('GET /api/jobs/:id', () => {
    it('FR-17: an other-source job shows its description and listing sightings', async () => {
      const [first] = await seedListings(testApp, runId);

      const detail = JobDetailSchema.parse((await testApp.get(`/api/jobs/${String(first?.id)}`)).body);

      expect(detail).toMatchObject({
        source: 'greenhouse',
        description: 'About the role\n\nRun the night dispatch desk.\n• Load planning\n• Driver check-ins',
        sightings: [],
        listingSightings: [{ runId, seenAt: expect.any(String) as unknown }],
      });
    });

    it('FR-10: a LinkedIn job has no description and no listing sightings', async () => {
      const linkedin = jobAt(linkedinJobs, 'Ledgerly');

      const detail = JobDetailSchema.parse((await testApp.get(`/api/jobs/${String(linkedin.id)}`)).body);

      expect(detail).toMatchObject({ source: 'linkedin', description: null, listingSightings: [] });
      expect(detail.sightings.length).toBeGreaterThan(0);
    });
  });

  it('FR-15: a new run for listings alone needs no emails', async () => {
    const { runId: listingsRun } = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body);
    await testApp.post(`/api/runs/${String(listingsRun)}/listings`, { listings: [LISTINGS[1]] });

    const summary = RunSummarySchema.parse((await testApp.post(`/api/runs/${String(listingsRun)}/finish`)).body);

    expect(summary).toMatchObject({ emailsSeen: 0, listingsSeen: 1, jobsNew: 1, jobsSeenAgain: 0 });
  });
});
