import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobListResponseSchema } from '../../src/schemas/api.ts';
import { seedBoard } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// PLAN.md §8.1 type 6. Threat model: a single user on 127.0.0.1; the danger is other websites open in the
// same browser (DNS rebinding, cross-site form posts) and hostile text inside LinkedIn emails.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe('HTTP security', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await startTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  /** The test cases write PORT where the app's own port goes. */
  const withPort = (value: string) => value.replace('PORT', String(testApp.port));

  describe('NFR-01: localhost only', () => {
    it('NFR-01: listens on 127.0.0.1 and nowhere else', async () => {
      expect(testApp.app.server.address()).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
      expect(await canConnect('127.0.0.1', testApp.port)).toBe(true);
    });

    it('NFR-01: is unreachable on every other network address of this machine', async () => {
      const others = Object.values(networkInterfaces()).flatMap((addresses = []) =>
        addresses.filter((entry) => !entry.internal).map((entry) => entry.address),
      );

      // A machine with no network adapter has nothing else to check; the bind address above still holds.
      for (const address of others) {
        expect({ address, reachable: await canConnect(address, testApp.port) }).toEqual({ address, reachable: false });
      }
    });
  });

  describe('DNS rebinding guard (Host header)', () => {
    it.each([
      'evil.example',
      'evil.example:PORT',
      '127.0.0.1',
      '127.0.0.1:1',
      'localhost.evil.example:PORT',
      '[::1]:PORT',
    ])('NFR-01: Host "%s" is refused with 421', async (host) => {
      const response = await testApp.raw({ path: '/api/health', headers: { Host: withPort(host) } });

      expect(response.status).toBe(421);
      expect(JSON.parse(response.text)).toMatchObject({ error: { code: 'misdirected_request' } });
    });

    it.each(['127.0.0.1:PORT', 'localhost:PORT', 'LOCALHOST:PORT'])('NFR-01: Host "%s" is served', async (host) => {
      const response = await testApp.raw({ path: '/api/health', headers: { Host: withPort(host) } });

      expect(response.status).toBe(200);
    });
  });

  describe('cross-site request guard', () => {
    /** Starts a run (a write) with the given request headers. */
    function postRun(headers: Record<string, string>) {
      const withPorts = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, withPort(value)]));
      return testApp.raw({ method: 'POST', path: '/api/runs', headers: { ...JSON_HEADERS, ...withPorts }, body: '{}' });
    }

    it.each<[string, Record<string, string>]>([
      ['a foreign Origin', { Origin: 'http://evil.example' }],
      ['an Origin on another port', { Origin: 'http://127.0.0.1:1' }],
      ['an opaque "null" Origin', { Origin: 'null' }],
      ['an https Origin for localhost', { Origin: 'https://localhost:PORT' }],
      ['Sec-Fetch-Site: cross-site', { 'Sec-Fetch-Site': 'cross-site' }],
      ['Sec-Fetch-Site: same-site', { 'Sec-Fetch-Site': 'same-site' }],
    ])('NFR-01: a write with %s is refused with 403 and changes nothing', async (_case, headers) => {
      const response = await postRun(headers);

      expect(response.status).toBe(403);
      expect(JSON.parse(response.text)).toMatchObject({ error: { code: 'cross_site_request' } });
      expect(JSON.parse((await testApp.raw({ path: '/api/runs' })).text)).toEqual([]);
    });

    it.each<[string, Record<string, string>]>([
      ['no Origin (curl, the /find-jobs agent)', {}],
      ['its own Origin', { Origin: 'http://127.0.0.1:PORT' }],
      ['its own localhost Origin', { Origin: 'http://localhost:PORT' }],
      ['Sec-Fetch-Site: same-origin', { 'Sec-Fetch-Site': 'same-origin', Origin: 'http://127.0.0.1:PORT' }],
      ['Sec-Fetch-Site: none (typed in the address bar)', { 'Sec-Fetch-Site': 'none' }],
    ])('NFR-01: a write with %s is allowed', async (_case, headers) => {
      const response = await postRun(headers);

      expect(response.status).toBe(201);
    });

    it('NFR-01: a cross-site HTML form post cannot even reach the API: it is refused before the content type is checked', async () => {
      const response = await testApp.raw({
        method: 'POST',
        path: '/api/runs',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://evil.example' },
        body: 'a=1',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('security headers', () => {
    it.each<[string, { method?: string; path: string; headers?: Record<string, string>; body?: string }]>([
      ['a 200', { path: '/api/health' }],
      ['a 404', { path: '/nope' }],
      ['a 405', { method: 'DELETE', path: '/api/health' }],
      ['a 400', { method: 'POST', path: '/api/runs', headers: JSON_HEADERS, body: '{' }],
      ['a 421', { path: '/api/health', headers: { Host: 'evil.example' } }],
    ])('NFR-07: %s carries every security header', async (_case, options) => {
      const response = await testApp.raw(options);

      expect(response.headers).toMatchObject({
        'content-security-policy': expect.stringContaining("default-src 'self'") as unknown,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'x-frame-options': 'DENY',
      });
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    });
  });

  describe('hostile text from job sources and users', () => {
    it('NFR-07: a <script> job title is only ever served as a JSON string, never as markup', async () => {
      const { runId } = await seedBoard(testApp);
      await testApp.post(`/api/runs/${String(runId)}/listings`, {
        listings: [
          {
            source: 'linkedin',
            sourceJobId: '77',
            title: '<script>alert(1)</script>',
            company: '<img src=x onerror=alert(2)>',
            location: 'Remote',
            url: 'https://www.linkedin.com/jobs/view/77/',
            postedAt: null,
            salary: null,
            description: null,
          },
        ],
      });

      const response = await testApp.raw({ path: '/api/jobs?q=script' });

      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(JobListResponseSchema.parse(JSON.parse(response.text)).items[0]).toMatchObject({
        title: '<script>alert(1)</script>',
        company: '<img src=x onerror=alert(2)>',
      });
    });

    it.each(["' OR 1=1 --", '"; DROP TABLE jobs; --', "%' UNION SELECT notes FROM jobs --", '\\', '%'])(
      'NFR-07: the search text %j is matched literally, never run as SQL',
      async (searchText) => {
        await seedBoard(testApp);

        const response = await testApp.get(`/api/jobs?q=${encodeURIComponent(searchText)}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ items: [], total: 0 });
        expect(JobListResponseSchema.parse((await testApp.get('/api/jobs')).body).total).toBe(18);
      },
    );

    it('NFR-07: "_" is a literal underscore, not a LIKE wildcard that matches every job', async () => {
      await seedBoard(testApp);

      const response = JobListResponseSchema.parse((await testApp.get('/api/jobs?q=_')).body);

      expect(response.total).toBe(1);
      expect(response.items[0]?.title).toContain('REQ_134');
    });

    it('NFR-07: a LinkedIn link with tracking parameters or one-time tokens is refused and never stored', async () => {
      const { runId } = await seedBoard(testApp);
      const response = await testApp.post(`/api/runs/${String(runId)}/listings`, {
        listings: [
          {
            source: 'linkedin',
            sourceJobId: '88',
            title: 'Dispatcher',
            company: 'Example Co',
            location: 'Remote',
            url: 'https://www.linkedin.com/jobs/view/88/?trackingId=T&otpToken=ONE-TIME-SECRET&midToken=M',
            postedAt: null,
            salary: null,
            description: null,
          },
        ],
      });

      expect(response.status).toBe(400);
      const stored = JSON.stringify(
        ['emails', 'jobs', 'sightings', 'listing_sightings'].map((table) =>
          testApp.app.db.prepare(`SELECT * FROM ${table}`).all(),
        ),
      );
      const served = (await testApp.get('/api/jobs?limit=100')).text;
      for (const text of [stored, served]) {
        expect(text).not.toMatch(/ONE-TIME-SECRET|otpToken|midToken|trackingId/);
      }
      expect(served).not.toContain('https://www.linkedin.com/jobs/view/88/');
    });
  });

  describe('paths and bodies', () => {
    it.each([
      '/static/../../data/profile.json',
      '/static/%2e%2e/%2e%2e/data/profile.json',
      '/%2e%2e/data/jobboard.db',
      '/api/../data/profile.json',
      '/data/profile.json',
      '/.env',
      '/package.json',
    ])('NFR-08: %s is 404, never a file', async (path) => {
      const response = await testApp.raw({ path });

      expect(response.status).toBe(404);
      expect(response.text).not.toMatch(/targetRoles|DB_PATH|"dependencies"/);
    });

    it('NFR-09: a declared body far over the limit is cut off without being read', async () => {
      const result = await testApp
        .raw({
          method: 'POST',
          path: '/api/runs',
          headers: { ...JSON_HEADERS, 'Content-Length': String(64 * 1024 * 1024) },
          body: '{}',
        })
        .then(
          (response) => response.status,
          (error: unknown) => (error instanceof Error ? error.message : 'error'),
        );

      expect(result).not.toBe(201);
      expect((await testApp.get('/api/health')).status).toBe(200);
    });
  });
});
