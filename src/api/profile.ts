import { HttpError, ok, parseInput } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import { ProfileSchema } from '../schemas/profile.ts';
import type { AppContext } from './context.ts';

// GET and PUT /api/profile: the profile every score is based on (FR-01). The board's own form is POST /profile.
export function profileRoutes(context: AppContext): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/profile',
      handler: () => {
        const state = context.repos.profile.state();
        if (state.status === 'missing') {
          throw new HttpError(
            404,
            'not_found',
            'No profile yet: fill it in on /setup, or send it with PUT /api/profile',
          );
        }
        if (state.status === 'outdated') {
          throw new HttpError(
            404,
            'not_found',
            'The saved profile is from an older version of the board: fill it in again on /setup, or PUT /api/profile',
          );
        }
        return ok(state.profile);
      },
    },
    {
      method: 'PUT',
      path: '/api/profile',
      handler: (request) => {
        const profile = parseInput(ProfileSchema, request.body, 'profile');
        context.repos.profile.put(profile, context.now());
        return ok(profile);
      },
    },
  ];
}
