import { transaction } from '../db/database.ts';
import type { RunRecord } from '../db/repositories/runs.ts';
import { HttpError, ok, parseInput, queryObject } from '../http/respond.ts';
import type { ApiRequest, Route } from '../http/router.ts';
import { ingestListings } from '../ingest/listing-ingest.ts';
import { RunFinishedError, RunNotFoundError } from '../ingest/run-errors.ts';
import {
  EmptyRequestSchema,
  IdParamSchema,
  IngestListingsRequestSchema,
  RunListQuerySchema,
  ScoresRequestSchema,
} from '../schemas/api.ts';
import { readSetup, type AppContext } from './context.ts';
import { toJobSummary, toRunSummary } from './views.ts';

// The /find-jobs run lifecycle (PLAN.md §4.1; FR-06, FR-11, FR-15, FR-18): where LinkedIn searches resume, start a
// run, send listings, store scores, finish, and list past runs. Alert emails are no longer taken (DEC-041).
export function runRoutes(context: AppContext): Route[] {
  const { db, repos } = context;

  function openRun(request: ApiRequest): RunRecord {
    const runId = parseInput(IdParamSchema, request.params['id'], 'run ID');
    const run = repos.runs.get(runId);
    if (run === null) throw new RunNotFoundError(runId);
    if (run.finishedAt !== null) throw new RunFinishedError(runId);
    return run;
  }

  function summaries(jobIds: readonly number[]) {
    return jobIds.flatMap((id) => {
      const job = repos.jobs.get(id);
      return job === null ? [] : [toJobSummary(job)];
    });
  }

  return [
    {
      method: 'GET',
      path: '/api/ingest/state',
      handler: () => ok({ lastLinkedInSearchAt: repos.listingSightings.latestSearchAt() }),
    },
    {
      method: 'POST',
      path: '/api/runs',
      handler: (request) => {
        parseInput(EmptyRequestSchema, request.body);
        // Setup comes first (FR-24): this stops /find-jobs and Find Now in the app itself, not only in the procedure.
        const { ready, ...setup } = readSetup(context);
        if (!ready) {
          throw new HttpError(
            409,
            'setup_required',
            'The board is not set up yet: save your profile and add LinkedIn searches or the feeds file (see /setup)',
            setup,
          );
        }
        return ok({ runId: repos.runs.create(context.now()) }, 201);
      },
    },
    {
      method: 'POST',
      path: '/api/runs/:id/listings',
      handler: (request) => {
        const run = openRun(request);
        const { listings } = parseInput(IngestListingsRequestSchema, request.body);
        const { newJobIds, ...counts } = ingestListings(db, repos, run.id, listings, context.now);
        return ok({ ...counts, newJobs: summaries(newJobIds) });
      },
    },
    {
      method: 'POST',
      path: '/api/runs/:id/scores',
      handler: (request) => {
        const run = openRun(request);
        const { rubricVersion, scores } = parseInput(ScoresRequestSchema, request.body);

        // All or nothing: one unknown job ID and no score is stored.
        return transaction(db, () => {
          const ids = scores.map((entry) => entry.jobId);
          const known = repos.jobs.existingIds(ids);
          const missing = ids.filter((id) => !known.has(id));
          if (missing.length > 0) {
            throw new HttpError(400, 'unknown_jobs', 'Some jobs do not exist, so no score was stored', {
              jobIds: missing,
            });
          }

          const scoredAt = context.now();
          for (const entry of scores) {
            repos.jobs.setScore(entry.jobId, { ...entry, rubricVersion, scoredAt });
          }
          repos.runs.addCounts(run.id, { jobsScored: scores.length });
          return ok({ stored: scores.length });
        });
      },
    },
    {
      method: 'POST',
      path: '/api/runs/:id/finish',
      handler: (request) => {
        const run = openRun(request);
        parseInput(EmptyRequestSchema, request.body);
        repos.runs.finish(run.id, context.now());
        const finished = repos.runs.get(run.id) ?? run;
        return ok(toRunSummary(finished, repos));
      },
    },
    {
      method: 'GET',
      path: '/api/runs',
      handler: (request) => {
        const { limit } = parseInput(RunListQuerySchema, queryObject(request.query), 'query string');
        return ok(repos.runs.list(limit).map((run) => toRunSummary(run, repos)));
      },
    },
  ];
}
