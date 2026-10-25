import { describe, expect, it } from 'vitest';
import {
  resolveSearches,
  parseLinkedInSearchConfig,
  type LinkedInSearch,
} from '../../../src/linkedin/search-config.ts';
import {
  FIRST_RUN_WINDOW_SECONDS,
  MAX_WINDOW_SECONDS,
  searchUrl,
  windowSeconds,
} from '../../../src/linkedin/search-url.ts';

function search(options: Record<string, unknown> = {}): LinkedInSearch {
  const config = parseLinkedInSearchConfig(
    JSON.stringify({ searches: [{ name: 'Test', keywords: 'sdet', ...options }] }),
    'test',
  );
  const [resolved] = resolveSearches(config);
  if (resolved === undefined) throw new Error('no search');
  return resolved;
}

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}

const DAY = 86_400;

describe('searchUrl', () => {
  it('FR-18: a plain search asks for the keywords, the window and the newest jobs first', () => {
    const url = searchUrl(search(), 0, DAY);

    expect(url).toBe('https://www.linkedin.com/jobs/search/?keywords=sdet&f_TPR=r86400&sortBy=DD');
  });

  it('FR-18: maps every option to LinkedIn’s parameter codes (checked against the live page, 2026-10-24)', () => {
    const url = searchUrl(
      search({
        location: 'United States',
        distanceMiles: 25,
        workplace: ['remote', 'hybrid', 'on-site'],
        experience: ['internship', 'entry', 'associate', 'mid-senior', 'director', 'executive'],
        jobType: ['full-time', 'part-time', 'contract', 'temporary', 'internship'],
        salaryMin: 140000,
        easyApply: true,
        companies: ['1035', '1441'],
        sort: 'relevant',
      }),
      0,
      7 * DAY,
    );

    expect(params(url)).toEqual({
      keywords: 'sdet',
      location: 'United States',
      distance: '25',
      f_TPR: 'r604800',
      f_WT: '2,3,1',
      f_E: '1,2,3,4,5,6',
      f_JT: 'F,P,C,T,I',
      f_SB2: '6',
      f_AL: 'true',
      f_C: '1035,1441',
      sortBy: 'R',
    });
  });

  it.each([
    [40000, '1'],
    [60000, '2'],
    [80000, '3'],
    [100000, '4'],
    [120000, '5'],
    [140000, '6'],
    [160000, '7'],
    [180000, '8'],
    [200000, '9'],
  ])('FR-18: salary from $%i is bracket %s', (salaryMin, code) => {
    expect(params(searchUrl(search({ salaryMin }), 0, DAY))['f_SB2']).toBe(code);
  });

  it('FR-18: a filter that is not set is left out, and easyApply false asks for every job', () => {
    expect(Object.keys(params(searchUrl(search({ easyApply: false, workplace: [] }), 0, DAY)))).toEqual([
      'keywords',
      'f_TPR',
      'sortBy',
    ]);
  });

  it('FR-18: names each value once', () => {
    expect(params(searchUrl(search({ workplace: ['remote', 'remote'] }), 0, DAY))['f_WT']).toBe('2');
  });

  it.each([
    [0, undefined],
    [1, '25'],
    [3, '75'],
    [9, '225'],
  ])('FR-18: page %i starts at job %s', (page, start) => {
    expect(params(searchUrl(search(), page, DAY))['start']).toBe(start);
  });

  it('FR-18: encodes quotes, OR and spaces in the keywords so LinkedIn reads them as typed', () => {
    const url = searchUrl(search({ keywords: '"test automation" OR C++ & QA' }), 0, DAY);

    expect(url).toContain('keywords=%22test%20automation%22%20OR%20C%2B%2B%20%26%20QA&');
    expect(params(url)['keywords']).toBe('"test automation" OR C++ & QA');
  });

  it.each([
    'https://evil.example/',
    '../../admin',
    '#fragment',
    '?keywords=x&f_TPR=r1',
    '@evil.example',
    'javascript:alert(1)',
  ])('NFR-03: keywords %j stay in the query string of a linkedin.com search URL', (keywords) => {
    const url = new URL(searchUrl(search({ keywords, location: keywords }), 1, DAY));

    expect(url.origin).toBe('https://www.linkedin.com');
    expect(url.pathname).toBe('/jobs/search/');
    expect(url.hash).toBe('');
    expect(url.searchParams.get('keywords')).toBe(keywords);
    expect(url.searchParams.getAll('f_TPR')).toEqual(['r86400']);
  });
});

describe('windowSeconds', () => {
  const NOW = '2026-10-24T12:00:00.000Z';

  it.each([
    ['day', DAY],
    ['week', 7 * DAY],
    ['month', 30 * DAY],
    [1, 3600],
    [36, 36 * 3600],
    [720, 30 * DAY],
  ] as const)('FR-18: %j covers %i seconds, whenever the last run was', (postedWithin, seconds) => {
    expect(windowSeconds(postedWithin, null, NOW)).toBe(seconds);
    expect(windowSeconds(postedWithin, '2026-10-24T11:00:00.000Z', NOW)).toBe(seconds);
  });

  it('FR-18: since-last-run covers a week on the first run', () => {
    expect(windowSeconds('since-last-run', null, NOW)).toBe(FIRST_RUN_WINDOW_SECONDS);
    expect(FIRST_RUN_WINDOW_SECONDS).toBe(7 * DAY);
  });

  it('FR-18: since-last-run covers the time since the last LinkedIn search plus an hour', () => {
    expect(windowSeconds('since-last-run', '2026-10-24T06:30:00.000Z', NOW)).toBe(5.5 * 3600 + 3600);
    expect(windowSeconds('since-last-run', '2026-10-24T11:59:59.400Z', NOW)).toBe(1 + 3600);
  });

  it('FR-18: since-last-run covers at most a month, and at least the hour of overlap', () => {
    expect(windowSeconds('since-last-run', '2026-08-01T00:00:00.000Z', NOW)).toBe(MAX_WINDOW_SECONDS);
    expect(windowSeconds('since-last-run', '2026-10-24T13:00:00.000Z', NOW)).toBe(3600);
  });
});
