import { describe, expect, it } from 'vitest';
import { FeedFormatError } from '../../../src/sources/feed.ts';
import { himalayasSearch, jobicyFeed, remoteOkFeed } from '../../../src/sources/remote-boards.ts';

// Answers shaped like the live ones (checked 2026-10-24), with made-up companies and jobs.

describe('Remote OK', () => {
  const answer = [
    { last_updated: 1_792_857_604, legal: 'API Terms of Service: Please link back to the URL on Remote OK…' },
    {
      slug: 'remote-senior-sdet-example-labs-1137563',
      id: '1137563',
      epoch: 1_792_857_600,
      date: '2026-10-23T16:00:18+00:00',
      company: 'Example Labs',
      position: 'Senior SDET',
      tags: ['qa', 'dev'],
      description: '<p>Ship quality.</p>',
      location: '',
      salary_min: 0,
      salary_max: 0,
      url: 'https://remoteOK.com/remote-jobs/remote-senior-sdet-example-labs-1137563',
      apply_url: 'https://remoteOK.com/remote-jobs/remote-senior-sdet-example-labs-1137563',
    },
    {
      id: 2,
      date: '2026-10-22T16:00:18+00:00',
      company: 'Sample Co',
      position: 'QA Lead',
      location: 'USA',
      salary_min: 140_000,
      salary_max: 170_000,
      url: 'https://remoteOK.com/remote-jobs/2',
    },
  ];

  it('FR-15: skips the legal notice and reads every job as remote, linking back to Remote OK', () => {
    const { jobs, listings } = remoteOkFeed().read(answer);

    expect(remoteOkFeed().url).toBe('https://remoteok.com/api');
    expect(jobs).toBe(2);
    expect(listings[0]).toEqual({
      source: 'remoteok',
      sourceJobId: '1137563',
      title: 'Senior SDET',
      company: 'Example Labs',
      location: 'Remote',
      url: 'https://remoteOK.com/remote-jobs/remote-senior-sdet-example-labs-1137563',
      postedAt: '2026-10-23T16:00:18.000Z',
      salary: null,
      description: 'Ship quality.',
    });
    expect(listings[1]).toMatchObject({ location: 'Remote (USA)', salary: '$140K – $170K' });
  });

  it('FR-15: an answer that is not a list is a feed failure', () => {
    expect(() => remoteOkFeed().read({ error: 'rate limited' })).toThrow(FeedFormatError);
  });
});

describe('Himalayas', () => {
  it('FR-15: searches one keyword in the US and reads the page path as the job ID', () => {
    const request = himalayasSearch('test automation');
    const { listings } = request.read({
      comments: 'Search results come 20 to a page.',
      totalCount: 1,
      jobs: [
        {
          title: 'Senior QA Automation Engineer',
          excerpt: 'Short',
          companyName: 'Example Labs',
          companySlug: 'example-labs',
          locationRestrictions: ['United States'],
          minSalary: 90_000,
          maxSalary: 120_000,
          currency: 'USD',
          salaryPeriod: 'annual',
          seniority: ['Senior'],
          pubDate: 1_792_666_342,
          description: '<p>Automate it.</p>',
          applicationLink: 'https://himalayas.app/companies/example-labs/jobs/senior-qa?utm_source=api',
          guid: 'https://himalayas.app/companies/example-labs/jobs/senior-qa',
        },
      ],
    });

    expect(request.url).toBe('https://himalayas.app/jobs/api/search?q=test%20automation&country=US');
    expect(listings).toEqual([
      {
        source: 'himalayas',
        sourceJobId: 'example-labs/jobs/senior-qa',
        title: 'Senior QA Automation Engineer',
        company: 'Example Labs',
        location: 'Remote (United States)',
        url: 'https://himalayas.app/companies/example-labs/jobs/senior-qa',
        postedAt: '2026-10-22T10:52:22.000Z',
        salary: '$90K – $120K',
        description: 'Automate it.',
      },
    ]);
  });
});

describe('Jobicy', () => {
  it('FR-15: reads the latest US jobs with their regions and salary', () => {
    const { listings } = jobicyFeed().read({
      apiVersion: '2.2.19',
      friendlyNotice: 'Please ensure Jobicy is clearly credited with a direct link to the source…',
      jobCount: 1,
      jobs: [
        {
          id: 156_466,
          url: 'https://jobicy.com/jobs/156466-manager-software-test-automation',
          jobTitle: 'Manager Software Test Automation',
          companyName: 'Example Health',
          jobGeo: 'Canada,  USA',
          jobLevel: 'Senior',
          pubDate: '2026-10-22T20:38:09+00:00',
          salaryMin: 130_000,
          salaryMax: 160_000,
          salaryCurrency: 'USD',
          salaryPeriod: 'yearly',
          jobDescription: '<p>Lead the team.</p>',
        },
      ],
    });

    expect(jobicyFeed().url).toBe('https://jobicy.com/api/v2/remote-jobs?count=100&geo=usa');
    expect(listings[0]).toMatchObject({
      sourceJobId: '156466',
      location: 'Remote (Canada, USA)',
      salary: '$130K – $160K',
      description: 'Lead the team.',
    });
  });
});
