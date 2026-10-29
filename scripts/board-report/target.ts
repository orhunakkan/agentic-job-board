// Where a reporter writes its results (PLAN.md Phase 14 task 3). scripts/board-report.ts sets both variables for
// every step it runs; when they are missing, as when vitest or playwright is run directly, reporters write nothing.
import { resolve } from 'node:path';
import { Step } from './result-schema.ts';

export const RESULTS_ENV = 'BOARD_REPORT_RESULTS';
export const STEP_ENV = 'BOARD_REPORT_STEP';

export interface ResultsTarget {
  dir: string;
  step: Step;
}

export class ResultsTargetError extends Error {
  override name = 'ResultsTargetError';
}

export function resultsTarget(env: Readonly<Record<string, string | undefined>>): ResultsTarget | null {
  const dir = env[RESULTS_ENV];
  if (dir === undefined || dir === '') return null;
  const step = Step.safeParse(env[STEP_ENV]);
  if (!step.success)
    throw new ResultsTargetError(`${STEP_ENV} must name a board-report step, not "${String(env[STEP_ENV])}"`);
  return { dir: resolve(dir), step: step.data };
}

/** A path relative to the repository, with forward slashes. */
export function repoPath(path: string, root: string): string {
  const normalized = path.replaceAll('\\', '/');
  const base = `${root.replaceAll('\\', '/').replace(/\/$/, '')}/`;
  return normalized.toLowerCase().startsWith(base.toLowerCase()) ? normalized.slice(base.length) : normalized;
}
