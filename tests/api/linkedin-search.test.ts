import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CreateRunResponseSchema,
  ErrorResponseSchema,
  IngestListingsResponseSchema,
  JobDetailSchema,
  JobListResponseSchema,
  KnownListingsResponseSchema,
  ScoringQueueResponseSchema,
  type JobSummary,
} from '../../src/schemas/api.ts';
import { jobAt, LINKEDIN_LISTINGS, LISTINGS, seedLinkedInListings, seedListings } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// The API side of the owner's LinkedIn searches (PLAN.md Phase 11 task 5; FR-18 to FR-20), over real HTTP:
// LinkedIn listings, which jobs the board already has, and the scoring queue.

describe('LinkedIn searches over the API', () => {
  let testApp: TestApp;
  let runId: number;

  beforeEach(async () => {
    testApp = await startTestApp();
    runId = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body).runId;
  });
  afterEach(async () => {
    await testApp.close();
  });

  const listingsPath = () => `/api/runs/${String(runId)}/listings`;
  const [withDetails, cardOnly] = LINKEDIN_LISTINGS;

  describe('POST /api/runs/:id/listings with source linkedin', () => {
    it('FR-18: stores jobs from LinkedIn searches on the LinkedIn view, with workplace, Easy Apply and search', async () => {
      const response = await testApp.post(listingsPath(), { listings: LINKEDIN_LISTINGS });

      expect(response.status).toBe(200);
      const body = IngestListingsResponseSchema.parse(response.body);
      expect(body).toMatchObject({ received: 3, new: 3, seenAgain: 0, repeated: 0 });
      const job = jobAt(body.newJobs, 'Example Health');
      expect(job).toMatchObject({
        source: 'linkedin',
        sourceJobId: '4480000001',
        url: 'https://www.linkedin.com/jobs/view/4480000001/',
        workplace: 'remote',
        easyApply: true,
        salary: '$150K/yr - $180K/yr',
        postedAt: '2026-10-23T09:00:00.000Z',
      });

      const linkedin = JobListResponseSchema.parse((await testApp.get('/api/jobs?origin=linkedin')).body);
      expect(linkedin.total).toBe(3);
      const detail = JobDetailSchema.parse((await testApp.get(`/api/jobs/${String(job.id)}`)).body);
      expect(detail.description).toContain('Ventilator care and charting');
      expect(detail.listingSightings).toEqual([
        { runId, seenAt: expect.any(String) as string, searchName: 'Dispatch family' },
      ]);
    });

    it('FR-18: a job found again by a later run is seen again, never a second job', async () => {
      await seedLinkedInListings(testApp, runId);
      await testApp.post(`/api/runs/${String(runId)}/finish`);
      const later = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body).runId;

      const again = IngestListingsResponseSchema.parse(
        (await testApp.post(`/api/runs/${String(later)}/listings`, { listings: [cardOnly] })).body,
      );

      expect(again).toMatchObject({ received: 1, new: 0, seenAgain: 1, repeated: 0 });
      expect(JobListResponseSchema.parse((await testApp.get('/api/jobs?origin=linkedin')).body).total).toBe(3);
    });

    it.each([
      ['a URL with a tracking query', { url: 'https://www.linkedin.com/jobs/view/4480000001/?trackingId=abc' }],
      ['a URL to another job', { url: 'https://www.linkedin.com/jobs/view/1/' }],
      ['an alert-email "comm" URL', { url: 'https://www.linkedin.com/comm/jobs/view/4480000001/' }],
      ['a URL off LinkedIn', { url: 'https://example.com/jobs/view/4480000001/' }],
      ['a job ID that is not a number', { sourceJobId: 'abc', url: 'https://www.linkedin.com/jobs/view/abc/' }],
      ['an unknown workplace', { workplace: 'office' }],
      ['a search name on two lines', { searchName: 'Nurse\nfamily' }],
      ['an empty search name', { searchName: '' }],
      ['an Easy Apply flag that is not a boolean', { easyApply: 'yes' }],
    ])('NFR-09: refuses a LinkedIn listing with %s, and stores nothing', async (_case, change) => {
      const response = await testApp.post(listingsPath(), { listings: [{ ...withDetails, ...change }] });

      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('validation_failed');
      expect(JobListResponseSchema.parse((await testApp.get('/api/jobs')).body).total).toBe(0);
    });

    it('FR-15: a feed listing still needs no workplace, Easy Apply flag or search name', async () => {
      const response = await testApp.post(listingsPath(), { listings: LISTINGS });

      expect(response.status).toBe(200);
      expect(IngestListingsResponseSchema.parse(response.body).newJobs.map((job) => job.workplace)).toEqual([
        null,
        null,
        null,
      ]);
    });
  });

  describe('POST /api/listings/known', () => {
    it('FR-19: returns the job IDs of that source the board already has, each once, in request order', async () => {
      await seedLinkedInListings(testApp, runId);
      await seedListings(testApp, runId);

      const response = await testApp.post('/api/listings/known', {
        source: 'linkedin',
        sourceJobIds: ['4480000003', '9999', '4480000001', '4480000001', '5550001'],
      });

      expect(response.status).toBe(200);
      expect(KnownListingsResponseSchema.parse(response.body)).toEqual({ known: ['4480000003', '4480000001'] });
    });

    it('FR-19: changes nothing on the board', async () => {
      await seedLinkedInListings(testApp, runId);
      const before = (await testApp.get('/api/jobs')).text;

      await testApp.post('/api/listings/known', { source: 'linkedin', sourceJobIds: ['4480000001'] });

      expect((await testApp.get('/api/jobs')).text).toBe(before);
    });

    it.each([
      ['no IDs', { source: 'linkedin', sourceJobIds: [] }],
      ['more than 100 IDs', { source: 'linkedin', sourceJobIds: Array.from({ length: 101 }, (_, i) => String(i)) }],
      ['an unknown source', { source: 'monster', sourceJobIds: ['1'] }],
      ['an empty ID', { source: 'linkedin', sourceJobIds: [''] }],
      ['an extra field', { source: 'linkedin', sourceJobIds: ['1'], runId: 1 }],
    ])('NFR-09: refuses %s', async (_case, body) => {
      const response = await testApp.post('/api/listings/known', body);

      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(response.body).error.code).toBe('validation_failed');
    });
  });

  describe('GET /api/scoring/queue', () => {
    async function queue(query = '') {
      const response = await testApp.get(`/api/scoring/queue${query}`);
      expect(response.status).toBe(200);
      return ScoringQueueResponseSchema.parse(response.body);
    }

    async function score(jobs: readonly JobSummary[], rubricVersion: string) {
      const scores = jobs.map((job) => ({ jobId: job.id, score: 80, label: 'strong', reason: 'Seeded.' }));
      const response = await testApp.post(`/api/runs/${String(runId)}/scores`, { rubricVersion, scores });
      expect(response.status).toBe(200);
    }

    it('FR-20: lists unscored jobs with their description and the rubric to score each with', async () => {
      await seedLinkedInListings(testApp, runId);

      const { items, total } = await queue();

      expect(total).toBe(3);
      expect(items.find((item) => item.company === 'Example Health')).toEqual({
        id: expect.any(Number) as number,
        source: 'linkedin',
        title: 'Senior Registered Nurse (ICU, Days)',
        company: 'Example Health',
        location: 'United States (Remote)',
        workplace: 'remote',
        salary: '$150K/yr - $180K/yr',
        postedAt: '2026-10-23T09:00:00.000Z',
        description:
          'About us\n\nWe run community clinics.\n• 5+ years of patient care\n• Ventilator care and charting',
        rubric: 'match-v2',
        currentRubric: null,
      });
      expect(items.find((item) => item.company === 'Sample Freight')).toMatchObject({
        description: null,
        rubric: 'triage-v2',
      });
    });

    it('FR-20: holds 10 jobs by default and at most the limit asked for, and counts them all', async () => {
      await seedLinkedInListings(testApp, runId);
      await seedListings(testApp, runId);

      expect((await queue()).items).toHaveLength(6);
      expect(await queue('?limit=2')).toMatchObject({ total: 6, items: [expect.anything(), expect.anything()] });
    });

    it('FR-20: empties as scores are posted; a triaged job with a description in New comes back for match-v2', async () => {
      const jobs = await seedLinkedInListings(testApp, runId);
      await score(jobs, 'triage-v2');

      const { items } = await queue();

      // Newest first: Acme Payments was sent last.
      expect(items.map((item) => [item.company, item.rubric, item.currentRubric])).toEqual([
        ['Acme Payments', 'match-v2', 'triage-v2'],
        ['Example Health', 'match-v2', 'triage-v2'],
      ]);
      await score(
        jobs.filter((job) => job.company !== 'Sample Freight'),
        'match-v2',
      );
      expect(await queue()).toEqual({ items: [], total: 0 });
    });

    it('FR-20: a job the owner moved on from keeps its score (DEC-044)', async () => {
      const jobs = await seedLinkedInListings(testApp, runId);
      await score(jobs, 'triage-v2');
      const health = jobAt(jobs, 'Example Health');

      await testApp.call('PATCH', `/api/jobs/${String(health.id)}`, { status: 'applied' });

      expect((await queue()).items.map((item) => item.company)).toEqual(['Acme Payments']);
    });

    it.each(['?limit=0', '?limit=26', '?limit=x', '?offset=1'])('NFR-09: refuses %s', async (query) => {
      const response = await testApp.get(`/api/scoring/queue${query}`);

      expect(response.status).toBe(400);
    });
  });
});
