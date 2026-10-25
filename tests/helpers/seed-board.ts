import type { IncomingListing } from '../../src/ingest/listing-ingest.ts';
import {
  CreateRunResponseSchema,
  IngestEmailsResponseSchema,
  IngestListingsResponseSchema,
  type JobSummary,
} from '../../src/schemas/api.ts';
import { fixtureEmail } from './fixtures.ts';
import type { TestApp } from './test-app.ts';

// Loads the three sanitized fixtures through the API, as /find-jobs would: 18 new jobs in one open run.
export async function seedBoard(testApp: TestApp): Promise<{ runId: number; jobs: JobSummary[] }> {
  const { runId } = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body);
  const response = await testApp.post(`/api/runs/${String(runId)}/emails`, {
    emails: [
      fixtureEmail('digest-test-automation.txt', 'msgdigestta'),
      fixtureEmail('digest-senior-qa.txt', 'msgdigestsq'),
      fixtureEmail('recommendations.txt', 'msgrecs'),
    ],
  });
  return { runId, jobs: IngestEmailsResponseSchema.parse(response.body).newJobs };
}

// Three made-up listings from the public feeds (PLAN.md Phase 10), as scripts/fetch-sources.ts sends them.
export const LISTINGS: readonly IncomingListing[] = [
  {
    source: 'greenhouse',
    sourceJobId: '5550001',
    title: 'Senior SDET (Playwright)',
    company: 'Example Labs',
    location: 'Remote, United States',
    url: 'https://job-boards.greenhouse.io/examplelabs/jobs/5550001',
    postedAt: '2026-10-20T13:00:00.000Z',
    salary: '$150K – $180K',
    description: 'About the role\n\nOwn the test platform.\n• Playwright\n• k6',
  },
  {
    source: 'himalayas',
    sourceJobId: 'sample-co/jobs/qa-lead',
    title: 'QA Lead',
    company: 'Sample Co',
    location: 'Remote (United States)',
    url: 'https://himalayas.app/companies/sample-co/jobs/qa-lead',
    postedAt: null,
    salary: null,
    description: null,
  },
  {
    source: 'hackernews',
    sourceJobId: '50012248',
    title: 'Software Engineer, Quality / SDET',
    company: 'Acme Exchange',
    location: 'U.S. Remote',
    url: 'https://news.ycombinator.com/item?id=50012248',
    postedAt: '2026-10-08T21:04:09.000Z',
    salary: null,
    description: 'Acme Exchange | Software Engineer, Quality / SDET | U.S. Remote\n\nWe match buyers and sellers.',
  },
];

// Three made-up jobs from the owner's LinkedIn searches (PLAN.md Phase 11), as scripts/search-linkedin.ts sends them:
// one with every detail from its job page, one from a search card only, one from another search.
export const LINKEDIN_LISTINGS: readonly IncomingListing[] = [
  {
    source: 'linkedin',
    sourceJobId: '4480000001',
    title: 'Senior SDET (Playwright, TypeScript)',
    company: 'Example Health',
    location: 'United States (Remote)',
    url: 'https://www.linkedin.com/jobs/view/4480000001/',
    postedAt: '2026-10-23T09:00:00.000Z',
    salary: '$150K/yr - $180K/yr',
    description: 'About us\n\nWe build health software.\n• 5+ years of test automation\n• Playwright and TypeScript',
    workplace: 'remote',
    easyApply: true,
    searchName: 'QA family',
  },
  {
    source: 'linkedin',
    sourceJobId: '4480000002',
    title: 'QA Automation Engineer',
    company: 'Sample Freight',
    location: 'Austin, TX',
    url: 'https://www.linkedin.com/jobs/view/4480000002/',
    postedAt: '2026-10-23T07:00:00.000Z',
    salary: null,
    description: null,
    workplace: null,
    easyApply: false,
    searchName: 'QA family',
  },
  {
    source: 'linkedin',
    sourceJobId: '4480000003',
    title: 'Software Quality Assurance Engineer',
    company: 'Acme Payments',
    location: 'New York, NY (Hybrid)',
    url: 'https://www.linkedin.com/jobs/view/4480000003/',
    postedAt: '2026-10-22T15:00:00.000Z',
    salary: null,
    description: 'Hybrid role, three days a week in our New York office.',
    workplace: 'hybrid',
    easyApply: false,
    searchName: 'Software QA',
  },
];

/** Sends LISTINGS to an open run, as scripts/fetch-sources.ts --run would. */
export async function seedListings(testApp: TestApp, runId: number): Promise<JobSummary[]> {
  const response = await testApp.post(`/api/runs/${String(runId)}/listings`, { listings: LISTINGS });
  return IngestListingsResponseSchema.parse(response.body).newJobs;
}

/** Sends LINKEDIN_LISTINGS to an open run, as scripts/search-linkedin.ts --run would. */
export async function seedLinkedInListings(testApp: TestApp, runId: number): Promise<JobSummary[]> {
  const response = await testApp.post(`/api/runs/${String(runId)}/listings`, { listings: LINKEDIN_LISTINGS });
  return IngestListingsResponseSchema.parse(response.body).newJobs;
}

export function jobAt(jobs: readonly JobSummary[], company: string): JobSummary {
  const job = jobs.find((candidate) => candidate.company === company);
  if (job === undefined) throw new Error(`no seeded job at ${company}`);
  return job;
}
