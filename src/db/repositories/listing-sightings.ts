import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

// One row per run in which a feed listed a job (FR-16, shown on the job detail page). A feed that lists the same
// job twice in one run still counts once.

export interface ListingSightingRecord {
  runId: number;
  seenAt: string;
}

export interface ListingSightingsRepository {
  /** False when the job already has a sighting in this run, which is then left as it was. */
  insert(jobId: number, runId: number, seenAt: string): boolean;
  listForJob(jobId: number): ListingSightingRecord[];
}

const Row = z.object({ runId: z.number().int(), seenAt: z.string() });

export function createListingSightingsRepository(db: DatabaseSync): ListingSightingsRepository {
  const insertStatement = db.prepare(
    'INSERT INTO listing_sightings (job_id, run_id, seen_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
  );
  const listStatement = db.prepare(
    'SELECT run_id AS runId, seen_at AS seenAt FROM listing_sightings WHERE job_id = ? ORDER BY seen_at, run_id',
  );

  return {
    insert(jobId, runId, seenAt) {
      return insertStatement.run(jobId, runId, seenAt).changes > 0;
    },
    listForJob(jobId) {
      return listStatement.all(jobId).map((row) => Row.parse(row));
    },
  };
}
