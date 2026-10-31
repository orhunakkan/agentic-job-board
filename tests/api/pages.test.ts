import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobSummary } from '../../src/schemas/api.ts';
import { PAGE_SIZE } from '../../src/ui/routes.ts';
import { SAMPLE_PROFILE } from '../helpers/profiles.ts';
import { jobAt, seedBoard } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// The HTML pages of PLAN.md §6.2 over real HTTP: what each page lists, every form post and its redirect,
// and every error status as a page (FR-07 to FR-12).

const PROFILE = SAMPLE_PROFILE;

/** The job IDs of the board cards, in page order. */
function cardIds(page: string): number[] {
  return [...page.matchAll(/<h3 class="card-title" id="job-(\d+)-title">/g)].map(([, id]) => Number(id));
}

describe('the HTML pages', () => {
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
      ['Optum', 45, 'weak'],
    ] as const;
    await testApp.post(`/api/runs/${String(runId)}/scores`, {
      rubricVersion: 'triage-v2',
      scores: scores.map(([company, score, label]) => ({
        jobId: jobAt(jobs, company).id,
        score,
        label,
        reason: `Reason for ${company}`,
      })),
    });
  });
  afterEach(async () => {
    await testApp.close();
  });

  const id = (company: string) => jobAt(jobs, company).id;

  async function page(path: string, status = 200): Promise<string> {
    const response = await testApp.get(path);
    expect(response.status, path).toBe(status);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    return response.text;
  }

  describe('board (FR-07)', () => {
    it('FR-07: lists the New tab by score, best first, unscored last, with tab counts', async () => {
      const board = await page('/');

      expect(cardIds(board).slice(0, 4)).toEqual([
        id('3Pillar'),
        id('Cboe Global Markets'),
        id('Workiva'),
        id('Optum'),
      ]);
      expect(cardIds(board)).toHaveLength(18);
      expect(board).toContain('Showing 1–18 of 18');
      expect(board).toMatch(/href="\/\?tab=new" aria-current="page"\s*>New <span class="count">18<\/span>/);
      expect(board).toContain('Saved <span class="count">0</span>');
    });

    it('FR-07: shows the score as a number and a word, and the reason', async () => {
      const board = await page('/');

      expect(board).toMatch(/<span class="score-value">92<\/span> <span class="score-label">Strong<\/span>/);
      expect(board).toContain('Reason for 3Pillar');
      expect(board).toContain('<span class="score score-none">Unscored</span>');
    });

    it('FR-07: filters by minimum score and by text in the title or company', async () => {
      expect(cardIds(await page('/?minScore=70'))).toEqual([id('3Pillar'), id('Cboe Global Markets'), id('Workiva')]);
      expect(cardIds(await page('/?q=workiva'))).toEqual([id('Workiva')]);
      expect(cardIds(await page('/?q=QA+Automation+Test'))).toEqual([id('Cboe Global Markets')]);
      expect(await page('/?q=nothing-matches')).toContain('No jobs match these filters.');
    });

    it('FR-07: empty filter fields from the form mean "not set"', async () => {
      expect(cardIds(await page('/?tab=new&minScore=&q=&sort=score'))).toHaveLength(18);
    });

    it('FR-07: sorts by recency on request and keeps the choice in the form', async () => {
      const board = await page('/?sort=recent');

      expect(board).toContain('<option value="recent" selected>');
      expect(cardIds(board)[0]).not.toBe(id('3Pillar'));
    });

    it('FR-07: each tab lists only its statuses', async () => {
      await testApp.form(`/jobs/${String(id('Workiva'))}/status`, { status: 'saved' });
      await testApp.form(`/jobs/${String(id('Optum'))}/status`, { status: 'applied' });
      await testApp.form(`/jobs/${String(id('Cboe Global Markets'))}/status`, { status: 'dismissed' });

      expect(cardIds(await page('/?tab=saved'))).toEqual([id('Workiva')]);
      expect(cardIds(await page('/?tab=in-progress'))).toEqual([id('Optum')]);
      expect(cardIds(await page('/?tab=dismissed'))).toEqual([id('Cboe Global Markets')]);
      expect(await page('/?tab=closed')).toContain('No jobs in Closed.');
      expect(cardIds(await page('/'))).toHaveLength(15);
    });

    it('FR-07: pages through long lists', async () => {
      const listings = Array.from({ length: PAGE_SIZE }, (_, index) => ({
        source: 'linkedin',
        sourceJobId: String(900 + index),
        title: `Job ${String(index)}`,
        company: 'Co',
        location: 'Remote',
        url: `https://www.linkedin.com/jobs/view/${String(900 + index)}/`,
        postedAt: null,
        salary: null,
        description: null,
      }));
      for (const batch of [listings.slice(0, 25), listings.slice(25)]) {
        const response = await testApp.post(`/api/runs/${String(runId)}/listings`, { listings: batch });
        expect(response.status).toBe(200);
      }

      const first = await page('/');
      const second = await page('/?tab=new&sort=score&page=2');

      expect(cardIds(first)).toHaveLength(PAGE_SIZE);
      expect(first).toContain('Page 1 of 2');
      expect(first).toContain('href="/?tab=new&amp;sort=score&amp;page=2" rel="next"');
      expect(cardIds(second)).toHaveLength(18);
      expect(second).toContain('rel="prev"');
      expect(new Set([...cardIds(first), ...cardIds(second)]).size).toBe(PAGE_SIZE + 18);
    });

    it('FR-07: a page past the end shows the last page instead of an empty board', async () => {
      const board = await page('/?page=99');

      expect(cardIds(board)).toHaveLength(18);
      expect(board).toContain('Showing 1–18 of 18');
      expect(board).not.toContain('No new jobs');
    });

    it.each(['/?tab=archived', '/?minScore=101', '/?page=0', '/?sort=random', '/?tab=new&tab=saved'])(
      'NFR-09: the board query %s is a 400 page',
      async (path) => {
        expect(await page(path, 400)).toContain('That request is not valid');
      },
    );

    it('FR-07: unknown query parameters are ignored, so old bookmarks still open', async () => {
      expect(cardIds(await page('/?utm_source=x'))).toHaveLength(18);
    });

    it('FR-07, FR-22: the empty New tab tells the owner to press Find Now or run /find-jobs', async () => {
      const empty = await startTestApp();
      try {
        const response = await empty.get('/');
        expect(response.text).toContain('No new jobs. Press Find Now, or run <code>/find-jobs</code>');
        expect(response.text).toContain('No runs yet');
      } finally {
        await empty.close();
      }
    });
  });

  describe('status changes from a form (FR-08)', () => {
    it('FR-08: moves the job, records it, and redirects back to the board with a notice', async () => {
      const jobId = id('3Pillar');

      const response = await testApp.form(`/jobs/${String(jobId)}/status`, {
        status: 'saved',
        return: '/?tab=new&q=x',
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`/?tab=new&q=x&changed=${String(jobId)}#notice`);
      expect((await testApp.get(`/api/jobs/${String(jobId)}`)).body).toMatchObject({
        status: 'saved',
        history: [{ toStatus: 'new' }, { fromStatus: 'new', toStatus: 'saved' }],
      });
      const board = await page(`/?tab=saved&changed=${String(jobId)}`);
      expect(board).toMatch(
        /<p class="notice" role="status" id="notice" tabindex="-1"><a href="\/jobs\/\d+">Senior Quality Assurance Engineer/,
      );
      expect(board).toContain('is now Saved.');
    });

    it('FR-08: without a return path, goes back to the job page with a notice', async () => {
      const jobId = id('Workiva');

      const response = await testApp.form(`/jobs/${String(jobId)}/status`, { status: 'applied' });

      expect(response.headers.get('location')).toBe(`/jobs/${String(jobId)}?changed=${String(jobId)}#notice`);
      expect(await page(`/jobs/${String(jobId)}?changed=${String(jobId)}`)).toContain('Status changed to Applied.');
    });

    it.each([
      ['https://evil.example/', 'another site'],
      ['//evil.example/x', 'a protocol-relative URL'],
      ['/\\evil.example', 'a backslash trick'],
      ['javascript:alert(1)', 'a script URL'],
      ['/ok path', 'a path with a space'],
    ])('NFR-07: a return of %j (%s) falls back to the job page', async (target) => {
      const jobId = id('Optum');

      const response = await testApp.form(`/jobs/${String(jobId)}/status`, { status: 'saved', return: target });

      expect(response.headers.get('location')).toBe(`/jobs/${String(jobId)}?changed=${String(jobId)}#notice`);
    });

    it('FR-08: an invalid transition is a 409 page and changes nothing', async () => {
      const jobId = id('Optum');

      const response = await testApp.form(`/jobs/${String(jobId)}/status`, { status: 'offer' });

      expect(response.status).toBe(409);
      expect(response.text).toContain('That can&#39;t be done');
      expect(response.text).toContain('A job can&#39;t move from new to offer');
      expect((await testApp.get(`/api/jobs/${String(jobId)}`)).body).toMatchObject({ status: 'new' });
    });

    it.each<[string, Record<string, string>]>([
      ['an unknown status', { status: 'hired' }],
      ['no status', {}],
      ['an extra field', { status: 'saved', admin: '1' }],
    ])('NFR-09: a status form with %s is a 400 page', async (_case, fields) => {
      const response = await testApp.form(`/jobs/${String(id('Optum'))}/status`, fields);

      expect(response.status).toBe(400);
      expect(response.text).toContain('The form is invalid');
    });

    it('NFR-09: a repeated form field is a 400 page', async () => {
      const response = await testApp.raw({
        method: 'POST',
        path: `/jobs/${String(id('Optum'))}/status`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'status=saved&status=dismissed',
      });

      expect(response.status).toBe(400);
    });

    it('FR-08: an unknown job is a 404 page', async () => {
      const response = await testApp.form('/jobs/99999/status', { status: 'saved' });

      expect(response.status).toBe(404);
      expect(response.text).toContain('Not found');
    });

    it('NFR-09: a page form only accepts a form post: JSON is 415', async () => {
      const response = await testApp.call('POST', `/jobs/${String(id('Optum'))}/status`, { status: 'saved' });

      expect(response.status).toBe(415);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.text).toContain('application/x-www-form-urlencoded');
    });

    it('NFR-09: the JSON API does not accept form posts: 415 as JSON', async () => {
      const response = await testApp.form(`/api/jobs/${String(id('Optum'))}`, { status: 'saved' });

      expect(response.status).toBe(405);
      const created = await testApp.form('/api/runs', {});
      expect(created.status).toBe(415);
      expect(JSON.parse(created.text)).toMatchObject({ error: { code: 'unsupported_media_type' } });
    });
  });

  describe('job detail and notes (FR-09, FR-10)', () => {
    it('FR-10: shows every field, the score, history, sightings and the LinkedIn link', async () => {
      const detail = await page(`/jobs/${String(id('Cboe Global Markets'))}`);

      expect(detail).toContain('<h1>Senior QA Automation Test Engineer</h1>');
      expect(detail).toContain('Cboe Global Markets · Chicago, IL');
      expect(detail).toContain('Reason: Reason for Cboe Global Markets');
      expect(detail).toContain('href="https://www.linkedin.com/jobs/view/4473592349/" target="_blank"');
      expect(detail).toContain('rel="noopener noreferrer"');
      expect(detail).toContain('Created as New');
      expect(detail).toContain('Alert: Test Automation Engineer');
      expect(detail).toContain('<dt>Rubric</dt>');
      expect(detail).toContain('triage-v2: scored on the title, company and location only');
      expect(detail).toContain('triage-v2');
      expect(detail).toContain('<dd>4473592349</dd>');
      expect(detail).toContain('href="/?tab=new"');
    });

    it('FR-08: the status form offers only the allowed next statuses', async () => {
      const detail = await page(`/jobs/${String(id('Optum'))}`);
      const options = [...detail.matchAll(/<option value="(\w+)">/g)].map(([, value]) => value);

      expect(options).toEqual(['saved', 'applied', 'dismissed']);
    });

    it('FR-08: a final status offers no change at all', async () => {
      const jobId = id('Optum');
      for (const status of ['applied', 'rejected']) {
        await testApp.form(`/jobs/${String(jobId)}/status`, { status });
      }

      const detail = await page(`/jobs/${String(jobId)}`);

      expect(detail).toContain("Rejected is a final status, so it can't change any more.");
      expect(detail).not.toContain('<form class="status-form"');
      expect(detail).toContain('href="/?tab=closed"');
    });

    it('FR-10: an unscored job says so', async () => {
      expect(await page(`/jobs/${String(id('BECU'))}`)).toContain('Not scored yet');
    });

    it('FR-09: saves notes and shows them again, line breaks intact', async () => {
      const jobId = id('3Pillar');

      const response = await testApp.form(`/jobs/${String(jobId)}/notes`, {
        notes: '\r\nCall recruiter\r\n<b>Friday</b>',
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`/jobs/${String(jobId)}?notes=saved#notice`);
      expect((await testApp.get(`/api/jobs/${String(jobId)}`)).body).toMatchObject({
        notes: '\nCall recruiter\n<b>Friday</b>',
      });
      const detail = await page(`/jobs/${String(jobId)}?notes=saved`);
      expect(detail).toContain('Notes saved.');
      // One newline after the tag is dropped by the browser, so the note's own leading newline survives.
      expect(detail).toContain(
        'aria-describedby="notes-hint">\n\nCall recruiter\n&lt;b&gt;Friday&lt;/b&gt;</textarea>',
      );
    });

    it('FR-09: notes of 5,000 characters are kept; 5,001 is a 400 page', async () => {
      const jobId = id('3Pillar');

      expect((await testApp.form(`/jobs/${String(jobId)}/notes`, { notes: 'x'.repeat(5000) })).status).toBe(303);
      expect((await testApp.form(`/jobs/${String(jobId)}/notes`, { notes: 'y'.repeat(5001) })).status).toBe(400);
      expect((await testApp.get(`/api/jobs/${String(jobId)}`)).body).toMatchObject({ notes: 'x'.repeat(5000) });
    });

    it('FR-09: CRLF line breaks count once toward the limit', async () => {
      const response = await testApp.form(`/jobs/${String(id('3Pillar'))}/notes`, { notes: 'ab\r\n'.repeat(1250) });

      expect(response.status).toBe(303);
    });

    it.each(['/jobs/99999', '/jobs/abc', '/jobs/0'])('FR-10: %s is a 404 or 400 page', async (path) => {
      const response = await testApp.get(path);

      expect([400, 404]).toContain(response.status);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    });
  });

  describe('runs and profile (FR-01, FR-11, FR-12)', () => {
    it('FR-11: lists every run with its counts, and the header shows the last one', async () => {
      await testApp.post(`/api/runs/${String(runId)}/finish`);
      const runs = await page('/runs');

      expect(runs).toContain('Every /find-jobs run, newest first');
      expect(runs).toMatch(/<th scope="row">1<\/th>/);
      expect(runs).toContain('<td class="num">18</td>');
      expect(runs).toMatch(/Last run: <a href="\/runs">[^<]+<\/a> · 18 new · 0\s+seen again/);
    });

    it('FR-11: an unfinished run says so', async () => {
      expect(await page('/runs')).toContain('Not finished');
    });

    it('FR-11: keeps the email counts of runs from the email years; the unrecognized-email list is gone (DEC-041)', async () => {
      const runs = await page('/runs');

      expect(runs).toMatch(/<td class="num">3<\/td>\s*<td class="num">3<\/td>\s*<td class="num">0<\/td>/);
      expect(runs).not.toContain('Unrecognized emails</h2>');
    });

    it('FR-01: the profile page explains how to load a profile until one exists', async () => {
      const empty = await startTestApp({ setup: 'none' });
      try {
        expect((await empty.get('/profile')).text).toContain('No profile yet.');
      } finally {
        await empty.close();
      }
    });

    it('FR-01: shows every profile field, with nothing to type into on the page itself', async () => {
      await testApp.call('PUT', '/api/profile', PROFILE);

      const profile = await page('/profile');

      for (const text of [
        'Freight and logistics dispatch',
        'Dispatcher for a regional carrier; looking for a lead role on a larger fleet.',
        '<li>Truck Dispatcher</li>',
        'Senior, 8 years of experience',
        '<li>Load planning</li>',
        '<li>Spanish</li>',
        '<li>CDL-A</li>',
        '<li>Remote: United States</li>',
        '<li>Hybrid: Austin, TX</li>',
        'Not relocating.',
        'US, no sponsorship needed',
        '<li>overnight shifts only</li>',
        '<li>Example Freight Co</li>',
      ]) {
        expect(profile).toContain(text);
      }
      // The header's theme toggle is a form on every page (FR-23); the profile is changed on its own form page.
      expect(/<main[\s\S]*<\/main>/.exec(profile)?.[0]).not.toContain('<form');
    });

    it('FR-01: empty lists read "None"', async () => {
      await testApp.call('PUT', '/api/profile', {
        ...PROFILE,
        secondarySkills: [],
        credentials: [],
        excludedCompanies: [],
      });

      expect((await page('/profile')).match(/<dd>None<\/dd>/g)).toHaveLength(3);
    });
  });

  describe('static files and errors', () => {
    it('FR-07: serves the stylesheet and the icon with their types', async () => {
      const css = await testApp.get('/static/app.css');
      const icon = await testApp.get('/static/favicon.svg');

      expect(css.status).toBe(200);
      expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(css.text).toContain('prefers-color-scheme: dark');
      expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    });

    it.each(['/static/nope.css', '/static/', '/static/app.css/x', '/nope'])(
      'NFR-09: %s is a 404 page',
      async (path) => {
        const response = await testApp.get(path);

        expect(response.status).toBe(404);
        expect(response.text).toContain('<h1>Not found</h1>');
      },
    );

    it('NFR-09: a page with the wrong method is a 405 page that names the allowed method', async () => {
      const response = await testApp.form('/runs', {});

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expect(response.text).toContain('Use GET for this path');
    });

    it('NFR-09: a page that fails is a 500 page without details', async () => {
      testApp.app.db.close();

      const response = await testApp.get('/');

      expect(response.status).toBe(500);
      expect(response.text).toContain('Something went wrong; see the server log');
      expect(response.text).not.toMatch(/sqlite|stack|database is not open/i);
    });
  });

  describe('the theme toggle (FR-23, DEC-061)', () => {
    const htmlTag = (text: string) => /<html[^>]*>/.exec(text)?.[0] ?? '';
    const returnField = (text: string) =>
      /<form class="theme-form"[\s\S]*?name="return" value="([^"]*)"/.exec(text)?.[1]?.replaceAll('&amp;', '&');

    it('FR-23: POST /theme keeps the choice in a cookie and goes back to the page it came from', async () => {
      const response = await testApp.form('/theme', { theme: 'dark', return: '/?origin=other&tab=saved&q=sdet' });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/?origin=other&tab=saved&q=sdet');
      expect(response.headers.getSetCookie()).toEqual(['theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly']);
    });

    it('FR-23: choosing light sets the light cookie, and no return path goes to the board', async () => {
      const response = await testApp.form('/theme', { theme: 'light' });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      expect(response.headers.getSetCookie()).toEqual([
        'theme=light; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly',
      ]);
    });

    it.each(['//evil.example', '//evil.example/x', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)'])(
      'FR-23, NFR-07: an unsafe return of %j goes to the board',
      async (target) => {
        const response = await testApp.form('/theme', { theme: 'dark', return: target });

        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe('/');
      },
    );

    it.each<[string, Record<string, string>]>([
      ['no theme', { return: '/' }],
      ['another theme', { theme: 'sepia', return: '/' }],
      ['an extra field', { theme: 'dark', admin: '1' }],
    ])('FR-23, NFR-09: a theme form with %s is a 400 page and sets no cookie', async (_case, fields) => {
      const response = await testApp.form('/theme', fields);

      expect(response.status).toBe(400);
      expect(response.text).toContain('The form is invalid');
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    it('FR-23: every page with the dark cookie is dark, error pages included', async () => {
      for (const path of ['/', '/?origin=other', `/jobs/${String(id('Workiva'))}`, '/runs', '/profile', '/nope']) {
        const response = await testApp.raw({ path, headers: { Cookie: 'theme=dark' } });

        expect(htmlTag(response.text), path).toBe('<html lang="en" data-theme="dark">');
      }
      const light = await testApp.raw({ path: '/runs', headers: { Cookie: 'other=1; theme=light' } });
      expect(htmlTag(light.text)).toBe('<html lang="en" data-theme="light">');
    });

    it.each(['theme=junk', 'theme=', 'theme', 'Theme=dark', ''])(
      'FR-23: a page with the cookie %j follows the system',
      async (cookie) => {
        const response = await testApp.raw({ path: '/', headers: cookie === '' ? {} : { Cookie: cookie } });

        expect(response.status).toBe(200);
        expect(response.text).not.toContain('data-theme');
      },
    );

    it('FR-23: the toggle comes back to the page with its filters, without the one-time notice', async () => {
      const jobId = id('Workiva');

      expect(returnField(await page(`/?origin=other&tab=saved&q=sdet&changed=${String(jobId)}`))).toBe(
        '/?origin=other&tab=saved&q=sdet',
      );
      expect(returnField(await page('/?origin=other&tab=new&cleared=3'))).toBe('/?origin=other&tab=new');
      expect(returnField(await page(`/jobs/${String(jobId)}?notes=saved`))).toBe(`/jobs/${String(jobId)}`);
      expect(returnField(await page('/runs'))).toBe('/runs');
      expect(returnField(await page('/profile'))).toBe('/profile');
    });

    it('FR-23: an error page has the toggle; after a failed form post it comes back to the board', async () => {
      expect(returnField(await page('/nope?x=1', 404))).toBe('/nope?x=1');

      const failed = await testApp.form(`/jobs/${String(id('Optum'))}/status`, { status: 'offer' });

      expect(failed.status).toBe(409);
      expect(returnField(failed.text)).toBe('/');
    });
  });
});
