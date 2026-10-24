import { readdirSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { transaction } from './database.ts';

// Applies migrations/NNN_name.sql in version order, each in its own transaction, and records it in
// schema_migrations. Already-applied versions are skipped, so running it again is a no-op.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
const FILE_NAME = /^(\d{3})_[a-z0-9_-]+\.sql$/;

export function loadMigrations(dir: URL = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const version = FILE_NAME.exec(file)?.[1];
      if (version === undefined) throw new MigrationError(`migration file name must look like 001_name.sql: ${file}`);
      return { version: Number(version), name: file, sql: readFileSync(new URL(file, dir), 'utf8') };
    })
    .sort((left, right) => left.version - right.version);

  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) {
      throw new MigrationError(`migration versions must run 001, 002, … without gaps; found ${migration.name}`);
    }
  }
  return migrations;
}

const AppliedRow = z.object({ version: z.number().int() });
const ForeignKeysRow = z.object({ foreign_keys: z.union([z.literal(0), z.literal(1)]) });

export function appliedVersions(db: DatabaseSync): number[] {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (table === undefined) return [];

  return db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => AppliedRow.parse(row).version);
}

export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = loadMigrations(),
  now: () => string = () => new Date().toISOString(),
): number[] {
  const done = new Set(appliedVersions(db));
  const applied: number[] = [];

  // SQLite's table-rebuild procedure (003, DEC-037) needs foreign keys off, and that pragma does nothing inside a
  // transaction, so it is switched off around the migrations. Each one is checked before it commits instead.
  const { foreign_keys: foreignKeys } = ForeignKeysRow.parse(db.prepare('PRAGMA foreign_keys').get());
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const migration of migrations) {
      if (done.has(migration.version)) continue;
      transaction(db, () => {
        db.exec(migration.sql);
        const broken = db.prepare('PRAGMA foreign_key_check').all().length;
        if (broken > 0) throw new MigrationError(`${migration.name} breaks ${String(broken)} foreign key(s)`);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, now());
      });
      applied.push(migration.version);
    }
  } finally {
    db.exec(`PRAGMA foreign_keys = ${String(foreignKeys)}`);
  }
  return applied;
}
