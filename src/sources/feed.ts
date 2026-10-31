import type { z } from 'zod';
import type { ListingSource } from '../domain/job-source.ts';
import type { IncomingListing } from '../ingest/listing-ingest.ts';
import { toListing, type RawListing } from './listing.ts';

// One request scripts/fetch-sources.ts makes, and how to read its answer (PLAN.md Phase 10, FR-15). Nothing in
// src/ makes the request (NFR-03): this only says which URL to ask and turns the JSON that came back into listings.

export interface FeedRequest {
  source: ListingSource;
  /** Shown in the script's output and failures, e.g. "Greenhouse examplelabs". Never holds a key. */
  name: string;
  url: string;
  read(body: unknown): FeedResult;
}

export interface FeedResult {
  /** How many jobs the feed listed, before filtering. */
  jobs: number;
  /** Its jobs as listings, not yet filtered; a job that can't be read is left out. */
  listings: IncomingListing[];
  /** More requests this answer asks for: the next page, or the Hacker News thread itself. */
  followUps: FeedRequest[];
}

/** The answer isn't what the feed is documented to send, so none of its jobs can be trusted. */
export class FeedFormatError extends Error {
  override name = 'FeedFormatError';
}

/**
 * Parses the feed's envelope (strictly enough to notice a format change) and each job on its own. The result asks
 * for no follow-ups; a feed that pages adds its own.
 */
export function readJobs<Job>(
  name: string,
  body: unknown,
  envelope: z.ZodType<unknown[]>,
  job: z.ZodType<Job>,
  toRaw: (job: Job) => RawListing | null,
): FeedResult {
  const parsed = envelope.safeParse(body);
  if (!parsed.success)
    throw new FeedFormatError(`${name}: unexpected answer (${String(parsed.error.issues.length)} problems)`);

  const listings = parsed.data.flatMap((item) => {
    const read = job.safeParse(item);
    if (!read.success) return [];
    const raw = toRaw(read.data);
    const listing = raw === null ? null : toListing(raw);
    return listing === null ? [] : [listing];
  });
  return { jobs: parsed.data.length, listings, followUps: [] };
}

/** A path segment from the owner's config, so it can never change the host or the rest of the path. */
export function segment(value: string): string {
  return encodeURIComponent(value);
}
