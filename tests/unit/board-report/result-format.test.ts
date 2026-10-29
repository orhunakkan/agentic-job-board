import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { categoryOf } from '../../../scripts/board-report/categories.ts';
import {
  historyIdOf,
  labelResult,
  requirementsOf,
  runParameters,
  severityOf,
  testTypeOf,
  UnknownTestTypeError,
  expectedAndActual,
  stripAnsi,
  type ResultDraft,
} from '../../../scripts/board-report/labels.ts';
import {
  attachmentSource,
  readResult,
  readResults,
  ResultFileError,
  TestResult,
  writeResult,
} from '../../../scripts/board-report/result-schema.ts';
import { repoPath, resultsTarget, ResultsTargetError } from '../../../scripts/board-report/target.ts';

// board-report's result format and labels (PLAN.md Phase 14 tasks 2 and 4).

function draft(overrides: Partial<ResultDraft> = {}): ResultDraft {
  return {
    name: 'FR-07: lists the board',
    fullName: 'board > FR-07: lists the board',
    status: 'passed',
    start: 1000,
    stop: 1100,
    duration: 100,
    file: 'tests/unit/board.test.ts',
    line: 12,
    suites: ['tests/unit/board.test.ts', 'board'],
    parameters: [],
    error: null,
    steps: [],
    attachments: [],
    stdout: [],
    stderr: [],
    retries: [],
    labels: { tags: [], browser: null, worker: null },
    ...overrides,
  };
}

const temp = () => mkdtempSync(join(tmpdir(), 'board-report-format-'));

describe('the result format', () => {
  it('NFR-13: a labelled result matches the schema, and a result missing a field does not', () => {
    const result = labelResult(draft(), 'unit');

    expect(TestResult.safeParse(result).success).toBe(true);
    const missing: Partial<typeof result> = { ...result };
    delete missing.stdout;
    expect(TestResult.safeParse(missing).success).toBe(false);
    expect(TestResult.safeParse({ ...result, status: 'flaky' }).success).toBe(false);
  });

  it('NFR-13: writes a result with its attachment files next to it, and reads it back checked', () => {
    const dir = temp();
    const result = labelResult(draft(), 'unit');
    const source = attachmentSource(result.id, 0, 'Axe results!', 'application/json');
    result.attachments.push({ name: 'Axe results!', type: 'application/json', source });
    const path = writeResult(join(dir, 'unit'), result, new Map([[source, { body: '{"violations":[]}' }]]));

    expect(source).toBe(`${result.id}-0-axe-results.json`);
    expect(readFileSync(join(dir, 'unit', source), 'utf8')).toBe('{"violations":[]}');
    expect(readResult(path)).toEqual(result);
    expect(readResults(dir)).toEqual([{ result, dir: join(dir, 'unit') }]);
    expect(readResults(join(dir, 'missing'))).toEqual([]);
  });

  it('NFR-13: copies an attachment from a file and keeps its extension', () => {
    const dir = temp();
    writeFileSync(join(dir, 'shot.PNG'), 'png');
    const source = attachmentSource(
      '0123456789abcdef',
      2,
      'screenshot',
      'application/octet-stream',
      join(dir, 'shot.PNG'),
    );
    const result = labelResult(draft(), 'e2e');
    writeResult(join(dir, 'out'), result, new Map([[source, { from: join(dir, 'shot.PNG') }]]));

    expect(source).toBe('0123456789abcdef-2-screenshot.png');
    expect(existsSync(join(dir, 'out', source))).toBe(true);
    expect(attachmentSource('0123456789abcdef', 0, '???', 'text/markdown')).toBe('0123456789abcdef-0-attachment.md');
    expect(attachmentSource('0123456789abcdef', 0, 'log', 'application/x-unknown')).toBe('0123456789abcdef-0-log.txt');
  });

  it('NFR-13: refuses to write an invalid result and names a file it cannot read', () => {
    const dir = temp();
    const invalid = { ...labelResult(draft(), 'unit'), duration: -1 };
    expect(() => writeResult(dir, invalid)).toThrow();

    writeFileSync(join(dir, 'a-result.json'), 'not json');
    expect(() => readResults(dir)).toThrow(ResultFileError);
    writeFileSync(join(dir, 'a-result.json'), '{"format":1}');
    expect(() => readResults(dir)).toThrow(/does not match the result format/);
  });

  it('NFR-13: an attachment name can never leave the result folder', () => {
    const result = labelResult(draft(), 'unit');
    expect(() => writeResult(temp(), result, new Map([['../escape.txt', { body: 'x' }]]))).toThrow();
  });
});

describe('labels', () => {
  it('NFR-13: the test type comes from the test file path, or from the step for steps of one type', () => {
    expect(testTypeOf('unit', 'tests/unit/a.test.ts')).toBe('unit');
    expect(testTypeOf('coverage', 'tests/integration/a.test.ts')).toBe('integration');
    expect(testTypeOf('coverage', 'tests/api/a.test.ts')).toBe('api');
    expect(testTypeOf('coverage', 'tests/contract/a.test.ts')).toBe('contract');
    expect(testTypeOf('coverage', 'tests/security/a.test.ts')).toBe('security');
    expect(testTypeOf('e2e', 'tests/e2e/a11y.spec.ts')).toBe('accessibility');
    expect(testTypeOf('e2e', 'tests/e2e/board.spec.ts')).toBe('e2e');
    expect(testTypeOf('smoke', 'tests/e2e/board.spec.ts')).toBe('smoke');
    expect(testTypeOf('bdd-smoke', 'tests/features/e2e/smoke.feature')).toBe('bdd-smoke');
    expect(testTypeOf('bdd-e2e', 'tests/features/e2e/a.feature')).toBe('bdd-e2e');
    expect(testTypeOf('perf', null)).toBe('performance');
    expect(testTypeOf('static', 'scripts/x.ts')).toBe('static');
    expect(testTypeOf('coverage', null, 'coverage')).toBe('coverage');
    expect(() => testTypeOf('unit', 'somewhere/else.ts')).toThrow(UnknownTestTypeError);
    expect(() => testTypeOf('unit', null)).toThrow(UnknownTestTypeError);
  });

  it('NFR-13: requirements come from the start of the name and from tags, in PLAN.md §3 order', () => {
    expect(requirementsOf('NFR-06, FR-07: the board', [])).toEqual(['FR-07', 'NFR-06']);
    expect(requirementsOf('Clear All empties New', ['@FR-21', '@smoke', '@FR-07'])).toEqual(['FR-07', 'FR-21']);
    expect(requirementsOf('a helper that names FR-07: inside', [])).toEqual([]);
  });

  it('NFR-13: smoke and security tests are critical, the rest normal', () => {
    expect(severityOf('smoke')).toBe('critical');
    expect(severityOf('bdd-smoke')).toBe('critical');
    expect(severityOf('security')).toBe('critical');
    expect(severityOf('unit')).toBe('normal');
  });

  it('NFR-13: the browser and the smoke run are parameters that change the history ID', () => {
    const chromium = labelResult(
      draft({ file: 'tests/features/e2e/a.feature', labels: { tags: [], browser: 'Chromium', worker: null } }),
      'bdd-e2e',
    );
    const firefox = labelResult(
      draft({ file: 'tests/features/e2e/a.feature', labels: { tags: [], browser: 'Firefox', worker: null } }),
      'bdd-e2e',
    );
    const smoke = labelResult(
      draft({ file: 'tests/features/e2e/a.feature', labels: { tags: [], browser: 'Chromium', worker: null } }),
      'bdd-smoke',
    );

    expect(chromium.parameters).toEqual([{ name: 'browser', value: 'Chromium' }]);
    expect(smoke.parameters).toEqual([
      { name: 'browser', value: 'Chromium' },
      { name: 'run', value: 'smoke' },
    ]);
    expect(new Set([chromium.historyId, firefox.historyId, smoke.historyId]).size).toBe(3);
    expect(
      runParameters('e2e', 'WebKit', [
        { name: 'browser', value: 'old' },
        { name: 'row', value: '1' },
      ]),
    ).toEqual([
      { name: 'row', value: '1' },
      { name: 'browser', value: 'WebKit' },
    ]);
  });

  it('NFR-13: the same test in two steps keeps its history ID but gets two result IDs', () => {
    const unit = labelResult(draft(), 'unit');
    const coverage = labelResult(draft(), 'coverage');

    expect(unit.historyId).toBe(coverage.historyId);
    expect(unit.id).not.toBe(coverage.id);
    expect(
      historyIdOf('unit', 'a', 'b', [
        { name: 'x', value: '1' },
        { name: 'y', value: '2' },
      ]),
    ).toBe(
      historyIdOf('unit', 'a', 'b', [
        { name: 'y', value: '2' },
        { name: 'x', value: '1' },
      ]),
    );
  });

  it('NFR-13: reads expected and received values out of a coloured message', () => {
    const message =
      'expect(locator).toHaveText(expected) failed\n\nExpected: \u001b[32m"Bye"\u001b[39m\nReceived: \u001b[31m"Hi"\u001b[39m';

    expect(stripAnsi(message)).not.toContain('\u001b');
    expect(expectedAndActual(message)).toEqual({ expected: '"Bye"', actual: '"Hi"' });
    expect(expectedAndActual('Expected substring: "a"\nReceived string:    "b"')).toEqual({
      expected: '"a"',
      actual: '"b"',
    });
    expect(expectedAndActual('boom')).toEqual({ expected: null, actual: null });
  });

  it('NFR-13: where results go comes from the environment, and nothing is written without it', () => {
    expect(resultsTarget({})).toBeNull();
    expect(resultsTarget({ BOARD_REPORT_RESULTS: '' })).toBeNull();
    expect(resultsTarget({ BOARD_REPORT_RESULTS: 'reports/x', BOARD_REPORT_STEP: 'unit' })?.step).toBe('unit');
    expect(() => resultsTarget({ BOARD_REPORT_RESULTS: 'reports/x', BOARD_REPORT_STEP: 'nope' })).toThrow(
      ResultsTargetError,
    );
    expect(repoPath('C:\\Repo\\tests\\a.test.ts', 'c:/repo')).toBe('tests/a.test.ts');
    expect(repoPath('/elsewhere/a.ts', '/repo/')).toBe('/elsewhere/a.ts');
  });
});

describe('failure categories', () => {
  const result = (
    testType: ResultDraft['testType'],
    status: 'passed' | 'failed' | 'broken' | 'skipped',
    message = '',
  ) => ({
    status,
    error: message === '' ? null : { message, expected: null, actual: null, stack: null },
    labels: labelResult(
      draft({ ...(testType === undefined ? {} : { testType }) }),
      testType === undefined ? 'unit' : 'coverage',
    ).labels,
  });

  it('NFR-13: puts every failed or broken test in one category', () => {
    expect(categoryOf(result(undefined, 'passed'))).toBeNull();
    expect(categoryOf(result(undefined, 'skipped'))).toBeNull();
    expect(categoryOf(result(undefined, 'failed', 'expected 1 to be 2'))).toBe('assertions');
    expect(categoryOf(result(undefined, 'failed', 'Expected: "a"\nReceived: "b"\nTimeout: 5000ms'))).toBe('assertions');
    expect(categoryOf(result(undefined, 'broken', 'Test timed out in 5000ms.'))).toBe('timeouts');
    expect(categoryOf(result(undefined, 'broken', 'locator.click: Timeout 10000ms exceeded.'))).toBe('timeouts');
    expect(categoryOf(result(undefined, 'broken', 'TypeError: x is undefined'))).toBe('crashes');
    expect(categoryOf(result('coverage', 'failed'))).toBe('thresholds');
    expect(
      categoryOf({
        ...result(undefined, 'failed'),
        labels: { ...result(undefined, 'failed').labels, testType: 'performance' },
      }),
    ).toBe('thresholds');
    expect(
      categoryOf({
        ...result(undefined, 'failed'),
        labels: { ...result(undefined, 'failed').labels, testType: 'accessibility' },
      }),
    ).toBe('accessibility');
    expect(
      categoryOf({
        ...result(undefined, 'failed'),
        labels: { ...result(undefined, 'failed').labels, testType: 'static' },
      }),
    ).toBe('static');
  });
});
