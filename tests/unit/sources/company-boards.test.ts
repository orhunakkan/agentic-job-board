import { describe, expect, it } from 'vitest';
import {
  ashbyBoard,
  greenhouseBoard,
  leverBoard,
  smartRecruitersBoard,
  workableBoard,
} from '../../../src/sources/company-boards.ts';
import { FeedFormatError } from '../../../src/sources/feed.ts';

// Answers shaped like the live ones (checked 2026-10-24), with made-up companies and jobs. Extra fields stay in,
// as the real answers have many more than the parsers read.

describe('Greenhouse', () => {
  const answer = {
    jobs: [
      {
        id: 8860302002,
        internal_job_id: 1,
        title: 'Senior SDET',
        absolute_url: 'https://job-boards.greenhouse.io/examplelabs/jobs/8860302002',
        company_name: 'Example Labs',
        location: { name: 'Remote, United States' },
        first_published: '2026-10-02T11:31:50-04:00',
        updated_at: '2026-10-15T15:24:46-04:00',
        content: '&lt;p&gt;Own the &lt;strong&gt;test platform&lt;/strong&gt;.&lt;/p&gt;',
        departments: [],
      },
      { id: 'not-a-number', title: 'Broken' },
    ],
    meta: { total: 2 },
  };

  it('FR-15: asks the company board on its fixed host, with descriptions', () => {
    expect(greenhouseBoard('examplelabs').url).toBe(
      'https://boards-api.greenhouse.io/v1/boards/examplelabs/jobs?content=true',
    );
  });

  it('FR-15: reads each job, and leaves out one it cannot read', () => {
    const result = greenhouseBoard('examplelabs').read(answer);

    expect(result.jobs).toBe(2);
    expect(result.followUps).toEqual([]);
    expect(result.listings).toEqual([
      {
        source: 'greenhouse',
        sourceJobId: '8860302002',
        title: 'Senior SDET',
        company: 'Example Labs',
        location: 'Remote, United States',
        url: 'https://job-boards.greenhouse.io/examplelabs/jobs/8860302002',
        postedAt: '2026-10-02T15:31:50.000Z',
        salary: null,
        description: 'Own the test platform.',
      },
    ]);
  });

  it('FR-15: a board that answers something else is a feed failure, not an empty board', () => {
    expect(() => greenhouseBoard('examplelabs').read({ status: 404, error: 'Job not found' })).toThrow(FeedFormatError);
  });
});

describe('Lever', () => {
  const answer = [
    {
      id: '2a55d6c9-c564-443a-be3e-a3851db5a93b',
      text: 'QA Automation Engineer',
      hostedUrl: 'https://jobs.lever.co/examplelabs/2a55d6c9-c564-443a-be3e-a3851db5a93b',
      createdAt: 1_792_767_640_768,
      workplaceType: 'remote',
      country: 'US',
      categories: { commitment: 'Permanent', location: 'New York, NY', allLocations: ['New York, NY', 'Austin, TX'] },
      salaryRange: { min: 120_000, max: 150_000, currency: 'USD', interval: 'per-year-salary' },
      descriptionPlain: 'Build checks.',
      additionalPlain: 'Benefits.',
      lists: [],
    },
    {
      id: 'b',
      text: 'Hybrid QA',
      hostedUrl: 'https://jobs.lever.co/examplelabs/b',
      workplaceType: 'hybrid',
      categories: { location: 'Austin, TX' },
    },
  ];

  it('FR-15: reads remote and hybrid jobs with their salary range', () => {
    const { listings } = leverBoard('examplelabs').read(answer);

    expect(leverBoard('examplelabs').url).toBe('https://api.lever.co/v0/postings/examplelabs?mode=json');
    expect(listings[0]).toMatchObject({
      source: 'lever',
      company: 'examplelabs',
      location: 'Remote (New York, NY, Austin, TX)',
      postedAt: '2026-10-23T15:00:40.768Z',
      salary: '$120K – $150K',
      description: 'Build checks.\n\nBenefits.',
    });
    expect(listings[1]).toMatchObject({ location: 'Austin, TX (hybrid)', salary: null, description: null });
  });
});

describe('Ashby', () => {
  const answer = {
    apiVersion: '1',
    jobs: [
      {
        id: '34413f8d-26bf-4bbc-8ade-eb309a0e2245',
        title: 'Senior Software Engineer in Test',
        location: 'New York, NY (HQ)',
        secondaryLocations: [{ location: 'Remote (US)' }],
        workplaceType: 'Hybrid',
        isRemote: true,
        isListed: true,
        publishedAt: '2026-04-07T17:12:35.753+00:00',
        jobUrl: 'https://jobs.ashbyhq.com/examplelabs/34413f8d-26bf-4bbc-8ade-eb309a0e2245',
        descriptionPlain: 'Test everything.',
        compensation: { compensationTierSummary: '$211.4K – $290.6K • Offers Equity' },
      },
      {
        id: 'unlisted',
        title: 'Hidden QA',
        isListed: false,
        jobUrl: 'https://jobs.ashbyhq.com/examplelabs/unlisted',
      },
      {
        id: 'remote',
        title: 'QA',
        workplaceType: 'Remote',
        location: 'US',
        jobUrl: 'https://jobs.ashbyhq.com/x/remote',
      },
    ],
  };

  it('FR-15: reads listed jobs with every location and the pay summary', () => {
    const { jobs, listings } = ashbyBoard('examplelabs').read(answer);

    expect(jobs).toBe(3);
    expect(listings.map((listing) => listing.sourceJobId)).toEqual(['34413f8d-26bf-4bbc-8ade-eb309a0e2245', 'remote']);
    expect(listings[0]).toMatchObject({
      location: 'New York, NY (HQ) / Remote (US) (hybrid)',
      salary: '$211.4K – $290.6K • Offers Equity',
      postedAt: '2026-04-07T17:12:35.753Z',
    });
    expect(listings[1]?.location).toBe('Remote (US)');
  });
});

describe('SmartRecruiters', () => {
  function page(offset: number, totalFound: number) {
    return {
      offset,
      limit: 100,
      totalFound,
      content: [
        {
          id: '744000157624691',
          name: 'QA Engineer',
          releasedDate: '2026-10-24T15:24:28.992Z',
          company: { identifier: 'ExampleGroup', name: 'Example Group' },
          location: { city: 'Austin', fullLocation: 'Austin, TX, United States', remote: true },
          ref: 'https://api.smartrecruiters.com/v1/companies/ExampleGroup/postings/744000157624691',
        },
      ],
    };
  }

  it('FR-15: links each job to its public page and marks remote jobs', () => {
    const { listings, followUps } = smartRecruitersBoard('ExampleGroup').read(page(0, 1));

    expect(listings[0]).toMatchObject({
      company: 'Example Group',
      location: 'Remote (Austin, TX, United States)',
      url: 'https://jobs.smartrecruiters.com/ExampleGroup/744000157624691',
    });
    expect(followUps).toEqual([]);
  });

  it('FR-15: asks for the next page while there are more, up to 1,000 jobs', () => {
    const first = smartRecruitersBoard('ExampleGroup').read(page(0, 250)).followUps;
    const last = smartRecruitersBoard('ExampleGroup', 900).read(page(900, 5000)).followUps;

    expect(first.map((request) => [request.name, request.url])).toEqual([
      [
        'SmartRecruiters ExampleGroup (page 2)',
        'https://api.smartrecruiters.com/v1/companies/ExampleGroup/postings?limit=100&offset=100',
      ],
    ]);
    expect(last).toEqual([]);
  });
});

describe('Workable', () => {
  it('FR-15: reads the account name, places and descriptions', () => {
    const { listings } = workableBoard('examplelabs').read({
      name: 'Example Labs',
      description: 'About us',
      jobs: [
        {
          title: 'QA Engineer - US Remote',
          shortcode: '81B46579FE',
          url: 'https://apply.workable.com/j/81B46579FE',
          telecommuting: true,
          published_on: '2026-05-29',
          city: 'Denver',
          state: 'Colorado',
          country: 'United States',
          description: '<p>Test the models.</p>',
        },
      ],
    });

    expect(workableBoard('examplelabs').url).toBe(
      'https://apply.workable.com/api/v1/widget/accounts/examplelabs?details=true',
    );
    expect(listings).toEqual([
      {
        source: 'workable',
        sourceJobId: '81B46579FE',
        title: 'QA Engineer - US Remote',
        company: 'Example Labs',
        location: 'Remote (Denver, Colorado, United States)',
        url: 'https://apply.workable.com/j/81B46579FE',
        postedAt: '2026-05-29T00:00:00.000Z',
        salary: null,
        description: 'Test the models.',
      },
    ]);
  });
});
