import { MATCH_RUBRIC, RESCORE_STATUSES, rubricFor } from '../domain/score.ts';
import { ok, parseInput, queryObject } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import { ScoringQueueQuerySchema } from '../schemas/api.ts';
import type { AppContext } from './context.ts';

// The jobs /find-jobs still has to score, with their descriptions (FR-20, DEC-043, DEC-044). The agent reads a few
// at a time and posts their scores before it reads the next, so the queue empties as it goes.
export function scoringRoutes(context: AppContext): Route[] {
  const { repos } = context;

  return [
    {
      method: 'GET',
      path: '/api/scoring/queue',
      handler: (request) => {
        const { limit } = parseInput(ScoringQueueQuerySchema, queryObject(request.query), 'query string');
        const { jobs, total } = repos.jobs.scoringQueue(MATCH_RUBRIC, RESCORE_STATUSES, limit);
        const items = jobs.map((job) => ({
          id: job.id,
          source: job.source,
          title: job.title,
          company: job.company,
          location: job.location,
          workplace: job.workplace,
          salary: job.salary,
          postedAt: job.postedAt,
          description: job.description,
          rubric: rubricFor(job.description),
          currentRubric: job.score === null ? null : job.rubricVersion,
        }));
        return ok({ items, total });
      },
    },
  ];
}
