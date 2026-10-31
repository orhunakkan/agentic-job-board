import { z } from 'zod';
import { TABS } from '../domain/board-tabs.ts';
import { JOB_SOURCES, ORIGINS } from '../domain/job-source.ts';
import { canonicalJobUrl } from '../domain/linkedin-url.ts';
import { isLabelConsistent, RUBRICS, SCORE_LABELS } from '../domain/score.ts';
import { FILE_STATUSES, PROFILE_STATUSES } from '../domain/setup.ts';
import { STATUSES } from '../domain/status.ts';
import { WORKPLACES } from '../domain/workplace.ts';
import { LINKEDIN_SESSION_STATES } from '../linkedin/session.ts';

// Every JSON API request and response shape (PLAN.md §6.1). Requests are parsed with these schemas in the
// handlers (NFR-09); the contract tests check every response against them.

const IsoTimestamp = z.iso.datetime({ offset: true });
const Count = z.number().int().nonnegative();
const Id = z.number().int().positive();

/** A whole number in a query string or path, e.g. "?limit=20" or "/api/jobs/7". */
export function intString(min: number, max: number) {
  return z
    .string()
    .regex(/^\d{1,16}$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

export const IdParamSchema = intString(1, Number.MAX_SAFE_INTEGER);

// --- Shared --------------------------------------------------------------------------------------------------

export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({ code: z.string().min(1), message: z.string().min(1), details: z.unknown().optional() }),
});

export const EmptyRequestSchema = z.strictObject({});

/** An absolute https link without a user name or password: the only kind of link a job may have (NFR-07). */
export const HttpsUrl = z
  .url({ protocol: /^https$/, hostname: z.regexes.domain })
  .max(2000)
  .refine((url) => {
    // z.url lets a scheme-relative "//host/path" through; URL.parse rejects it, as it has no base.
    const parsed = URL.parse(url);
    return parsed?.protocol === 'https:' && parsed.username === '' && parsed.password === '';
  }, 'must be an absolute https link without a user name or password');

const JobSummaryFields = z.strictObject({
  id: Id,
  source: z.enum(JOB_SOURCES),
  sourceJobId: z.string().min(1),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: HttpsUrl,
  activelyHiring: z.boolean(),
  easyApply: z.boolean(),
  postedAt: IsoTimestamp.nullable(),
  salary: z.string().nullable(),
  workplace: z.enum(WORKPLACES).nullable(),
  status: z.enum(STATUSES),
  statusChangedAt: IsoTimestamp,
  score: z.number().int().min(0).max(100).nullable(),
  scoreLabel: z.enum(SCORE_LABELS).nullable(),
  scoreReason: z.string().nullable(),
  firstSeenAt: IsoTimestamp,
  lastSeenAt: IsoTimestamp,
  seenCount: z.number().int().positive(),
});

// A LinkedIn job links exactly to the canonical form of PLAN.md §5.3: no query string, so no tracking token can
// ever be served.
const LINKEDIN_CANONICAL = {
  check: (job: { source: string; sourceJobId: string; url: string }) =>
    job.source !== 'linkedin' || (/^\d+$/.test(job.sourceJobId) && job.url === canonicalJobUrl(job.sourceJobId)),
  issue: { message: 'a LinkedIn job must link to its canonical URL', path: ['url'] },
};

export const JobSummarySchema = JobSummaryFields.refine(LINKEDIN_CANONICAL.check, LINKEDIN_CANONICAL.issue);

export const JobDetailSchema = JobSummaryFields.extend({
  notes: z.string(),
  description: z.string().nullable(),
  rubricVersion: z.string().nullable(),
  scoredAt: IsoTimestamp.nullable(),
  sightings: z.array(
    z.strictObject({ gmailMessageId: z.string(), savedSearch: z.string().nullable(), receivedAt: IsoTimestamp }),
  ),
  listingSightings: z.array(z.strictObject({ runId: Id, seenAt: IsoTimestamp, searchName: z.string().nullable() })),
  history: z.array(
    z.strictObject({ fromStatus: z.enum(STATUSES).nullable(), toStatus: z.enum(STATUSES), changedAt: IsoTimestamp }),
  ),
}).refine(LINKEDIN_CANONICAL.check, LINKEDIN_CANONICAL.issue);

export const RunSummarySchema = z.strictObject({
  id: Id,
  startedAt: IsoTimestamp,
  finishedAt: IsoTimestamp.nullable(),
  emailsSeen: Count,
  emailsNew: Count,
  emailsDuplicate: Count,
  emailsUnrecognized: Count,
  listingsSeen: Count,
  jobsNew: Count,
  jobsSeenAgain: Count,
  jobsScored: Count,
  topNewJobs: z.array(JobSummarySchema).max(5),
});

// --- GET /api/health ---------------------------------------------------------------------------------------------

export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  db: z.literal('ok'),
  version: z.string(),
});

// --- GET /api/linkedin/session -----------------------------------------------------------------------------------

export const LinkedInSessionResponseSchema = z.strictObject({
  status: z.enum(LINKEDIN_SESSION_STATES),
  savedAt: IsoTimestamp.nullable(),
  expiresAt: IsoTimestamp.nullable(),
});

// --- GET /api/ingest/state ---------------------------------------------------------------------------------------

/** When a run last stored a job a LinkedIn search found: where `postedWithin: since-last-run` starts (Phase 11). */
export const IngestStateResponseSchema = z.strictObject({ lastLinkedInSearchAt: IsoTimestamp.nullable() });

// --- GET /api/setup ---------------------------------------------------------------------------------------------

/** Whether the board is set up (FR-24, DEC-066): the profile, and whether each source's file is there and valid. */
export const SetupResponseSchema = z.strictObject({
  profile: z.enum(PROFILE_STATUSES),
  linkedinSearches: z.enum(FILE_STATUSES),
  sources: z.enum(FILE_STATUSES),
  ready: z.boolean(),
});

// --- POST /api/runs ----------------------------------------------------------------------------------------------

export const CreateRunResponseSchema = z.strictObject({ runId: Id });

// --- POST /api/runs/:id/listings ---------------------------------------------------------------------------------

/** At most this many listings per call; with full descriptions a batch stays well under the 1 MB body limit. */
export const MAX_LISTINGS_PER_CALL = 25;
/** Descriptions are cut to this many characters by the scripts before they are sent. */
export const DESCRIPTION_MAX = 10_000;

const OneLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\r\n]*$/, 'must be one line');

/**
 * One job as a feed or a LinkedIn search lists it; scripts/fetch-sources.ts and scripts/search-linkedin.ts check every
 * listing with this before sending it. A LinkedIn job links to its canonical URL, like every LinkedIn job (§5.3).
 */
export const IncomingListingSchema = z
  .strictObject({
    source: z.enum(JOB_SOURCES),
    sourceJobId: OneLine(200).min(1),
    title: OneLine(300).min(1),
    company: OneLine(200).min(1),
    location: OneLine(300),
    url: HttpsUrl,
    postedAt: IsoTimestamp.nullable(),
    salary: OneLine(200).min(1).nullable(),
    description: z.string().trim().min(1).max(DESCRIPTION_MAX).nullable(),
    // Only LinkedIn says these (FR-19); the feeds leave them out.
    workplace: z.enum(WORKPLACES).nullable().optional(),
    easyApply: z.boolean().optional(),
    /** The LinkedIn search that found the job, stored on its sighting. */
    searchName: OneLine(100).min(1).optional(),
  })
  .refine(LINKEDIN_CANONICAL.check, LINKEDIN_CANONICAL.issue);

export const IngestListingsRequestSchema = z.strictObject({
  listings: z.array(IncomingListingSchema).min(1).max(MAX_LISTINGS_PER_CALL),
});

export const IngestListingsResponseSchema = z.strictObject({
  received: Count,
  new: Count,
  seenAgain: Count,
  repeated: Count,
  newJobs: z.array(JobSummarySchema),
});

// --- POST /api/listings/known ------------------------------------------------------------------------------------

/** At most this many job IDs per call: four search pages. */
export const MAX_KNOWN_IDS_PER_CALL = 100;

export const KnownListingsRequestSchema = z.strictObject({
  source: z.enum(JOB_SOURCES),
  sourceJobIds: z.array(OneLine(200).min(1)).min(1).max(MAX_KNOWN_IDS_PER_CALL),
});

/** The IDs from the request that the board already has, in request order. */
export const KnownListingsResponseSchema = z.strictObject({ known: z.array(z.string()) });

// --- GET /api/scoring/queue --------------------------------------------------------------------------------------

export const ScoringQueueQuerySchema = z.strictObject({ limit: intString(1, 25).default(10) });

/** A job waiting for a score, with everything the rubric reads (FR-20, DEC-043). */
export const ScoringQueueItemSchema = z.strictObject({
  id: Id,
  source: z.enum(JOB_SOURCES),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  workplace: z.enum(WORKPLACES).nullable(),
  salary: z.string().nullable(),
  postedAt: IsoTimestamp.nullable(),
  description: z.string().nullable(),
  /** match-v2 when there is a description, triage-v2 when there isn't. */
  rubric: z.enum(RUBRICS),
  /** The score it has from another rubric, or null when it has none yet. */
  currentRubric: z.string().nullable(),
});

export const ScoringQueueResponseSchema = z.strictObject({ items: z.array(ScoringQueueItemSchema), total: Count });

// --- POST /api/runs/:id/scores -----------------------------------------------------------------------------------

export const ScoresRequestSchema = z
  .strictObject({
    rubricVersion: z.string().trim().min(1).max(50),
    scores: z
      .array(
        z
          .strictObject({
            jobId: Id,
            score: z.number().int().min(0).max(100),
            label: z.enum(SCORE_LABELS),
            reason: z.string().trim().min(1).max(200),
          })
          .refine((entry) => isLabelConsistent(entry.score, entry.label), {
            message: 'label does not match the score band (strong ≥ 75, possible 50–74, weak < 50)',
            path: ['label'],
          }),
      )
      .min(1)
      .max(50),
  })
  .refine((body) => new Set(body.scores.map((entry) => entry.jobId)).size === body.scores.length, {
    message: 'each job may be scored only once per request',
    path: ['scores'],
  });

export const ScoresResponseSchema = z.strictObject({ stored: Count });

// --- GET /api/runs -----------------------------------------------------------------------------------------------

export const RunListQuerySchema = z.strictObject({ limit: intString(1, 100).default(20) });

export const RunListResponseSchema = z.array(RunSummarySchema);

// --- GET /api/jobs -----------------------------------------------------------------------------------------------

export const JobListQuerySchema = z
  .strictObject({
    origin: z.enum(ORIGINS).optional(),
    tab: z.enum(TABS).optional(),
    minScore: intString(0, 100).optional(),
    q: z.string().trim().max(200).optional(),
    sort: z.enum(['score', 'recent']).optional(),
    unscored: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    limit: intString(1, 100).default(50),
    offset: intString(0, 1_000_000).default(0),
  })
  .refine((query) => !(query.unscored === true && query.minScore !== undefined), {
    message: 'minScore and unscored=true exclude each other',
    path: ['unscored'],
  });

export const JobListResponseSchema = z.strictObject({ items: z.array(JobSummarySchema), total: Count });

// --- PATCH /api/jobs/:id -----------------------------------------------------------------------------------------

export const PatchJobRequestSchema = z
  .strictObject({ status: z.enum(STATUSES).optional(), notes: z.string().max(5000).optional() })
  .refine((body) => body.status !== undefined || body.notes !== undefined, { message: 'send status, notes or both' });

export type JobSummary = z.infer<typeof JobSummarySchema>;
export type JobDetail = z.infer<typeof JobDetailSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
