// Reads the free public job feeds into the board (PLAN.md Phase 10, FR-15, DEC-035).
//   node scripts/fetch-sources.ts --dry-run       prints the jobs that match data/sources.json; sends nothing
//   node scripts/fetch-sources.ts                 sends them to the app (npm start) as a run of their own
//   node scripts/fetch-sources.ts --run <id>      adds them to an open run (how /find-jobs uses it)
// Options: --config <file> (default data/sources.json), --app <url> (default http://127.0.0.1:$PORT).
// Only this script reaches the feeds: the app server makes no outbound requests (NFR-03). The feeds are asked one
// at a time; a feed that fails is reported and skipped. The last line printed is a JSON summary.
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { SOURCE_LABELS } from '../src/domain/job-source.ts';
import type { IncomingListing } from '../src/ingest/listing-ingest.ts';
import type { AdzunaKey } from '../src/sources/adzuna.ts';
import { FeedFormatError } from '../src/sources/feed.ts';
import { planFeeds } from '../src/sources/feeds.ts';
import type { FetchSourcesSummary } from '../src/sources/fetch-summary.ts';
import { isWanted } from '../src/sources/filter.ts';
import { parseSourcesConfig, SourcesConfigError, type SourcesConfig } from '../src/sources/source-config.ts';
import { AppRequestError, appClient, sendToRun } from './app-client.ts';

export const DEFAULT_CONFIG_PATH = 'data/sources.json';
const FEED_TIMEOUT_MS = 20_000;
const USER_AGENT = 'agentic-job-board/1.0 (personal job search; github.com/orhunakkan/agentic-job-board)';

/** A feed could not be read: no answer, an error status, or not JSON. */
export class FeedRequestError extends Error {
  override name = 'FeedRequestError';
}

export interface FetchSourcesOptions {
  config: SourcesConfig;
  adzunaKey: AdzunaKey | null;
  /** The app's address, e.g. http://127.0.0.1:3000. A dry run never contacts it. */
  appUrl: string;
  /** An open run to add to; null starts and finishes a run of its own. */
  runId: number | null;
  dryRun: boolean;
  fetchJson: (url: string) => Promise<unknown>;
  log: (line: string) => void;
}

export async function fetchSources(options: FetchSourcesOptions): Promise<FetchSourcesSummary> {
  const { config, log } = options;
  const requests = planFeeds(config, options.adzunaKey);
  const wanted = new Map<string, IncomingListing>();
  const failures: string[] = [];
  let fetched = 0;

  // Follow-ups (a next page, the Hacker News thread) join the end of the list; for…of reaches them too.
  for (const request of requests) {
    try {
      const result = request.read(await options.fetchJson(request.url));
      requests.push(...result.followUps);
      const matching = result.listings.filter((listing) => isWanted(listing, config));
      for (const listing of matching) {
        const key = `${listing.source}\n${listing.sourceJobId}`;
        if (!wanted.has(key)) wanted.set(key, listing);
      }
      fetched += result.jobs;
      if (result.jobs > 0 || result.followUps.length === 0) {
        log(`${request.name}: ${String(result.jobs)} jobs, ${String(matching.length)} matching`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const failure = error instanceof FeedFormatError ? reason : `${request.name}: ${reason}`;
      failures.push(failure);
      log(`${failure} (skipped)`);
    }
  }

  const listings = [...wanted.values()];
  const summary: FetchSourcesSummary = {
    runId: null,
    feeds: requests.length,
    fetched,
    matched: listings.length,
    new: 0,
    seenAgain: 0,
    repeated: 0,
    failures,
  };

  if (options.dryRun) {
    for (const listing of listings) {
      const where = listing.location === '' ? '' : ` · ${listing.location}`;
      log(`  ${listing.title} · ${listing.company}${where} · ${SOURCE_LABELS[listing.source]}`);
    }
    return summary;
  }

  const app = appClient(options.appUrl);
  await app.checkHealth();
  const runId = await sendToRun(app, options.runId, listings, summary);
  return { ...summary, runId };
}

/** GETs a feed's JSON. An error never includes the URL, which holds the Adzuna key. */
export async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new FeedRequestError(timedOut ? 'no answer within 20 s' : 'could not connect');
  }
  if (!response.ok) throw new FeedRequestError(`HTTP ${String(response.status)}`);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new FeedRequestError('the answer is not JSON');
  }
}

export function readConfig(path: string): SourcesConfig {
  if (!existsSync(path)) {
    throw new SourcesConfigError(
      `${path} not found. Copy sources.example.json to ${DEFAULT_CONFIG_PATH} and edit it (see the README).`,
    );
  }
  return parseSourcesConfig(readFileSync(path, 'utf8'), path);
}

const EnvSchema = z.object({
  PORT: z.string().regex(/^\d+$/).default('3000'),
  ADZUNA_APP_ID: z.string().trim().min(1).optional(),
  ADZUNA_APP_KEY: z.string().trim().min(1).optional(),
});

if (import.meta.main) {
  const usage = 'Usage: node scripts/fetch-sources.ts [--dry-run] [--run <id>] [--config <file>] [--app <url>]';
  try {
    const { values } = parseArgs({
      options: {
        'dry-run': { type: 'boolean', default: false },
        run: { type: 'string' },
        config: { type: 'string', default: DEFAULT_CONFIG_PATH },
        app: { type: 'string' },
      },
    });
    // The script runs without --env-file (from /find-jobs too), so it reads .env itself for PORT and the Adzuna key.
    if (existsSync('.env')) process.loadEnvFile('.env');
    const env = EnvSchema.parse(process.env);
    const runId = values.run === undefined ? null : z.coerce.number().int().positive().parse(values.run);

    const summary = await fetchSources({
      config: readConfig(values.config),
      adzunaKey:
        env.ADZUNA_APP_ID === undefined || env.ADZUNA_APP_KEY === undefined
          ? null
          : { appId: env.ADZUNA_APP_ID, appKey: env.ADZUNA_APP_KEY },
      appUrl: values.app ?? `http://127.0.0.1:${env.PORT}`,
      runId,
      dryRun: values['dry-run'],
      fetchJson,
      log: (line) => {
        console.log(line);
      },
    });
    console.log(JSON.stringify(summary));
  } catch (error) {
    if (error instanceof SourcesConfigError) {
      console.error(error.message);
      process.exitCode = 2;
    } else if (error instanceof AppRequestError) {
      console.error(error.message);
      process.exitCode = 1;
    } else if (error instanceof z.ZodError || (error instanceof TypeError && 'code' in error)) {
      console.error(usage);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
