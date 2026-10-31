import { ok } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import { readSetup, type AppContext } from './context.ts';

// GET /api/setup (FR-24, DEC-066): whether the profile is saved and each source's file is there and valid. Only the
// statuses, never the files' contents. /find-jobs reads it first and stops when the board isn't set up.
export function setupRoutes(context: AppContext): Route[] {
  return [{ method: 'GET', path: '/api/setup', handler: () => ok(readSetup(context)) }];
}
