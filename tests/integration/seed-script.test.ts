import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { seedDatabase, SeedError } from '../../scripts/seed.ts';
import { canTransition, STATUSES } from '../../src/domain/status.ts';
import { isLabelConsistent } from '../../src/domain/score.ts';
import { countAll, createTestDatabase } from './helpers/test-database.ts';

// scripts/seed.ts (PLAN.md Phase 7 task 1): realistic fake data for the load test, loaded through the real
// listing ingest and status services, as LinkedIn searches would bring it (Phase 11), so it obeys every rule real
// data obeys.

const root = fileURLToPath(new URL('../../', import.meta.url));
const UNTIL = '2026-10-23T12:00:00.000Z';

describe('scripts/seed.ts', () => {
  const testDb = createTestDatabase();
  const summary = seedDatabase(testDb.db, testDb.repos, { count: 400, seed: 7, until: UNTIL });
  const jobs = testDb.repos.jobs.list({
    sources: null,
    statuses: null,
    minScore: null,
    text: null,
    unscoredOnly: false,
    sort: 'recent',
    limit: 1000,
    offset: 0,
  });
  afterAll(() => {
    testDb.close();
  });

  it('NFR-05: creates exactly the requested number of jobs, with repeat sightings', () => {
    expect(summary.jobs).toBe(400);
    expect(jobs).toHaveLength(400);
    expect(summary.pages).toBe(100);
    expect(countAll(testDb.db)).toMatchObject({ runs: 30, emails: 0, sightings: 0, jobs: 400 });
    expect(countAll(testDb.db).listing_sightings).toBeGreaterThan(400);
    expect(jobs.filter((job) => job.seenCount > 1).length).toBeGreaterThan(50);
  });

  it('FR-24: saves a valid profile, so the seeded board opens instead of the setup page', () => {
    expect(testDb.repos.profile.state().status).toBe('saved');
  });

  it('NFR-14: the seeded jobs come from several lines of work', () => {
    const titles = jobs.map((job) => job.title).join(' | ');

    for (const word of ['Nurse', 'Accountant', 'Dispatcher', 'Teacher', 'Account', 'Developer']) {
      expect(titles, word).toContain(word);
    }
  });

  it('NFR-05: spreads jobs over every status, and most are scored with a consistent label', () => {
    expect(Object.keys(summary.byStatus).sort()).toEqual([...STATUSES].sort());
    expect(summary.scored).toBeGreaterThan(300);
    for (const job of jobs.filter((candidate) => candidate.score !== null)) {
      expect(job.scoreLabel === null ? false : isLabelConsistent(job.score ?? -1, job.scoreLabel)).toBe(true);
    }
  });

  it('FR-08: every status history follows the allowed transitions', () => {
    for (const job of jobs) {
      const history = testDb.repos.statusHistory.listForJob(job.id);
      expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'new' });
      for (const change of history.slice(1)) {
        expect(change.fromStatus === null ? false : canTransition(change.fromStatus, change.toStatus)).toBe(true);
      }
      expect(history.at(-1)?.toStatus).toBe(job.status);
    }
  });

  it('FR-11: every run is finished and its counters add up', () => {
    const runs = testDb.repos.runs.list(100);

    expect(runs.every((run) => run.finishedAt !== null)).toBe(true);
    expect(runs.reduce((sum, run) => sum + run.jobsNew, 0)).toBe(400);
    expect(runs.reduce((sum, run) => sum + run.jobsScored, 0)).toBe(summary.scored);
    expect(runs.reduce((sum, run) => sum + run.emailsUnrecognized, 0)).toBe(0);
  });

  it('NFR-05: the same seed gives the same data', () => {
    const again = createTestDatabase();
    try {
      seedDatabase(again.db, again.repos, { count: 400, seed: 7, until: UNTIL });
      const titles = (db: typeof testDb.db) => db.prepare('SELECT title, score, status FROM jobs ORDER BY id').all();

      expect(titles(again.db)).toEqual(titles(testDb.db));
    } finally {
      again.close();
    }
  });

  it('NFR-08: refuses to seed a database that already has jobs', () => {
    expect(() => seedDatabase(testDb.db, testDb.repos, { count: 5, seed: 1, until: UNTIL })).toThrow(SeedError);
  });

  describe('from the command line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'));
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ['scripts/seed.ts', ...args], { cwd: root, encoding: 'utf8' });

    it('NFR-05: seeds a new database and refuses to seed it twice', () => {
      const db = join(dir, 'perf.db');

      const first = run('--count', '40', '--db', db);
      const second = run('--count', '40', '--db', db);

      expect(first.status).toBe(0);
      expect(first.stdout).toContain(`Seeded ${db}`);
      expect(second.status).toBe(1);
      expect(second.stderr).toContain('the database already has 40 jobs');
    });

    it.each([[[]], [['--count', '0', '--db', 'x.db']], [['--count', '5']], [['--db']]])(
      'NFR-09: bad arguments %j print the usage',
      (args) => {
        const result = run(...args);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Usage: node scripts/seed.ts');
      },
    );
  });
});
