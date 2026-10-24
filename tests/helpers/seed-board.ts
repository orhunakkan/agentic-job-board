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

/** Sends LISTINGS to an open run, as scripts/fetch-sources.ts --run would. */
export async function seedListings(testApp: TestApp, runId: number): Promise<JobSummary[]> {
  const response = await testApp.post(`/api/runs/${String(runId)}/listings`, { listings: LISTINGS });
  return IngestListingsResponseSchema.parse(response.body).newJobs;
}

export function jobAt(jobs: readonly JobSummary[], company: string): JobSummary {
  const job = jobs.find((candidate) => candidate.company === company);
  if (job === undefined) throw new Error(`no seeded job at ${company}`);
  return job;
}
