import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { toId } from './columns.ts';

// One row per /find-jobs run, with its counters (FR-11). Listings are the jobs the other sources sent (FR-15).

export interface RunCounters {
  emailsSeen: number;
  emailsNew: number;
  emailsDuplicate: number;
  emailsUnrecognized: number;
  listingsSeen: number;
  jobsNew: number;
  jobsSeenAgain: number;
  jobsScored: number;
}

export interface RunRecord extends RunCounters {
  id: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface RunsRepository {
  create(startedAt: string): number;
  get(id: number): RunRecord | null;
  addCounts(id: number, counts: Partial<RunCounters>): void;
  finish(id: number, finishedAt: string): void;
  /** Newest first. */
  list(limit: number): RunRecord[];
}

const Count = z.number().int().nonnegative();
const Row = z.object({
  id: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  emailsSeen: Count,
  emailsNew: Count,
  emailsDuplicate: Count,
  emailsUnrecognized: Count,
  listingsSeen: Count,
  jobsNew: Count,
  jobsSeenAgain: Count,
  jobsScored: Count,
});

const COLUMNS = `id, started_at AS startedAt, finished_at AS finishedAt,
  emails_seen AS emailsSeen, emails_new AS emailsNew, emails_duplicate AS emailsDuplicate,
  emails_unrecognized AS emailsUnrecognized, listings_seen AS listingsSeen, jobs_new AS jobsNew,
  jobs_seen_again AS jobsSeenAgain, jobs_scored AS jobsScored`;

export function createRunsRepository(db: DatabaseSync): RunsRepository {
  const insert = db.prepare('INSERT INTO runs (started_at) VALUES (?)');
  const select = db.prepare(`SELECT ${COLUMNS} FROM runs WHERE id = ?`);
  const selectRecent = db.prepare(`SELECT ${COLUMNS} FROM runs ORDER BY id DESC LIMIT ?`);
  const add = db.prepare(
    `UPDATE runs SET
       emails_seen = emails_seen + ?, emails_new = emails_new + ?, emails_duplicate = emails_duplicate + ?,
       emails_unrecognized = emails_unrecognized + ?, listings_seen = listings_seen + ?, jobs_new = jobs_new + ?,
       jobs_seen_again = jobs_seen_again + ?, jobs_scored = jobs_scored + ?
     WHERE id = ?`,
  );
  const close = db.prepare('UPDATE runs SET finished_at = ? WHERE id = ?');

  return {
    create(startedAt) {
      return toId(insert.run(startedAt).lastInsertRowid);
    },
    get(id) {
      const row = select.get(id);
      return row === undefined ? null : Row.parse(row);
    },
    addCounts(id, counts) {
      add.run(
        counts.emailsSeen ?? 0,
        counts.emailsNew ?? 0,
        counts.emailsDuplicate ?? 0,
        counts.emailsUnrecognized ?? 0,
        counts.listingsSeen ?? 0,
        counts.jobsNew ?? 0,
        counts.jobsSeenAgain ?? 0,
        counts.jobsScored ?? 0,
        id,
      );
    },
    finish(id, finishedAt) {
      close.run(finishedAt, id);
    },
    list(limit) {
      return selectRecent.all(limit).map((row) => Row.parse(row));
    },
  };
}
