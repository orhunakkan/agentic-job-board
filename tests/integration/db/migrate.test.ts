import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { appliedVersions, loadMigrations, migrate, MigrationError } from '../../../src/db/migrate.ts';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.ts';

const EXPECTED_TABLES = [
  'emails',
  'jobs',
  'listing_sightings',
  'profile',
  'runs',
  'schema_migrations',
  'sightings',
  'status_history',
];
const EXPECTED_INDEXES = [
  'idx_emails_received',
  'idx_jobs_first_run',
  'idx_jobs_first_seen',
  'idx_jobs_rubric',
  'idx_jobs_status_score',
  'idx_status_history_job',
];

describe('migrate', () => {
  let testDb: TestDatabase;
  afterEach(() => {
    testDb.close();
  });

  function names(type: 'table' | 'index'): string[] {
    return testDb.db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(type)
      .map((row) => String(row['name']));
  }

  function migrationsDir(files: Record<string, string>): URL {
    const dir = join(testDb.dir, 'migrations');
    mkdirSync(dir);
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
    return pathToFileURL(`${dir}/`);
  }

  it('FR-04: builds the whole schema from an empty database', () => {
    testDb = createTestDatabase({ migrated: false });

    const applied = migrate(testDb.db, loadMigrations(), () => '2026-10-23T12:00:00.000Z');

    expect(applied).toEqual([1, 2, 3, 4]);
    expect(names('table')).toEqual(EXPECTED_TABLES);
    expect(names('index')).toEqual(EXPECTED_INDEXES);
    expect(testDb.db.prepare('SELECT version, applied_at FROM schema_migrations').all()).toEqual([
      { version: 1, applied_at: '2026-10-23T12:00:00.000Z' },
      { version: 2, applied_at: '2026-10-23T12:00:00.000Z' },
      { version: 3, applied_at: '2026-10-23T12:00:00.000Z' },
      { version: 4, applied_at: '2026-10-23T12:00:00.000Z' },
    ]);
  });

  it('FR-04: upgrading a database built on 001 keeps its jobs, with no first run recorded', () => {
    testDb = createTestDatabase({ migrated: false });
    const migrations = loadMigrations();
    migrate(testDb.db, migrations.slice(0, 1));
    testDb.db.exec(`INSERT INTO jobs (linkedin_job_id, title, company, location, url, status_changed_at,
                                    first_seen_at, last_seen_at)
                  VALUES ('1', 'Dispatcher', 'Example Co', 'Remote', 'https://www.linkedin.com/jobs/view/1/', 'x', 'x', 'x')`);

    expect(migrate(testDb.db, migrations)).toEqual([2, 3, 4]);
    expect(testDb.db.prepare('SELECT title, first_run_id FROM jobs').all()).toEqual([
      { title: 'Dispatcher', first_run_id: null },
    ]);
  });

  it('FR-16: upgrading a database built on 002 keeps every LinkedIn job, sighting and status change', () => {
    testDb = createTestDatabase({ migrated: false });
    const migrations = loadMigrations();
    migrate(testDb.db, migrations.slice(0, 2));
    testDb.db.exec(`
      INSERT INTO runs (id, started_at) VALUES (1, '2026-10-22T10:00:00.000Z');
      INSERT INTO emails (gmail_message_id, run_id, received_at, sender, subject, parse_status, processed_at)
        VALUES ('msg-1', 1, '2026-10-22T10:00:00.000Z', 'jobalerts-noreply@linkedin.com', 'Alert', 'parsed', 'x');
      INSERT INTO jobs (id, linkedin_job_id, title, company, location, url, status, status_changed_at, notes, score,
                        score_label, score_reason, rubric_version, scored_at, first_seen_at, last_seen_at,
                        seen_count, first_run_id)
        VALUES (7, '4000000001', 'Dispatcher', 'Example Co', 'Remote', 'https://www.linkedin.com/jobs/view/4000000001/',
                'saved', 's', 'call back', 88, 'strong', 'Good fit.', 'triage-v1', 'sc', 'f', 'l', 2, 1);
      INSERT INTO sightings (job_id, gmail_message_id, saved_search) VALUES (7, 'msg-1', 'dispatcher');
      INSERT INTO status_history (job_id, from_status, to_status, changed_at) VALUES (7, NULL, 'new', 'x');
    `);

    expect(migrate(testDb.db, migrations.slice(0, 3))).toEqual([3]);

    expect(testDb.db.prepare('SELECT * FROM jobs').all()).toEqual([
      {
        id: 7,
        source: 'linkedin',
        source_job_id: '4000000001',
        title: 'Dispatcher',
        company: 'Example Co',
        location: 'Remote',
        url: 'https://www.linkedin.com/jobs/view/4000000001/',
        actively_hiring: 0,
        easy_apply: 0,
        posted_at: null,
        salary: null,
        description: null,
        status: 'saved',
        status_changed_at: 's',
        notes: 'call back',
        score: 88,
        score_label: 'strong',
        score_reason: 'Good fit.',
        rubric_version: 'triage-v1',
        scored_at: 'sc',
        first_seen_at: 'f',
        last_seen_at: 'l',
        seen_count: 2,
        first_run_id: 1,
      },
    ]);
    expect(testDb.db.prepare('SELECT job_id FROM sightings UNION ALL SELECT job_id FROM status_history').all()).toEqual(
      [{ job_id: 7 }, { job_id: 7 }],
    );
    expect(testDb.db.prepare('SELECT listings_seen FROM runs').all()).toEqual([{ listings_seen: 0 }]);
    expect(testDb.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('FR-19: upgrading a database built on 003 keeps every job and sighting; workplace and search name start empty', () => {
    testDb = createTestDatabase({ migrated: false });
    const migrations = loadMigrations();
    migrate(testDb.db, migrations.slice(0, 3));
    testDb.db.exec(`
      INSERT INTO runs (id, started_at) VALUES (1, '2026-10-22T10:00:00.000Z');
      INSERT INTO emails (gmail_message_id, run_id, received_at, sender, subject, parse_status, processed_at)
        VALUES ('msg-1', 1, '2026-10-22T10:00:00.000Z', 'jobalerts-noreply@linkedin.com', 'Alert', 'parsed', 'x');
      INSERT INTO jobs (id, source, source_job_id, title, company, location, url, status_changed_at, first_seen_at,
                        last_seen_at)
        VALUES (7, 'linkedin', '4000000001', 'Dispatcher', 'Example Co', 'Remote',
                'https://www.linkedin.com/jobs/view/4000000001/', 's', 'f', 'l'),
               (8, 'greenhouse', '55', 'Lead Nurse', 'Sample Co', '', 'https://example.com/55', 's', 'f', 'l');
      INSERT INTO sightings (job_id, gmail_message_id, saved_search) VALUES (7, 'msg-1', 'dispatcher');
      INSERT INTO listing_sightings (job_id, run_id, seen_at) VALUES (8, 1, '2026-10-22T10:00:01.000Z');
    `);

    expect(migrate(testDb.db, migrations)).toEqual([4]);

    expect(testDb.db.prepare('SELECT id, title, workplace FROM jobs ORDER BY id').all()).toEqual([
      { id: 7, title: 'Dispatcher', workplace: null },
      { id: 8, title: 'Lead Nurse', workplace: null },
    ]);
    expect(testDb.db.prepare('SELECT job_id, saved_search FROM sightings').all()).toEqual([
      { job_id: 7, saved_search: 'dispatcher' },
    ]);
    expect(testDb.db.prepare('SELECT job_id, search_name FROM listing_sightings').all()).toEqual([
      { job_id: 8, search_name: null },
    ]);
    expect(() => {
      testDb.db.exec("UPDATE jobs SET workplace = 'office' WHERE id = 7");
    }).toThrow(/CHECK constraint/);
    testDb.db.exec("UPDATE jobs SET workplace = 'on-site' WHERE id = 7");
    expect(testDb.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('FR-16: a job ID is unique within its source, not across sources', () => {
    testDb = createTestDatabase();
    const insert = testDb.db.prepare(`INSERT INTO jobs (source, source_job_id, title, company, location, url,
                                     status_changed_at, first_seen_at, last_seen_at)
                                     VALUES (?, ?, 'T', 'C', '', 'https://example.com/', 'x', 'x', 'x')`);

    insert.run('linkedin', '123');
    insert.run('greenhouse', '123');

    expect(() => insert.run('greenhouse', '123')).toThrow(/UNIQUE/);
  });

  it('FR-04: foreign keys are on again after migrating', () => {
    testDb = createTestDatabase();

    expect(testDb.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('FR-04: a migration that breaks a foreign key is rolled back', () => {
    testDb = createTestDatabase({ migrated: false });
    const dir = migrationsDir({
      '001_first.sql': `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                        CREATE TABLE parent (id INTEGER PRIMARY KEY);
                        CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));`,
      '002_orphan.sql': 'INSERT INTO child (parent_id) VALUES (42);',
    });

    expect(() => migrate(testDb.db, loadMigrations(dir))).toThrow(MigrationError);
    expect(() => migrate(testDb.db, loadMigrations(dir))).toThrow('002_orphan.sql breaks 1 foreign key');

    expect(appliedVersions(testDb.db)).toEqual([1]);
    expect(testDb.db.prepare('SELECT count(*) AS n FROM child').get()).toEqual({ n: 0 });
    expect(testDb.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('FR-04: running it again is a no-op', () => {
    testDb = createTestDatabase();

    expect(migrate(testDb.db)).toEqual([]);
    expect(appliedVersions(testDb.db)).toEqual([1, 2, 3, 4]);
  });

  it('FR-04: an empty database has no applied versions', () => {
    testDb = createTestDatabase({ migrated: false });

    expect(appliedVersions(testDb.db)).toEqual([]);
  });

  it('FR-04: applies only the versions that are missing, in order', () => {
    testDb = createTestDatabase({ migrated: false });
    const dir = migrationsDir({
      '002_second.sql': 'CREATE TABLE b (x INTEGER);',
      '001_first.sql':
        'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE a (x INTEGER);',
      'README.md': 'not a migration',
    });
    const migrations = loadMigrations(dir);

    expect(migrations.map((migration) => migration.name)).toEqual(['001_first.sql', '002_second.sql']);
    expect(migrate(testDb.db, migrations.slice(0, 1))).toEqual([1]);
    expect(migrate(testDb.db, migrations)).toEqual([2]);
    expect(appliedVersions(testDb.db)).toEqual([1, 2]);
  });

  it('FR-04: a failing migration leaves no trace', () => {
    testDb = createTestDatabase({ migrated: false });
    const dir = migrationsDir({
      '001_first.sql':
        'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
      '002_broken.sql': 'CREATE TABLE half (x INTEGER); THIS IS NOT SQL;',
    });

    expect(() => migrate(testDb.db, loadMigrations(dir))).toThrow();

    expect(appliedVersions(testDb.db)).toEqual([1]);
    expect(names('table')).toEqual(['schema_migrations']);
  });

  it.each([
    [{ '001_ok.sql': '', 'second.sql': '' }, 'migration file name must look like 001_name.sql: second.sql'],
    [{ '001_ok.sql': '', '003_gap.sql': '' }, 'without gaps; found 003_gap.sql'],
    [{ '001_a.sql': '', '001_b.sql': '' }, 'without gaps; found 001_b.sql'],
  ])('FR-04: rejects a bad set of migration files', (files, message) => {
    testDb = createTestDatabase({ migrated: false });
    const dir = migrationsDir(files);

    expect(() => loadMigrations(dir)).toThrow(MigrationError);
    expect(() => loadMigrations(dir)).toThrow(message);
  });
});
