import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';

// The integration scenarios check what the services stored by reading the rows back with SQL (PLAN.md §8.5).

export function sqlRows<T>(db: DatabaseSync, schema: z.ZodType<T>, sql: string, ...params: SQLInputValue[]): T[] {
  return z.array(schema).parse(db.prepare(sql).all(...params));
}

export function sqlRow<T>(db: DatabaseSync, schema: z.ZodType<T>, sql: string, ...params: SQLInputValue[]): T {
  const [row, ...more] = sqlRows(db, schema, sql, ...params);
  if (row === undefined || more.length > 0) throw new Error(`expected one row from: ${sql}`);
  return row;
}

export const JobRowSql = z.object({ status: z.string(), seenCount: z.number(), lastSeenAt: z.string() });

export const JOB_SQL = 'SELECT status, seen_count AS seenCount, last_seen_at AS lastSeenAt FROM jobs WHERE id = ?';
