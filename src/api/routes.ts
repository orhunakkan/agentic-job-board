import type { Route } from '../http/router.ts';
import type { AppContext } from './context.ts';
import { healthRoutes } from './health.ts';
import { jobRoutes } from './jobs.ts';
import { linkedinRoutes } from './linkedin.ts';
import { listingRoutes } from './listings.ts';
import { profileRoutes } from './profile.ts';
import { runRoutes } from './runs.ts';
import { scoringRoutes } from './scoring.ts';

// Every JSON API route of PLAN.md §6.1.
export function apiRoutes(context: AppContext): Route[] {
  return [
    ...healthRoutes(context),
    ...profileRoutes(context),
    ...runRoutes(context),
    ...jobRoutes(context),
    ...listingRoutes(context),
    ...scoringRoutes(context),
    ...linkedinRoutes(context),
  ];
}
