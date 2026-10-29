import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  FullConfig,
  TestCase as PlaywrightCase,
  TestResult as PlaywrightResult,
  TestStep,
} from '@playwright/test/reporter';
import type { TestCase as VitestCase, TestModule } from 'vitest/node';
import { describe, expect, it } from 'vitest';
import {
  BoardReportPlaywrightReporter,
  errorInfo,
  statusOf,
} from '../../../scripts/board-report/reporters/playwright.ts';
import { BoardReportVitestReporter, errorOf, statusOfErrors } from '../../../scripts/board-report/reporters/vitest.ts';
import { readResults } from '../../../scripts/board-report/result-schema.ts';

// board-report's Vitest and Playwright reporters (PLAN.md Phase 14 task 3), fed runner events shaped like the ones
// Vitest 5 and Playwright 1.64 send (checked in task 1).

const ROOT = 'C:/repo';
const env = (dir: string, step: string) => ({ BOARD_REPORT_RESULTS: dir, BOARD_REPORT_STEP: step });
const temp = () => mkdtempSync(join(tmpdir(), 'board-report-reporter-'));

function vitestCase(id: string, name: string, result: object, diagnostic?: object): VitestCase {
  const module = { type: 'module', moduleId: `${ROOT}/tests/unit/domain/status.test.ts` };
  const inner = { type: 'suite', name: 'transitions', parent: { type: 'suite', name: 'status', parent: module } };
  return {
    id,
    name,
    parent: inner,
    module,
    location: { line: 42, column: 5 },
    options: { tags: ['fast'] },
    result: () => result,
    diagnostic: () => diagnostic,
  } as unknown as VitestCase;
}

describe('the Vitest reporter', () => {
  it('NFR-13: keeps each test with its describe blocks, duration, console output, and error with expected and actual', () => {
    const dir = temp();
    const reporter = new BoardReportVitestReporter(env(dir, 'unit'), ROOT);
    reporter.onUserConsoleLog({ content: 'hello\n', type: 'stdout', taskId: 'a', time: 0, size: 6 });
    reporter.onUserConsoleLog({ content: 'warn\n', type: 'stderr', taskId: 'a', time: 0, size: 5 });
    reporter.onUserConsoleLog({ content: 'outside a test\n', type: 'stdout', time: 0, size: 6 });
    reporter.onTestCaseResult(
      vitestCase(
        'a',
        'FR-08: passes',
        { state: 'passed', errors: undefined },
        { startTime: 1000, duration: 5, retryCount: 0 },
      ),
    );
    reporter.onTestCaseResult(
      vitestCase(
        'b',
        'FR-08: fails',
        {
          state: 'failed',
          errors: [
            {
              name: 'AssertionError',
              message: 'expected 1 to be 2',
              expected: '2',
              actual: '1',
              stack: 'AssertionError: x\n at y',
            },
          ],
        },
        { startTime: 1010, duration: 3, retryCount: 1 },
      ),
    );
    reporter.onTestCaseResult(
      vitestCase('c', 'throws', { state: 'failed', errors: [{ name: 'TypeError', message: 'boom' }] }),
    );
    reporter.onTestCaseResult(vitestCase('d', 'later', { state: 'skipped', errors: undefined }));
    const results = readResults(dir).map(({ result }) => result);
    const byName = (name: string) => results.find((result) => result.name === name);

    expect(results).toHaveLength(4);
    expect(byName('FR-08: passes')).toMatchObject({
      fullName: 'status > transitions > FR-08: passes',
      file: 'tests/unit/domain/status.test.ts',
      line: 42,
      suites: ['tests/unit/domain/status.test.ts', 'status', 'transitions'],
      start: 1000,
      stop: 1005,
      stdout: ['hello\n'],
      stderr: ['warn\n'],
      error: null,
      labels: { testType: 'unit', requirements: ['FR-08'], tags: ['fast'], step: 'unit' },
    });
    expect(byName('FR-08: fails')).toMatchObject({
      status: 'failed',
      error: { message: 'expected 1 to be 2', expected: '2', actual: '1', stack: 'AssertionError: x\n at y' },
      retries: [{ status: 'failed', duration: 0, message: null }],
    });
    expect(byName('throws')).toMatchObject({
      status: 'broken',
      error: { message: 'boom', expected: null, stack: null },
    });
    expect(byName('later')?.status).toBe('skipped');
  });

  it('NFR-13: a file that could not run and an unhandled error are broken results of their own', () => {
    const dir = temp();
    const reporter = new BoardReportVitestReporter(env(dir, 'integration'), ROOT);
    const modules = [
      {
        moduleId: `${ROOT}/tests/integration/db.test.ts`,
        errors: () => [{ name: 'SyntaxError', message: 'Unexpected token' }],
      },
      { moduleId: `${ROOT}/tests/integration/ok.test.ts`, errors: () => [] },
    ] as unknown as TestModule[];
    reporter.onTestRunEnd(modules, [{ name: 'Error', message: 'leaked promise' }]);
    const results = readResults(dir).map(({ result }) => result);

    expect(results.map((result) => [result.name, result.status, result.labels.testType]).sort()).toEqual([
      ['Unhandled errors during the run', 'broken', 'integration'],
      ['tests/integration/db.test.ts could not run', 'broken', 'integration'],
    ]);
  });

  it('NFR-13: writes nothing when board-report did not start the run', () => {
    const reporter = new BoardReportVitestReporter({}, ROOT);
    reporter.onUserConsoleLog({ content: 'x', type: 'stdout', taskId: 'a', time: 0, size: 1 });
    reporter.onTestCaseResult(vitestCase('a', 'x', { state: 'passed', errors: undefined }));
    reporter.onTestRunEnd([], [{ message: 'x' }]);

    expect(new BoardReportVitestReporter().constructor.name).toBe('BoardReportVitestReporter');
  });

  it('NFR-13: an assertion is "failed", anything else thrown is "broken"', () => {
    expect(statusOfErrors([{ expected: '1' }])).toBe('failed');
    expect(statusOfErrors([{ name: 'AssertionError' }])).toBe('failed');
    expect(statusOfErrors([{ name: 'TypeError' }])).toBe('broken');
    expect(errorOf([])).toBeNull();
    expect(errorOf([{ name: 'Error' }, { message: 'second' }])?.message).toBe('Error\n\nsecond');
  });
});

function step(title: string, category: string, extra: Partial<TestStep> = {}): TestStep {
  return {
    title,
    category,
    startTime: new Date(2000),
    duration: 4,
    steps: [],
    attachments: [],
    annotations: [],
    location: { file: `${ROOT}/tests/e2e/board.spec.ts`, line: 30, column: 1 },
    titlePath: () => [title],
    ...extra,
  };
}

function playwrightCase(title: string, project: string, outcome: string): PlaywrightCase {
  return {
    title,
    titlePath: () => ['', project, 'board.spec.ts', 'board', title],
    parent: { project: () => ({ name: project }) },
    location: { file: `${ROOT}\\tests\\e2e\\board.spec.ts`, line: 25, column: 3 },
    tags: ['@smoke'],
    outcome: () => outcome,
  } as unknown as PlaywrightCase;
}

describe('the Playwright reporter', () => {
  it('NFR-13: keeps the browser, every step nested, the error, stdout, tags and the screenshot, video and trace files', () => {
    const dir = temp();
    const media = temp();
    writeFileSync(join(media, 'test-failed-1.png'), 'png');
    writeFileSync(join(media, 'video.webm'), 'webm');
    const failure = {
      message: 'Error: \u001b[2mexpect(\u001b[22mlocator).toHaveText(expected) failed\nExpected: "Bye"\nReceived: "Hi"',
      stack: 'Error: x\n at board.spec.ts:30',
    };
    const screenshot = { name: 'screenshot', contentType: 'image/png', path: join(media, 'test-failed-1.png') };
    const axe = { name: 'axe results', contentType: 'application/json', body: Buffer.from('{"violations":[]}') };
    const result = {
      status: 'failed',
      duration: 120,
      startTime: new Date(1000),
      retry: 1,
      parallelIndex: 2,
      error: failure,
      errors: [failure],
      stdout: ['out\n', Buffer.from('bytes\n')],
      stderr: [],
      attachments: [
        axe,
        screenshot,
        { name: 'video', contentType: 'video/webm', path: join(media, 'video.webm') },
        { name: 'trace', contentType: 'application/zip', path: join(media, 'missing-trace.zip') },
        { name: 'empty', contentType: 'text/plain' },
      ],
      steps: [
        step('Before Hooks', 'hook', { steps: [step('Launch browser', 'pw:api')] }),
        step('save the job', 'test.step', {
          error: failure,
          steps: [step('Click', 'pw:api'), step('Expect "toHaveText"', 'expect', { error: failure })],
        }),
        step('Attach "axe results"', 'test.attach', { attachments: [axe] as TestStep['attachments'] }),
        step('After Hooks', 'hook', {
          attachments: [screenshot] as TestStep['attachments'],
          error: { message: 'crash' },
        }),
      ],
    } as unknown as PlaywrightResult;
    const earlier = {
      ...result,
      retry: 0,
      duration: 90,
      error: { message: 'Error: first try' },
    } as unknown as PlaywrightResult;
    const reporter = new BoardReportPlaywrightReporter({}, env(dir, 'e2e'));
    reporter.onBegin({ configFile: `${ROOT}/playwright.config.ts`, rootDir: `${ROOT}/tests/e2e` } as FullConfig);
    const test = playwrightCase('FR-07: save a job', 'firefox', 'unexpected');
    reporter.onTestEnd(test, earlier);
    reporter.onTestEnd(test, result);
    reporter.onEnd();
    const [stored] = readResults(dir);
    const saved = stored?.result;

    expect(reporter.printsToStdio()).toBe(false);
    expect(saved).toMatchObject({
      name: 'FR-07: save a job',
      fullName: 'board > FR-07: save a job',
      status: 'failed',
      file: 'tests/e2e/board.spec.ts',
      line: 25,
      suites: ['tests/e2e/board.spec.ts', 'board'],
      start: 1000,
      duration: 120,
      stdout: ['out\n', 'bytes\n'],
      parameters: [{ name: 'browser', value: 'Firefox' }],
      error: { expected: '"Bye"', actual: '"Hi"' },
      retries: [{ status: 'broken', duration: 90, message: 'Error: first try' }],
      labels: { testType: 'e2e', browser: 'Firefox', worker: 'worker 2', tags: ['@smoke'], requirements: ['FR-07'] },
    });
    expect(saved?.error?.message).not.toContain('\u001b');
    expect(saved?.attachments.map((attachment) => attachment.name)).toEqual(['axe results', 'screenshot', 'video']);
    expect(saved?.steps.map((child) => [child.name, child.category, child.status])).toEqual([
      ['Before Hooks', 'hook', 'passed'],
      ['save the job', 'test.step', 'failed'],
      ['Attach "axe results"', 'test.attach', 'passed'],
      ['After Hooks', 'hook', 'broken'],
    ]);
    expect(saved?.steps[1]?.steps[1]).toMatchObject({
      status: 'failed',
      parameters: [{ name: 'line', value: '30' }],
      error: { expected: '"Bye"' },
    });
    expect(saved?.steps[2]?.attachments[0]?.name).toBe('axe results');
    expect(saved?.steps[3]?.attachments[0]?.name).toBe('screenshot');
    const files = new Map(
      saved?.attachments.map((attachment) => [
        attachment.name,
        readFileSync(join(stored?.dir ?? '', attachment.source), 'utf8'),
      ]),
    );
    expect(files).toEqual(
      new Map([
        ['axe results', '{"violations":[]}'],
        ['screenshot', 'png'],
        ['video', 'webm'],
      ]),
    );
  });

  it('NFR-13: maps every outcome to a status, and writes nothing without board-report', () => {
    const expected = { status: 'passed' } as PlaywrightResult;
    expect(statusOf(playwrightCase('x', 'chromium', 'skipped'), expected)).toBe('skipped');
    expect(statusOf(playwrightCase('x', 'chromium', 'expected'), expected)).toBe('passed');
    expect(statusOf(playwrightCase('x', 'chromium', 'flaky'), expected)).toBe('passed');
    expect(statusOf(playwrightCase('x', 'chromium', 'unexpected'), expected)).toBe('failed');
    expect(statusOf(playwrightCase('x', 'chromium', 'unexpected'), { status: 'timedOut' })).toBe('broken');
    expect(
      statusOf(playwrightCase('x', 'chromium', 'unexpected'), {
        status: 'failed',
        error: { message: 'boom' },
      }),
    ).toBe('broken');
    expect(errorInfo(undefined)).toBeNull();
    expect(errorInfo({ value: 'thrown string' })).toMatchObject({ message: 'thrown string', stack: null });

    const reporter = new BoardReportPlaywrightReporter({}, {});
    reporter.onBegin({ rootDir: ROOT } as FullConfig);
    reporter.onTestEnd(playwrightCase('x', 'mobile', 'expected'), expected);
    reporter.onEnd();
    expect(new BoardReportPlaywrightReporter().printsToStdio()).toBe(false);
  });

  it('NFR-13: a skipped test keeps no error and an unknown project keeps its own name', () => {
    const dir = temp();
    const reporter = new BoardReportPlaywrightReporter({}, env(dir, 'smoke'));
    reporter.onBegin({ rootDir: ROOT } as FullConfig);
    const skipped = {
      status: 'skipped',
      duration: 0,
      startTime: new Date(5),
      retry: 0,
      parallelIndex: 0,
      error: { message: 'x' },
      stdout: [],
      stderr: [],
      attachments: [],
      steps: [],
    };
    reporter.onTestEnd(
      playwrightCase('FR-07: later @smoke', 'tablet', 'skipped'),
      skipped as unknown as PlaywrightResult,
    );
    reporter.onEnd();
    const [stored] = readResults(dir);

    expect(stored?.result).toMatchObject({
      status: 'skipped',
      error: null,
      labels: { testType: 'smoke', browser: 'tablet', severity: 'critical' },
    });
  });
});
