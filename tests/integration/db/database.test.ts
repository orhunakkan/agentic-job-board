import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, transaction } from '../../../src/db/database.ts';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.ts';

describe('openDatabase', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('NFR-08: creates the folder for DB_PATH when it does not exist yet', () => {
    dir = mkdtempSync(join(tmpdir(), 'jobboard-open-'));
    const path = join(dir, 'nested', 'deeper', 'jobboard.db');

    const db = openDatabase(path);
    db.close();

    expect(existsSync(path)).toBe(true);
  });

  it('FR-04: turns on WAL, foreign keys and a busy timeout', () => {
    dir = mkdtempSync(join(tmpdir(), 'jobboard-open-'));
    const db = openDatabase(join(dir, 'jobboard.db'));

    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    db.close();
  });

  it('FR-04: opens an in-memory database without touching the disk', () => {
    const db = openDatabase(':memory:');

    expect(db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
    db.close();
  });
});

describe('transaction', () => {
  let testDb: TestDatabase;
  afterEach(() => {
    testDb.close();
  });

  function setUp(): TestDatabase {
    testDb = createTestDatabase({ migrated: false });
    testDb.db.exec('CREATE TABLE t (v INTEGER NOT NULL)');
    return testDb;
  }

  function values(): unknown[] {
    return testDb.db.prepare('SELECT v FROM t ORDER BY v').all();
  }

  it('FR-04: commits when the work returns, and passes its result through', () => {
    const { db } = setUp();

    const result = transaction(db, () => {
      db.prepare('INSERT INTO t VALUES (1)').run();
      return 'done';
    });

    expect(result).toBe('done');
    expect(values()).toEqual([{ v: 1 }]);
    expect(db.isTransaction).toBe(false);
  });

  it('FR-04: rolls everything back when the work throws, and rethrows', () => {
    const { db } = setUp();

    expect(() =>
      transaction(db, () => {
        db.prepare('INSERT INTO t VALUES (1)').run();
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(values()).toEqual([]);
    expect(db.isTransaction).toBe(false);
  });

  it('FR-04: a nested call joins the open transaction, so an inner failure undoes the outer work', () => {
    const { db } = setUp();

    expect(() => {
      transaction(db, () => {
        db.prepare('INSERT INTO t VALUES (1)').run();
        transaction(db, () => {
          db.prepare('INSERT INTO t VALUES (2)').run();
          throw new Error('inner');
        });
      });
    }).toThrow('inner');

    expect(values()).toEqual([]);
  });
});
