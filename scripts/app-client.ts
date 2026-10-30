// The board's API as scripts/fetch-sources.ts and scripts/search-linkedin.ts call it: both send what they find to a
// run of the app (npm start) on 127.0.0.1.
import { z } from 'zod';
import type { IncomingListing } from '../src/ingest/listing-ingest.ts';
import {
  CreateRunResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  IngestListingsResponseSchema,
  MAX_LISTINGS_PER_CALL,
} from '../src/schemas/api.ts';

/** The app is not running or refused what was sent. */
export class AppRequestError extends Error {
  override name = 'AppRequestError';
}

export type AppClient = ReturnType<typeof appClient>;

export function appClient(appUrl: string) {
  async function call<T>(method: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(
        `${appUrl}${path}`,
        body === undefined
          ? { method }
          : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
    } catch {
      throw new AppRequestError(`The app is not running at ${appUrl}. Start it with npm start.`);
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = ErrorResponseSchema.safeParse(json);
      const detail = error.success ? `${error.data.error.code}: ${error.data.error.message}` : 'no details';
      throw new AppRequestError(`${method} ${path} failed with HTTP ${String(response.status)} (${detail})`);
    }
    return schema.parse(json);
  }

  return {
    call,
    async checkHealth() {
      await call('GET', '/api/health', undefined, HealthResponseSchema);
    },
    async startRun() {
      return (await call('POST', '/api/runs', {}, CreateRunResponseSchema)).runId;
    },
    sendListings(runId: number, listings: IncomingListing[]) {
      return call('POST', `/api/runs/${String(runId)}/listings`, { listings }, IngestListingsResponseSchema);
    },
    async finishRun(runId: number) {
      await call('POST', `/api/runs/${String(runId)}/finish`, {}, z.unknown());
    },
  };
}

/** What the app counted for the listings sent; a script's summary carries these. */
interface IngestCounts {
  new: number;
  seenAgain: number;
  repeated: number;
}

/**
 * Sends the listings to the open run `runId`, or to a run of their own when it is null (started here and finished
 * after the last call), at most MAX_LISTINGS_PER_CALL at a time. Adds the app's counts to `counts`; returns the run.
 */
export async function sendToRun(
  app: AppClient,
  runId: number | null,
  listings: readonly IncomingListing[],
  counts: IngestCounts,
): Promise<number> {
  const run = runId ?? (await app.startRun());
  for (let start = 0; start < listings.length; start += MAX_LISTINGS_PER_CALL) {
    const sent = await app.sendListings(run, listings.slice(start, start + MAX_LISTINGS_PER_CALL));
    counts.new += sent.new;
    counts.seenAgain += sent.seenAgain;
    counts.repeated += sent.repeated;
  }
  if (runId === null) await app.finishRun(run);
  return run;
}
