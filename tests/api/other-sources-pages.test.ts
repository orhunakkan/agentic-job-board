import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobSummary } from '../../src/schemas/api.ts';
import { jobAt, seedBoard, seedListings } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// The board's two views and the other-source job page (FR-17, DEC-036) over real HTTP: 18 LinkedIn jobs from the
// email fixtures and 3 made-up listings from the feeds.

function cardIds(page: string): number[] {
  return [...page.matchAll(/<h3 class="card-title" id="job-(\d+)-title">/g)].map(([, id]) => Number(id));
}

describe('LinkedIn and other sources on the pages', () => {
  let testApp: TestApp;
  let runId: number;
  let linkedinJobs: JobSummary[];
  let listedJobs: JobSummary[];

  beforeEach(async () => {
    testApp = await startTestApp();
    ({ runId, jobs: linkedinJobs } = await seedBoard(testApp));
    listedJobs = await seedListings(testApp, runId);
  });
  afterEach(async () => {
    await testApp.close();
  });

  async function page(path: string, status = 200): Promise<string> {
    const response = await testApp.get(path);
    expect(response.status, path).toBe(status);
    return response.text;
  }

  it('FR-17: the board shows LinkedIn jobs by default, exactly as before', async () => {
    const board = await page('/');

    expect(cardIds(board).sort()).toEqual(linkedinJobs.map((job) => job.id).sort());
    expect(board).toMatch(
      /<a href="\/" aria-current="page"\s*>LinkedIn\s*<span class="count">18<span class="visually-hidden"> new<\/span><\/span><\/a/,
    );
    expect(board).toMatch(
      /<a href="\/\?origin=other"\s*>Other sources\s*<span class="count">3<span class="visually-hidden"> new<\/span><\/span><\/a/,
    );
    expect(board).toContain('href="/?tab=saved"');
    expect(board).not.toContain('Open on Greenhouse');
  });

  it('FR-17: the other-sources view lists only those jobs, with their own tab counts and links', async () => {
    const board = await page('/?origin=other');

    expect(cardIds(board).sort()).toEqual(listedJobs.map((job) => job.id).sort());
    expect(board).toMatch(/<a href="\/\?origin=other" aria-current="page"\s*>Other sources/);
    expect(board).toMatch(/href="\/\?origin=other&amp;tab=new" aria-current="page"\s*>New <span class="count">3</);
    expect(board).toContain('<input type="hidden" name="origin" value="other" />');
    expect(board).toContain('>Open on Greenhouse<span class="visually-hidden">: Senior SDET (Playwright)');
    expect(board).toContain('>Open on Hacker News<');
    expect(board).toContain('<span class="flag">Himalayas</span>');
    expect(board).toContain('<span class="salary">$150K – $180K</span>');
    expect(board).toContain('New jobs · Other sources');
  });

  it('FR-17: filters, sorting and paging links keep the other-sources view', async () => {
    const board = await page('/?origin=other&q=sdet&sort=recent');

    expect(cardIds(board)).toHaveLength(2);
    expect(board).toContain('<a class="clear" href="/?origin=other&amp;tab=new">Clear filters</a>');
    expect(board).toContain('name="return" value="/?origin=other&amp;tab=new&amp;q=sdet&amp;sort=recent"');
  });

  it('FR-17: an empty other-sources tab says how to fetch the feeds', async () => {
    await testApp.call('PATCH', `/api/jobs/${String(listedJobs[0]?.id)}`, { status: 'dismissed' });

    expect(await page('/?origin=other&tab=saved')).toContain('No jobs in Saved.');
    expect(await page('/?origin=other&tab=dismissed')).toContain('>Dismissed <span class="count">1</span>');
  });

  it('FR-17: with no new jobs from other sources, the board says how to fetch them', async () => {
    for (const job of listedJobs) {
      await testApp.call('PATCH', `/api/jobs/${String(job.id)}`, { status: 'dismissed' });
    }

    const board = await page('/?origin=other');

    expect(board).toContain('No new jobs from other sources.');
    expect(board).toContain('<code>node scripts/fetch-sources.ts</code>');
  });

  it('NFR-09: an unknown origin is a 400 page', async () => {
    expect(await page('/?origin=greenhouse', 400)).toContain('The query string is invalid');
  });

  it('FR-17: an other-source job page shows its source, details, description and listing sighting', async () => {
    const job = jobAt(listedJobs, 'Example Labs');

    const detail = await page(`/jobs/${String(job.id)}`);

    expect(detail).toContain('href="/?origin=other&amp;tab=new"');
    expect(detail).toContain('>Open on Greenhouse<');
    expect(detail).toMatch(/<dt>Source<\/dt>\s*<dd>Greenhouse<\/dd>/);
    expect(detail).toMatch(/<dt>Greenhouse job ID<\/dt>\s*<dd>5550001<\/dd>/);
    expect(detail).toMatch(/<dt>Salary<\/dt>\s*<dd>\$150K – \$180K<\/dd>/);
    expect(detail).toContain('<dt>Posted</dt>');
    expect(detail).toContain('<h2 id="description-heading">Description</h2>');
    expect(detail).toContain(
      '<div class="description">About the role\n\nOwn the test platform.\n• Playwright\n• k6</div>',
    );
    expect(detail.replace(/\s+/g, ' ')).toContain(`Listed on Greenhouse · <a href="/runs">run ${String(runId)}</a>`);
  });

  it('FR-17: a job page without a description or salary leaves those out', async () => {
    const detail = await page(`/jobs/${String(jobAt(listedJobs, 'Sample Co').id)}`);

    expect(detail).not.toContain('Description</h2>');
    expect(detail).not.toContain('<dt>Salary</dt>');
    expect(detail).not.toContain('<dt>Posted</dt>');
  });

  it('FR-10: a LinkedIn job page is unchanged: LinkedIn link, job ID, no description', async () => {
    const detail = await page(`/jobs/${String(jobAt(linkedinJobs, 'Workiva').id)}`);

    expect(detail).toContain('href="/?tab=new"');
    expect(detail).toContain('>Open on LinkedIn<');
    expect(detail).toContain('<dt>LinkedIn job ID</dt>');
    expect(detail).not.toContain('Description</h2>');
  });

  it('FR-11: /runs counts each run’s listings', async () => {
    const runs = await page('/runs');

    expect(runs).toContain('<th scope="col" class="num">Listings</th>');
    // Unrecognized 0, then Listings 3, then New jobs 21 (18 from the emails, 3 from the feeds).
    expect(runs).toMatch(/<td class="num">0<\/td>\s*<td class="num">3<\/td>\s*<td class="num">21<\/td>/);
  });
});
