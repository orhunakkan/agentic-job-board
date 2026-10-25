import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changeJobStatus, InvalidTransitionError, JobNotFoundError } from '../../../src/jobs/status-service.ts';
import { ingestListings } from '../../../src/ingest/listing-ingest.ts';
import { LINKEDIN_LISTINGS } from '../../helpers/seed-board.ts';
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
