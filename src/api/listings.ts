import { ok, parseInput } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import { KnownListingsRequestSchema } from '../schemas/api.ts';
import type { AppContext } from './context.ts';

// Which jobs the board already has (PLAN.md Phase 11 task 5, FR-19): scripts/search-linkedin.ts asks before it reads
// job pages, so it opens a page only for a job that is new to the board. Read-only.
export function listingRoutes(context: AppContext): Route[] {
  const { repos } = context;

  return [
    {
      method: 'POST',
      path: '/api/listings/known',
      handler: (request) => {
        const { source, sourceJobIds } = parseInput(KnownListingsRequestSchema, request.body);
        const known = repos.jobs.knownSourceJobIds(source, sourceJobIds);
        return ok({ known: [...new Set(sourceJobIds)].filter((id) => known.has(id)) });
      },
    },
  ];
}
