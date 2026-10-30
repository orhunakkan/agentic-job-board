// Runs the owner's LinkedIn searches with the saved session (PLAN.md Phase 11, FR-18, FR-19, DEC-041, DEC-042):
//   node scripts/search-linkedin.ts --dry-run       prints the jobs the searches find; sends nothing
//   node scripts/search-linkedin.ts                 sends them to the app (npm start) as a run of their own
//   node scripts/search-linkedin.ts --run <id>      adds them to an open run (how /find-jobs uses it)
//   node scripts/search-linkedin.ts --backfill      reads the job pages of LinkedIn jobs in New and Saved that have no
//                                                   description, so they can be scored on it (DEC-043)
// Options: --config <file> (default data/linkedin-searches.json), --app <url> (default http://127.0.0.1:$PORT),
//          --search <name> (one search only), --no-details (search cards only, no job pages),
//          --session <path> (default LINKEDIN_SESSION_PATH, else data/linkedin/session.json),
//          --channel <name> (msedge on Windows, else chromium).
// A hidden browser opens one page at a time. A search whose page can't be read is reported and skipped; the other
// searches still run. Job pages are read only for jobs the board doesn't have. The app server itself never reaches
// LinkedIn (NFR-03), and this script never prints a cookie value (NFR-12). The last line printed is a JSON summary.
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { chromium, type BrowserContext, type Page, type Response as PageResponse } from '@playwright/test';
import { z } from 'zod';
import type { IncomingListing } from '../src/ingest/listing-ingest.ts';
import {
  linkedInListing,
  LinkedInPageFormatError,
  RawJobPageSchema,
  RawSearchCardSchema,
  toJobDetails,
  toSearchCard,
  type JobDetails,
  type RawJobPage,
  type RawSearchCard,
  type SearchCard,
} from '../src/linkedin/job-page.ts';
import {
  LinkedInSearchConfigError,
  parseLinkedInSearchConfig,
  resolveSearches,
  type LinkedInSearchConfig,
} from '../src/linkedin/search-config.ts';
import type { SearchLinkedInSummary } from '../src/linkedin/search-summary.ts';
import { SEARCH_PAGE_SIZE, searchUrl, windowSeconds } from '../src/linkedin/search-url.ts';
import {
  createLinkedInSessionFile,
  isLinkedInSignInPage,
  linkedInSessionStatus,
  readLinkedInSession,
  saveLinkedInSession,
} from '../src/linkedin/session.ts';
import { WORKPLACE_LABELS } from '../src/domain/workplace.ts';
import {
  IngestStateResponseSchema,
  JobDetailSchema,
  JobListResponseSchema,
  KnownListingsResponseSchema,
  MAX_KNOWN_IDS_PER_CALL,
  type JobSummary,
} from '../src/schemas/api.ts';
import { containsAny } from '../src/sources/filter.ts';
import { AppRequestError, appClient, sendToRun } from './app-client.ts';
import { defaultLoginOptions, ensureLinkedInSession } from './linkedin-login.ts';

export const DEFAULT_CONFIG_PATH = 'data/linkedin-searches.json';
const DAY_MS = 86_400_000;

/** LinkedIn sent the browser to its sign-in page: the saved session no longer works, so nothing else will either. */
export class LinkedInSignedOutError extends Error {
  override name = 'LinkedInSignedOutError';

  constructor() {
    super('LinkedIn asked to sign in again. Run node scripts/linkedin-login.ts, then run this again.');
  }
}

/** LinkedIn refused a page twice, a minute apart: it limits how fast one account reads pages. */
export class LinkedInBusyError extends Error {
  override name = 'LinkedInBusyError';

  constructor(answer: string) {
    super(`LinkedIn is limiting requests (${answer}); the remaining searches and job pages were skipped`);
  }
}

/** Shared by one run: once LinkedIn limits requests, nothing else is asked of it. */
interface RunState {
  limited: boolean;
}

/** What the script reads from LinkedIn; a real browser in use, pages saved on disk in the tests. */
export interface LinkedInPages {
  /** The cards on one search page, or 'no-results' when LinkedIn says no job matches (it then suggests others). */
  searchPage(url: string): Promise<RawSearchCard[] | 'no-results'>;
  /** A job's detail pane. */
  jobPage(jobId: string): Promise<RawJobPage>;
}

export interface SearchLinkedInOptions {
  config: LinkedInSearchConfig;
  /** The app's address, e.g. http://127.0.0.1:3000. A dry run only reads from it, and runs without it too. */
  appUrl: string;
  /** An open run to add to; null starts and finishes a run of its own. */
  runId: number | null;
  dryRun: boolean;
  /** Run only the search with this name. */
  only: string | null;
  /** Read the job pages of new jobs (false: --no-details). */
  details: boolean;
  backfill: boolean;
  pages: LinkedInPages;
  now: () => string;
  log: (line: string) => void;
}

interface FoundJob {
  card: SearchCard;
  searchName: string;
  /** Jobs posted before this time (ms) are outside the window of the search that found it. */
  cutoff: number;
}

export async function searchLinkedIn(options: SearchLinkedInOptions): Promise<SearchLinkedInSummary> {
  const summary: SearchLinkedInSummary = {
    runId: null,
    searches: 0,
    pages: 0,
    cards: 0,
    excluded: 0,
    older: 0,
    matched: 0,
    detailsRead: 0,
    closed: 0,
    new: 0,
    seenAgain: 0,
    repeated: 0,
    failures: [],
  };
  const app = linkedInAppClient(options.appUrl);
  if (!options.dryRun) await app.checkHealth();

  const state: RunState = { limited: false };
  const listings = options.backfill
    ? await backfill(options, app, summary, state)
    : await search(options, app, summary, state);

  if (options.dryRun) {
    for (const listing of listings) options.log(`  ${describe(listing)}`);
    return summary;
  }
  const runId = await sendToRun(app, options.runId, listings, summary);
  return { ...summary, runId };
}

/** Runs the searches, then reads the pages of the jobs new to the board. */
async function search(
  options: SearchLinkedInOptions,
  app: LinkedInAppClient,
  summary: SearchLinkedInSummary,
  state: RunState,
): Promise<IncomingListing[]> {
  const { config, log, pages } = options;
  const now = options.now();
  const searches = resolveSearches(config).filter((entry) => options.only === null || entry.name === options.only);
  if (searches.length === 0) throw new LinkedInSearchConfigError(`No search is named "${String(options.only)}".`);

  const lastSearchAt = searches.some((entry) => entry.postedWithin === 'since-last-run')
    ? await lastLinkedInSearch(options, app)
    : null;

  const found = new Map<string, FoundJob>();
  for (const entry of searches) {
    if (state.limited) break;
    summary.searches += 1;
    const window = windowSeconds(entry.postedWithin, lastSearchAt, now);
    const cutoff = Date.parse(now) - window * 1000;
    try {
      for (let page = 0; page < entry.maxPages; page += 1) {
        const raw = await pages.searchPage(searchUrl(entry, page, window));
        summary.pages += 1;
        if (raw === 'no-results') break;

        const cards = raw.flatMap((card) => toSearchCard(card, now) ?? []);
        if (raw.length > 0 && cards.length === 0) {
          throw new LinkedInPageFormatError(`no job card on page ${String(page + 1)} could be read`);
        }
        summary.cards += cards.length;
        let kept = 0;
        for (const card of cards) {
          if (containsAny(card.title, config.excludeKeywords)) {
            summary.excluded += 1;
          } else if (postedBefore(card, cutoff)) {
            summary.older += 1;
          } else {
            kept += 1;
            if (!found.has(card.jobId)) found.set(card.jobId, { card, searchName: entry.name, cutoff });
          }
        }
        log(`${entry.name}, page ${String(page + 1)}: ${String(cards.length)} jobs, ${String(kept)} kept`);

        const allOlder = entry.sort === 'recent' && cards.every((card) => postedBefore(card, cutoff));
        if (raw.length < SEARCH_PAGE_SIZE || allOlder) break;
      }
    } catch (error) {
      if (error instanceof LinkedInSignedOutError) throw error;
      if (error instanceof LinkedInBusyError) {
        limited(options, summary, state, error);
      } else {
        const failure = `${entry.name}: ${reason(error)}`;
        summary.failures.push(failure);
        log(`${failure} (skipped)`);
      }
    }
  }

  const known = await knownJobs(options, app, [...found.keys()]);
  const listings: IncomingListing[] = [];
  for (const { card, searchName, cutoff } of found.values()) {
    let details: JobDetails | null = null;
    if (options.details && !known.has(card.jobId)) {
      details = await readJobPage(options, summary, state, card.jobId);
      if (details?.closed === true) {
        summary.closed += 1;
        continue;
      }
      if (details?.postedAt != null && Date.parse(details.postedAt) < cutoff) {
        summary.older += 1;
        continue;
      }
    }
    const listing = linkedInListing(card, details, searchName);
    if (listing !== null) listings.push(listing);
  }
  summary.matched = listings.length;
  return listings;
}

/** Reads the job pages of LinkedIn jobs in New and Saved that have no description yet (--backfill). */
async function backfill(
  options: SearchLinkedInOptions,
  app: LinkedInAppClient,
  summary: SearchLinkedInSummary,
  state: RunState,
): Promise<IncomingListing[]> {
  const jobs = [...(await app.linkedInJobs('new')), ...(await app.linkedInJobs('saved'))];
  const listings: IncomingListing[] = [];
  for (const job of jobs) {
    if (state.limited) break;
    if ((await app.description(job.id)) !== null) continue;
    const details = await readJobPage(options, summary, state, job.sourceJobId);
    if (details === null) continue;
    if (details.closed) {
      summary.closed += 1;
      options.log(`${job.title} · ${job.company}: no longer accepting applications`);
      continue;
    }
    const card: SearchCard = {
      jobId: job.sourceJobId,
      title: job.title,
      company: job.company,
      location: job.location,
      listedAt: job.postedAt,
      listedDayOnly: false,
      salary: job.salary,
      easyApply: job.easyApply,
    };
    const listing = linkedInListing(card, details, null);
    if (listing !== null) listings.push(listing);
  }
  summary.matched = listings.length;
  options.log(
    `Backfill: ${String(jobs.length)} jobs in New and Saved, ${String(listings.length)} with a new description`,
  );
  return listings;
}

async function readJobPage(
  options: SearchLinkedInOptions,
  summary: SearchLinkedInSummary,
  state: RunState,
  jobId: string,
): Promise<JobDetails | null> {
  if (state.limited) return null;
  try {
    const details = toJobDetails(await options.pages.jobPage(jobId), options.now());
    summary.detailsRead += 1;
    return details;
  } catch (error) {
    if (error instanceof LinkedInSignedOutError) throw error;
    if (error instanceof LinkedInBusyError) {
      limited(options, summary, state, error);
      return null;
    }
    const failure = `job ${jobId}: ${reason(error)}`;
    summary.failures.push(failure);
    options.log(`${failure} (sent without its job page)`);
    return null;
  }
}

/** Stops asking LinkedIn for anything more in this run; what was read so far is still sent. */
function limited(
  options: SearchLinkedInOptions,
  summary: SearchLinkedInSummary,
  state: RunState,
  error: LinkedInBusyError,
): void {
  state.limited = true;
  summary.failures.push(error.message);
  options.log(error.message);
}

/** Posted before the window starts. A card that gives only a date counts as posted at the end of that day. */
function postedBefore(card: SearchCard, cutoff: number): boolean {
  if (card.listedAt === null) return false;
  return Date.parse(card.listedAt) + (card.listedDayOnly ? DAY_MS : 0) < cutoff;
}

async function lastLinkedInSearch(options: SearchLinkedInOptions, app: LinkedInAppClient): Promise<string | null> {
  try {
    return await app.lastLinkedInSearchAt();
  } catch (error) {
    if (!options.dryRun) throw error;
    options.log('The app is not running, so since-last-run covers the first-run week.');
    return null;
  }
}

async function knownJobs(options: SearchLinkedInOptions, app: LinkedInAppClient, jobIds: readonly string[]) {
  const known = new Set<string>();
  try {
    for (let start = 0; start < jobIds.length; start += MAX_KNOWN_IDS_PER_CALL) {
      for (const id of await app.known(jobIds.slice(start, start + MAX_KNOWN_IDS_PER_CALL))) known.add(id);
    }
  } catch (error) {
    if (!options.dryRun) throw error;
    options.log('The app is not running, so every job counts as new.');
  }
  return known;
}

function describe(listing: IncomingListing): string {
  const parts = [listing.title, listing.company, listing.location];
  if (listing.workplace != null) parts.push(WORKPLACE_LABELS[listing.workplace]);
  if (listing.postedAt !== null) parts.push(`posted ${listing.postedAt.slice(0, 16).replace('T', ' ')} UTC`);
  if (listing.description === null) parts.push('no description');
  return parts.filter((part) => part !== '').join(' · ');
}

function reason(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'the page did not show what was expected in time (LinkedIn may have changed it)';
  }
  return error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
}

type LinkedInAppClient = ReturnType<typeof linkedInAppClient>;

/** The shared app client, plus what only this script asks the app. */
function linkedInAppClient(appUrl: string) {
  const app = appClient(appUrl);
  return {
    ...app,
    async lastLinkedInSearchAt() {
      return (await app.call('GET', '/api/ingest/state', undefined, IngestStateResponseSchema)).lastLinkedInSearchAt;
    },
    async known(sourceJobIds: string[]) {
      const body = { source: 'linkedin', sourceJobIds };
      return (await app.call('POST', '/api/listings/known', body, KnownListingsResponseSchema)).known;
    },
    async linkedInJobs(tab: 'new' | 'saved'): Promise<JobSummary[]> {
      const jobs: JobSummary[] = [];
      for (let offset = 0; ; offset += 100) {
        const path = `/api/jobs?origin=linkedin&tab=${tab}&limit=100&offset=${String(offset)}`;
        const page = await app.call('GET', path, undefined, JobListResponseSchema);
        jobs.push(...page.items);
        if (jobs.length >= page.total || page.items.length === 0) return jobs;
      }
    },
    async description(jobId: number) {
      return (await app.call('GET', `/api/jobs/${String(jobId)}`, undefined, JobDetailSchema)).description;
    },
  };
}

// --- Reading LinkedIn's pages in a browser ------------------------------------------------------------------------
// The selectors below match LinkedIn's search page as it was on 2026-10-24. When LinkedIn changes it, a search
// reports "no job card … could be read" or a timeout, and the selectors here are what to update.

const CARD = 'li[data-occludable-job-id]';
const FILLED_CARD = '[data-job-id]';
const NO_RESULTS = '.jobs-search-no-results-banner';
const JOB_TITLE = '.job-details-jobs-unified-top-card__job-title';
const SEARCH_URL = 'https://www.linkedin.com/jobs/search/';

export interface BrowserPagesOptions {
  /** Wait between two page loads, plus up to `jitterMs` more, so LinkedIn sees an unhurried reader. */
  pauseMs: number;
  jitterMs?: number;
  /** When LinkedIn refuses a page, wait this long and try once more (default 60 s). */
  busyWaitMs?: number;
  /** How long to wait for a page to show its results or job (default 20 s). */
  timeoutMs?: number;
  /** How long to wait for one card to fill in once it is scrolled into view (default 5 s). */
  cardTimeoutMs?: number;
  /**
   * How long the number of cards must stay the same before the list counts as loaded (default 2 s). LinkedIn shows
   * the first 7 cards, then the other 18 about a second later.
   */
  settleMs?: number;
}

export function browserPages(context: BrowserContext, options: BrowserPagesOptions): LinkedInPages {
  const timeout = options.timeoutMs ?? 20_000;
  const cardTimeout = options.cardTimeoutMs ?? 5_000;
  const settleMs = options.settleMs ?? 2_000;
  const jitterMs = options.jitterMs ?? 0;
  const busyWaitMs = options.busyWaitMs ?? 60_000;
  let page: Page | null = null;
  let opened = 0;

  async function open(url: string): Promise<Page> {
    for (let attempt = 1; ; attempt += 1) {
      if (opened > 0 && options.pauseMs > 0) await sleep(options.pauseMs + Math.random() * jitterMs);
      opened += 1;
      page ??= await context.newPage();
      const refusal = await load(page, url);
      if (refusal === null) {
        if (isLinkedInSignInPage(page.url())) throw new LinkedInSignedOutError();
        return page;
      }
      if (attempt === 2) throw new LinkedInBusyError(refusal);
      await sleep(busyWaitMs);
    }
  }

  /**
   * Null when the page loaded (an error page for one job included: waiting for its content then fails that job
   * only); otherwise how LinkedIn refused it ("HTTP 429"). LinkedIn answers too many requests with 429, 999 or 5xx,
   * sometimes as an empty page that the browser reports only as ERR_HTTP_RESPONSE_CODE_FAILURE.
   */
  async function load(current: Page, url: string): Promise<string | null> {
    let status: number | null = null;
    const listener = (response: PageResponse) => {
      if (response.request().isNavigationRequest() && response.frame() === current.mainFrame()) {
        status = response.status();
      }
    };
    current.on('response', listener);
    try {
      status = (await current.goto(url, { waitUntil: 'domcontentloaded', timeout }))?.status() ?? status;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('ERR_HTTP_RESPONSE_CODE_FAILURE'))) throw error;
      if (status === null) return 'an empty error page';
    } finally {
      current.off('response', listener);
    }
    return status !== null && isRefusal(status) ? `HTTP ${String(status)}` : null;
  }

  return {
    async searchPage(url) {
      const current = await open(url);
      await current.locator(`${CARD}, ${NO_RESULTS}`).first().waitFor({ timeout });
      const cardList = current.locator(CARD);
      await settle(() => cardList.count(), settleMs);
      if ((await current.locator(NO_RESULTS).count()) > 0) return 'no-results';

      const cards: RawSearchCard[] = [];
      for (const card of await current.locator(CARD).all()) {
        await card.scrollIntoViewIfNeeded({ timeout: cardTimeout }).catch(() => undefined);
        await card
          .locator(FILLED_CARD)
          .waitFor({ timeout: cardTimeout })
          .catch(() => undefined);
        cards.push(RawSearchCardSchema.parse(await card.evaluate(readCard)));
      }
      return cards;
    },

    async jobPage(jobId) {
      const current = await open(`${SEARCH_URL}?currentJobId=${encodeURIComponent(jobId)}`);
      await current.locator(`${JOB_TITLE} a[href*="/jobs/view/${jobId}/"]`).waitFor({ timeout });
      // The description's box appears before its text, and a "Desired skills" part often before the rest: wait for
      // text (a job may have none), then until it stops growing.
      const shown = await current
        .waitForFunction(descriptionShown, undefined, { timeout: Math.min(timeout, 10_000) })
        .then(() => true)
        .catch(() => false);
      if (shown) await settle(() => current.evaluate(descriptionLength), settleMs);
      return RawJobPageSchema.parse(await current.evaluate(readJobPane));
    },
  };
}

function isRefusal(status: number): boolean {
  return status === 429 || status === 999 || status >= 500;
}

/** Waits until `measure` (the number of cards, the description's length) has stayed the same for `stableMs`, ≤ 12 s. */
async function settle(measure: () => Promise<number>, stableMs: number): Promise<void> {
  const step = 250;
  const deadline = Date.now() + 12_000;
  let value = await measure();
  let stableSince = Date.now();
  while (Date.now() - stableSince < stableMs && Date.now() < deadline) {
    await sleep(step);
    const now = await measure();
    if (now !== value) {
      value = now;
      stableSince = Date.now();
    }
  }
}

// These run inside the page, so they use only the DOM and nothing from this file.

function descriptionLength(): number {
  return (document.querySelector('#job-details')?.textContent ?? '').length;
}

function descriptionShown(): boolean {
  const text = document.querySelector('#job-details')?.textContent ?? '';
  return text.replace('About the job', '').trim().length > 20;
}

function readCard(card: Element): RawSearchCard {
  const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const link = card.querySelector('a.job-card-container__link, .artdeco-entity-lockup__title a');
  const time = card.querySelector('time');
  const timeText = time === null ? null : time.cloneNode(true);
  if (timeText instanceof Element) for (const hidden of timeText.querySelectorAll('.visually-hidden')) hidden.remove();
  const title = text(link?.querySelector('strong')) || (link?.getAttribute('aria-label') ?? '');
  const footer = card.querySelectorAll('.job-card-container__footer-item, .job-card-list__footer-wrapper li');
  return {
    jobId:
      card.getAttribute('data-occludable-job-id') ??
      card.querySelector('[data-job-id]')?.getAttribute('data-job-id') ??
      null,
    href: link?.getAttribute('href') ?? null,
    title: title.replace(/\s+with verification$/i, ''),
    company: text(card.querySelector('.artdeco-entity-lockup__subtitle')),
    metadata: [...card.querySelectorAll('.job-card-container__metadata-wrapper li')].map(text),
    listedDate: time?.getAttribute('datetime') ?? null,
    listedText: timeText === null ? null : text(timeText as Element),
    footer: [...new Set([...footer].map(text))],
  };
}

function readJobPane(): RawJobPage {
  const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const titleBox = document.querySelector('.job-details-jobs-unified-top-card__job-title');
  const tertiary = document.querySelector('.job-details-jobs-unified-top-card__tertiary-description-container');
  const topCard =
    document.querySelector('.job-details-jobs-unified-top-card__container--two-pane') ??
    titleBox?.closest('[class*="top-card"]')?.parentElement ??
    null;
  const parts = tertiary === null ? [] : (tertiary as HTMLElement).innerText.split(/·|\n/);
  return {
    href: titleBox?.querySelector('a')?.getAttribute('href') ?? null,
    title: text(titleBox?.querySelector('h1')),
    company: text(document.querySelector('.job-details-jobs-unified-top-card__company-name')),
    tertiary: parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter((part) => part !== ''),
    pills: [...document.querySelectorAll('.job-details-fit-level-preferences button')].map(text),
    descriptionHtml: document.querySelector('#job-details')?.innerHTML ?? null,
    closed: /No longer accepting applications/i.test(text(topCard)),
  };
}

// --- Command line ---------------------------------------------------------------------------------------------------

export function readConfig(path: string): LinkedInSearchConfig {
  if (!existsSync(path)) {
    throw new LinkedInSearchConfigError(
      `${path} not found. Copy linkedin-searches.example.json to ${DEFAULT_CONFIG_PATH} and edit it (see the README).`,
    );
  }
  return parseLinkedInSearchConfig(readFileSync(path, 'utf8'), path);
}

const EnvSchema = z.object({ PORT: z.string().regex(/^\d+$/).default('3000') });

if (import.meta.main) {
  const usage =
    'Usage: node scripts/search-linkedin.ts [--dry-run] [--run <id>] [--backfill] [--search <name>] [--no-details] ' +
    '[--config <file>] [--app <url>] [--session <path>] [--channel <name>]';
  try {
    const { values } = parseArgs({
      options: {
        'dry-run': { type: 'boolean', default: false },
        run: { type: 'string' },
        backfill: { type: 'boolean', default: false },
        search: { type: 'string' },
        'no-details': { type: 'boolean', default: false },
        config: { type: 'string', default: DEFAULT_CONFIG_PATH },
        app: { type: 'string' },
        session: { type: 'string' },
        channel: { type: 'string' },
      },
    });
    // The script runs without --env-file (from /find-jobs too), so it reads .env itself for PORT and the session path.
    if (existsSync('.env')) process.loadEnvFile('.env');
    const env = EnvSchema.parse(process.env);
    const runId = values.run === undefined ? null : z.coerce.number().int().positive().parse(values.run);
    const config = readConfig(values.config);
    const defaults = defaultLoginOptions();
    const login = { sessionPath: values.session ?? defaults.sessionPath, channel: values.channel ?? defaults.channel };

    const now = () => new Date().toISOString();
    if (linkedInSessionStatus(login.sessionPath, now()).status !== 'active') {
      await ensureLinkedInSession(login, { quiet: true });
    }
    const session = readLinkedInSession(login.sessionPath);
    if (session === null || linkedInSessionStatus(login.sessionPath, now()).status !== 'active') {
      throw new LinkedInSignedOutError();
    }

    const browser = await chromium.launch({
      headless: true,
      ...(login.channel === 'chromium' ? {} : { channel: login.channel }),
    });
    try {
      const context = await browser.newContext({
        storageState: session.storageState,
        viewport: { width: 1400, height: 1000 },
      });
      const summary = await searchLinkedIn({
        config,
        appUrl: values.app ?? `http://127.0.0.1:${env.PORT}`,
        runId,
        dryRun: values['dry-run'],
        only: values.search ?? null,
        details: !values['no-details'],
        backfill: values.backfill,
        pages: browserPages(context, { pauseMs: 3000, jitterMs: 2000 }),
        now,
        log: (line) => {
          console.log(line);
        },
      });
      // LinkedIn renews its cookies as pages load; keeping them means the owner signs in less often.
      try {
        saveLinkedInSession(login.sessionPath, createLinkedInSessionFile(await context.storageState(), now()));
      } catch {
        // Signed out during the run: keep the file as it was.
      }
      console.log(JSON.stringify(summary));
    } finally {
      await browser.close();
    }
  } catch (error) {
    if (error instanceof LinkedInSearchConfigError) {
      console.error(error.message);
      process.exitCode = 2;
    } else if (error instanceof AppRequestError || error instanceof LinkedInSignedOutError) {
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
