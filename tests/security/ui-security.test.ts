import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IngestListingsResponseSchema } from '../../src/schemas/api.ts';
import { seedBoard } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// PLAN.md §8.1 type 6 for the HTML pages (Phase 6): hostile text from LinkedIn searches (every field of a job,
// its description and the search name) and from the owner's own input is escaped on every page, form posts from
// other sites are refused, and pages never carry script.

const HOSTILE_TITLE = '<script>alert(1)</script>';
const HOSTILE_COMPANY = '<img src=x onerror=alert(2)>';

const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// Form posts another site could make: the board must refuse every one.
const CROSS_SITE_HEADERS: [string, Record<string, string>][] = [
  ['a foreign Origin', { Origin: 'http://evil.example' }],
  ['Sec-Fetch-Site: cross-site', { 'Sec-Fetch-Site': 'cross-site', Origin: 'http://evil.example' }],
  ['an opaque "null" Origin', { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }],
];

describe('HTML page security', () => {
  let testApp: TestApp;
  let jobId: number;

  beforeEach(async () => {
    testApp = await startTestApp();
    const { runId } = await seedBoard(testApp);
    const response = await testApp.post(`/api/runs/${String(runId)}/listings`, {
      listings: [
        {
          source: 'linkedin',
          sourceJobId: '77',
          title: HOSTILE_TITLE,
          company: HOSTILE_COMPANY,
          location: '" onmouseover="alert(4)',
          url: 'https://www.linkedin.com/jobs/view/77/',
          postedAt: '2026-10-23T10:00:00.000Z',
          salary: '<i>$1</i>',
          description: 'About the job\n<script>alert(5)</script>\n<b>Apply</b> now',
          workplace: 'remote',
          searchName: '"><svg onload=alert(3)>',
        },
      ],
    });
    const [job] = IngestListingsResponseSchema.parse(response.body).newJobs;
    jobId = job?.id ?? 0;
    await testApp.post(`/api/runs/${String(runId)}/scores`, {
      rubricVersion: 'triage-v1',
      scores: [{ jobId, score: 80, label: 'strong', reason: '<iframe src=//evil.example>' }],
    });
    await testApp.form(`/jobs/${String(jobId)}/notes`, { notes: '</textarea><script>alert(6)</script>' });
    await testApp.call('PUT', '/api/profile', {
      field: '<script>alert(9)</script>',
      summary: '<img src=x onerror=alert(10)>',
      targetRoles: ['<script>alert(7)</script>'],
      seniority: 'senior',
      yearsExperience: 8,
      coreSkills: ['<b>x</b>'],
      secondarySkills: [],
      credentials: ['<u>z</u>'],
      locations: { remote: ['<s>r</s>'], hybridAreas: ['<i>y</i>'], onsiteAreas: [], relocate: false },
      workAuthorization: '"><script>alert(8)</script>',
      dealBreakers: [],
      excludedCompanies: [],
    });
  });
  afterEach(async () => {
    await testApp.close();
  });

  const pages = () => [
    '/',
    '/?q=script',
    `/?changed=${String(jobId)}`,
    `/jobs/${String(jobId)}`,
    `/jobs/${String(jobId)}?notes=saved`,
    '/runs',
    '/profile',
  ];

  it('NFR-07: hostile text from LinkedIn searches, scores, notes and the profile is escaped on every page', async () => {
    for (const path of pages()) {
      const { text } = await testApp.get(path);

      // Escaped text may still read "onerror=" or "onmouseover"; it is only dangerous as real markup.
      expect(text, path).not.toMatch(/<script|<img|<svg|<iframe|<b>|<i>|<u>|<s>|<\/textarea><|<[^>]*\son[a-z]+=/i);
    }

    expect((await testApp.get('/?q=script')).text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const detail = (await testApp.get(`/jobs/${String(jobId)}`)).text;
    expect(detail).toContain('&lt;/textarea&gt;&lt;script&gt;alert(6)');
    expect(detail).toContain('&lt;script&gt;alert(5)&lt;/script&gt;');
    expect(detail).toContain('“&quot;&gt;&lt;svg onload=alert(3)&gt;”');
    const profile = (await testApp.get('/profile')).text;
    expect(profile).toContain('&quot;&gt;&lt;script&gt;alert(8)');
    expect(profile).toContain('&lt;script&gt;alert(9)&lt;/script&gt;');
    expect(profile).toContain('&lt;img src=x onerror=alert(10)&gt;');
    expect(profile).toContain('&lt;u&gt;z&lt;/u&gt;');
    expect(profile).toContain('&lt;s&gt;r&lt;/s&gt;');
  });

  it('NFR-07: a hostile search term is escaped where the form shows it again', async () => {
    const { text } = await testApp.get(`/?q=${encodeURIComponent('"><script>alert(9)</script>')}`);

    expect(text).toContain('value="&quot;&gt;&lt;script&gt;alert(9)&lt;/script&gt;"');
    expect(text).not.toContain('<script');
  });

  it('DEC-006: no page carries script, inline handlers or inline styles', async () => {
    for (const path of pages()) {
      const { text } = await testApp.get(path);

      expect(text, path).not.toMatch(/<script|<[^>]*\s(?:on[a-z]+|style)=/i);
    }
  });

  it('NFR-01: every page has the security headers, and the CSP allows no inline code', async () => {
    for (const path of pages()) {
      const response = await testApp.raw({ path });

      expect(response.headers, path).toMatchObject({
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'x-frame-options': 'DENY',
        'cache-control': 'no-store',
      });
      expect(response.headers['content-security-policy']).toBe(CSP);
    }
  });

  it('NFR-03: every LinkedIn link opens in a new tab without an opener or referrer', async () => {
    for (const path of ['/', `/jobs/${String(jobId)}`]) {
      const links = (await testApp.get(path)).text.match(/<a [^>]*linkedin\.com[^>]*>/g) ?? [];

      expect(links.length, path).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toMatch(/href="https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/"/);
        expect(link).toContain('rel="noopener noreferrer"');
      }
    }
  });

  it.each(CROSS_SITE_HEADERS)(
    'NFR-01: a form post with %s is refused with 403 and changes nothing',
    async (_case, headers) => {
      const status = await testApp.form(`/jobs/${String(jobId)}/status`, { status: 'dismissed' }, headers);
      const notes = await testApp.form(`/jobs/${String(jobId)}/notes`, { notes: 'pwned' }, headers);

      expect(status.status).toBe(403);
      expect(notes.status).toBe(403);
      expect(status.text).toContain('Requests from other sites are not allowed');
      expect((await testApp.get(`/api/jobs/${String(jobId)}`)).body).toMatchObject({
        status: 'new',
        notes: '</textarea><script>alert(6)</script>',
      });
    },
  );

  it.each([
    '/static/..%2fpackage.json',
    '/static/%2e%2e%2fsrc%2fmain.ts',
    '/static/..%5C..%5C.env',
    '/static/app.css%00.txt',
    '/static/APP.CSS',
    '/public/app.css',
  ])('NFR-08: %s is 404, never a file', async (path) => {
    const response = await testApp.raw({ path });

    expect(response.status).toBe(404);
    expect(response.text).not.toMatch(/"dependencies"|startApp|DB_PATH|prefers-color-scheme/);
  });

  it.each(CROSS_SITE_HEADERS)(
    'FR-23, NFR-01: a theme form post with %s is refused with 403 and sets no cookie',
    async (_case, headers) => {
      const response = await testApp.form('/theme', { theme: 'dark', return: '/' }, headers);

      expect(response.status).toBe(403);
      expect(response.text).toContain('Requests from other sites are not allowed');
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it('FR-23, NFR-01: the theme cookie is out of reach of scripts and is not sent on other sites’ posts', async () => {
    const response = await testApp.form('/theme', { theme: 'light', return: '/runs' });
    const [cookie, ...others] = response.headers.getSetCookie();
    const attributes = (cookie ?? '').split(';').map((part) => part.trim());

    expect(others).toEqual([]);
    expect(attributes[0]).toBe('theme=light');
    expect(attributes).toContain('HttpOnly');
    expect(attributes).toContain('SameSite=Lax');
    expect(attributes).toContain('Path=/');
    expect(attributes.some((attribute) => /^Domain=/i.test(attribute))).toBe(false);
  });

  it('FR-23, DEC-006: with either theme chosen, no page gains script, inline handlers or inline styles, and the CSP is unchanged', async () => {
    for (const theme of ['dark', 'light', '"><script>alert(10)</script>']) {
      for (const path of [...pages(), '/nope', `/nope?"><script>alert(11)</script>`]) {
        const response = await testApp.raw({ path, headers: { Cookie: `theme=${encodeURIComponent(theme)}` } });

        expect(response.text, path).not.toMatch(/<script|<img|<svg|<[^>]*\s(?:on[a-z]+|style)=/i);
        expect(response.headers['content-security-policy']).toBe(CSP);
      }
    }
  });

  it('FR-23, NFR-07: the toggle’s return path is escaped on every page, also on an error page for a hostile address', async () => {
    const { text } = await testApp.get(`/nope?q=${encodeURIComponent('"><script>alert(12)</script>')}`);

    expect(text).toContain('name="return" value="/nope?q=%22%3E%3Cscript%3Ealert%2812%29%3C%2Fscript%3E"');
    expect(text).not.toContain('<script');
  });
});
