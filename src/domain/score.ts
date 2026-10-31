import type { Status } from './status.ts';

// Triage score bands (PLAN.md FR-06): strong ≥ 75, possible 50–74, weak < 50.

export const SCORE_LABELS = ['strong', 'possible', 'weak'] as const;

export type ScoreLabel = (typeof SCORE_LABELS)[number];

const STRONG_MIN = 75;
const POSSIBLE_MIN = 50;

export class InvalidScoreError extends Error {
  override name = 'InvalidScoreError';

  constructor(score: number) {
    super(`A score must be a whole number from 0 to 100, got ${String(score)}`);
  }
}

export function isValidScore(score: number): boolean {
  return Number.isInteger(score) && score >= 0 && score <= 100;
}

export function labelForScore(score: number): ScoreLabel {
  if (!isValidScore(score)) throw new InvalidScoreError(score);
  if (score >= STRONG_MIN) return 'strong';
  if (score >= POSSIBLE_MIN) return 'possible';
  return 'weak';
}

export function isLabelConsistent(score: number, label: ScoreLabel): boolean {
  return isValidScore(score) && labelForScore(score) === label;
}

// Rubrics (agent/scoring-rubric.md, FR-20, DEC-043, DEC-067): a job with a description is scored on it with
// match-v2; a job without one only on its title, company and location with triage-v2. Both judge a job only against
// the user's own profile, for any line of work. A v1 score in an older database still shows, by its name.

export const TRIAGE_RUBRIC = 'triage-v2';
export const MATCH_RUBRIC = 'match-v2';
export const RUBRICS = [MATCH_RUBRIC, TRIAGE_RUBRIC] as const;

export type Rubric = (typeof RUBRICS)[number];

/**
 * A job in one of these statuses that has a description but was scored without it (for example before --backfill
 * added it) is scored again with match-v2 (DEC-044). Jobs the owner has moved on from keep their score.
 */
export const RESCORE_STATUSES: readonly Status[] = ['new', 'saved'];

export function rubricFor(description: string | null): Rubric {
  return description === null ? TRIAGE_RUBRIC : MATCH_RUBRIC;
}
