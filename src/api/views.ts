import type { Repositories } from '../db/repositories/index.ts';
import type { JobRecord } from '../db/repositories/jobs.ts';
import type { RunRecord } from '../db/repositories/runs.ts';
import type { JobDetail, JobSummary, RunSummary } from '../schemas/api.ts';

// Database records → API response shapes (src/schemas/api.ts). Fields are listed one by one so a new
// column never leaks into the API by accident.

export function toJobSummary(job: JobRecord): JobSummary {
  return {
    id: job.id,
    source: job.source,
    sourceJobId: job.sourceJobId,
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    activelyHiring: job.activelyHiring,
    easyApply: job.easyApply,
    postedAt: job.postedAt,
    salary: job.salary,
    status: job.status,
    statusChangedAt: job.statusChangedAt,
    score: job.score,
    scoreLabel: job.scoreLabel,
    scoreReason: job.scoreReason,
    firstSeenAt: job.firstSeenAt,
    lastSeenAt: job.lastSeenAt,
    seenCount: job.seenCount,
  };
}

export function toJobDetail(job: JobRecord, repos: Repositories): JobDetail {
  return {
    ...toJobSummary(job),
    notes: job.notes,
    description: repos.jobs.descriptionOf(job.id),
    rubricVersion: job.rubricVersion,
    scoredAt: job.scoredAt,
    sightings: repos.sightings.listForJob(job.id),
    listingSightings: repos.listingSightings.listForJob(job.id),
    history: repos.statusHistory.listForJob(job.id),
  };
}

export const TOP_NEW_JOBS = 5;

export function toRunSummary(run: RunRecord, repos: Repositories): RunSummary {
  return { ...run, topNewJobs: repos.jobs.topNewForRun(run.id, TOP_NEW_JOBS).map(toJobSummary) };
}
