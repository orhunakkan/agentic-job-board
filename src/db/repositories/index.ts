import type { DatabaseSync } from 'node:sqlite';
import { createEmailsRepository, type EmailsRepository } from './emails.ts';
import { createJobsRepository, type JobsRepository } from './jobs.ts';
import { createListingSightingsRepository, type ListingSightingsRepository } from './listing-sightings.ts';
import { createProfileRepository, type ProfileRepository } from './profile.ts';
import { createRunsRepository, type RunsRepository } from './runs.ts';
import { createSightingsRepository, type SightingsRepository } from './sightings.ts';
import { createStatusHistoryRepository, type StatusHistoryRepository } from './status-history.ts';

export interface Repositories {
  profile: ProfileRepository;
  runs: RunsRepository;
  emails: EmailsRepository;
  jobs: JobsRepository;
  sightings: SightingsRepository;
  listingSightings: ListingSightingsRepository;
  statusHistory: StatusHistoryRepository;
}

// Prepares every statement once; call after migrate(), because preparing needs the tables.
export function createRepositories(db: DatabaseSync): Repositories {
  return {
    profile: createProfileRepository(db),
    runs: createRunsRepository(db),
    emails: createEmailsRepository(db),
    jobs: createJobsRepository(db),
    sightings: createSightingsRepository(db),
    listingSightings: createListingSightingsRepository(db),
    statusHistory: createStatusHistoryRepository(db),
  };
}
