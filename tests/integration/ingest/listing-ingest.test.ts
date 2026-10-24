import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunFinishedError, RunNotFoundError } from '../../../src/ingest/ingest-service.ts';
import { ingestListings, type IncomingListing } from '../../../src/ingest/listing-ingest.ts';
import { countAll, createTestDatabase, fakeClock, type TestDatabase } from '../helpers/test-database.ts';

// Fictional listings only, shaped like the ones scripts/fetch-sources.ts sends (PLAN.md Phase 10).
function listing(overrides: Partial<IncomingListing> = {}): IncomingListing {
  return {
    source: 'greenhouse',
    sourceJobId: '5550001',
    title: 'Senior SDET',
    company: 'Example Labs',
    location: 'Remote, United States',
    url: 'https://job-boards.greenhouse.io/examplelabs/jobs/5550001',
    postedAt: '2026-10-20T09:00:00-04:00',
    salary: '$150K – $180K',
    description: 'Build the test platform.',
    ...overrides,
  };
}

describe('ingestListings', () => {
  let testDb: TestDatabase;
  let runId: number;

  beforeEach(() => {
    testDb = createTestDatabase();
    runId = testDb.repos.runs.create('2026-10-23T12:00:00.000Z');
  });
  afterEach(() => {
    testDb.close();
  });

  function ingest(listings: IncomingListing[], run = runId, clock = fakeClock()) {
    return ingestListings(testDb.db, testDb.repos, run, listings, clock);
  }

  it('FR-15: stores a new listing as a new job with its source, details and history', () => {
    const result = ingest([listing()]);

    expect(result).toEqual({ received: 1, new: 1, seenAgain: 0, repeated: 0, newJobIds: [expect.any(Number)] });
    const [jobId = 0] = result.newJobIds;
    expect(testDb.repos.jobs.get(jobId)).toMatchObject({
      source: 'greenhouse',
      sourceJobId: '5550001',
      title: 'Senior SDET',
      company: 'Example Labs',
      location: 'Remote, United States',
      url: 'https://job-boards.greenhouse.io/examplelabs/jobs/5550001',
      postedAt: '2026-10-20T13:00:00.000Z',
      salary: '$150K – $180K',
      activelyHiring: false,
      easyApply: false,
      status: 'new',
      seenCount: 1,
      firstSeenAt: '2026-10-23T12:00:00.000Z',
      firstRunId: runId,
    });
    expect(testDb.repos.jobs.descriptionOf(jobId)).toBe('Build the test platform.');
    expect(testDb.repos.statusHistory.listForJob(jobId)).toEqual([
      { fromStatus: null, toStatus: 'new', changedAt: '2026-10-23T12:00:00.000Z' },
    ]);
    expect(testDb.repos.listingSightings.listForJob(jobId)).toEqual([{ runId, seenAt: '2026-10-23T12:00:00.000Z' }]);
    expect(testDb.repos.runs.get(runId)).toMatchObject({
      listingsSeen: 1,
      jobsNew: 1,
      jobsSeenAgain: 0,
      emailsSeen: 0,
    });
  });

  it('FR-16: a listing from a later run counts as seen again and refreshes the job', () => {
    const [jobId] = ingest([listing()]).newJobIds;
    testDb.repos.runs.finish(runId, '2026-10-23T12:10:00.000Z');
    const laterRun = testDb.repos.runs.create('2026-10-24T12:00:00.000Z');

    const result = ingest(
      [listing({ title: 'Staff SDET', salary: null })],
      laterRun,
      fakeClock('2026-10-24T12:00:00Z'),
    );

    expect(result).toEqual({ received: 1, new: 0, seenAgain: 1, repeated: 0, newJobIds: [] });
    expect(testDb.repos.jobs.get(jobId ?? 0)).toMatchObject({
      title: 'Staff SDET',
      salary: '$150K – $180K',
      seenCount: 2,
      lastSeenAt: '2026-10-24T12:00:00.000Z',
    });
    expect(testDb.repos.listingSightings.listForJob(jobId ?? 0).map((sighting) => sighting.runId)).toEqual([
      runId,
      laterRun,
    ]);
    expect(testDb.repos.runs.get(laterRun)).toMatchObject({ listingsSeen: 1, jobsNew: 0, jobsSeenAgain: 1 });
  });

  it('FR-16: the same listing twice in one run is stored once and counted once', () => {
    const result = ingest([listing(), listing({ title: 'Changed in the same run' })]);
    const again = ingest([listing()]);

    expect(result).toMatchObject({ received: 2, new: 1, repeated: 1 });
    expect(again).toMatchObject({ received: 1, new: 0, seenAgain: 0, repeated: 1 });
    expect(countAll(testDb.db)).toMatchObject({ jobs: 1, listing_sightings: 1, status_history: 1 });
    expect(testDb.repos.jobs.get(result.newJobIds[0] ?? 0)).toMatchObject({ title: 'Senior SDET', seenCount: 1 });
    expect(testDb.repos.runs.get(runId)).toMatchObject({ listingsSeen: 3, jobsNew: 1, jobsSeenAgain: 0 });
  });

  it('FR-16: the same job ID from two sources is two jobs', () => {
    const result = ingest([listing(), listing({ source: 'lever', url: 'https://jobs.lever.co/examplelabs/5550001' })]);

    expect(result).toMatchObject({ new: 2 });
    expect(countAll(testDb.db).jobs).toBe(2);
  });

  it('FR-16: never matches a listing to a LinkedIn job with the same ID', () => {
    testDb.repos.jobs.insert(
      {
        source: 'linkedin',
        sourceJobId: '5550001',
        title: 'SDET',
        company: 'Example Co',
        location: 'Remote',
        url: 'https://www.linkedin.com/jobs/view/5550001/',
        activelyHiring: true,
        easyApply: true,
        postedAt: null,
        salary: null,
        description: null,
      },
      { runId: null, seenAt: '2026-10-22T00:00:00.000Z', createdAt: '2026-10-22T00:00:00.000Z' },
    );

    expect(ingest([listing()])).toMatchObject({ new: 1, seenAgain: 0 });
  });

  it('FR-15: keeps a listing without a posted date, salary or description', () => {
    const [jobId = 0] = ingest([listing({ postedAt: null, salary: null, description: null, location: '' })]).newJobIds;

    expect(testDb.repos.jobs.get(jobId)).toMatchObject({ postedAt: null, salary: null, location: '' });
    expect(testDb.repos.jobs.descriptionOf(jobId)).toBeNull();
  });

  it('FR-11: refuses a run that does not exist or is finished, and stores nothing', () => {
    testDb.repos.runs.finish(runId, '2026-10-23T12:10:00.000Z');

    expect(() => ingest([listing()], 999)).toThrow(RunNotFoundError);
    expect(() => ingest([listing()])).toThrow(RunFinishedError);
    expect(countAll(testDb.db)).toMatchObject({ jobs: 0, listing_sightings: 0, status_history: 0 });
  });
});
