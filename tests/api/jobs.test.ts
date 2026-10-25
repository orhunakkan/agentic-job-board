import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobDetailSchema, JobListResponseSchema, type JobSummary } from '../../src/schemas/api.ts';
import { jobAt, seedBoard } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

describe('the jobs API', () => {
  let testApp: TestApp;
  let runId: number;
  let jobs: JobSummary[];

  beforeEach(async () => {
    testApp = await startTestApp();
    ({ runId, jobs } = await seedBoard(testApp));
    const scores = [
      ['3Pillar', 92, 'strong'],
      ['Cboe Global Markets', 88, 'strong'],
      ['Workiva', 70, 'possible'],
      ['Agilent Technologies', 10, 'weak'],
      ['Optum', 45, 'weak'],
    ] as const;
    await testApp.post(`/api/runs/${String(runId)}/scores`, {
      rubricVersion: 'v1',
      scores: scores
        .filter(([company]) => jobs.some((job) => job.company === company))
        .map(([company, score, label]) => ({ jobId: jobAt(jobs, company).id, score, label, reason: 'r' })),
    });
  });
  afterEach(async () => {
    await testApp.close();
  });

  async function list(query = ''): Promise<{ companies: string[]; total: number }> {
    const response = await testApp.get(`/api/jobs${query}`);
    expect(response.status).toBe(200);
    const body = JobListResponseSchema.parse(response.body);
    return { companies: body.items.map((job) => job.company), total: body.total };
  }

  async function patch(jobId: number, body: unknown) {
    return testApp.call('PATCH', `/api/jobs/${String(jobId)}`, body);
  }

  describe('GET /api/jobs', () => {
    it('FR-07: lists every job, best score first and unscored last, with the total', async () => {
      const { companies, total } = await list();

      expect(total).toBe(18);
      expect(companies).toHaveLength(18);
      expect(companies.slice(0, 4)).toEqual(['3Pillar', 'Cboe Global Markets', 'Workiva', 'Optum']);
    });

    it('FR-07: unscored jobs come after scored ones, newest first seen first', async () => {
      const response = JobListResponseSchema.parse((await testApp.get('/api/jobs?unscored=true&limit=100')).body);

      expect(response.total).toBe(14);
      expect(response.items.every((job) => job.score === null)).toBe(true);
      const seen = response.items.map((job) => job.firstSeenAt);
      expect(seen).toEqual([...seen].sort().reverse());
    });

    it('FR-07: minScore keeps only jobs scored at least that high', async () => {
      expect(await list('?minScore=70')).toEqual({
        companies: ['3Pillar', 'Cboe Global Markets', 'Workiva'],
        total: 3,
      });
      expect(await list('?minScore=100')).toEqual({ companies: [], total: 0 });
    });

    it('FR-07: q matches title or company, ignoring case', async () => {
      expect((await list('?q=playwright')).companies.sort()).toEqual(['3Pillar', 'Capgemini', 'PDSSOFT INC.']);
      expect((await list('?q=DELOITTE')).total).toBe(2);
      expect((await list('?q=%20%20')).total).toBe(18);
    });

    it('FR-07: sort=recent orders by first seen, newest first', async () => {
      const response = JobListResponseSchema.parse((await testApp.get('/api/jobs?sort=recent&limit=100')).body);

      const seen = response.items.map((job) => job.firstSeenAt);
      expect(seen).toEqual([...seen].sort().reverse());
      expect(response.items[0]?.firstSeenAt).toBe('2026-10-22T14:10:48.000Z');
    });

    it('FR-07: limit and offset page through the list; total stays the full count', async () => {
      const first = await list('?limit=5');
      const second = await list('?limit=5&offset=5');
      const all = await list('?limit=100');

      expect(first.total).toBe(18);
      expect(second.total).toBe(18);
      expect([...first.companies, ...second.companies]).toEqual(all.companies.slice(0, 10));
    });

    it('FR-07: each tab shows its statuses (PLAN.md §5.5)', async () => {
      const cboe = jobAt(jobs, 'Cboe Global Markets').id;
      const pillar = jobAt(jobs, '3Pillar').id;
      const workiva = jobAt(jobs, 'Workiva').id;
      const optum = jobAt(jobs, 'Optum').id;
      await patch(cboe, { status: 'saved' });
      await patch(pillar, { status: 'applied' });
      await patch(workiva, { status: 'applied' });
      await patch(workiva, { status: 'rejected' });
      await patch(optum, { status: 'dismissed' });

      expect(await list('?tab=new')).toMatchObject({ total: 14 });
      expect(await list('?tab=saved')).toEqual({ companies: ['Cboe Global Markets'], total: 1 });
      expect(await list('?tab=in-progress')).toEqual({ companies: ['3Pillar'], total: 1 });
      expect(await list('?tab=closed')).toEqual({ companies: ['Workiva'], total: 1 });
      expect(await list('?tab=dismissed')).toEqual({ companies: ['Optum'], total: 1 });
    });

    it('FR-07: in-progress is sorted by the latest status change', async () => {
      const pillar = jobAt(jobs, '3Pillar').id;
      const nagarro = jobAt(jobs, 'Nagarro').id;
      await patch(pillar, { status: 'applied' });
      await patch(nagarro, { status: 'applied' });
      await patch(nagarro, { status: 'interviewing' });
      await patch(pillar, { status: 'interviewing' });

      expect((await list('?tab=in-progress')).companies).toEqual(['3Pillar', 'Nagarro']);
    });

    it.each([
      'tab=archive',
      'minScore=-1',
      'minScore=101',
      'minScore=high',
      'sort=company',
      'unscored=yes',
      'unscored=true&minScore=50',
      'limit=0',
      'limit=101',
      'offset=-5',
      'tab=new&tab=saved',
      'status=new',
      '__proto__=x',
      `q=${'x'.repeat(201)}`,
    ])('NFR-09: GET /api/jobs?%s is a 400', async (query) => {
      const response = await testApp.get(`/api/jobs?${query}`);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
    });
  });

  describe('GET /api/jobs/:id', () => {
    it('FR-10: returns every field, with its email sighting, its search sighting and status history', async () => {
      const job = jobAt(jobs, 'ConsumerAffairs');
      const again = await testApp.post('/api/runs');
      const secondRun = (again.body as { runId: number }).runId;
      await testApp.post(`/api/runs/${String(secondRun)}/listings`, {
        listings: [
          {
            source: 'linkedin',
            sourceJobId: job.sourceJobId,
            title: job.title,
            company: job.company,
            location: 'United States (Remote)',
            url: job.url,
            postedAt: null,
            salary: null,
            description: null,
            workplace: 'remote',
            easyApply: true,
            searchName: 'QA family',
          },
        ],
      });

      const response = await testApp.get(`/api/jobs/${String(job.id)}`);

      expect(response.status).toBe(200);
      const detail = JobDetailSchema.parse(response.body);
      expect(detail).toMatchObject({
        id: job.id,
        title: 'AI Native, QA Engineer',
        company: 'ConsumerAffairs',
        location: 'United States (Remote)',
        workplace: 'remote',
        easyApply: true,
        notes: '',
        seenCount: 2,
        firstSeenAt: '2026-10-21T18:10:47.000Z',
      });
      expect(detail.lastSeenAt > detail.firstSeenAt).toBe(true);
      expect(detail.sightings).toEqual([
        {
          gmailMessageId: 'msgdigestsq',
          savedSearch: 'senior quality assurance engineer in United States',
          receivedAt: '2026-10-21T18:10:47.000Z',
        },
      ]);
      expect(detail.listingSightings).toEqual([
        { runId: secondRun, seenAt: detail.lastSeenAt, searchName: 'QA family' },
      ]);
      expect(detail.history).toEqual([{ fromStatus: null, toStatus: 'new', changedAt: expect.any(String) as unknown }]);
    });

    it('FR-10: an unknown job is 404 and a malformed ID is 400', async () => {
      const unknown = await testApp.get('/api/jobs/9999');
      const malformed = await testApp.get('/api/jobs/first');

      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual({ error: { code: 'not_found', message: 'job 9999 does not exist' } });
      expect(malformed.status).toBe(400);
      expect(malformed.body).toMatchObject({ error: { code: 'validation_failed', message: 'The job ID is invalid' } });
    });
  });

  describe('PATCH /api/jobs/:id', () => {
    it('FR-08: changes the status and records it in history', async () => {
      const job = jobAt(jobs, '3Pillar');

      const response = await patch(job.id, { status: 'saved' });

      expect(response.status).toBe(200);
      const detail = JobDetailSchema.parse(response.body);
      expect(detail.status).toBe('saved');
      expect(detail.history.map((change) => [change.fromStatus, change.toStatus])).toEqual([
        [null, 'new'],
        ['new', 'saved'],
      ]);
    });

    it('FR-08: an invalid transition is a 409 that names both statuses, and nothing changes', async () => {
      const job = jobAt(jobs, '3Pillar');

      const response = await patch(job.id, { status: 'offer', notes: 'should not be saved' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          code: 'invalid_transition',
          message: "a job can't move from new to offer",
          details: { from: 'new', to: 'offer' },
        },
      });
      expect((await testApp.get(`/api/jobs/${String(job.id)}`)).body).toMatchObject({ status: 'new', notes: '' });
    });

    it('FR-08: dismiss and restore', async () => {
      const job = jobAt(jobs, 'EY');

      await patch(job.id, { status: 'dismissed' });
      const restored = await patch(job.id, { status: 'new' });

      expect(restored.status).toBe(200);
      expect(restored.body).toMatchObject({ status: 'new' });
    });

    it('FR-09: saves notes, keeping them exactly as typed', async () => {
      const job = jobAt(jobs, 'Cboe Global Markets');
      const notes = 'Recruiter: call Tue 10:00.\n<b>Ask about remote</b> & on-call — ✓';

      const response = await patch(job.id, { notes });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ notes, status: 'new' });
    });

    it('FR-09: status and notes can change together', async () => {
      const job = jobAt(jobs, 'Cboe Global Markets');

      const response = await patch(job.id, { status: 'applied', notes: 'Applied via referral' });

      expect(response.body).toMatchObject({ status: 'applied', notes: 'Applied via referral' });
    });

    it.each<[string, unknown]>([
      ['notes over 5,000 characters', { notes: 'x'.repeat(5001) }],
      ['an unknown status', { status: 'hired' }],
      ['an empty change', {}],
      ['an unknown field', { score: 100 }],
      ['notes that are not text', { notes: 42 }],
    ])('NFR-09: rejects %s', async (_case, body) => {
      const response = await patch(jobAt(jobs, 'Cboe Global Markets').id, body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
    });

    it('FR-09: exactly 5,000 characters of notes are accepted', async () => {
      const response = await patch(jobAt(jobs, 'Cboe Global Markets').id, { notes: 'x'.repeat(5000) });

      expect(response.status).toBe(200);
    });

    it('FR-08: an unknown job is 404', async () => {
      const response = await patch(9999, { status: 'saved' });

      expect(response.status).toBe(404);
    });
  });
});
