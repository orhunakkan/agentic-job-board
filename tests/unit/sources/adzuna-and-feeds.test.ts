import { describe, expect, it } from 'vitest';
import { adzunaSearch } from '../../../src/sources/adzuna.ts';
import { planFeeds } from '../../../src/sources/feeds.ts';
import { parseSourcesConfig } from '../../../src/sources/source-config.ts';

const KEY = { appId: 'app-id-123', appKey: 'SECRET-KEY-456' };

describe('Adzuna', () => {
  it('FR-15: searches the US for one keyword with the free key', () => {
    const url = new URL(adzunaSearch('sdet', KEY).url);

    expect(`${url.origin}${url.pathname}`).toBe('https://api.adzuna.com/v1/api/jobs/us/search/1');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: 'app-id-123',
      app_key: 'SECRET-KEY-456',
      what: 'sdet',
      results_per_page: '50',
      max_days_old: '14',
      'content-type': 'application/json',
    });
  });

  it('NFR-12: the name the script prints never holds the key', () => {
    expect(adzunaSearch('sdet', KEY).name).toBe('Adzuna "sdet"');
  });

  it('FR-15: reads results, strips highlights, and shows only a real salary', () => {
    const { listings } = adzunaSearch('sdet', KEY).read({
      __CLASS__: 'Adzuna::API::Response::JobSearchResults',
      count: 2,
      results: [
        {
          id: '5012345678',
          title: 'Senior <strong>SDET</strong>',
          redirect_url: 'https://www.adzuna.com/land/ad/5012345678?se=abc&v=def',
          created: '2026-10-20T08:00:00Z',
          description: 'Snippet of the ad…',
          company: { display_name: 'Example Labs' },
          location: { display_name: 'Austin, Travis County', area: ['US', 'Texas'] },
          salary_min: 140_000,
          salary_max: 160_000,
          salary_is_predicted: '0',
        },
        {
          id: 5012345679,
          title: 'QA Analyst',
          redirect_url: 'https://www.adzuna.com/land/ad/5012345679',
          company: { display_name: 'Sample Co' },
          salary_min: 70_000,
          salary_is_predicted: '1',
        },
        { id: 1, title: 'No company', redirect_url: 'https://www.adzuna.com/land/ad/1' },
      ],
    });

    expect(listings).toEqual([
      {
        source: 'adzuna',
        sourceJobId: '5012345678',
        title: 'Senior SDET',
        company: 'Example Labs',
        location: 'Austin, Travis County',
        url: 'https://www.adzuna.com/details/5012345678',
        postedAt: '2026-10-20T08:00:00.000Z',
        salary: '$140K – $160K',
        description: 'Snippet of the ad…',
      },
      expect.objectContaining({ sourceJobId: '5012345679', salary: null, location: '' }),
    ]);
  });
});

describe('planFeeds', () => {
  const config = parseSourcesConfig(
    JSON.stringify({
      keywords: ['sdet', 'test automation'],
      companies: {
        greenhouse: ['examplelabs'],
        lever: ['example.co'],
        ashby: ['sample-co'],
        smartrecruiters: ['ExampleGroup'],
        workable: ['acme'],
      },
    }),
    'test',
  );

  it('FR-15: one request per company, per keyword search and per feed, in a fixed order', () => {
    expect(planFeeds(config, KEY).map((request) => request.name)).toEqual([
      'Greenhouse examplelabs',
      'Lever example.co',
      'Ashby sample-co',
      'SmartRecruiters ExampleGroup',
      'Workable acme',
      'Remote OK',
      'Himalayas "sdet"',
      'Himalayas "test automation"',
      'Jobicy',
      'Hacker News',
      'Adzuna "sdet"',
      'Adzuna "test automation"',
    ]);
  });

  it('FR-15: leaves out Adzuna without a key, and any feed switched off', () => {
    const off = {
      ...config,
      feeds: { remoteok: false, himalayas: false, jobicy: true, hackernews: false, adzuna: true },
    };

    expect(planFeeds(off, null).map((request) => request.source)).toEqual([
      'greenhouse',
      'lever',
      'ashby',
      'smartrecruiters',
      'workable',
      'jobicy',
    ]);
  });

  it('NFR-03: every request goes over https to one of the documented hosts', () => {
    const hosts = new Set(planFeeds(config, KEY).map((request) => new URL(request.url).host));

    expect([...hosts].sort()).toEqual([
      'api.adzuna.com',
      'api.ashbyhq.com',
      'api.lever.co',
      'api.smartrecruiters.com',
      'apply.workable.com',
      'boards-api.greenhouse.io',
      'himalayas.app',
      'hn.algolia.com',
      'jobicy.com',
      'remoteok.com',
    ]);
    expect(planFeeds(config, KEY).every((request) => request.url.startsWith('https://'))).toBe(true);
  });
});
