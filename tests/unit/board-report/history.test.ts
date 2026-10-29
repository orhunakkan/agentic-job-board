import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  isFlaky,
  readHistory,
  statusesOf,
  summarizeRun,
  withRun,
  writeHistory,
  type HistoryRun,
} from '../../../scripts/board-report/history.ts';
import { labelResult } from '../../../scripts/board-report/labels.ts';
import type { Status } from '../../../scripts/board-report/result-schema.ts';

// board-report's history and trends (PLAN.md Phase 14 task 4).

function run(time: string, tests: Record<string, Status>): HistoryRun {
  return {
    time,
    commit: null,
    duration: 1,
    totals: { passed: 0, failed: 0, broken: 0, skipped: 0 },
    byType: {},
    tests: Object.fromEntries(Object.entries(tests).map(([id, status]) => [id, [status, 1]])),
  };
}

describe('history', () => {
  it('NFR-13: a run is summed up by status and by type, with each test by history ID', () => {
    const base = {
      fullName: 'x',
      duration: 10,
      file: 'tests/unit/a.test.ts',
      line: null,
      suites: [],
      parameters: [],
      error: null,
      steps: [],
      attachments: [],
      stdout: [],
      stderr: [],
      retries: [],
      labels: { tags: [], browser: null, worker: null },
    };
    const passed = labelResult({ ...base, name: 'a', status: 'passed', start: 100, stop: 110 }, 'unit');
    const failed = labelResult(
      { ...base, name: 'b', status: 'failed', start: 105, stop: 160, file: 'tests/api/b.test.ts' },
      'api',
    );
    const summary = summarizeRun([passed, failed], '2026-10-29T12:00:00.000Z', 'abc');

    expect(summary.totals).toEqual({ passed: 1, failed: 1, broken: 0, skipped: 0 });
    expect(summary.byType).toEqual({
      unit: { passed: 1, failed: 0, broken: 0, skipped: 0 },
      api: { passed: 0, failed: 1, broken: 0, skipped: 0 },
    });
    expect(summary.duration).toBe(60);
    expect(summary.tests[passed.historyId]).toEqual(['passed', 10]);
    expect(summarizeRun([], 't', null).duration).toBe(0);
  });

  it('NFR-13: keeps the last 50 runs and reads them back, leaving out lines it cannot read', () => {
    const runs = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => run(String(index), {})).reduce<HistoryRun[]>(
      (all, next) => withRun(all, next),
      [],
    );
    const path = join(mkdtempSync(join(tmpdir(), 'board-report-history-')), 'nested', 'history.jsonl');
    writeHistory(path, runs);
    writeFileSync(path, `{broken\n${JSON.stringify({ time: 'x' })}\n\n`, { flag: 'a' });

    expect(runs).toHaveLength(50);
    expect(runs[0]?.time).toBe('5');
    expect(readHistory(path)).toEqual(runs);
    expect(readHistory(join(path, 'missing'))).toEqual([]);
  });

  it('NFR-13: a test is flaky when it switched between pass and fail in its last 10 runs', () => {
    const steady = [run('1', { a: 'passed', b: 'failed' }), run('2', { a: 'passed', b: 'failed' })];
    const switching = [
      ...Array.from({ length: 12 }, (_, index) => run(String(index), { c: 'failed', d: 'passed' })),
      run('12', { c: 'passed', d: 'skipped' }),
    ];

    expect(isFlaky('a', steady)).toBe(false);
    expect(isFlaky('b', steady)).toBe(false);
    expect(isFlaky('c', switching)).toBe(true);
    expect(isFlaky('d', switching)).toBe(false);
    // The switch dropped out of the last 10 runs.
    expect(isFlaky('c', [...switching, ...Array.from({ length: 10 }, () => run('later', { c: 'passed' }))])).toBe(
      false,
    );
    expect(statusesOf('c', switching, 3)).toEqual(['failed', 'failed', 'passed']);
    expect(statusesOf('missing', switching, 3)).toEqual([]);
  });
});
