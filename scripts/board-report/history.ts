// The history behind the report's trends (PLAN.md Phase 14 task 4): each run adds one line to
// reports/board-report-history.jsonl with its time, commit, totals by type and status, and each test's status and
// duration by history ID. The last 50 runs are kept. A test whose result switched between pass and fail in its last
// 10 runs is flaky.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { Status, TestType, type TestResult } from './result-schema.ts';

export const HISTORY_LIMIT = 50;
export const FLAKY_WINDOW = 10;
export const DOTS = 20;

const Totals = z.strictObject({ passed: z.number(), failed: z.number(), broken: z.number(), skipped: z.number() });
export type Totals = z.infer<typeof Totals>;

export const HistoryRun = z.strictObject({
  time: z.string(),
  commit: z.string().nullable(),
  /** Wall time from the first test's start to the last one's stop, in milliseconds. */
  duration: z.number().nonnegative(),
  totals: Totals,
  byType: z.partialRecord(TestType, Totals),
  /** Each test's status and duration, by history ID. */
  tests: z.record(z.string(), z.tuple([Status, z.number().nonnegative()])),
});
export type HistoryRun = z.infer<typeof HistoryRun>;

export function emptyTotals(): Totals {
  return { passed: 0, failed: 0, broken: 0, skipped: 0 };
}

export function totalsOf(results: readonly Pick<TestResult, 'status'>[]): Totals {
  const totals = emptyTotals();
  for (const result of results) totals[result.status] += 1;
  return totals;
}

export function summarizeRun(results: readonly TestResult[], time: string, commit: string | null): HistoryRun {
  const byType: Partial<Record<TestType, Totals>> = {};
  const tests: Record<string, [Status, number]> = {};
  for (const result of results) {
    const totals = (byType[result.labels.testType] ??= emptyTotals());
    totals[result.status] += 1;
    tests[result.historyId] = [result.status, Math.round(result.duration)];
  }
  const starts = results.map((result) => result.start);
  const stops = results.map((result) => result.stop);
  const duration = results.length === 0 ? 0 : Math.max(...stops) - Math.min(...starts);
  return { time, commit, duration: Math.max(0, duration), totals: totalsOf(results), byType, tests };
}

/** The runs in the history file, oldest first. A line that can't be read is left out rather than stopping the build. */
export function readHistory(path: string): HistoryRun[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line) => {
      if (line.trim() === '') return [];
      try {
        const parsed = HistoryRun.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
}

/** The runs with this one added, the last 50 kept. */
export function withRun(runs: readonly HistoryRun[], run: HistoryRun): HistoryRun[] {
  return [...runs, run].slice(-HISTORY_LIMIT);
}

export function writeHistory(path: string, runs: readonly HistoryRun[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, runs.map((run) => `${JSON.stringify(run)}\n`).join(''));
}

/** The test's status in each of the runs it took part in, oldest first, up to `limit`. */
export function statusesOf(historyId: string, runs: readonly HistoryRun[], limit: number): Status[] {
  return runs.flatMap((run) => run.tests[historyId]?.[0] ?? []).slice(-limit);
}

/** Switched between pass and fail (failed or broken) in its last 10 runs; skipped runs don't count. */
export function isFlaky(historyId: string, runs: readonly HistoryRun[]): boolean {
  const outcomes = statusesOf(historyId, runs, FLAKY_WINDOW).filter((status) => status !== 'skipped');
  return outcomes.some((status, index) => index > 0 && (status === 'passed') !== (outcomes[index - 1] === 'passed'));
}
