import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/database.ts';
import type { Repositories } from '../db/repositories/index.ts';
import type { NewJob } from '../db/repositories/jobs.ts';
import type { JobSource } from '../domain/job-source.ts';
import type { Workplace } from '../domain/workplace.ts';
import { RunFinishedError, RunNotFoundError } from './run-errors.ts';

// Stores a batch of listings for a run (PLAN.md Phase 10 and 11, FR-15, FR-16, FR-18): jobs from the public feeds
// (scripts/fetch-sources.ts) and from the owner's LinkedIn searches (scripts/search-linkedin.ts). The scripts read
// and filter; the app only stores what it is sent. A LinkedIn job the board has from an alert email is the same
// job. Each listing is one transaction: its job, status history, listing sighting and run counters are all written
// or none are.

export interface IncomingListing {
  source: JobSource;
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: string | null;
  salary: string | null;
  description: string | null;
  workplace?: Workplace | null | undefined;
  easyApply?: boolean | undefined;
  /** The LinkedIn search that found it, stored on the sighting. */
  searchName?: string | undefined;
}

export interface ListingIngestResult {
  received: number;
  /** Jobs this run stored for the first time. */
  new: number;
  /** Jobs stored by an earlier run and listed again in this one. */
  seenAgain: number;
  /** Listings this run had already received; they change nothing. */
  repeated: number;
  newJobIds: number[];
}

export function ingestListings(
  db: DatabaseSync,
  repos: Repositories,
  runId: number,
  listings: readonly IncomingListing[],
  now: () => string = () => new Date().toISOString(),
): ListingIngestResult {
  const run = repos.runs.get(runId);
  if (run === null) throw new RunNotFoundError(runId);
  if (run.finishedAt !== null) throw new RunFinishedError(runId);

  const result: ListingIngestResult = { received: listings.length, new: 0, seenAgain: 0, repeated: 0, newJobIds: [] };
  for (const listing of listings) {
    transaction(db, () => {
      const outcome = ingestOne(repos, runId, listing, now());
      if (typeof outcome === 'number') {
        result.new += 1;
        result.newJobIds.push(outcome);
      } else {
        result[outcome] += 1;
      }
    });
  }
  return result;
}

/** The new job's ID, or what happened to a job already stored. */
function ingestOne(
  repos: Repositories,
  runId: number,
  listing: IncomingListing,
  seenAt: string,
): number | 'seenAgain' | 'repeated' {
  const { searchName = null, ...details } = listing;
  const job: NewJob = {
    ...details,
    postedAt: listing.postedAt === null ? null : new Date(listing.postedAt).toISOString(),
    workplace: listing.workplace ?? null,
    activelyHiring: false,
    easyApply: listing.easyApply ?? false,
  };

  const existingId = repos.jobs.findId(job.source, job.sourceJobId);
  if (existingId === null) {
    const jobId = repos.jobs.insert(job, { runId, seenAt, createdAt: seenAt });
    repos.statusHistory.insert(jobId, { fromStatus: null, toStatus: 'new', changedAt: seenAt });
    repos.listingSightings.insert(jobId, runId, seenAt, searchName);
    repos.runs.addCounts(runId, { listingsSeen: 1, jobsNew: 1 });
    return jobId;
  }

  repos.runs.addCounts(runId, { listingsSeen: 1 });
  // A feed may list a job twice, a run may fetch the same feed twice, and two searches may find the same job: one run
  // counts one sighting, under the first search that found it.
  if (!repos.listingSightings.insert(existingId, runId, seenAt, searchName)) return 'repeated';
  repos.jobs.recordSighting(existingId, job, seenAt);
  repos.runs.addCounts(runId, { jobsSeenAgain: 1 });
  return 'seenAgain';
}
