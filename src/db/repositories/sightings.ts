import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

// One row per appearance of a job in an alert email (FR-04, shown on the job detail page). Alert emails are no
// longer read (DEC-041), so these rows are only read: jobs from the email years keep their history.

export interface SightingRecord {
  gmailMessageId: string;
  savedSearch: string | null;
  receivedAt: string;
}

export interface SightingsRepository {
  listForJob(jobId: number): SightingRecord[];
}

const Row = z.object({
  gmailMessageId: z.string(),
  savedSearch: z.string().nullable(),
  receivedAt: z.string(),
});

export function createSightingsRepository(db: DatabaseSync): SightingsRepository {
  const listStatement = db.prepare(
    `SELECT s.gmail_message_id AS gmailMessageId, s.saved_search AS savedSearch, e.received_at AS receivedAt
     FROM sightings s JOIN emails e ON e.gmail_message_id = s.gmail_message_id
     WHERE s.job_id = ?
     ORDER BY e.received_at, s.gmail_message_id`,
  );

  return {
    listForJob(jobId) {
      return listStatement.all(jobId).map((row) => Row.parse(row));
    },
  };
}
