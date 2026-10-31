import type { DatabaseSync } from 'node:sqlite';
import type { Repositories } from '../db/repositories/index.ts';
import { setupStatus, type SetupStatus } from '../domain/setup.ts';
import type { FindNow } from '../find-now/claude-runner.ts';
import { linkedInSearchesStatus, sourcesStatus } from '../setup/config-files.ts';

// What every API handler gets: the database, its repositories, a clock, the app version, where the saved
// LinkedIn login lives (DEC-032), the two files setup checks for (FR-24) and the board's Find Now runner (FR-22).
export interface AppContext {
  db: DatabaseSync;
  repos: Repositories;
  now: () => string;
  version: string;
  linkedinSessionPath: string;
  linkedinSearchesPath: string;
  sourcesPath: string;
  findNow: FindNow;
}

/** Whether the board is set up (FR-24), read fresh on every call so a file the user just created counts at once. */
export function readSetup(context: AppContext): SetupStatus {
  return setupStatus({
    profile: context.repos.profile.state().status,
    linkedinSearches: linkedInSearchesStatus(context.linkedinSearchesPath),
    sources: sourcesStatus(context.sourcesPath),
  });
}
