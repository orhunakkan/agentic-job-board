import type { DatabaseSync } from 'node:sqlite';
import type { Repositories } from '../db/repositories/index.ts';
import type { FindNow } from '../find-now/claude-runner.ts';

// What every API handler gets: the database, its repositories, a clock, the app version, where the saved
// LinkedIn login lives (DEC-032) and the board's Find Now runner (FR-22).
export interface AppContext {
  db: DatabaseSync;
  repos: Repositories;
  now: () => string;
  version: string;
  linkedinSessionPath: string;
  findNow: FindNow;
}
