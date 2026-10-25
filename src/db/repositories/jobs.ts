import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { BoardSort } from '../../domain/board-tabs.ts';
import { JOB_SOURCES, type JobSource } from '../../domain/job-source.ts';
import { SCORE_LABELS, type ScoreLabel } from '../../domain/score.ts';
import { STATUSES, type Status } from '../../domain/status.ts';
import { WORKPLACES, type Workplace } from '../../domain/workplace.ts';
import { SqlBoolean, toId, toSqlBoolean } from './columns.ts';

// One row per job ID within its source (FR-04, FR-16, DEC-037). Repeat sightings update the counters, never add
// a row.

/** A job as an email, a feed or a LinkedIn search shows it: everything from the source, nothing the owner sets. */
export interface NewJob {
  source: JobSource;
  sourceJobId: string;
  title: string;
  company: string;
  location: string; // '' when the source gives none
  url: string;
  activelyHiring: boolean;
  easyApply: boolean;
  postedAt: string | null;
  salary: string | null;
  description: string | null;
  workplace: Workplace | null;
}

/** A stored job. The description is left out because lists don't need it; `descriptionOf` reads it. */
export interface JobRecord {
  id: number;
  source: JobSource;
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  activelyHiring: boolean;
  easyApply: boolean;
  postedAt: string | null;
  salary: string | null;
  workplace: Workplace | null;
  status: Status;
  statusChangedAt: string;
  notes: string;
  score: number | null;
  scoreLabel: ScoreLabel | null;
  scoreReason: string | null;
  rubricVersion: string | null;
  scoredAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  firstRunId: number | null;
}

export interface JobScore {
  score: number;
  label: ScoreLabel;
  reason: string;
  rubricVersion: string;
  scoredAt: string;
}

/** A job waiting in the scoring queue, with the description the rubric reads. */
export interface QueuedJob extends JobRecord {
  description: string | null;
}

export interface JobFilter {
  sources: readonly JobSource[] | null; // null = every source
  statuses: readonly Status[] | null; // null = every status
  minScore: number | null; // excludes unscored jobs
  text: string | null; // case-insensitive substring of title or company
  unscoredOnly: boolean;
  sort: BoardSort;
  limit: number;
  offset: number;
}

export interface JobsRepository {
  /**
   * Inserts a job first seen at `seenAt` (the email's time, or when a feed listed it) in run `runId`, with status
   * `new` set at `createdAt`.
   */
  insert(job: NewJob, at: { runId: number | null; seenAt: string; createdAt: string }): number;
  findId(source: JobSource, sourceJobId: string): number | null;
  get(id: number): JobRecord | null;
  /** The job's description as plain text, or null when its source gives none (or the job doesn't exist). */
  descriptionOf(id: number): string | null;
  /**
   * Counts one more sighting of `job` at `seenAt`. Emails can arrive out of order, so first/last seen widen to
   * include `seenAt`, and the details from the source are taken from the sighting only when it is newer than every
   * earlier one (DEC-023); a newer sighting without a posted date, salary or description keeps the stored one.
   * Status, notes and score are never touched.
   */
  recordSighting(id: number, job: NewJob, seenAt: string): void;
  updateStatus(id: number, status: Status, changedAt: string): void;
  updateNotes(id: number, notes: string): void;
  setScore(id: number, score: JobScore): void;
  /** The IDs of every job from `sources` with `status`, oldest first (Clear All, FR-21). */
  idsWithStatus(sources: readonly JobSource[], status: Status): number[];
  /** The subset of `ids` that exist. */
  existingIds(ids: readonly number[]): Set<number>;
  /** The subset of `sourceJobIds` the board has from `source`. */
  knownSourceJobIds(source: JobSource, sourceJobIds: readonly string[]): Set<string>;
  /**
   * The jobs /find-jobs still has to score (FR-20, DEC-043, DEC-044): every unscored job, then every job in
   * `rescoreStatuses` that has a description but was scored with another rubric than `rubric`. Newest first.
   */
  scoringQueue(rubric: string, rescoreStatuses: readonly Status[], limit: number): { jobs: QueuedJob[]; total: number };
  list(filter: JobFilter): JobRecord[];
  count(filter: Omit<JobFilter, 'sort' | 'limit' | 'offset'>): number;
  /** The jobs first ingested in a run, best score first (FR-13). */
  topNewForRun(runId: number, limit: number): JobRecord[];
}

const Row = z.object({
  id: z.number().int(),
  source: z.enum(JOB_SOURCES),
  sourceJobId: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string(),
  activelyHiring: SqlBoolean,
  easyApply: SqlBoolean,
  postedAt: z.string().nullable(),
  salary: z.string().nullable(),
  workplace: z.enum(WORKPLACES).nullable(),
  status: z.enum(STATUSES),
  statusChangedAt: z.string(),
  notes: z.string(),
  score: z.number().int().nullable(),
  scoreLabel: z.enum(SCORE_LABELS).nullable(),
  scoreReason: z.string().nullable(),
  rubricVersion: z.string().nullable(),
  scoredAt: z.string().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  seenCount: z.number().int().positive(),
  firstRunId: z.number().int().nullable(),
});

const QueuedRow = Row.extend({ description: z.string().nullable() });
const IdRow = z.object({ id: z.number().int() });
const CountRow = z.object({ n: z.number().int() });
const DescriptionRow = z.object({ description: z.string().nullable() });
const SourceJobIdRow = z.object({ sourceJobId: z.string() });

const COLUMNS = `id, source, source_job_id AS sourceJobId, title, company, location, url,
  actively_hiring AS activelyHiring, easy_apply AS easyApply, posted_at AS postedAt, salary, workplace,
  status, status_changed_at AS statusChangedAt, notes, score, score_label AS scoreLabel, score_reason AS scoreReason,
  rubric_version AS rubricVersion, scored_at AS scoredAt, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt,
  seen_count AS seenCount, first_run_id AS firstRunId`;

// One fixed WHERE clause for every filter: an unused filter is bound as NULL (or 0) and matches everything,
// so no SQL is ever built from strings. ?1 statuses (JSON array), ?2 min score, ?3 LIKE pattern, ?4 unscored only,
// ?5 sources (JSON array).
const FILTER = `(?1 IS NULL OR status IN (SELECT value FROM json_each(?1)))
  AND (?2 IS NULL OR score >= ?2)
  AND (?3 IS NULL OR title LIKE ?3 ESCAPE '\\' OR company LIKE ?3 ESCAPE '\\')
  AND (?4 = 0 OR score IS NULL)
  AND (?5 IS NULL OR source IN (SELECT value FROM json_each(?5)))`;

function filterParams(filter: Omit<JobFilter, 'sort' | 'limit' | 'offset'>) {
  return [
    filter.statuses === null ? null : JSON.stringify(filter.statuses),
    filter.minScore,
    filter.text === null ? null : `%${filter.text.replace(/[\\%_]/g, '\\$&')}%`,
    toSqlBoolean(filter.unscoredOnly),
    filter.sources === null ? null : JSON.stringify(filter.sources),
  ] as const;
}

export function createJobsRepository(db: DatabaseSync): JobsRepository {
  const insertStatement = db.prepare(
    `INSERT INTO jobs (source, source_job_id, title, company, location, url, actively_hiring, easy_apply,
                       posted_at, salary, description, workplace, status, status_changed_at, first_seen_at,
                       last_seen_at, first_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
  );
  const findStatement = db.prepare('SELECT id FROM jobs WHERE source = ? AND source_job_id = ?');
  const selectStatement = db.prepare(`SELECT ${COLUMNS} FROM jobs WHERE id = ?`);
  const descriptionStatement = db.prepare('SELECT description FROM jobs WHERE id = ?');
  const sightingStatement = db.prepare(
    // Every right-hand side reads the row as it was before this UPDATE, so `?1 > last_seen_at` is the old value.
    `UPDATE jobs SET
       title           = CASE WHEN ?1 > last_seen_at THEN ?2 ELSE title END,
       company         = CASE WHEN ?1 > last_seen_at THEN ?3 ELSE company END,
       location        = CASE WHEN ?1 > last_seen_at THEN ?4 ELSE location END,
       actively_hiring = CASE WHEN ?1 > last_seen_at THEN ?5 ELSE actively_hiring END,
       easy_apply      = CASE WHEN ?1 > last_seen_at THEN ?6 ELSE easy_apply END,
       url             = CASE WHEN ?1 > last_seen_at THEN ?8 ELSE url END,
       posted_at       = CASE WHEN ?1 > last_seen_at THEN coalesce(?9, posted_at) ELSE posted_at END,
       salary          = CASE WHEN ?1 > last_seen_at THEN coalesce(?10, salary) ELSE salary END,
       description     = CASE WHEN ?1 > last_seen_at THEN coalesce(?11, description) ELSE description END,
       workplace       = CASE WHEN ?1 > last_seen_at THEN coalesce(?12, workplace) ELSE workplace END,
       seen_count      = seen_count + 1,
       first_seen_at   = min(first_seen_at, ?1),
       last_seen_at    = max(last_seen_at, ?1)
     WHERE id = ?7`,
  );
  const statusStatement = db.prepare('UPDATE jobs SET status = ?, status_changed_at = ? WHERE id = ?');
  const notesStatement = db.prepare('UPDATE jobs SET notes = ? WHERE id = ?');
  const scoreStatement = db.prepare(
    `UPDATE jobs SET score = ?, score_label = ?, score_reason = ?, rubric_version = ?, scored_at = ? WHERE id = ?`,
  );
  const idsWithStatusStatement = db.prepare(
    'SELECT id FROM jobs WHERE status = ? AND source IN (SELECT value FROM json_each(?)) ORDER BY id',
  );
  const existingStatement = db.prepare('SELECT id FROM jobs WHERE id IN (SELECT value FROM json_each(?))');
  const knownStatement = db.prepare(
    'SELECT source_job_id AS sourceJobId FROM jobs WHERE source = ? AND source_job_id IN (SELECT value FROM json_each(?))',
  );
  // ?1 the rubric that reads descriptions, ?2 the statuses whose jobs are scored again with it (JSON array).
  const QUEUE = `score IS NULL OR (description IS NOT NULL AND coalesce(rubric_version, '') <> ?1
    AND status IN (SELECT value FROM json_each(?2)))`;
  const queueStatement = db.prepare(
    `SELECT ${COLUMNS}, description FROM jobs WHERE ${QUEUE}
     ORDER BY score IS NOT NULL, first_seen_at DESC, id DESC LIMIT ?3`,
  );
  const queueCountStatement = db.prepare(`SELECT count(*) AS n FROM jobs WHERE ${QUEUE}`);
  const listStatement = db.prepare(
    `SELECT ${COLUMNS} FROM jobs WHERE ${FILTER}
     ORDER BY CASE WHEN ?6 = 'score' THEN score END DESC NULLS LAST,
              CASE WHEN ?6 = 'changed' THEN status_changed_at END DESC,
              first_seen_at DESC, id DESC
     LIMIT ?7 OFFSET ?8`,
  );
  const countStatement = db.prepare(`SELECT count(*) AS n FROM jobs WHERE ${FILTER}`);
  const topNewStatement = db.prepare(
    `SELECT ${COLUMNS} FROM jobs WHERE first_run_id = ?
     ORDER BY score DESC NULLS LAST, first_seen_at DESC, id DESC LIMIT ?`,
  );

  return {
    insert(job, at) {
      const result = insertStatement.run(
        job.source,
        job.sourceJobId,
        job.title,
        job.company,
        job.location,
        job.url,
        toSqlBoolean(job.activelyHiring),
        toSqlBoolean(job.easyApply),
        job.postedAt,
        job.salary,
        job.description,
        job.workplace,
        at.createdAt,
        at.seenAt,
        at.seenAt,
        at.runId,
      );
      return toId(result.lastInsertRowid);
    },
    findId(source, sourceJobId) {
      const row = findStatement.get(source, sourceJobId);
      return row === undefined ? null : IdRow.parse(row).id;
    },
    get(id) {
      const row = selectStatement.get(id);
      return row === undefined ? null : Row.parse(row);
    },
    descriptionOf(id) {
      const row = descriptionStatement.get(id);
      return row === undefined ? null : DescriptionRow.parse(row).description;
    },
    recordSighting(id, job, seenAt) {
      sightingStatement.run(
        seenAt,
        job.title,
        job.company,
        job.location,
        toSqlBoolean(job.activelyHiring),
        toSqlBoolean(job.easyApply),
        id,
        job.url,
        job.postedAt,
        job.salary,
        job.description,
        job.workplace,
      );
    },
    updateStatus(id, status, changedAt) {
      statusStatement.run(status, changedAt, id);
    },
    updateNotes(id, notes) {
      notesStatement.run(notes, id);
    },
    setScore(id, score) {
      scoreStatement.run(score.score, score.label, score.reason, score.rubricVersion, score.scoredAt, id);
    },
    idsWithStatus(sources, status) {
      return idsWithStatusStatement.all(status, JSON.stringify(sources)).map((row) => IdRow.parse(row).id);
    },
    existingIds(ids) {
      return new Set(existingStatement.all(JSON.stringify(ids)).map((row) => IdRow.parse(row).id));
    },
    knownSourceJobIds(source, sourceJobIds) {
      const rows = knownStatement.all(source, JSON.stringify(sourceJobIds));
      return new Set(rows.map((row) => SourceJobIdRow.parse(row).sourceJobId));
    },
    scoringQueue(rubric, rescoreStatuses, limit) {
      const statuses = JSON.stringify(rescoreStatuses);
      const jobs = queueStatement.all(rubric, statuses, limit).map((row) => QueuedRow.parse(row));
      return { jobs, total: CountRow.parse(queueCountStatement.get(rubric, statuses)).n };
    },
    list(filter) {
      return listStatement
        .all(...filterParams(filter), filter.sort, filter.limit, filter.offset)
        .map((row) => Row.parse(row));
    },
    count(filter) {
      return CountRow.parse(countStatement.get(...filterParams(filter))).n;
    },
    topNewForRun(runId, limit) {
      return topNewStatement.all(runId, limit).map((row) => Row.parse(row));
    },
  };
}
