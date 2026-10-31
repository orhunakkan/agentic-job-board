import type { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateRunResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  IngestListingsResponseSchema,
  IngestStateResponseSchema,
  JobDetailSchema,
  JobListResponseSchema,
  JobSummarySchema,
  KnownListingsResponseSchema,
  LinkedInSessionResponseSchema,
  RunListResponseSchema,
  RunSummarySchema,
  ScoresResponseSchema,
  ScoringQueueResponseSchema,
} from '../../src/schemas/api.ts';
import { createLinkedInSessionFile, saveLinkedInSession } from '../../src/linkedin/session.ts';
import { ProfileSchema } from '../../src/schemas/profile.ts';
import { fakeLinkedInStorageState } from '../helpers/fixtures.ts';
import { SAMPLE_PROFILE } from '../helpers/profiles.ts';
import { LINKEDIN_LISTINGS } from '../helpers/seed-board.ts';
import { startTestApp, type ApiResponse, type TestApp } from '../helpers/test-app.ts';

// Every response of PLAN.md §6.1 is checked against its Zod schema (DEC-009). The schemas are strict,
// so an extra, missing or mistyped field in any response fails here.

function conforms(schema: z.ZodType, response: ApiResponse, status: number): void {
  expect(response.status).toBe(status);
  const result = schema.safeParse(response.body);
  expect(result.error?.issues ?? []).toEqual([]);
}

describe('API responses match their schemas', () => {
  let testApp: TestApp;
  let runId = 0;
  let jobId = 0;

  beforeAll(async () => {
    testApp = await startTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  it('FR-01: GET /api/health', async () => {
    conforms(HealthResponseSchema, await testApp.get('/api/health'), 200);
  });

  it('FR-01: PUT and GET /api/profile', async () => {
    const profile = SAMPLE_PROFILE;
    conforms(ProfileSchema, await testApp.call('PUT', '/api/profile', profile), 200);
    conforms(ProfileSchema, await testApp.get('/api/profile'), 200);
  });

  it('FR-18: GET /api/ingest/state before any LinkedIn search', async () => {
    conforms(IngestStateResponseSchema, await testApp.get('/api/ingest/state'), 200);
  });

  it('FR-11: POST /api/runs', async () => {
    const response = await testApp.post('/api/runs');
    conforms(CreateRunResponseSchema, response, 201);
    runId = CreateRunResponseSchema.parse(response.body).runId;
  });

  it('FR-18: POST /api/runs/:id/listings with jobs from LinkedIn searches, and the ingest state after it', async () => {
    const response = await testApp.post(`/api/runs/${String(runId)}/listings`, { listings: LINKEDIN_LISTINGS });
    conforms(IngestListingsResponseSchema, response, 200);
    jobId = IngestListingsResponseSchema.parse(response.body).newJobs[0]?.id ?? 0;
    conforms(IngestStateResponseSchema, await testApp.get('/api/ingest/state'), 200);
  });

  it('FR-19: POST /api/listings/known', async () => {
    const response = await testApp.post('/api/listings/known', {
      source: 'linkedin',
      sourceJobIds: ['4480000001', '1'],
    });
    conforms(KnownListingsResponseSchema, response, 200);
  });

  it('FR-20: GET /api/scoring/queue', async () => {
    conforms(ScoringQueueResponseSchema, await testApp.get('/api/scoring/queue'), 200);
    conforms(ScoringQueueResponseSchema, await testApp.get('/api/scoring/queue?limit=1'), 200);
  });

  it('FR-06: POST /api/runs/:id/scores', async () => {
    const response = await testApp.post(`/api/runs/${String(runId)}/scores`, {
      rubricVersion: 'v1',
      scores: [{ jobId, score: 88, label: 'strong', reason: 'Senior logistics role.' }],
    });
    conforms(ScoresResponseSchema, response, 200);
  });

  it('FR-07: GET /api/jobs with and without filters', async () => {
    conforms(JobListResponseSchema, await testApp.get('/api/jobs'), 200);
    conforms(
      JobListResponseSchema,
      await testApp.get('/api/jobs?tab=new&minScore=50&q=nurse&sort=recent&limit=5'),
      200,
    );
  });

  it('FR-10: GET /api/jobs/:id', async () => {
    conforms(JobDetailSchema, await testApp.get(`/api/jobs/${String(jobId)}`), 200);
  });

  it('FR-08: PATCH /api/jobs/:id', async () => {
    conforms(
      JobDetailSchema,
      await testApp.call('PATCH', `/api/jobs/${String(jobId)}`, { status: 'saved', notes: 'n' }),
      200,
    );
  });

  it('FR-11: POST /api/runs/:id/finish and GET /api/runs', async () => {
    conforms(RunSummarySchema, await testApp.post(`/api/runs/${String(runId)}/finish`), 200);
    conforms(RunListResponseSchema, await testApp.get('/api/runs'), 200);
  });

  it('FR-14: GET /api/linkedin/session without and with a saved session', async () => {
    conforms(LinkedInSessionResponseSchema, await testApp.get('/api/linkedin/session'), 200);
    saveLinkedInSession(
      testApp.linkedinSessionPath,
      createLinkedInSessionFile(fakeLinkedInStorageState(), '2026-10-24T09:00:00.000Z'),
    );
    conforms(LinkedInSessionResponseSchema, await testApp.get('/api/linkedin/session'), 200);
  });

  it.each<[string, () => Promise<ApiResponse>, number]>([
    ['400 validation', () => testApp.get('/api/jobs?tab=x'), 400],
    ['400 invalid JSON', () => testApp.call('POST', '/api/runs', '{'), 400],
    ['404 route', () => testApp.get('/api/nothing'), 404],
    ['404 job', () => testApp.get('/api/jobs/999'), 404],
    ['405', () => testApp.call('DELETE', '/api/jobs'), 405],
    ['409 transition', () => testApp.call('PATCH', `/api/jobs/${String(jobId)}`, { status: 'offer' }), 409],
    ['409 finished run', () => testApp.post(`/api/runs/${String(runId)}/finish`), 409],
  ])('NFR-09: the %s error matches the error envelope', async (_case, send, status) => {
    conforms(ErrorResponseSchema, await send(), status);
  });
});

describe('the response schemas are strict', () => {
  const summary = {
    id: 1,
    source: 'linkedin',
    sourceJobId: '4473592349',
    title: 'Dispatcher',
    company: 'Example Co',
    location: 'Remote',
    url: 'https://www.linkedin.com/jobs/view/4473592349/',
    activelyHiring: false,
    easyApply: false,
    postedAt: null,
    salary: null,
    workplace: null,
    status: 'new',
    statusChangedAt: '2026-10-23T12:00:00.000Z',
    score: null,
    scoreLabel: null,
    scoreReason: null,
    firstSeenAt: '2026-10-22T14:10:48.000Z',
    lastSeenAt: '2026-10-22T14:10:48.000Z',
    seenCount: 1,
  };

  // The same job as a public feed lists it (FR-15).
  const listed = {
    ...summary,
    source: 'greenhouse',
    sourceJobId: '5550001',
    url: 'https://job-boards.greenhouse.io/examplelabs/jobs/5550001?gh_src=feed',
    postedAt: '2026-10-20T13:00:00.000Z',
    salary: '$150K – $180K',
  };

  it('NFR-09: a valid job summary passes, from LinkedIn or from another source', () => {
    expect(JobSummarySchema.safeParse(summary).success).toBe(true);
    expect(JobSummarySchema.safeParse(listed).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an extra field', { ...summary, notes: 'leak' }],
    ['a missing field', { ...summary, seenCount: undefined }],
    ['a URL with tracking parameters', { ...summary, url: `${summary.url}?trackingId=abc` }],
    ['a URL off LinkedIn', { ...summary, url: 'https://example.com/jobs/view/1/' }],
    ['a non-ISO timestamp', { ...summary, firstSeenAt: 'Oct 22' }],
    ['an unknown status', { ...summary, status: 'hired' }],
    ['a LinkedIn link to another job', { ...summary, url: 'https://www.linkedin.com/jobs/view/1/' }],
    ['an unknown source', { ...listed, source: 'monster' }],
    ['an unknown workplace', { ...summary, workplace: 'office' }],
    ['no workplace field', { ...summary, workplace: undefined }],
    ['a plain http link', { ...listed, url: 'http://job-boards.greenhouse.io/examplelabs/jobs/5550001' }],
    ['a javascript: link', { ...listed, url: 'javascript:alert(1)' }],
    ['a link with a password', { ...listed, url: 'https://user:secret@example.com/jobs/1' }],
  ])('NFR-09: a job summary with %s fails', (_case, value) => {
    expect(JobSummarySchema.safeParse(value).success).toBe(false);
  });

  it('NFR-09: an error body with extra fields fails', () => {
    expect(ErrorResponseSchema.safeParse({ error: { code: 'x', message: 'y', stack: 'at …' } }).success).toBe(false);
  });
});
