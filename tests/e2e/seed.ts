import { randomInt } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import type { ListingSource } from '../../src/domain/job-source.ts';
import {
  CreateRunResponseSchema,
  IngestEmailsResponseSchema,
  IngestListingsResponseSchema,
} from '../../src/schemas/api.ts';

// Every E2E test seeds its own jobs through the JSON API, as /find-jobs would, into the one shared E2E server.
// A unique tag in each title (and unique LinkedIn IDs) keeps parallel tests and browser projects apart: a test
// filters the board by its tag and only ever touches its own jobs.

export interface SeedJob {
  title: string;
  company: string;
  location?: string;
  score?: number; // left out: the job stays unscored
  activelyHiring?: boolean;
}

export interface SeededJob {
  id: number;
  title: string; // including the tag
  company: string;
}

export function uniqueTag(): string {
  return `e2e${Date.now().toString(36)}${randomInt(1e9).toString(36)}`;
}

export async function seedJobs(
  request: APIRequestContext,
  tag: string,
  jobs: readonly SeedJob[],
): Promise<SeededJob[]> {
  const blocks = jobs.map((job) =>
    [
      `${job.title} ${tag}`,
      job.company,
      job.location ?? 'United States',
      job.activelyHiring === true ? 'This company is actively hiring' : '',
      `View job: https://www.linkedin.com/comm/jobs/view/${String(randomInt(1e9, 9e9))}${String(randomInt(1e3))}/`,
    ].join('\n'),
  );

  const run = await request.post('/api/runs', { data: {} });
  expect(run.status()).toBe(201);
  const { runId } = CreateRunResponseSchema.parse(await run.json());

  const ingest = await request.post(`/api/runs/${String(runId)}/emails`, {
    data: {
      emails: [
        {
          gmailMessageId: `msg-${tag}`,
          receivedAt: new Date().toISOString(),
          sender: 'jobalerts-noreply@linkedin.com',
          subject: `E2E ${tag}`,
          plainText: `Your job alert for e2e ${tag}\nNew jobs match your preferences.\n\n${blocks.join('\n\n---------------------------------------------------------\n\n')}\n`,
        },
      ],
    },
  });
  expect(ingest.status()).toBe(200);
  const { newJobs } = IngestEmailsResponseSchema.parse(await ingest.json());
  expect(newJobs).toHaveLength(jobs.length);

  const scores = jobs.flatMap((job, index) => {
    const id = newJobs[index]?.id;
    if (job.score === undefined || id === undefined) return [];
    const label = job.score >= 75 ? 'strong' : job.score >= 50 ? 'possible' : 'weak';
    return [{ jobId: id, score: job.score, label, reason: `Seeded reason for ${job.company}.` }];
  });
  if (scores.length > 0) {
    const scored = await request.post(`/api/runs/${String(runId)}/scores`, { data: { rubricVersion: 'e2e', scores } });
    expect(scored.status()).toBe(200);
  }
  expect((await request.post(`/api/runs/${String(runId)}/finish`, { data: {} })).status()).toBe(200);

  return newJobs.map((job) => ({ id: job.id, title: job.title, company: job.company }));
}

export interface SeedListing extends SeedJob {
  source: ListingSource;
  salary?: string;
  description?: string;
}

/** Jobs from the public feeds, sent as scripts/fetch-sources.ts would (FR-15), each with the tag in its title. */
export async function seedListings(
  request: APIRequestContext,
  tag: string,
  listings: readonly SeedListing[],
): Promise<SeededJob[]> {
  const run = await request.post('/api/runs', { data: {} });
  const { runId } = CreateRunResponseSchema.parse(await run.json());

  const sent = await request.post(`/api/runs/${String(runId)}/listings`, {
    data: {
      listings: listings.map((listing) => {
        const id = `${tag}-${String(randomInt(1e9))}`;
        return {
          source: listing.source,
          sourceJobId: id,
          title: `${listing.title} ${tag}`,
          company: listing.company,
          location: listing.location ?? 'Remote (United States)',
          url: `https://jobs.example.com/${listing.source}/${id}`,
          postedAt: new Date().toISOString(),
          salary: listing.salary ?? null,
          description: listing.description ?? null,
        };
      }),
    },
  });
  expect(sent.status()).toBe(200);
  const { newJobs } = IngestListingsResponseSchema.parse(await sent.json());
  expect(newJobs).toHaveLength(listings.length);

  const scores = listings.flatMap((listing, index) => {
    const id = newJobs[index]?.id;
    if (listing.score === undefined || id === undefined) return [];
    const label = listing.score >= 75 ? 'strong' : listing.score >= 50 ? 'possible' : 'weak';
    return [{ jobId: id, score: listing.score, label, reason: `Seeded reason for ${listing.company}.` }];
  });
  if (scores.length > 0) {
    const scored = await request.post(`/api/runs/${String(runId)}/scores`, { data: { rubricVersion: 'e2e', scores } });
    expect(scored.status()).toBe(200);
  }
  expect((await request.post(`/api/runs/${String(runId)}/finish`, { data: {} })).status()).toBe(200);

  return newJobs.map((job) => ({ id: job.id, title: job.title, company: job.company }));
}

export const PROFILE = {
  targetRoles: ['SDET', 'QA Automation Engineer'],
  seniority: 'senior',
  yearsExperience: 8,
  coreSkills: ['Playwright', 'TypeScript'],
  secondarySkills: ['Java'],
  locations: { remoteUS: true, hybridMetros: [], onsiteMetros: [], relocate: false },
  workAuthorization: 'US, no sponsorship needed',
  dealBreakers: ['manual-only testing roles'],
  excludedCompanies: [],
};
