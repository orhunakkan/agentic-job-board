import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/database.ts';
import type { Repositories } from '../db/repositories/index.ts';
import type { NewJob } from '../db/repositories/jobs.ts';
import { parseAlertEmail, type ParsedJob } from './linkedin-email-parser.ts';

// Stores a batch of Gmail messages for a run (PLAN.md Phase 3, FR-02/04/05/12).
// Each email is one transaction: its email row, jobs, sightings, history and run counters
// are all written or none are. An email already stored is a duplicate and changes nothing.

export interface IncomingEmail {
  gmailMessageId: string;
  receivedAt: string;
  sender: string;
  subject: string;
  plainText: string;
}

export type EmailOutcome = 'new' | 'duplicate' | 'unrecognized';

export interface EmailResult {
  gmailMessageId: string;
  outcome: EmailOutcome;
  jobsFound: number;
}

export interface IngestResult {
  results: EmailResult[];
  newJobIds: number[];
}

export class RunNotFoundError extends Error {
  override name = 'RunNotFoundError';

  constructor(runId: number) {
    super(`run ${String(runId)} does not exist`);
  }
}

export class RunFinishedError extends Error {
  override name = 'RunFinishedError';

  constructor(runId: number) {
    super(`run ${String(runId)} is already finished`);
  }
}

export class InvalidEmailError extends Error {
  override name = 'InvalidEmailError';
}

export function ingestEmails(
  db: DatabaseSync,
  repos: Repositories,
  runId: number,
  emails: readonly IncomingEmail[],
  now: () => string = () => new Date().toISOString(),
): IngestResult {
  const run = repos.runs.get(runId);
  if (run === null) throw new RunNotFoundError(runId);
  if (run.finishedAt !== null) throw new RunFinishedError(runId);

  // Check the whole batch first, so a bad email can't leave half a batch behind.
  const batch = emails.map((email) => ({ ...email, receivedAt: toIsoTimestamp(email) }));

  const results: EmailResult[] = [];
  const newJobIds: number[] = [];
  for (const email of batch) {
    results.push(transaction(db, () => ingestOne(repos, runId, email, now(), newJobIds)));
  }
  return { results, newJobIds };
}

function ingestOne(
  repos: Repositories,
  runId: number,
  email: IncomingEmail,
  processedAt: string,
  newJobIds: number[],
): EmailResult {
  const { gmailMessageId } = email;
  if (repos.emails.exists(gmailMessageId)) {
    repos.runs.addCounts(runId, { emailsSeen: 1, emailsDuplicate: 1 });
    return { gmailMessageId, outcome: 'duplicate', jobsFound: 0 };
  }

  const stored = {
    gmailMessageId,
    runId,
    receivedAt: email.receivedAt,
    sender: email.sender,
    subject: email.subject,
    processedAt,
  };
  const parsed = parseAlertEmail(email);
  if ('unrecognized' in parsed) {
    repos.emails.insert({
      ...stored,
      savedSearch: null,
      parseStatus: 'unrecognized',
      unrecognizedReason: parsed.unrecognized,
      jobsFound: 0,
    });
    repos.runs.addCounts(runId, { emailsSeen: 1, emailsUnrecognized: 1 });
    return { gmailMessageId, outcome: 'unrecognized', jobsFound: 0 };
  }

  repos.emails.insert({
    ...stored,
    savedSearch: parsed.savedSearch,
    parseStatus: 'parsed',
    unrecognizedReason: null,
    jobsFound: parsed.jobs.length,
  });

  let jobsNew = 0;
  let jobsSeenAgain = 0;
  for (const parsedJob of parsed.jobs) {
    const job = linkedInJob(parsedJob);
    let jobId = repos.jobs.findId(job.source, job.sourceJobId);
    if (jobId === null) {
      jobId = repos.jobs.insert(job, { runId, seenAt: email.receivedAt, createdAt: processedAt });
      repos.statusHistory.insert(jobId, { fromStatus: null, toStatus: 'new', changedAt: processedAt });
      newJobIds.push(jobId);
      jobsNew += 1;
    } else {
      repos.jobs.recordSighting(jobId, job, email.receivedAt);
      jobsSeenAgain += 1;
    }
    repos.sightings.insert(jobId, gmailMessageId, parsed.savedSearch);
  }
  repos.runs.addCounts(runId, { emailsSeen: 1, emailsNew: 1, jobsNew, jobsSeenAgain });

  return { gmailMessageId, outcome: 'new', jobsFound: parsed.jobs.length };
}

// A job from an alert email, keyed by its LinkedIn job ID (DEC-037). Emails carry no date, salary or description.
function linkedInJob(job: ParsedJob): NewJob {
  const { linkedinJobId, ...details } = job;
  return {
    ...details,
    source: 'linkedin',
    sourceJobId: linkedinJobId,
    postedAt: null,
    salary: null,
    description: null,
  };
}

// Timestamps are compared as text (first/last seen), so every one is stored in the same ISO-8601 UTC form.
function toIsoTimestamp(email: IncomingEmail): string {
  const time = Date.parse(email.receivedAt);
  if (Number.isNaN(time)) {
    throw new InvalidEmailError(`email ${email.gmailMessageId} has an invalid receivedAt: ${email.receivedAt}`);
  }
  return new Date(time).toISOString();
}
