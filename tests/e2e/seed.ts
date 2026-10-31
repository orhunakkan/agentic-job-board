import { randomInt } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import type { ListingSource } from '../../src/domain/job-source.ts';
import type { IncomingListing } from '../../src/ingest/listing-ingest.ts';
import { CreateRunResponseSchema, IngestListingsResponseSchema } from '../../src/schemas/api.ts';
import { SAMPLE_PROFILE } from '../helpers/profiles.ts';

// Every E2E test seeds its own jobs through the JSON API, as /find-jobs and its scripts would, into the one shared
// E2E server. A unique tag in each title (and unique job IDs) keeps parallel tests and browser projects apart: a
// test filters the board by its tag and only ever touches its own jobs.

export interface SeedJob {
  title: string;
  company: string;
  location?: string;
  score?: number; // left out: the job stays unscored
  rubricVersion?: string;
  easyApply?: boolean;
  workplace?: 'remote' | 'hybrid' | 'on-site';
  description?: string;
  searchName?: string;
}

export interface SeededJob {
  id: number;
  title: string; // including the tag
  company: string;
}

export function uniqueTag(): string {
  return `e2e${Date.now().toString(36)}${randomInt(1e9).toString(36)}`;
}

/** LinkedIn jobs as one of the owner's searches finds them (FR-18), sent as scripts/search-linkedin.ts would. */
export function seedJobs(request: APIRequestContext, tag: string, jobs: readonly SeedJob[]): Promise<SeededJob[]> {
  return sendInOneRun(
    request,
    jobs,
    jobs.map((job) => {
      const id = `${String(randomInt(1e9, 9e9))}${String(randomInt(1e3, 1e4))}`;
      return {
        source: 'linkedin',
        sourceJobId: id,
        title: `${job.title} ${tag}`,
        company: job.company,
        location: job.location ?? 'United States',
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        postedAt: new Date().toISOString(),
        salary: null,
        description: job.description ?? null,
        workplace: job.workplace ?? null,
        easyApply: job.easyApply ?? false,
        searchName: job.searchName ?? 'E2E search',
      };
    }),
  );
}

/** Sends the listings in a run of their own, scores the jobs that have a score, and finishes the run. */
async function sendInOneRun(
  request: APIRequestContext,
  jobs: readonly SeedJob[],
  listings: readonly IncomingListing[],
): Promise<SeededJob[]> {
  const run = await request.post('/api/runs', { data: {} });
  expect(run.status()).toBe(201);
  const { runId } = CreateRunResponseSchema.parse(await run.json());

  const sent = await request.post(`/api/runs/${String(runId)}/listings`, { data: { listings } });
  expect(sent.status()).toBe(200);
  const { newJobs } = IngestListingsResponseSchema.parse(await sent.json());
  expect(newJobs).toHaveLength(jobs.length);

  await score(request, runId, jobs, newJobs);
  expect((await request.post(`/api/runs/${String(runId)}/finish`, { data: {} })).status()).toBe(200);

  return newJobs.map((job) => ({ id: job.id, title: job.title, company: job.company }));
}

/** Scores the jobs that have a score, with their rubric ('e2e' unless set), as /find-jobs would. */
async function score(
  request: APIRequestContext,
  runId: number,
  jobs: readonly SeedJob[],
  stored: readonly { id: number }[],
): Promise<void> {
  const byRubric = new Map<string, { jobId: number; score: number; label: string; reason: string }[]>();
  for (const [index, job] of jobs.entries()) {
    const id = stored[index]?.id;
    if (job.score === undefined || id === undefined) continue;
    const label = job.score >= 75 ? 'strong' : job.score >= 50 ? 'possible' : 'weak';
    const rubric = job.rubricVersion ?? 'e2e';
    byRubric.set(rubric, [
      ...(byRubric.get(rubric) ?? []),
      { jobId: id, score: job.score, label, reason: `Seeded reason for ${job.company}.` },
    ]);
  }
  for (const [rubricVersion, scores] of byRubric) {
    const scored = await request.post(`/api/runs/${String(runId)}/scores`, { data: { rubricVersion, scores } });
    expect(scored.status()).toBe(200);
  }
}

export interface SeedListing extends SeedJob {
  source: ListingSource;
  salary?: string;
}

/** Jobs from the public feeds, sent as scripts/fetch-sources.ts would (FR-15), each with the tag in its title. */
export function seedListings(
  request: APIRequestContext,
  tag: string,
  listings: readonly SeedListing[],
): Promise<SeededJob[]> {
  return sendInOneRun(
    request,
    listings,
    listings.map((listing) => {
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
  );
}

export const PROFILE = SAMPLE_PROFILE;
