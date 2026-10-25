import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

// Jobs from the alert-email years (before Phase 11, DEC-041). The app no longer takes emails, but the owner's
// database keeps the jobs, emails and sightings they left, and the pages still show them. These rows are what the
// old email ingest stored for the three sanitized alert emails of PLAN.md §8.2 (18 jobs), recorded once in
// tests/fixtures/email-years.json before the parser was removed, and written here as that ingest wrote them.

const EmailYearsSchema = z.strictObject({
  emails: z.array(
    z.strictObject({
      gmail_message_id: z.string(),
      received_at: z.string(),
      sender: z.string(),
      subject: z.string(),
      saved_search: z.string().nullable(),
      jobs_found: z.number().int(),
      processed_at: z.string(),
    }),
  ),
  jobs: z.array(
    z.strictObject({
      id: z.number().int(),
      source_job_id: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string(),
      url: z.string(),
      actively_hiring: z.number().int(),
      easy_apply: z.number().int(),
      status_changed_at: z.string(),
      first_seen_at: z.string(),
      last_seen_at: z.string(),
      seen_count: z.number().int(),
    }),
  ),
  sightings: z.array(
    z.strictObject({ job_id: z.number().int(), gmail_message_id: z.string(), saved_search: z.string().nullable() }),
  ),
  run: z.strictObject({
    emails_seen: z.number().int(),
    emails_new: z.number().int(),
    jobs_new: z.number().int(),
    jobs_seen_again: z.number().int(),
  }),
});

export const EMAIL_YEARS = EmailYearsSchema.parse(
  JSON.parse(readFileSync(new URL('../fixtures/email-years.json', import.meta.url), 'utf8')),
);

/** Writes the email-years jobs into run `runId`, as the old ingest did. Returns the new job IDs, in email order. */
export function seedEmailYears(db: DatabaseSync, runId: number): number[] {
  const insertEmail = db.prepare(
    `INSERT INTO emails (gmail_message_id, run_id, received_at, sender, subject, saved_search, parse_status,
                         jobs_found, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'parsed', ?, ?)`,
  );
  const insertJob = db.prepare(
    `INSERT INTO jobs (source, source_job_id, title, company, location, url, actively_hiring, easy_apply,
                       status_changed_at, first_seen_at, last_seen_at, seen_count, first_run_id)
     VALUES ('linkedin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertHistory = db.prepare(
    "INSERT INTO status_history (job_id, from_status, to_status, changed_at) VALUES (?, NULL, 'new', ?)",
  );
  const insertSighting = db.prepare('INSERT INTO sightings (job_id, gmail_message_id, saved_search) VALUES (?, ?, ?)');

  for (const email of EMAIL_YEARS.emails) {
    insertEmail.run(
      email.gmail_message_id,
      runId,
      email.received_at,
      email.sender,
      email.subject,
      email.saved_search,
      email.jobs_found,
      email.processed_at,
    );
  }
  const ids = new Map<number, number>();
  for (const job of EMAIL_YEARS.jobs) {
    const id = Number(
      insertJob.run(
        job.source_job_id,
        job.title,
        job.company,
        job.location,
        job.url,
        job.actively_hiring,
        job.easy_apply,
        job.status_changed_at,
        job.first_seen_at,
        job.last_seen_at,
        job.seen_count,
        runId,
      ).lastInsertRowid,
    );
    ids.set(job.id, id);
    insertHistory.run(id, job.status_changed_at);
  }
  for (const sighting of EMAIL_YEARS.sightings) {
    insertSighting.run(ids.get(sighting.job_id) ?? 0, sighting.gmail_message_id, sighting.saved_search);
  }
  const { run } = EMAIL_YEARS;
  db.prepare(
    `UPDATE runs SET emails_seen = emails_seen + ?, emails_new = emails_new + ?, jobs_new = jobs_new + ?,
       jobs_seen_again = jobs_seen_again + ? WHERE id = ?`,
  ).run(run.emails_seen, run.emails_new, run.jobs_new, run.jobs_seen_again, runId);
  return [...ids.values()];
}
