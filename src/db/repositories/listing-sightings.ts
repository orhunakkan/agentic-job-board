import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { JobSource } from '../../domain/job-source.ts';

// One row per run in which a feed or a LinkedIn search listed a job (FR-16, FR-18, shown on the job detail page).
// A feed that lists the same job twice in one run, or two searches that find it, still count once.

export interface ListingSightingRecord {
  runId: number;
  seenAt: string;
  /** The LinkedIn search that found the job; null for the feeds. */
  searchName: string | null;
}

export interface ListingSightingsRepository {
  /** False when the job already has a sighting in this run, which is then left as it was. */
  insert(jobId: number, runId: number, seenAt: string, searchName: string | null): boolean;
  listForJob(jobId: number): ListingSightingRecord[];
  /** When a run last stored a sighting of a job from `source`, or null when none has (Phase 11, since-last-run). */
  latestSeenAt(source: JobSource): string | null;
}

const Row = z.object({ runId: z.number().int(), seenAt: z.string(), searchName: z.string().nullable() });
const LatestRow = z.object({ at: z.string().nullable() });

export function createListingSightingsRepository(db: DatabaseSync): ListingSightingsRepository {
  const insertStatement = db.prepare(
    `INSERT INTO listing_sightings (job_id, run_id, seen_at, search_name) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  );
  const listStatement = db.prepare(
    `SELECT run_id AS runId, seen_at AS seenAt, search_name AS searchName FROM listing_sightings WHERE job_id = ?
     ORDER BY seen_at, run_id`,
  );
  const latestStatement = db.prepare(
    `SELECT max(s.seen_at) AS at FROM listing_sightings s JOIN jobs j ON j.id = s.job_id WHERE j.source = ?`,
  );

  return {
    insert(jobId, runId, seenAt, searchName) {
      return insertStatement.run(jobId, runId, seenAt, searchName).changes > 0;
    },
    listForJob(jobId) {
      return listStatement.all(jobId).map((row) => Row.parse(row));
    },
    latestSeenAt(source) {
      return LatestRow.parse(latestStatement.get(source)).at;
    },
  };
}
