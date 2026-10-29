import { setWorldConstructor, World } from '@cucumber/cucumber';
import type { Page } from '@playwright/test';
import type { IncomingListing } from '../../../src/ingest/listing-ingest.ts';
import { fakeClaudeCommand } from '../../helpers/fake-claude.ts';
import { fakeClock } from '../../helpers/fixtures.ts';
import { startTestApp, type ApiResponse, type TestApp } from '../../helpers/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../../integration/helpers/test-database.ts';
import { listingFor, type JobRow } from './board-data.ts';

// What one scenario holds (PLAN.md §8.5). Cucumber makes a new World for every scenario, so each one starts from a
// clean app: its own temporary database (integration), or its own app on a free port with the stand-in for Claude
// Code (API and E2E). Both are made on first use, so a scenario can say how Find Now's stand-in behaves first.

export interface BoardParameters {
  /** The E2E profile's browser (cucumber.json): chromium, firefox, webkit or mobile (Pixel 7). */
  browser?: string;
}

export class BoardWorld extends World<BoardParameters> {
  /** The jobs this scenario put on the board, by title. */
  readonly jobs = new Map<string, number>();
  /** The job a step means by "it" or "the job": the one added or named last. */
  current: string | undefined;
  /** How long the current job's history was before the scenario changed its status. */
  historyLength: number | undefined;
  /** The listing each job was sent as, by title, so a scenario can send the same one again. */
  readonly listings = new Map<string, IncomingListing>();
  /** The run the scenario is working in, if one is open. */
  runId: number | undefined;
  /** The note the scenario last wrote on a job (API steps). */
  note: string | undefined;
  /** The last answer from the app (API steps). */
  response: ApiResponse | undefined;
  /** What the last service call threw, if it threw (integration steps). */
  error: unknown;
  /** How many jobs Clear All said it dismissed (integration steps). */
  dismissed: number | undefined;
  /** The time the integration services stamp; one second later on each call. */
  readonly clock = fakeClock();
  /** How Find Now starts its stand-in for Claude Code; set it before the app starts. */
  claudeCommand: readonly string[] = fakeClaudeCommand();

  #database: TestDatabase | undefined;
  #app: TestApp | undefined;
  #page: Page | undefined;

  /** A migrated temporary database for the integration steps. */
  get database(): TestDatabase {
    this.#database ??= createTestDatabase();
    return this.#database;
  }

  /** The real app for the API and E2E steps, started on first use. */
  async app(): Promise<TestApp> {
    this.#app ??= await startTestApp({ claudeCommand: this.claudeCommand });
    return this.#app;
  }

  get appStarted(): boolean {
    return this.#app !== undefined;
  }

  /** The browser page of an E2E scenario (tests/features/e2e/hooks.ts opens it). */
  get page(): Page {
    if (this.#page === undefined) throw new Error('no browser page: only the E2E profiles open one');
    return this.#page;
  }

  set page(page: Page) {
    this.#page = page;
  }

  /** Records a job the scenario put on the board; it becomes "the job". */
  remember(title: string, id: number): void {
    this.jobs.set(title, id);
    this.current = title;
  }

  jobId(title: string): number {
    const id = this.jobs.get(title);
    if (id === undefined) throw new Error(`the scenario has no job called "${title}"`);
    return id;
  }

  /** The job a step means by "it" or "the job". */
  theJob(): number {
    if (this.current === undefined) throw new Error('the scenario has not named a job yet');
    return this.jobId(this.current);
  }

  /** The listing for a job, made once per title so that sending it again is the same listing. */
  listing(row: JobRow): IncomingListing {
    const known = this.listings.get(row.title);
    if (known !== undefined) return known;
    const listing = listingFor(row, this.listings.size + 1);
    this.listings.set(row.title, listing);
    return listing;
  }

  knownListing(title: string): IncomingListing {
    const listing = this.listings.get(title);
    if (listing === undefined) throw new Error(`the scenario never sent a listing called "${title}"`);
    return listing;
  }

  /** Closes all three even when one fails, so no app keeps the run alive; the first failure is rethrown. */
  async cleanUp(): Promise<void> {
    const results = await Promise.allSettled([
      this.#page?.context().close(),
      this.#app?.close(),
      Promise.resolve().then(() => this.#database?.close()),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed !== undefined) throw failed.reason;
  }
}

setWorldConstructor(BoardWorld);
