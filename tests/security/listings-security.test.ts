import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IngestListingsResponseSchema, JobDetailSchema } from '../../src/schemas/api.ts';
import { LISTINGS, seedBoard } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// PLAN.md §8.1 type 6 for the public feeds (Phase 10): anyone can post on some of them (Hacker News), so every
// field of a listing is hostile until escaped, and only safe links get in.

const HOSTILE = {
  ...LISTINGS[0],
  sourceJobId: '<b>1</b>',
  title: '<script>alert(1)</script> Dispatcher',
  company: '<img src=x onerror=alert(2)>',
  location: '" onmouseover="alert(3)',
  salary: '<svg onload=alert(4)>',
  description: '</div><script>alert(5)</script><iframe src="https://evil.example"></iframe>',
  // A quote in a link must not end the href attribute.
  url: 'https://evil.example/jobs/1?x="><script>alert(6)</script>',
};

describe('listing security', () => {
  let testApp: TestApp;
  let runId: number;
  let jobId: number;

  beforeEach(async () => {
    testApp = await startTestApp();
    ({ runId } = await seedBoard(testApp));
    const response = await testApp.post(`/api/runs/${String(runId)}/listings`, { listings: [HOSTILE] });
    jobId = IngestListingsResponseSchema.parse(response.body).newJobs[0]?.id ?? 0;
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('NFR-07: hostile listing text is stored as given and escaped on every page', async () => {
    const detail = JobDetailSchema.parse((await testApp.get(`/api/jobs/${String(jobId)}`)).body);
    expect(detail.description).toBe(HOSTILE.description);

    for (const path of ['/?origin=other', `/jobs/${String(jobId)}`]) {
      const { text } = await testApp.get(path);

      expect(text, path).not.toMatch(/<script|<img|<svg|<iframe|<b>|<[^>]*\son[a-z]+=/i);
      expect(text, path).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Dispatcher');
    }
    expect((await testApp.get(`/jobs/${String(jobId)}`)).text).toContain(
      '&lt;/div&gt;&lt;script&gt;alert(5)&lt;/script&gt;',
    );
  });

  it('NFR-07: a link with quotes stays inside its href', async () => {
    const { text } = await testApp.get('/?origin=other');
    const links = text.match(/<a class="external"[^>]*>/g) ?? [];

    expect(links).toHaveLength(1);
    expect(links[0]).toContain('href="https://evil.example/jobs/1?x=&quot;&gt;&lt;script&gt;');
  });

  it('NFR-03: every link to another source opens in a new tab without an opener or referrer', async () => {
    for (const path of ['/?origin=other', `/jobs/${String(jobId)}`]) {
      const links = (await testApp.get(path)).text.match(/<a class="external"[^>]*>/g) ?? [];

      expect(links.length, path).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toMatch(/href="https:\/\//);
        expect(link).toContain('target="_blank"');
        expect(link).toContain('rel="noopener noreferrer"');
      }
    }
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.com/', '//example.com/'])(
    'NFR-07: the API never stores the link %j',
    async (url) => {
      const response = await testApp.post(`/api/runs/${String(runId)}/listings`, { listings: [{ ...HOSTILE, url }] });

      expect(response.status).toBe(400);
    },
  );
});

describe('the feeds are reached only by the script', () => {
  const root = new URL('../../', import.meta.url);

  it('NFR-03: src/sources only parses: it never makes a request', () => {
    const dir = new URL('src/sources/', root);
    for (const file of readdirSync(dir)) {
      const code = readFileSync(new URL(file, dir), 'utf8');

      expect(code, file).not.toMatch(/\bfetch\(|XMLHttpRequest|node:https?|node:net|node:tls/);
    }
  });

  it('NFR-08: git ignores the owner’s data/sources.json but keeps the example', () => {
    const check = (path: string) =>
      spawnSync('git', ['check-ignore', '--no-index', '--quiet', path], { cwd: fileURLToPath(root) }).status;

    expect(check('data/sources.json')).toBe(0);
    expect(check('sources.example.json')).toBe(1);
  });
});
