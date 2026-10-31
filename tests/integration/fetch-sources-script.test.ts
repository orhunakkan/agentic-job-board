import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchSources, readConfig, type FetchSourcesOptions } from '../../scripts/fetch-sources.ts';
import { FetchSourcesSummarySchema } from '../../src/sources/fetch-summary.ts';
import { parseSourcesConfig, SourcesConfigError } from '../../src/sources/source-config.ts';
import { CreateRunResponseSchema, JobListResponseSchema, RunSummarySchema } from '../../src/schemas/api.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// scripts/fetch-sources.ts against a real app (FR-15, FR-16). The feeds are faked by URL, so no test ever reaches
// the network; the answers are shaped like the live ones, with made-up companies.

const CONFIG = parseSourcesConfig(
  JSON.stringify({
    keywords: ['dispatcher', 'nurse'],
    excludeKeywords: ['intern'],
    locations: ['remote', 'united states'],
    companies: { greenhouse: ['examplelabs'], lever: ['brokenco'] },
    feeds: { remoteok: true, himalayas: false, jobicy: false, hackernews: true, adzuna: true },
  }),
  'test',
);

const GREENHOUSE = {
  jobs: [
    {
      id: 1001,
      title: 'Senior Dispatcher',
      absolute_url: 'https://job-boards.greenhouse.io/examplelabs/jobs/1001',
      company_name: 'Example Labs',
      location: { name: 'Remote, United States' },
      first_published: '2026-10-20T09:00:00Z',
      content: '&lt;p&gt;Run the night dispatch desk.&lt;/p&gt;',
    },
    {
      id: 1002,
      title: 'Account Executive',
      absolute_url: 'https://job-boards.greenhouse.io/examplelabs/jobs/1002',
      location: { name: 'Remote' },
    },
    {
      id: 1003,
      title: 'Nurse Intern',
      absolute_url: 'https://job-boards.greenhouse.io/examplelabs/jobs/1003',
      location: { name: 'Remote' },
    },
    {
      id: 1004,
      title: 'Nurse Educator',
      absolute_url: 'https://job-boards.greenhouse.io/examplelabs/jobs/1004',
      location: { name: 'Berlin, Germany' },
    },
  ],
};

const REMOTE_OK = [
  { legal: 'API Terms of Service' },
  {
    id: '77',
    position: 'Lead Nurse',
    company: 'Sample Co',
    location: '',
    url: 'https://remoteOK.com/remote-jobs/77',
    date: '2026-10-22T10:00:00Z',
    salary_min: 120_000,
    salary_max: 140_000,
  },
  // The same job again later in the feed: sent once.
  { id: '77', position: 'Lead Nurse', company: 'Sample Co', url: 'https://remoteOK.com/remote-jobs/77' },
];

const HN_STORIES = { hits: [{ objectID: '900', title: 'Ask HN: Who is hiring? (October 2026)' }] };
const HN_POSTS = {
  hits: [
    {
      objectID: '901',
      parent_id: 900,
      created_at: '2026-10-02T10:00:00Z',
      comment_text: 'Acme | Senior Dispatcher | REMOTE (US)<p>We move freight.',
    },
  ],
};

function fakeFeeds(answers: Record<string, unknown>): { fetchJson: FetchSourcesOptions['fetchJson']; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetchJson: (url) => {
      asked.push(url);
      const host = new URL(url).host;
      const key = Object.keys(answers).find((prefix) => url.startsWith(prefix));
      if (key === undefined) return Promise.reject(new Error(`HTTP 404 from ${host}`));
      return Promise.resolve(answers[key]);
    },
  };
}

const ANSWERS = {
  'https://boards-api.greenhouse.io/v1/boards/examplelabs/': GREENHOUSE,
  'https://remoteok.com/api': REMOTE_OK,
  'https://hn.algolia.com/api/v1/search_by_date': HN_STORIES,
  'https://hn.algolia.com/api/v1/search?tags=comment,story_900': HN_POSTS,
};

describe('scripts/fetch-sources.ts', () => {
  let testApp: TestApp;
  let lines: string[];

  beforeEach(async () => {
    testApp = await startTestApp();
    lines = [];
  });
  afterEach(async () => {
    await testApp.close();
  });

  function options(overrides: Partial<FetchSourcesOptions> = {}): FetchSourcesOptions {
    return {
      config: CONFIG,
      adzunaKey: null,
      appUrl: testApp.url,
      runId: null,
      dryRun: false,
      fetchJson: fakeFeeds(ANSWERS).fetchJson,
      log: (line) => lines.push(line),
      ...overrides,
    };
  }

  async function jobs(origin: 'linkedin' | 'other') {
    return JobListResponseSchema.parse((await testApp.get(`/api/jobs?origin=${origin}`)).body);
  }

  it('FR-15: a dry run lists the matching jobs and sends nothing', async () => {
    const summary = await fetchSources(options({ dryRun: true }));

    expect(summary).toEqual({
      runId: null,
      feeds: 5, // the Hacker News thread, then its posts

      fetched: 7,
      matched: 3,
      new: 0,
      seenAgain: 0,
      repeated: 0,
      failures: ['Lever brokenco: HTTP 404 from api.lever.co'],
    });
    expect(lines).toContain('Greenhouse examplelabs: 4 jobs, 1 matching');
    expect(lines).toContain('  Senior Dispatcher · Example Labs · Remote, United States · Greenhouse');
    expect(lines).toContain('  Lead Nurse · Sample Co · Remote · Remote OK');
    expect(lines).toContain('Lever brokenco: HTTP 404 from api.lever.co (skipped)');
    expect((await jobs('other')).total).toBe(0);
    expect(FetchSourcesSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('FR-15: without --run it stores the matches in a run of its own and finishes it', async () => {
    const summary = await fetchSources(options());

    expect(summary).toMatchObject({ matched: 3, new: 3, seenAgain: 0, repeated: 0 });
    const runs = RunSummarySchema.array().parse((await testApp.get('/api/runs')).body);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: summary.runId, listingsSeen: 3, jobsNew: 3, emailsSeen: 0 });
    expect(runs[0]?.finishedAt).not.toBeNull();

    const stored = await jobs('other');
    expect(stored.items.map((job) => [job.source, job.title, job.company]).sort()).toEqual([
      ['greenhouse', 'Senior Dispatcher', 'Example Labs'],
      ['hackernews', 'Senior Dispatcher', 'Acme'],
      ['remoteok', 'Lead Nurse', 'Sample Co'],
    ]);
    expect((await jobs('linkedin')).total).toBe(0);
  });

  it('FR-16: a second fetch counts the same jobs as seen again, never as new', async () => {
    await fetchSources(options());

    const again = await fetchSources(options());

    expect(again).toMatchObject({ new: 0, seenAgain: 3 });
    expect((await jobs('other')).total).toBe(3);
  });

  it('FR-15: with --run it adds to the open run and leaves it open for scoring', async () => {
    const { runId } = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body);

    const summary = await fetchSources(options({ runId }));

    expect(summary.runId).toBe(runId);
    const runs = RunSummarySchema.array().parse((await testApp.get('/api/runs')).body);
    expect(runs).toEqual([expect.objectContaining({ id: runId, finishedAt: null, listingsSeen: 3 })]);
  });

  it('FR-15: sends large batches in calls of at most 25 listings', async () => {
    const many = {
      jobs: Array.from({ length: 60 }, (_, index) => ({
        id: 2000 + index,
        title: `Dispatcher ${String(index)}`,
        absolute_url: `https://job-boards.greenhouse.io/examplelabs/jobs/${String(2000 + index)}`,
        location: { name: 'Remote' },
      })),
    };
    const config = { ...CONFIG, feeds: { ...CONFIG.feeds, remoteok: false, hackernews: false } };

    const summary = await fetchSources(
      options({ config, fetchJson: fakeFeeds({ 'https://boards-api.greenhouse.io/': many }).fetchJson }),
    );

    expect(summary).toMatchObject({ matched: 60, new: 60 });
    expect(testApp.logs.filter((line) => line.includes('/listings')).length).toBe(3);
  });

  it('NFR-12: the Adzuna key is used in the request, never printed or reported', async () => {
    const feeds = fakeFeeds(ANSWERS);
    const summary = await fetchSources(
      options({ dryRun: true, adzunaKey: { appId: 'id-1', appKey: 'SECRET-KEY' }, fetchJson: feeds.fetchJson }),
    );

    expect(feeds.asked.some((url) => url.includes('app_key=SECRET-KEY'))).toBe(true);
    expect(JSON.stringify([lines, summary])).not.toContain('SECRET-KEY');
    expect(summary.failures).toContain('Adzuna "dispatcher": HTTP 404 from api.adzuna.com');
  });

  it('FR-15: a feed whose answer has the wrong shape is a failure, not an empty feed', async () => {
    const summary = await fetchSources(
      options({
        dryRun: true,
        fetchJson: fakeFeeds({ ...ANSWERS, 'https://remoteok.com/api': { oops: 1 } }).fetchJson,
      }),
    );

    expect(summary.failures).toContain('Remote OK: unexpected answer (1 problems)');
    expect(summary.matched).toBe(2);
  });

  it('FR-15: stops with a clear message when the app is not running', async () => {
    await expect(fetchSources(options({ appUrl: 'http://127.0.0.1:9' }))).rejects.toThrow(
      'The app is not running at http://127.0.0.1:9. Start it with npm start.',
    );
  });

  it('FR-15: stops with the app’s error when the run is already finished', async () => {
    const { runId } = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body);
    await testApp.post(`/api/runs/${String(runId)}/finish`);

    await expect(fetchSources(options({ runId }))).rejects.toThrow(/failed with HTTP 409 \(run_finished: /);
  });
});

describe('scripts/fetch-sources.ts on the command line', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'fetch-sources-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Every feed off and no companies: the script runs end to end without a single request.
  function run(...args: string[]) {
    const result = spawnSync(process.execPath, ['scripts/fetch-sources.ts', ...args], { cwd: root, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('FR-15: a dry run prints the JSON summary as its last line', () => {
    const config = join(dir, 'quiet.json');
    writeFileSync(
      config,
      JSON.stringify({
        keywords: ['dispatcher'],
        feeds: { remoteok: false, himalayas: false, jobicy: false, hackernews: false, adzuna: false },
      }),
    );

    const { status, stdout } = run('--dry-run', '--config', config);

    expect(status).toBe(0);
    const last = stdout.trim().split('\n').at(-1) ?? '';
    expect(FetchSourcesSummarySchema.parse(JSON.parse(last))).toMatchObject({ runId: null, feeds: 0, matched: 0 });
  });

  it('FR-15: a missing sources file is explained, and nothing runs', () => {
    const { status, stderr } = run('--dry-run', '--config', join(dir, 'missing.json'));

    expect(status).toBe(2);
    expect(stderr).toContain('missing.json not found. Copy sources.example.json to data/sources.json');
  });

  it('FR-15: a bad --run value prints the usage', () => {
    const { status, stderr } = run('--run', 'seven', '--config', join(dir, 'missing.json'));

    expect(status).toBe(2);
    expect(stderr).toContain('Usage: node scripts/fetch-sources.ts');
  });

  it('FR-15: readConfig reads and checks the file', () => {
    const config = join(dir, 'typo.json');
    writeFileSync(config, '{"keyword":["nurse"]}');

    expect(() => readConfig(config)).toThrow(SourcesConfigError);
  });
});
