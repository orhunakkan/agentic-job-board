import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  browserPages,
  LinkedInBusyError,
  LinkedInSignedOutError,
  readConfig,
  searchLinkedIn,
  type LinkedInPages,
  type SearchLinkedInOptions,
} from '../../scripts/search-linkedin.ts';
import type { RawJobPage, RawSearchCard } from '../../src/linkedin/job-page.ts';
import { LinkedInSearchConfigError, parseLinkedInSearchConfig } from '../../src/linkedin/search-config.ts';
import { SearchLinkedInSummarySchema } from '../../src/linkedin/search-summary.ts';
import {
  CreateRunResponseSchema,
  JobDetailSchema,
  JobListResponseSchema,
  RunSummarySchema,
  ScoringQueueResponseSchema,
} from '../../src/schemas/api.ts';
import { FAKE_LINKEDIN_COOKIE_VALUE, fakeLinkedInStorageState } from '../helpers/fixtures.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// scripts/search-linkedin.ts (PLAN.md Phase 11 task 12; FR-18, FR-19) against a real app. The first part feeds it
// LinkedIn's pages as the browser reads them (fakes, made-up jobs); the second opens the saved, sanitized copies of
// a search page and a job page in Chromium. No test ever reaches linkedin.com.

const NOW = '2026-10-24T12:00:00.000Z';

const CONFIG = parseLinkedInSearchConfig(
  JSON.stringify({
    defaults: { location: 'United States', workplace: ['remote'], maxPages: 3 },
    excludeKeywords: ['junior'],
    searches: [
      { name: 'SDET', keywords: 'sdet' },
      { name: 'QA', keywords: 'qa engineer', postedWithin: 'day' },
    ],
  }),
  'test',
);

function card(jobId: string, title: string, company: string, listedText = '2 hours ago'): RawSearchCard {
  return {
    jobId,
    href: `/jobs/view/${jobId}/?trackingId=abc`,
    title,
    company,
    metadata: ['United States (Remote)'],
    listedDate: '2026-10-24',
    listedText,
    footer: [listedText, 'Easy Apply'],
  };
}

function pane(jobId: string, changes: Partial<RawJobPage> = {}): RawJobPage {
  return {
    href: `/jobs/view/${jobId}/?alternateChannel=search`,
    title: `Job ${jobId}`,
    company: 'Example Health',
    tertiary: ['United States', '2 hours ago', '14 applicants'],
    pills: ['$150K/yr - $180K/yr', 'Remote', 'Full-time'],
    descriptionHtml: `<p>Description of job ${jobId}. Playwright and TypeScript.</p>`,
    closed: false,
    ...changes,
  };
}

type SearchAnswer = RawSearchCard[] | 'no-results' | Error;

/** LinkedIn's pages by search keywords (one answer per page, in order) and by job ID; records what was opened. */
function fakePages(searches: Record<string, SearchAnswer[]>, panes: Record<string, RawJobPage | Error> = {}) {
  const searched: string[] = [];
  const opened: string[] = [];
  const pages: LinkedInPages = {
    searchPage(url) {
      searched.push(url);
      const params = new URL(url).searchParams;
      const page = Number(params.get('start') ?? '0') / 25;
      const answer = searches[params.get('keywords') ?? '']?.[page] ?? [];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    jobPage(jobId) {
      opened.push(jobId);
      const answer = panes[jobId] ?? pane(jobId);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return { pages, searched, opened };
}

const SDET_PAGE = [
  card('4490000001', 'Senior SDET (Playwright)', 'Example Health', '41 minutes ago'),
  card('4490000002', 'SDET II', 'Sample Freight', '3 hours ago'),
  card('4490000003', 'Junior SDET', 'Sample Freight'),
  card('4490000004', 'SDET', 'Acme Payments', '3 weeks ago'),
  card('4490000006', 'Test Automation Lead', 'Example Labs', '5 hours ago'),
];
const QA_PAGE = [
  card('4490000002', 'SDET II', 'Sample Freight', '3 hours ago'),
  card('4490000007', 'QA Engineer', 'Acme Payments', '1 hour ago'),
  card('4490000008', 'QA Engineer', 'Old Co', '2 days ago'),
];

describe('scripts/search-linkedin.ts', () => {
  let testApp: TestApp;
  let lines: string[];

  beforeEach(async () => {
    testApp = await startTestApp();
    lines = [];
  });
  afterEach(async () => {
    await testApp.close();
  });

  function options(pages: LinkedInPages, overrides: Partial<SearchLinkedInOptions> = {}): SearchLinkedInOptions {
    return {
      config: CONFIG,
      appUrl: testApp.url,
      runId: null,
      dryRun: false,
      only: null,
      details: true,
      backfill: false,
      pages,
      now: () => NOW,
      log: (line) => lines.push(line),
      ...overrides,
    };
  }

  const standard = () =>
    fakePages({ sdet: [SDET_PAGE], 'qa engineer': [QA_PAGE] }, { '4490000006': pane('4490000006', { closed: true }) });

  async function linkedInJobs() {
    return JobListResponseSchema.parse((await testApp.get('/api/jobs?origin=linkedin&limit=100')).body).items;
  }

  async function detail(jobId: number) {
    return JobDetailSchema.parse((await testApp.get(`/api/jobs/${String(jobId)}`)).body);
  }

  describe('a run', () => {
    it('FR-18, FR-19: stores the jobs posted in the window, with their job pages, as a run of its own', async () => {
      const fake = standard();

      const summary = await searchLinkedIn(options(fake.pages));

      expect(SearchLinkedInSummarySchema.parse(summary)).toEqual({
        runId: 1,
        searches: 2,
        pages: 2,
        cards: 8,
        excluded: 1, // Junior SDET
        older: 2, // 3 weeks ago (SDET, a week's window) and 2 days ago (QA, a day's window)
        matched: 3, // Example Health, Sample Freight and Acme Payments; Example Labs is closed
        detailsRead: 4,
        closed: 1,
        new: 3,
        seenAgain: 0,
        repeated: 0,
        failures: [],
      });
      expect(fake.opened.sort()).toEqual(['4490000001', '4490000002', '4490000006', '4490000007']);

      const jobs = await linkedInJobs();
      expect(jobs.map((job) => job.sourceJobId).sort()).toEqual(['4490000001', '4490000002', '4490000007']);
      const health = await detail(jobs.find((job) => job.sourceJobId === '4490000001')?.id ?? 0);
      expect(health).toMatchObject({
        source: 'linkedin',
        title: 'Job 4490000001',
        url: 'https://www.linkedin.com/jobs/view/4490000001/',
        workplace: 'remote',
        salary: '$150K/yr - $180K/yr',
        easyApply: true,
        postedAt: '2026-10-24T10:00:00.000Z',
        description: 'Description of job 4490000001. Playwright and TypeScript.',
      });
      expect(health.listingSightings.map((sighting) => sighting.searchName)).toEqual(['SDET']);
      const [run] = RunSummarySchema.array().parse((await testApp.get('/api/runs')).body);
      expect(run).toMatchObject({ id: 1, listingsSeen: 3, jobsNew: 3 });
      expect(run?.finishedAt).not.toBeNull();
      expect(lines).toContain('SDET, page 1: 5 jobs, 3 kept');
    });

    it('FR-18: since-last-run covers a week on the first run, then the time since the last search plus an hour', async () => {
      const first = standard();
      await searchLinkedIn(options(first.pages));
      expect(first.searched.map((url) => new URL(url).searchParams.get('f_TPR'))).toEqual(['r604800', 'r86400']);

      const second = standard();
      await searchLinkedIn(options(second.pages));

      // The test app stores sightings at 2026-10-23T12:00:xx, a day before NOW.
      const [sdetWindow] = second.searched.map((url) => Number(new URL(url).searchParams.get('f_TPR')?.slice(1)));
      expect(sdetWindow).toBeGreaterThan(86_400 + 3600 - 60);
      expect(sdetWindow).toBeLessThanOrEqual(86_400 + 3600);
    });

    it('FR-19: reads job pages only for jobs new to the board; the others are sightings from their cards', async () => {
      await searchLinkedIn(options(standard().pages));
      const again = standard();

      const summary = await searchLinkedIn(options(again.pages));

      expect(again.opened).toEqual(['4490000006']); // the closed job never reached the board
      expect(summary).toMatchObject({ new: 0, seenAgain: 3, closed: 1, detailsRead: 1 });
      const health = (await linkedInJobs()).find((job) => job.sourceJobId === '4490000001');
      expect(health?.seenCount).toBe(2);
      expect((await detail(health?.id ?? 0)).description).toBe(
        'Description of job 4490000001. Playwright and TypeScript.',
      );
    });

    it('FR-18: --run adds the jobs to an open run and leaves it open', async () => {
      const runId = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body).runId;

      const summary = await searchLinkedIn(options(standard().pages, { runId }));

      expect(summary.runId).toBe(runId);
      const [run] = RunSummarySchema.array().parse((await testApp.get('/api/runs')).body);
      expect(run).toMatchObject({ id: runId, finishedAt: null, listingsSeen: 3, jobsNew: 3 });
    });

    it('FR-18: --search runs only that search; an unknown name is a configuration error', async () => {
      const fake = standard();

      await searchLinkedIn(options(fake.pages, { only: 'QA' }));

      expect(fake.searched.map((url) => new URL(url).searchParams.get('keywords'))).toEqual(['qa engineer']);
      await expect(searchLinkedIn(options(fake.pages, { only: 'Nope' }))).rejects.toThrow(LinkedInSearchConfigError);
    });

    it('FR-18: --no-details reads no job page; jobs are sent from their cards', async () => {
      const fake = standard();

      const summary = await searchLinkedIn(options(fake.pages, { details: false }));

      expect(fake.opened).toEqual([]);
      expect(summary).toMatchObject({ new: 4, detailsRead: 0, closed: 0 });
      expect((await linkedInJobs()).every((job) => job.workplace === null)).toBe(true);
    });
  });

  describe('paging', () => {
    const full = (prefix: string, listedText = '1 hour ago') =>
      Array.from({ length: 25 }, (_, index) =>
        card(`${prefix}${String(index).padStart(2, '0')}`, 'SDET', 'Example Health', listedText),
      );

    it('FR-18: pages on while pages are full, up to maxPages', async () => {
      const fake = fakePages({ sdet: [full('44910000'), full('44920000'), full('44930000'), full('44940000')] });

      const summary = await searchLinkedIn(options(fake.pages, { only: 'SDET', details: false }));

      expect(fake.searched.map((url) => new URL(url).searchParams.get('start'))).toEqual([null, '25', '50']);
      expect(summary).toMatchObject({ pages: 3, cards: 75, new: 75 });
    });

    it('FR-18: stops at a page with fewer than 25 jobs, at "no matching jobs", and once a page is all older', async () => {
      const short = fakePages({ sdet: [full('44910000'), [card('4492000001', 'SDET', 'A')], full('44930000')] });
      await searchLinkedIn(options(short.pages, { only: 'SDET', details: false, dryRun: true }));
      expect(short.searched).toHaveLength(2);

      const none = fakePages({ sdet: [full('44910000'), 'no-results', full('44930000')] });
      expect(await searchLinkedIn(options(none.pages, { only: 'SDET', details: false, dryRun: true }))).toMatchObject({
        pages: 2,
        cards: 25,
      });

      const older = fakePages({ sdet: [full('44910000', '2 weeks ago'), full('44920000')] });
      expect(await searchLinkedIn(options(older.pages, { only: 'SDET', details: false, dryRun: true }))).toMatchObject({
        pages: 1,
        older: 25,
        matched: 0,
      });
    });
  });

  describe('when something goes wrong', () => {
    it('FR-18: a search whose cards cannot be read is reported and skipped; the other searches still run', async () => {
      const unreadable = [{ ...card('4490000001', '', ''), jobId: null, href: null }];
      const fake = fakePages({ sdet: [unreadable], 'qa engineer': [QA_PAGE] });

      const summary = await searchLinkedIn(options(fake.pages));

      expect(summary.failures).toEqual(['SDET: no job card on page 1 could be read']);
      expect(summary.new).toBe(2);
      expect(lines).toContain('SDET: no job card on page 1 could be read (skipped)');
    });

    it('FR-18: a search page that does not load is reported and skipped', async () => {
      const fake = fakePages({ sdet: [new Error('Timeout 20000ms exceeded.')], 'qa engineer': [QA_PAGE] });

      const summary = await searchLinkedIn(options(fake.pages));

      expect(summary.failures).toEqual(['SDET: Timeout 20000ms exceeded.']);
      expect(summary.new).toBe(2);
    });

    it('FR-19: a job page that cannot be read is reported, and the job is sent from its card', async () => {
      const fake = fakePages({ 'qa engineer': [QA_PAGE] }, { '4490000007': new Error('Timeout 20000ms exceeded.') });

      const summary = await searchLinkedIn(options(fake.pages, { only: 'QA' }));

      expect(summary).toMatchObject({
        new: 2,
        detailsRead: 1,
        failures: ['job 4490000007: Timeout 20000ms exceeded.'],
      });
      const acme = (await linkedInJobs()).find((job) => job.sourceJobId === '4490000007');
      expect((await detail(acme?.id ?? 0)).description).toBeNull();
    });

    it('FR-18: when LinkedIn limits requests, nothing more is asked of it and what was read is still sent', async () => {
      const fake = fakePages(
        { sdet: [SDET_PAGE], 'qa engineer': [QA_PAGE] },
        { '4490000002': new LinkedInBusyError('HTTP 429') },
      );

      const summary = await searchLinkedIn(options(fake.pages));

      expect(summary.failures).toEqual([
        'LinkedIn is limiting requests (HTTP 429); the remaining searches and job pages were skipped',
      ]);
      expect(fake.opened).toEqual(['4490000001', '4490000002']);
      expect(summary.new).toBe(4);
    });

    it('NFR-12: a sign-in page stops the whole run, sending nothing', async () => {
      const fake = fakePages({ sdet: [new LinkedInSignedOutError()], 'qa engineer': [QA_PAGE] });

      await expect(searchLinkedIn(options(fake.pages))).rejects.toThrow(LinkedInSignedOutError);
      expect(await linkedInJobs()).toEqual([]);
    });

    it('FR-18: a run that is not a dry run needs the app', async () => {
      await testApp.close();

      await expect(searchLinkedIn(options(standard().pages))).rejects.toThrow('The app is not running');
      testApp = await startTestApp();
    });
  });

  describe('a dry run', () => {
    it('FR-18: lists the jobs it would send and sends nothing', async () => {
      const summary = await searchLinkedIn(options(standard().pages, { dryRun: true }));

      expect(summary).toMatchObject({ runId: null, matched: 3, new: 0, closed: 1 });
      expect(lines).toContain(
        '  Job 4490000001 · Example Health · United States (Remote) · Remote · posted 2026-10-24 10:00 UTC',
      );
      expect(await linkedInJobs()).toEqual([]);
      expect(RunSummarySchema.array().parse((await testApp.get('/api/runs')).body)).toEqual([]);
    });

    it('FR-18: runs without the app, counting every job as new and covering the first-run week', async () => {
      const fake = standard();

      const summary = await searchLinkedIn(
        options(fake.pages, { dryRun: true, appUrl: 'http://127.0.0.1:9', only: 'SDET' }),
      );

      expect(summary.matched).toBe(2);
      expect(new URL(fake.searched[0] ?? '').searchParams.get('f_TPR')).toBe('r604800');
      expect(lines).toContain('The app is not running, so since-last-run covers the first-run week.');
      expect(lines).toContain('The app is not running, so every job counts as new.');
    });
  });

  describe('--backfill', () => {
    it('FR-20: reads the job pages of LinkedIn jobs in New and Saved without a description, for match-v1', async () => {
      const seeded = standard();
      await searchLinkedIn(options(seeded.pages, { details: false }));
      const [first, second, third, closed] = (await linkedInJobs()).sort((left, right) =>
        left.sourceJobId.localeCompare(right.sourceJobId),
      );
      await testApp.call('PATCH', `/api/jobs/${String(second?.id ?? 0)}`, { status: 'saved' });
      await testApp.call('PATCH', `/api/jobs/${String(third?.id ?? 0)}`, { status: 'dismissed' });
      const fake = fakePages({}, { [closed?.sourceJobId ?? '']: pane(closed?.sourceJobId ?? '', { closed: true }) });

      const summary = await searchLinkedIn(options(fake.pages, { backfill: true }));

      expect(fake.opened.sort()).toEqual([first?.sourceJobId, second?.sourceJobId, closed?.sourceJobId].sort());
      expect(summary).toMatchObject({ searches: 0, detailsRead: 3, closed: 1, matched: 2, seenAgain: 2 });
      expect((await detail(first?.id ?? 0)).description).toContain('Playwright');
      expect((await detail(third?.id ?? 0)).description).toBeNull();
      const queue = ScoringQueueResponseSchema.parse((await testApp.get('/api/scoring/queue')).body);
      expect(queue.items.filter((item) => item.rubric === 'match-v1').map((item) => item.id)).toHaveLength(2);
      // A backfill names no search, so it doesn't move where since-last-run starts.
      const state = (await testApp.get('/api/ingest/state')).body as { lastLinkedInSearchAt: string };
      expect(Date.parse(state.lastLinkedInSearchAt)).toBeLessThan(Date.parse('2026-10-23T12:01:00.000Z'));
    });
  });

  describe('data/linkedin-searches.json', () => {
    it('FR-18: a missing file says how to create it', () => {
      expect(() => readConfig('does/not/exist.json')).toThrow(/linkedin-searches\.example\.json/);
    });
  });
});

// --- In Chromium, against the saved pages -------------------------------------------------------------------------

const FIXTURES = new URL('../fixtures/linkedin/', import.meta.url);
const page = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8');

describe('scripts/search-linkedin.ts in Chromium, on saved copies of LinkedIn’s pages', () => {
  let browser: Browser;
  let context: BrowserContext;
  let testApp: TestApp;
  let requests: { url: string; cookie: string }[];
  let refusals: number;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });
  beforeEach(async () => {
    testApp = await startTestApp();
    requests = [];
    refusals = 0;
    context = await browser.newContext({ storageState: fakeLinkedInStorageState() });
    // Every request is answered here, from disk; nothing leaves the machine.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ url: url.href, cookie: (await request.allHeaders())['cookie'] ?? '' });
      if (url.hostname !== 'www.linkedin.com') return route.abort();
      const keywords = url.searchParams.get('keywords');
      const jobId = url.searchParams.get('currentJobId');
      const html = (body: string, status = 200) => route.fulfill({ status, contentType: 'text/html', body });
      if (keywords === 'busy' || (keywords === 'busy-once' && refusals++ === 0)) return html('Too many', 429);
      if (keywords === 'signed-out')
        return route.fulfill({ status: 302, headers: { location: 'https://www.linkedin.com/authwall?x=1' } });
      if (url.pathname === '/authwall') return html('<h1>Sign in</h1>');
      if (keywords === 'nothing') return html(page('no-results-page.html'));
      if (keywords !== null) return html(page('search-page.html'));
      if (jobId === '4490000006') return html(page('job-page-closed.html'));
      if (jobId === '4490000001') return html(page('job-page.html'));
      return html('<h1>Not found</h1>', 404);
    });
  });
  afterEach(async () => {
    await context.close();
    await testApp.close();
  });

  const fast = { pauseMs: 0, busyWaitMs: 0, settleMs: 50, cardTimeoutMs: 300, timeoutMs: 3000 };

  it('FR-18: reads every filled card of a search page, as LinkedIn shows it', async () => {
    const cards = await browserPages(context, fast).searchPage('https://www.linkedin.com/jobs/search/?keywords=sdet');

    expect(cards).not.toBe('no-results');
    const [first, second, , older, empty] = cards === 'no-results' ? [] : cards;
    expect(first).toEqual({
      jobId: '4490000001',
      href: '/jobs/view/4490000001/?eBP=NON_CHARGEABLE_CHANNEL&refId=AAAA&trackingId=BBBB%3D%3D&trk=flagship3_search_srp_jobs',
      title: 'Senior SDET (Playwright)',
      company: 'Example Health',
      metadata: ['United States (Remote)', '$140K/yr - $170K/yr · 401(k) benefit'],
      listedDate: '2026-10-24',
      listedText: '41 minutes ago',
      footer: ['41 minutes ago Within the past 24 hours', 'Easy Apply'],
    });
    expect(second).toMatchObject({
      title: 'QA Automation Engineer',
      footer: ['Viewed', '3 hours ago Within the past 24 hours'],
    });
    expect(older).toMatchObject({ listedText: '3 weeks ago', footer: ['Promoted', '3 weeks ago'] });
    expect(empty).toMatchObject({ jobId: '4490000005', title: '', company: '' });
  });

  it('FR-18: a page that says no job matches is no results, whatever it suggests instead', async () => {
    const pages = browserPages(context, fast);

    expect(await pages.searchPage('https://www.linkedin.com/jobs/search/?keywords=nothing')).toBe('no-results');
  });

  it('FR-19: reads a job’s detail pane, and sees a job that no longer takes applications', async () => {
    const pages = browserPages(context, fast);

    expect(await pages.jobPage('4490000001')).toEqual({
      href: '/jobs/view/4490000001/?alternateChannel=search&refId=AAAA&trackingId=BBBB%3D%3D&trk=d_flagship3_search_srp_jobs',
      title: 'Senior SDET (Playwright)',
      company: 'Example Health',
      tertiary: [
        'United States',
        'Reposted 2 hours ago',
        '14 applicants',
        'Promoted by hirer',
        'Actively reviewing applicants',
      ],
      pills: ['$140K/yr - $170K/yr', 'Remote', 'Full-time'],
      descriptionHtml: expect.stringContaining(
        'Build and run end-to-end suites in Playwright and TypeScript',
      ) as string,
      closed: false,
    });
    expect(await pages.jobPage('4490000006')).toMatchObject({ title: 'Test Automation Lead', closed: true });
  });

  it('FR-18, FR-19: the whole script on the saved pages stores the open jobs of the window, with their details', async () => {
    const config = parseLinkedInSearchConfig(
      JSON.stringify({ excludeKeywords: ['junior'], searches: [{ name: 'SDET', keywords: 'sdet' }] }),
      'test',
    );
    const log: string[] = [];

    const summary = await searchLinkedIn({
      config,
      appUrl: testApp.url,
      runId: null,
      dryRun: false,
      only: null,
      details: true,
      backfill: false,
      pages: browserPages(context, fast),
      now: () => NOW,
      log: (line) => log.push(line),
    });

    // 6 cards: one never filled in, one junior, one 3 weeks old, one closed; Sample Freight has no saved job page.
    expect(summary).toMatchObject({ cards: 5, excluded: 1, older: 1, closed: 1, new: 2, detailsRead: 2 });
    expect(summary.failures).toEqual([expect.stringMatching(/^job 4490000002: /) as string]);
    const jobs = JobListResponseSchema.parse((await testApp.get('/api/jobs?origin=linkedin')).body).items;
    const health = JobDetailSchema.parse(
      (await testApp.get(`/api/jobs/${String(jobs.find((job) => job.company === 'Example Health')?.id ?? 0)}`)).body,
    );
    expect(health).toMatchObject({
      title: 'Senior SDET (Playwright)',
      url: 'https://www.linkedin.com/jobs/view/4490000001/',
      workplace: 'remote',
      salary: '$140K/yr - $170K/yr',
      easyApply: true,
      postedAt: '2026-10-24T10:00:00.000Z',
    });
    expect(health.description).toMatch(/^About Example Health\n\nWe build scheduling software/);
  }, 15_000);

  it('FR-18: a refused page is tried once more; refused twice, LinkedIn is limiting requests', async () => {
    const pages = browserPages(context, fast);

    expect(await pages.searchPage('https://www.linkedin.com/jobs/search/?keywords=busy-once')).not.toBe('no-results');
    await expect(pages.searchPage('https://www.linkedin.com/jobs/search/?keywords=busy')).rejects.toThrow(
      'LinkedIn is limiting requests (HTTP 429)',
    );
  });

  it('NFR-12: a redirect to the sign-in page stops with "sign in again"', async () => {
    await expect(
      browserPages(context, fast).searchPage('https://www.linkedin.com/jobs/search/?keywords=signed-out'),
    ).rejects.toThrow(LinkedInSignedOutError);
  });

  it('NFR-12: the session cookie goes only to linkedin.com and never into what the script prints', async () => {
    const log: string[] = [];
    const summary = await searchLinkedIn({
      config: readConfigFrom({ searches: [{ name: 'SDET', keywords: 'sdet' }] }),
      appUrl: testApp.url,
      runId: null,
      dryRun: true,
      only: null,
      details: true,
      backfill: false,
      pages: browserPages(context, fast),
      now: () => NOW,
      log: (line) => log.push(line),
    });

    const linkedin = requests.filter((request) => new URL(request.url).hostname === 'www.linkedin.com');
    expect(linkedin.length).toBeGreaterThan(0);
    expect(linkedin.every((request) => request.cookie.includes(FAKE_LINKEDIN_COOKIE_VALUE))).toBe(true);
    expect(requests.filter((request) => request.cookie.includes(FAKE_LINKEDIN_COOKIE_VALUE)).length).toBe(
      linkedin.length,
    );
    expect(JSON.stringify([log, summary, testApp.logs])).not.toContain(FAKE_LINKEDIN_COOKIE_VALUE);
  }, 15_000);
});

function readConfigFrom(value: unknown) {
  return parseLinkedInSearchConfig(JSON.stringify(value), 'test');
}
