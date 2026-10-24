import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/database.ts';
import type { Repositories } from '../db/repositories/index.ts';
import type { NewJob } from '../db/repositories/jobs.ts';
import type { ListingSource } from '../domain/job-source.ts';
import { RunFinishedError, RunNotFoundError } from './ingest-service.ts';

// Stores a batch of listings from the public feeds for a run (PLAN.md Phase 10, FR-15, FR-16). The feeds were
// read and filtered by scripts/fetch-sources.ts; the app only stores what it is sent. Each listing is one
// transaction: its job, status history, listing sighting and run counters are all written or none are.

export interface IncomingListing {
  source: ListingSource;
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: string | null;
  salary: string | null;
  description: string | null;
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
  const job: NewJob = {
    ...listing,
    postedAt: listing.postedAt === null ? null : new Date(listing.postedAt).toISOString(),
    activelyHiring: false,
    easyApply: false,
  };

  const existingId = repos.jobs.findId(job.source, job.sourceJobId);
  if (existingId === null) {
    const jobId = repos.jobs.insert(job, { runId, seenAt, createdAt: seenAt });
    repos.statusHistory.insert(jobId, { fromStatus: null, toStatus: 'new', changedAt: seenAt });
    repos.listingSightings.insert(jobId, runId, seenAt);
    repos.runs.addCounts(runId, { listingsSeen: 1, jobsNew: 1 });
    return jobId;
  }

  repos.runs.addCounts(runId, { listingsSeen: 1 });
  // A feed may list a job twice, and a run may fetch the same feed twice: one run counts one sighting.
  if (!repos.listingSightings.insert(existingId, runId, seenAt)) return 'repeated';
  repos.jobs.recordSighting(existingId, job, seenAt);
  repos.runs.addCounts(runId, { jobsSeenAgain: 1 });
  return 'seenAgain';
}
