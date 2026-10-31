import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { openDatabase } from '../../../src/db/database.ts';
import { migrate } from '../../../src/db/migrate.ts';
import { createRepositories, type Repositories } from '../../../src/db/repositories/index.ts';

// PLAN.md §8.2: every test gets its own temporary SQLite file, deleted afterwards.
export { fakeClock } from '../../helpers/fixtures.ts';

export interface TestDatabase {
  db: DatabaseSync;
  repos: Repositories;
  dir: string;
  path: string;
  close(): void;
}

export function createTestDatabase(options: { migrated?: boolean } = {}): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'jobboard-test-'));
  const path = join(dir, 'test.db');
  const db = openDatabase(path);
  if (options.migrated !== false) migrate(db);

  let repos: Repositories | undefined;
  return {
    db,
    // Created on first use: preparing statements needs the tables, which unmigrated tests don't have.
    get repos() {
      repos ??= createRepositories(db);
      return repos;
    },
    dir,
    path,
    close() {
      if (db.isOpen) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const TABLES = ['runs', 'emails', 'jobs', 'sightings', 'listing_sightings', 'status_history', 'profile'] as const;
type Table = (typeof TABLES)[number];
const CountRow = z.object({ n: z.number().int() });

export function countRows(db: DatabaseSync, table: Table): number {
  // `table` is one of the fixed names above, never user input.
  return CountRow.parse(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n;
}

export function countAll(db: DatabaseSync): Record<Table, number> {
  return Object.fromEntries(TABLES.map((table) => [table, countRows(db, table)])) as Record<Table, number>;
}

// Every stored value of every table, for "this never reaches the database" checks.
export function dumpAll(db: DatabaseSync): string {
  return JSON.stringify(TABLES.map((table) => db.prepare(`SELECT * FROM ${table}`).all()));
}

/**
 * A LinkedIn job from the alert-email years (before Phase 11, DEC-041): a run, the email, the job with its triage
 * score and status, and its email sighting, written as the old email ingest left them. Returns the job's ID.
 */
export function seedEmailYearsJob(db: DatabaseSync, linkedinJobId = '4473592349'): number {
  const runId = db
    .prepare(
      `INSERT INTO runs (started_at, finished_at, emails_seen, emails_new, jobs_new, jobs_scored)
       VALUES ('2026-10-20T16:00:00.000Z', '2026-10-20T16:05:00.000Z', 1, 1, 1, 1)`,
    )
    .run().lastInsertRowid;
  db.prepare(
    `INSERT INTO emails (gmail_message_id, run_id, received_at, sender, subject, saved_search, parse_status,
                         jobs_found, processed_at)
     VALUES ('msg-email-years', ?, '2026-10-20T14:10:48.000Z', 'jobalerts-noreply@linkedin.com',
             'Senior Logistics Coordinator', 'senior underwriting analyst in United States', 'parsed',
             1, '2026-10-20T16:00:01.000Z')`,
  ).run(runId);
  const result = db
    .prepare(
      `INSERT INTO jobs (source, source_job_id, title, company, location, url, actively_hiring, easy_apply, status,
                         status_changed_at, notes, score, score_label, score_reason, rubric_version, scored_at,
                         first_seen_at, last_seen_at, first_run_id)
       VALUES ('linkedin', ?, 'Senior Logistics Coordinator', 'Example Markets', 'Chicago, IL', ?, 1, 0, 'saved',
               '2026-10-21T09:00:00.000Z', 'Call back', 70, 'possible', 'Senior accounting role, Chicago-based.', 'triage-v1',
               '2026-10-20T16:04:00.000Z', '2026-10-20T14:10:48.000Z', '2026-10-20T14:10:48.000Z', ?)`,
    )
    .run(linkedinJobId, `https://www.linkedin.com/jobs/view/${linkedinJobId}/`, runId);
  const jobId = Number(result.lastInsertRowid);
  db.prepare(
    `INSERT INTO sightings (job_id, gmail_message_id, saved_search)
     VALUES (?, 'msg-email-years', 'senior underwriting analyst in United States')`,
  ).run(jobId);
  db.prepare(
    `INSERT INTO status_history (job_id, from_status, to_status, changed_at)
     VALUES (?, NULL, 'new', '2026-10-20T16:00:01.000Z'), (?, 'new', 'saved', '2026-10-21T09:00:00.000Z')`,
  ).run(jobId, jobId);
  return jobId;
}
