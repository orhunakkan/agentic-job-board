import type { IncomingListing } from '../../src/ingest/listing-ingest.ts';
import {
  CreateRunResponseSchema,
  IngestListingsResponseSchema,
  JobSummarySchema,
  type JobSummary,
} from '../../src/schemas/api.ts';
import { seedEmailYears } from './email-years.ts';
import type { TestApp } from './test-app.ts';

/**
 * The 18 LinkedIn jobs of the alert-email years (tests/helpers/email-years.ts) in one open run, as the old email
 * ingest left them; the app no longer takes emails (DEC-041). Returns the run and the jobs as the API shows them.
 */
export async function seedBoard(testApp: TestApp): Promise<{ runId: number; jobs: JobSummary[] }> {
  const { runId } = CreateRunResponseSchema.parse((await testApp.post('/api/runs')).body);
  const jobs: JobSummary[] = [];
  for (const id of seedEmailYears(testApp.app.db, runId)) {
    // The detail answer is a summary plus more; only the summary's fields are kept.
    const { body } = await testApp.get(`/api/jobs/${String(id)}`);
    jobs.push(JobSummarySchema.parse(pickSummary(body)));
  }
  return { runId, jobs };
}

function pickSummary(detail: unknown): Record<string, unknown> {
  const fields = Object.keys(JobSummarySchema.shape);
  return Object.fromEntries(Object.entries(detail as Record<string, unknown>).filter(([key]) => fields.includes(key)));
}

// Three made-up listings from the public feeds (PLAN.md Phase 10), as scripts/fetch-sources.ts sends them.
export const LISTINGS: readonly IncomingListing[] = [
  {
    source: 'greenhouse',
    sourceJobId: '5550001',
    title: 'Senior Dispatcher (Night Desk)',
    company: 'Example Labs',
    location: 'Remote, United States',
    url: 'https://job-boards.greenhouse.io/examplelabs/jobs/5550001',
    postedAt: '2026-10-20T13:00:00.000Z',
    salary: '$150K – $180K',
    description: 'About the role\n\nRun the night dispatch desk.\n• Load planning\n• Driver check-ins',
  },
  {
    source: 'himalayas',
    sourceJobId: 'sample-co/jobs/nurse-lead',
    title: 'Lead Nurse',
    company: 'Sample Co',
    location: 'Remote (United States)',
    url: 'https://himalayas.app/companies/sample-co/jobs/nurse-lead',
    postedAt: null,
    salary: null,
    description: null,
  },
  {
    source: 'hackernews',
    sourceJobId: '50012248',
    title: 'Fleet Dispatcher, Operations',
    company: 'Acme Exchange',
    location: 'U.S. Remote',
    url: 'https://news.ycombinator.com/item?id=50012248',
    postedAt: '2026-10-08T21:04:09.000Z',
    salary: null,
    description: 'Acme Exchange | Fleet Dispatcher, Operations | U.S. Remote\n\nWe match buyers and sellers.',
  },
];

// Three made-up jobs from the owner's LinkedIn searches (PLAN.md Phase 11), as scripts/search-linkedin.ts sends them:
// one with every detail from its job page, one from a search card only, one from another search.
export const LINKEDIN_LISTINGS: readonly IncomingListing[] = [
  {
    source: 'linkedin',
    sourceJobId: '4480000001',
    title: 'Senior Registered Nurse (ICU, Days)',
    company: 'Example Health',
    location: 'United States (Remote)',
    url: 'https://www.linkedin.com/jobs/view/4480000001/',
    postedAt: '2026-10-23T09:00:00.000Z',
    salary: '$150K/yr - $180K/yr',
    description: 'About us\n\nWe run community clinics.\n• 5+ years of patient care\n• Ventilator care and charting',
    workplace: 'remote',
    easyApply: true,
    searchName: 'Dispatch family',
  },
  {
    source: 'linkedin',
    sourceJobId: '4480000002',
    title: 'Nurse Case Manager',
    company: 'Sample Freight',
    location: 'Austin, TX',
    url: 'https://www.linkedin.com/jobs/view/4480000002/',
    postedAt: '2026-10-23T07:00:00.000Z',
    salary: null,
    description: null,
    workplace: null,
    easyApply: false,
    searchName: 'Dispatch family',
  },
  {
    source: 'linkedin',
    sourceJobId: '4480000003',
    title: 'Accounts Payable Clerk',
    company: 'Acme Payments',
    location: 'New York, NY (Hybrid)',
    url: 'https://www.linkedin.com/jobs/view/4480000003/',
    postedAt: '2026-10-22T15:00:00.000Z',
    salary: null,
    description: 'Hybrid role, three days a week in our New York office.',
    workplace: 'hybrid',
    easyApply: false,
    searchName: 'Software development',
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
