import type { DataTable } from '@cucumber/cucumber';
import { z } from 'zod';
import { JOB_SOURCES, SOURCE_LABELS, type JobSource } from '../../../src/domain/job-source.ts';
import { nextStatuses, type Status } from '../../../src/domain/status.ts';
import type { IncomingListing } from '../../../src/ingest/listing-ingest.ts';
import { statusNamed } from './parameter-types.ts';

// The jobs a scenario puts on the board, in the board's own words: a title, a company, a source (LinkedIn by
// default), a score and a status. Turned into the listings scripts/search-linkedin.ts and scripts/fetch-sources.ts
// send (PLAN.md Phase 10 and 11); all of them made up.

export interface JobRow {
  title: string;
  company: string;
  source: JobSource;
  score: number | null;
  status: Status;
  description: string | null;
  searchName: string | null;
}

const SOURCE_BY_LABEL = new Map(JOB_SOURCES.map((source) => [SOURCE_LABELS[source], source]));

/** A source by the name the board shows ("LinkedIn", "Greenhouse"); "Other sources" means a feed, Greenhouse. */
export function sourceNamed(name: string): JobSource {
  if (name === 'Other sources') return 'greenhouse';
  const source = SOURCE_BY_LABEL.get(name);
  if (source === undefined) throw new Error(`no job source is called "${name}"`);
  return source;
}

// An empty cell in a table is a value left out.
const cell = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const JobRowSchema = z
  .object({
    title: z.string().min(1),
    company: cell,
    // "view" names the board's view (LinkedIn or Other sources), "source" one feed (Greenhouse, Lever, …).
    view: cell,
    source: cell,
    score: cell.pipe(z.union([z.undefined(), z.string().regex(/^\d+$/).transform(Number).pipe(z.int().max(100))])),
    status: cell,
    description: cell,
    search: cell,
  })
  .strict();

export function jobRow(fields: Partial<JobRow> & { title: string }): JobRow {
  return {
    company: 'Example Co',
    source: 'linkedin',
    score: null,
    status: 'new',
    description: null,
    searchName: null,
    ...fields,
  };
}

/** The rows of a table with a `title` column and any of company, view, source, score, status, description. */
export function jobRows(table: DataTable): JobRow[] {
  return table.hashes().map((hash) => {
    const row = JobRowSchema.parse(hash);
    return jobRow({
      title: row.title,
      company: row.company ?? `${row.title} Co`,
      source: sourceNamed(row.source ?? row.view ?? 'LinkedIn'),
      score: row.score ?? null,
      status: statusNamed(row.status ?? 'New'),
      description: row.description ?? null,
      searchName: row.search ?? null,
    });
  });
}

/** The listing a script would send for the job; `n` makes its job ID unique within the scenario. */
export function listingFor(row: JobRow, n: number): IncomingListing {
  if (row.source === 'linkedin') {
    const id = String(4480000000 + n);
    return {
      source: 'linkedin',
      sourceJobId: id,
      title: row.title,
      company: row.company,
      location: 'United States (Remote)',
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      postedAt: null,
      salary: null,
      description: row.description,
      workplace: 'remote',
      easyApply: false,
      searchName: row.searchName ?? 'QA family',
    };
  }
  const id = `555${String(n).padStart(4, '0')}`;
  return {
    source: row.source,
    sourceJobId: id,
    title: row.title,
    company: row.company,
    location: 'Remote, United States',
    url: `https://jobs.example.com/${row.source}/${id}`,
    postedAt: null,
    salary: null,
    description: row.description,
  };
}

/** The status changes that take a New job to `to` by the shortest way §5.4 allows, e.g. Rejected: Applied, Rejected. */
export function pathFromNew(to: Status): Status[] {
  const paths = new Map<Status, Status[]>([['new', []]]);
  const queue: Status[] = ['new'];
  for (const from of queue) {
    for (const next of nextStatuses(from)) {
      if (paths.has(next)) continue;
      paths.set(next, [...(paths.get(from) ?? []), next]);
      queue.push(next);
    }
  }
  const path = paths.get(to);
  if (path === undefined) throw new Error(`no job can reach ${to} from New`);
  return path;
}
