import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ingestEmails,
  InvalidEmailError,
  RunFinishedError,
  RunNotFoundError,
  type IncomingEmail,
} from '../../../src/ingest/ingest-service.ts';
import {
  countAll,
  createTestDatabase,
  dumpAll,
  fakeClock,
  fixtureEmail,
  type TestDatabase,
} from '../helpers/test-database.ts';

function oneJobEmail(gmailMessageId: string, receivedAt: string, jobId = '1000000001'): IncomingEmail {
  return {
    gmailMessageId,
    receivedAt,
    sender: 'jobalerts-noreply@linkedin.com',
    subject: 'Alert',
    plainText: [
      'Your job alert for sdet in United States',
      'New jobs match your preferences.',
      '',
      'SDET',
      'Example Co',
      'Remote',
      `View job: https://www.linkedin.com/comm/jobs/view/${jobId}/?trackingId=abc&otpToken=SECRET-TOKEN`,
    ].join('\n'),
  };
}

const UNRECOGNIZED: IncomingEmail = {
  gmailMessageId: 'msg-anniversary',
  receivedAt: '2026-10-23T09:00:00Z',
  sender: 'jobs-noreply@linkedin.com',
  subject: 'Happy work anniversary',
  plainText: 'Congratulate your connection on their work anniversary!',
};

describe('ingestEmails', () => {
  let testDb: TestDatabase;
  let runId: number;
  const clock = fakeClock();

  beforeEach(() => {
    testDb = createTestDatabase();
    runId = testDb.repos.runs.create('2026-10-23T12:00:00.000Z');
  });
  afterEach(() => {
    testDb.close();
  });

  function ingest(emails: IncomingEmail[], run = runId) {
    return ingestEmails(testDb.db, testDb.repos, run, emails, clock);
  }

  it('FR-02: stores a parsed email with its jobs, sightings and history', () => {
    const result = ingest([fixtureEmail('digest-test-automation.txt', 'msg-1')]);

    expect(result.results).toEqual([{ gmailMessageId: 'msg-1', outcome: 'new', jobsFound: 6 }]);
    expect(result.newJobIds).toHaveLength(6);
    expect(countAll(testDb.db)).toEqual({
      runs: 1,
      emails: 1,
      jobs: 6,
      sightings: 6,
      listing_sightings: 0,
      status_history: 6,
      profile: 0,
    });
    expect(testDb.repos.emails.get('msg-1')).toMatchObject({
      runId,
      receivedAt: '2026-10-22T14:10:48.000Z',
      parseStatus: 'parsed',
      unrecognizedReason: null,
      savedSearch: expect.stringContaining('Test Automation Engineer') as unknown,
      jobsFound: 6,
    });

    const [firstId] = result.newJobIds;
    expect(testDb.repos.jobs.get(firstId ?? 0)).toMatchObject({
      source: 'linkedin',
      sourceJobId: '4473592349',
      title: 'Senior QA Automation Test Engineer',
      company: 'Cboe Global Markets',
      status: 'new',
      seenCount: 1,
      firstSeenAt: '2026-10-22T14:10:48.000Z',
      lastSeenAt: '2026-10-22T14:10:48.000Z',
    });
    expect(testDb.repos.statusHistory.listForJob(firstId ?? 0)).toEqual([
      { fromStatus: null, toStatus: 'new', changedAt: expect.any(String) as unknown },
    ]);
  });

  it('FR-05: sending the same email again changes nothing and reports a duplicate', () => {
    ingest([fixtureEmail('digest-test-automation.txt', 'msg-1')]);
    const before = storedData();

    const again = ingest([fixtureEmail('digest-test-automation.txt', 'msg-1')]);

    expect(again).toEqual({
      results: [{ gmailMessageId: 'msg-1', outcome: 'duplicate', jobsFound: 0 }],
      newJobIds: [],
    });
    expect(storedData()).toEqual(before);
    expect(testDb.repos.runs.get(runId)).toMatchObject({ emailsSeen: 2, emailsNew: 1, emailsDuplicate: 1, jobsNew: 6 });
  });

  it('FR-05: a duplicate in a later run is still a duplicate', () => {
    ingest([fixtureEmail('recommendations.txt', 'msg-r')]);
    const secondRun = testDb.repos.runs.create('2026-10-24T12:00:00.000Z');

    const again = ingest([fixtureEmail('recommendations.txt', 'msg-r')], secondRun);

    expect(again.results[0]?.outcome).toBe('duplicate');
    expect(testDb.repos.runs.get(secondRun)).toMatchObject({
      emailsSeen: 1,
      emailsDuplicate: 1,
      emailsNew: 0,
      jobsNew: 0,
    });
  });

  it('FR-05: the same message twice in one batch is stored once', () => {
    const email = oneJobEmail('msg-1', '2026-10-22T10:00:00Z');

    const result = ingest([email, email]);

    expect(result.results.map((emailResult) => emailResult.outcome)).toEqual(['new', 'duplicate']);
    expect(countAll(testDb.db)).toMatchObject({ emails: 1, jobs: 1, sightings: 1 });
  });

  it('FR-04: the same job in two emails is one job with two sightings', () => {
    const later = oneJobEmail('msg-later', '2026-10-23T08:00:00Z', '42');
    const earlier = { ...oneJobEmail('msg-earlier', '2026-10-21T08:00:00Z', '42'), subject: 'Older alert' };

    const result = ingest([later, earlier]);

    expect(result.results.map((emailResult) => emailResult.outcome)).toEqual(['new', 'new']);
    expect(result.newJobIds).toHaveLength(1);
    const jobId = result.newJobIds[0] ?? 0;
    expect(countAll(testDb.db)).toMatchObject({ emails: 2, jobs: 1, sightings: 2, status_history: 1 });
    expect(testDb.repos.jobs.get(jobId)).toMatchObject({
      seenCount: 2,
      firstSeenAt: '2026-10-21T08:00:00.000Z',
      lastSeenAt: '2026-10-23T08:00:00.000Z',
    });
    expect(testDb.repos.sightings.listForJob(jobId).map((sighting) => sighting.gmailMessageId)).toEqual([
      'msg-earlier',
      'msg-later',
    ]);
  });

  it('FR-04: the board shows the newest email’s details, even when the older email is ingested last (DEC-023)', () => {
    const newer = oneJobEmail('msg-oct-23', '2026-10-23T08:00:00Z', '42');
    const newerWithFlags = {
      ...newer,
      plainText: newer.plainText.replace(
        'Remote\n',
        'Remote\nThis company is actively hiring\nApply with resume & profile\n',
      ),
    };
    const older = {
      ...oneJobEmail('msg-oct-21', '2026-10-21T08:00:00Z', '42'),
      subject: 'Older alert',
    };

    const [jobId] = ingest([newerWithFlags, older]).newJobIds;

    expect(testDb.repos.jobs.get(jobId ?? 0)).toMatchObject({
      activelyHiring: true,
      easyApply: true,
      seenCount: 2,
      firstSeenAt: '2026-10-21T08:00:00.000Z',
      lastSeenAt: '2026-10-23T08:00:00.000Z',
    });
  });

  it('FR-04: a job already on the board is never reset by a new sighting', () => {
    const [jobId] = ingest([oneJobEmail('msg-1', '2026-10-22T10:00:00Z')]).newJobIds;
    testDb.repos.jobs.updateStatus(jobId ?? 0, 'applied', '2026-10-22T11:00:00.000Z');

    const result = ingest([oneJobEmail('msg-2', '2026-10-23T10:00:00Z')]);

    expect(result.newJobIds).toEqual([]);
    expect(testDb.repos.jobs.get(jobId ?? 0)).toMatchObject({ status: 'applied', seenCount: 2 });
  });

  it('FR-12: an unrecognized email is stored with its reason and counted, never dropped', () => {
    const result = ingest([UNRECOGNIZED]);

    expect(result.results).toEqual([{ gmailMessageId: 'msg-anniversary', outcome: 'unrecognized', jobsFound: 0 }]);
    expect(testDb.repos.emails.get('msg-anniversary')).toMatchObject({
      parseStatus: 'unrecognized',
      unrecognizedReason: 'unknown email format',
      savedSearch: null,
      jobsFound: 0,
      subject: 'Happy work anniversary',
    });
    expect(testDb.repos.runs.get(runId)).toMatchObject({ emailsSeen: 1, emailsUnrecognized: 1, emailsNew: 0 });
    expect(ingest([UNRECOGNIZED]).results[0]?.outcome).toBe('duplicate');
  });

  it('FR-11: keeps the run counters for a mixed batch', () => {
    ingest([oneJobEmail('msg-0', '2026-10-20T10:00:00Z', '4481581724')]);

    ingest([
      fixtureEmail('digest-senior-qa.txt', 'msg-1'),
      fixtureEmail('digest-test-automation.txt', 'msg-2'),
      fixtureEmail('digest-test-automation.txt', 'msg-2'),
      UNRECOGNIZED,
    ]);

    expect(testDb.repos.runs.get(runId)).toMatchObject({
      emailsSeen: 5,
      emailsNew: 3,
      emailsDuplicate: 1,
      emailsUnrecognized: 1,
      jobsNew: 1 + 5 + 6,
      jobsSeenAgain: 1,
      jobsScored: 0,
    });
  });

  it('NFR-07: tracking parameters, tokens and email bodies never reach the database', () => {
    ingest([oneJobEmail('msg-1', '2026-10-22T10:00:00Z'), fixtureEmail('recommendations.txt', 'msg-2')]);

    const stored = dumpAll(testDb.db);

    expect(stored).not.toMatch(/SECRET-TOKEN|otpToken|trackingId|\?/);
    expect(stored).not.toContain('This email was intended for');
    expect(stored).toContain('https://www.linkedin.com/jobs/view/1000000001/');
  });

  it('FR-05: a failure inside one email rolls that whole email back, and it can be sent again', () => {
    testDb.db.exec(`CREATE TEMP TRIGGER fail_third_sighting BEFORE INSERT ON sightings
                  WHEN (SELECT count(*) FROM sightings) >= 2
                  BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);

    expect(() => ingest([fixtureEmail('digest-test-automation.txt', 'msg-1')])).toThrow('injected failure');
    expect(countAll(testDb.db)).toEqual({
      runs: 1,
      emails: 0,
      jobs: 0,
      sightings: 0,
      listing_sightings: 0,
      status_history: 0,
      profile: 0,
    });
    expect(testDb.repos.runs.get(runId)).toMatchObject({ emailsSeen: 0, emailsNew: 0, jobsNew: 0 });

    testDb.db.exec('DROP TRIGGER fail_third_sighting');
    expect(ingest([fixtureEmail('digest-test-automation.txt', 'msg-1')]).results[0]?.outcome).toBe('new');
  });

  it('FR-05: emails before a failing one in the same batch stay stored', () => {
    testDb.db.exec(`CREATE TEMP TRIGGER fail_job_two BEFORE INSERT ON jobs WHEN NEW.source_job_id = '2'
                  BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);

    expect(() =>
      ingest([oneJobEmail('msg-1', '2026-10-22T10:00:00Z', '1'), oneJobEmail('msg-2', '2026-10-22T11:00:00Z', '2')]),
    ).toThrow('injected failure');

    expect(testDb.repos.emails.exists('msg-1')).toBe(true);
    expect(testDb.repos.emails.exists('msg-2')).toBe(false);
  });

  it('FR-02: an invalid receivedAt rejects the whole batch before anything is stored', () => {
    const batch = [oneJobEmail('msg-1', '2026-10-22T10:00:00Z'), oneJobEmail('msg-2', 'yesterday')];

    expect(() => ingest(batch)).toThrow(InvalidEmailError);
    expect(() => ingest(batch)).toThrow('email msg-2 has an invalid receivedAt: yesterday');
    expect(countAll(testDb.db)).toMatchObject({ emails: 0, jobs: 0 });
  });

  it('FR-02: stores every receivedAt in one ISO-8601 UTC form', () => {
    ingest([oneJobEmail('msg-1', '2026-10-22T09:10:48-05:00')]);

    expect(testDb.repos.emails.get('msg-1')?.receivedAt).toBe('2026-10-22T14:10:48.000Z');
  });

  it('FR-11: refuses an unknown run', () => {
    expect(() => ingest([UNRECOGNIZED], 999)).toThrow(RunNotFoundError);
    expect(() => ingest([UNRECOGNIZED], 999)).toThrow('run 999 does not exist');
  });

  it('FR-11: refuses a run that is already finished', () => {
    testDb.repos.runs.finish(runId, '2026-10-23T12:30:00.000Z');

    expect(() => ingest([UNRECOGNIZED])).toThrow(RunFinishedError);
    expect(countAll(testDb.db).emails).toBe(0);
  });

  it('FR-02: an empty batch does nothing', () => {
    expect(ingest([])).toEqual({ results: [], newJobIds: [] });
  });

  // Everything an ingest may write except the run's own counters, which do count the duplicate.
  function storedData(): unknown {
    return ['emails', 'jobs', 'sightings', 'status_history'].map((table) =>
      testDb.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  }
});
