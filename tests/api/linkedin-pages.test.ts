import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CreateRunResponseSchema, IngestListingsResponseSchema, type JobSummary } from '../../src/schemas/api.ts';
import { jobAt, seedLinkedInListings } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// Jobs from the owner's LinkedIn searches on the pages (PLAN.md Phase 11 task 11; FR-17, FR-19, FR-20), over real
// HTTP: the workplace and posted date on cards, and the workplace, rubric and search name on the detail page.

describe('LinkedIn search jobs on the pages', () => {
  let testApp: TestApp;
  let runId: number;
  let jobs: JobSummary[];

  beforeEach(async () => {
    testApp = await startTestApp();
    runId = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body).runId;
    jobs = await seedLinkedInListings(testApp, runId);
  });
  afterEach(async () => {
    await testApp.close();
  });

  async function page(path: string): Promise<string> {
    const response = await testApp.get(path);
    expect(response.status, path).toBe(200);
    return response.text.replace(/\s+/g, ' ');
  }

  it('FR-19: a LinkedIn card shows its workplace, salary and when it was posted, and names no source', async () => {
    const board = await page('/');

    // The test app's clock starts at 2026-10-23T12:00:00Z; Example Health was posted at 09:00 that day.
    expect(board).toContain(
      'Example Health · United States (Remote) <span class="flag">Easy Apply</span> <span class="flag">Remote</span> <span class="salary">$150K/yr - $180K/yr</span>',
    );
    expect(board).toContain('Posted 3 h ago · Seen 1×');
    expect(board).toContain('Acme Payments · New York, NY (Hybrid) <span class="flag">Hybrid</span>');
    expect(board).not.toContain('<span class="flag">LinkedIn</span>');
  });

  it('FR-19: a card without a workplace or salary shows neither', async () => {
    const board = await page('/');

    expect(board).toMatch(/Sample Freight · Austin, TX <\/p>/);
  });

  it('FR-19, FR-20: the detail page shows the workplace, the search that found the job and the rubric', async () => {
    const health = jobAt(jobs, 'Example Health');
    const scored = await testApp.post(`/api/runs/${String(runId)}/scores`, {
      rubricVersion: 'match-v2',
      scores: [{ jobId: health.id, score: 88, label: 'strong', reason: 'Playwright and TypeScript, remote US.' }],
    });
    expect(scored.status).toBe(200);

    const detail = await page(`/jobs/${String(health.id)}`);

    expect(detail).toContain('<dt>Workplace</dt> <dd>Remote</dd>');
    expect(detail).toContain('Found by the search “QA family” · <a href="/runs">run 1</a>');
    expect(detail).toContain('<dt>Rubric</dt> <dd>match-v2: scored on the full description</dd>');
    expect(detail).toContain('<h2 id="description-heading">Description</h2> <p class="hint">As LinkedIn lists it.</p>');
  });

  it('FR-20: an unscored job has no rubric yet; a rubric the app does not know is shown by name', async () => {
    const freight = jobAt(jobs, 'Sample Freight');
    expect(await page(`/jobs/${String(freight.id)}`)).not.toContain('<dt>Rubric</dt>');

    await testApp.post(`/api/runs/${String(runId)}/scores`, {
      rubricVersion: 'custom-v9',
      scores: [{ jobId: freight.id, score: 40, label: 'weak', reason: 'Not remote.' }],
    });

    expect(await page(`/jobs/${String(freight.id)}`)).toContain('<dt>Rubric</dt> <dd>custom-v9</dd>');
  });

  it('FR-20: a score from a v1 rubric, kept in an older database, still shows its version name and no note', async () => {
    const health = jobAt(jobs, 'Example Health');
    await testApp.post(`/api/runs/${String(runId)}/scores`, {
      rubricVersion: 'match-v1',
      scores: [{ jobId: health.id, score: 88, label: 'strong', reason: 'Scored before rubric v2.' }],
    });

    expect(await page(`/jobs/${String(health.id)}`)).toContain('<dt>Rubric</dt> <dd>match-v1</dd>');
  });

  it('NFR-07: a search name is escaped like any other value', async () => {
    const response = await testApp.post(`/api/runs/${String(runId)}/listings`, {
      listings: [
        {
          source: 'linkedin',
          sourceJobId: '4480000009',
          title: 'SDET',
          company: 'Example Co',
          location: '',
          url: 'https://www.linkedin.com/jobs/view/4480000009/',
          postedAt: null,
          salary: null,
          description: null,
          searchName: '<script>alert(1)</script>',
        },
      ],
    });
    expect(response.status).toBe(200);
    const id = IngestListingsResponseSchema.parse(response.body).newJobs[0]?.id ?? 0;

    const detail = await page(`/jobs/${String(id)}`);

    expect(detail).toContain('Found by the search “&lt;script&gt;alert(1)&lt;/script&gt;”');
    expect(detail).not.toContain('<script>alert(1)');
  });
});
