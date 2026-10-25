import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/database.ts';
import type { Repositories } from '../db/repositories/index.ts';
import type { JobRecord } from '../db/repositories/jobs.ts';
import type { JobSource } from '../domain/job-source.ts';
import { canTransition, type Status } from '../domain/status.ts';

// Moves a job to a new status if §5.4 allows it, and records the change in its history (FR-08); Clear All moves a
// whole view's New jobs at once (FR-21).

export class JobNotFoundError extends Error {
  override name = 'JobNotFoundError';

  constructor(jobId: number) {
    super(`job ${String(jobId)} does not exist`);
  }
}

export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';
  readonly from: Status;
  readonly to: Status;

  constructor(from: Status, to: Status) {
    super(`a job can't move from ${from} to ${to}`);
    this.from = from;
    this.to = to;
  }
}

export function changeJobStatus(
  db: DatabaseSync,
  repos: Repositories,
  jobId: number,
  to: Status,
  now: () => string = () => new Date().toISOString(),
): JobRecord {
  return transaction(db, () => {
    const job = repos.jobs.get(jobId);
    if (job === null) throw new JobNotFoundError(jobId);
    if (!canTransition(job.status, to)) throw new InvalidTransitionError(job.status, to);

    const changedAt = now();
    repos.jobs.updateStatus(jobId, to, changedAt);
    repos.statusHistory.insert(jobId, { fromStatus: job.status, toStatus: to, changedAt });
    return { ...job, status: to, statusChangedAt: changedAt };
  });
}

/**
 * Clear All (FR-21, DEC-051): dismisses every job in New from `sources`, one view of the board, with a history row
 * each, as if the owner had pressed Dismiss on every card. Returns how many it dismissed.
 */
export function dismissNewJobs(
  db: DatabaseSync,
  repos: Repositories,
  sources: readonly JobSource[],
  now: () => string = () => new Date().toISOString(),
): number {
  return transaction(db, () => {
    const changedAt = now();
    const ids = repos.jobs.idsWithStatus(sources, 'new');
    for (const id of ids) {
      repos.jobs.updateStatus(id, 'dismissed', changedAt);
      repos.statusHistory.insert(id, { fromStatus: 'new', toStatus: 'dismissed', changedAt });
    }
    return ids.length;
  });
}
