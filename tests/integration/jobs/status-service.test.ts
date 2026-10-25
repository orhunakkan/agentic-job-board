import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LISTING_SOURCES } from '../../../src/domain/job-source.ts';
import {
  changeJobStatus,
  dismissNewJobs,
  InvalidTransitionError,
  JobNotFoundError,
} from '../../../src/jobs/status-service.ts';
import { ingestListings } from '../../../src/ingest/listing-ingest.ts';
import { LINKEDIN_LISTINGS, LISTINGS } from '../../helpers/seed-board.ts';
import { createTestDatabase, fakeClock, type TestDatabase } from '../helpers/test-database.ts';

describe('changeJobStatus', () => {
  let testDb: TestDatabase;
  let jobId: number;
  const clock = fakeClock('2026-10-24T09:00:00.000Z');

  beforeEach(() => {
    testDb = createTestDatabase();
    const runId = testDb.repos.runs.create('2026-10-23T12:00:00.000Z');
    const { newJobIds } = ingestListings(testDb.db, testDb.repos, runId, LINKEDIN_LISTINGS);
    jobId = newJobIds[0] ?? 0;
  });
  afterEach(() => {
    testDb.close();
  });

  function change(to: Parameters<typeof changeJobStatus>[3], id = jobId) {
    return changeJobStatus(testDb.db, testDb.repos, id, to, clock);
  }

  it('FR-08: a status change updates the job and writes history', () => {
    const updated = change('saved');

    expect(updated).toMatchObject({ id: jobId, status: 'saved' });
    expect(testDb.repos.jobs.get(jobId)).toEqual(updated);
    expect(testDb.repos.statusHistory.listForJob(jobId).slice(1)).toEqual([
      { fromStatus: 'new', toStatus: 'saved', changedAt: updated.statusChangedAt },
    ]);
  });

  it('FR-08: a job can go all the way to an offer, with every step in history', () => {
    for (const to of ['saved', 'applied', 'interviewing', 'offer'] as const) change(to);

    expect(
      testDb.repos.statusHistory.listForJob(jobId).map((change) => `${String(change.fromStatus)}→${change.toStatus}`),
    ).toEqual(['null→new', 'new→saved', 'saved→applied', 'applied→interviewing', 'interviewing→offer']);
  });

  it('FR-08: a dismissed job can be restored to new', () => {
    change('dismissed');

    expect(change('new').status).toBe('new');
  });

  it('FR-08: an invalid transition is refused and writes nothing', () => {
    const before = testDb.repos.jobs.get(jobId);

    expect(() => change('offer')).toThrow(InvalidTransitionError);
    expect(() => change('offer')).toThrow("a job can't move from new to offer");
    expect(testDb.repos.jobs.get(jobId)).toEqual(before);
    expect(testDb.repos.statusHistory.listForJob(jobId)).toHaveLength(1);
  });

  it('FR-08: the error says which transition was refused', () => {
    change('saved');
    change('applied');
    change('rejected');

    let error: unknown;
    try {
      change('interviewing');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect(error).toMatchObject({ name: 'InvalidTransitionError', from: 'rejected', to: 'interviewing' });
  });

  it('FR-08: an unknown job is refused', () => {
    expect(() => change('saved', 999)).toThrow(JobNotFoundError);
    expect(() => change('saved', 999)).toThrow('job 999 does not exist');
  });

  it('FR-08: without a clock, the change is stamped with the current time', () => {
    const before = new Date().toISOString();

    const updated = changeJobStatus(testDb.db, testDb.repos, jobId, 'saved');

    expect(updated.statusChangedAt >= before).toBe(true);
    expect(new Date(updated.statusChangedAt).toISOString()).toBe(updated.statusChangedAt);
  });
});

describe('dismissNewJobs', () => {
  let testDb: TestDatabase;
  const clock = fakeClock('2026-10-25T09:00:00.000Z');

  beforeEach(() => {
    testDb = createTestDatabase();
  });
  afterEach(() => {
    testDb.close();
  });

  function seed(): { linkedin: number[]; other: number[] } {
    const runId = testDb.repos.runs.create('2026-10-24T12:00:00.000Z');
    return {
      linkedin: ingestListings(testDb.db, testDb.repos, runId, LINKEDIN_LISTINGS).newJobIds,
      other: ingestListings(testDb.db, testDb.repos, runId, LISTINGS).newJobIds,
    };
  }

  it('FR-21: dismisses every New job from the sources, one history row each, all at one time', () => {
    const { linkedin, other } = seed();
    const [saved, ...rest] = linkedin;
    changeJobStatus(testDb.db, testDb.repos, saved ?? 0, 'saved', clock);

    expect(dismissNewJobs(testDb.db, testDb.repos, ['linkedin'], clock)).toBe(rest.length);

    expect(testDb.repos.jobs.idsWithStatus(['linkedin'], 'dismissed')).toEqual(rest);
    expect(testDb.repos.jobs.idsWithStatus(['linkedin'], 'saved')).toEqual([saved]);
    expect(testDb.repos.jobs.idsWithStatus(LISTING_SOURCES, 'new')).toEqual(other);
    const changedAt = testDb.repos.jobs.get(rest[0] ?? 0)?.statusChangedAt;
    for (const id of rest) {
      expect(testDb.repos.statusHistory.listForJob(id).slice(1)).toEqual([
        { fromStatus: 'new', toStatus: 'dismissed', changedAt },
      ]);
    }
  });

  it('FR-21: with nothing in New it changes nothing and returns 0', () => {
    expect(dismissNewJobs(testDb.db, testDb.repos, LISTING_SOURCES, clock)).toBe(0);
  });

  it('FR-21: a failure part-way leaves every job as it was', () => {
    const { linkedin } = seed();
    const failing = {
      ...testDb.repos,
      statusHistory: {
        ...testDb.repos.statusHistory,
        insert: () => {
          throw new Error('disk full');
        },
      },
    };

    expect(() => dismissNewJobs(testDb.db, failing, ['linkedin'], clock)).toThrow('disk full');
    expect(testDb.repos.jobs.idsWithStatus(['linkedin'], 'new')).toEqual(linkedin);
  });
});
