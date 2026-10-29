import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertCoverage, globPattern, thresholdsOf } from '../../../scripts/board-report/converters/coverage.ts';
import {
  convertCucumber,
  CucumberMessagesError,
  scenarioStatus,
} from '../../../scripts/board-report/converters/cucumber.ts';
import { convertK6 } from '../../../scripts/board-report/converters/k6.ts';
import {
  convertAudit,
  convertEslint,
  convertPrettier,
  convertTsc,
  type CommandOutput,
} from '../../../scripts/board-report/converters/static.ts';
import { writeConverted } from '../../../scripts/board-report/converters/write.ts';
import { readResults, TestResult } from '../../../scripts/board-report/result-schema.ts';

// board-report's converters (PLAN.md Phase 14 task 3), each on a passing and a failing input.

const at = (seconds: number) => ({ seconds, nanos: 500_000_000 });

/** Cucumber messages for a feature with a Background, a Scenario Outline of two rows and a plain scenario. */
function messages(options: { failSecondRow?: boolean; retryPlain?: boolean; undefinedStep?: boolean } = {}): string {
  const envelopes: unknown[] = [
    { meta: { protocolVersion: '28' } },
    {
      gherkinDocument: {
        uri: 'tests\\features\\e2e\\notes.feature',
        feature: {
          name: 'Notes',
          children: [
            { background: { steps: [{ id: 'bg1', keyword: 'Given ', location: { line: 5 } }] } },
            {
              scenario: {
                id: 'sc1',
                name: 'A note of <length> characters',
                location: { line: 8 },
                steps: [{ id: 'st1', keyword: 'When ', location: { line: 9 } }],
                examples: [
                  {
                    tableHeader: { cells: [{ value: 'length' }] },
                    tableBody: [
                      { id: 'row1', location: { line: 12 }, cells: [{ value: '5000' }] },
                      { id: 'row2', location: { line: 13 }, cells: [{ value: '5001' }] },
                    ],
                  },
                ],
              },
            },
            {
              rule: {
                name: 'Saving',
                children: [
                  {
                    scenario: {
                      id: 'sc2',
                      name: 'A saved note',
                      location: { line: 20 },
                      steps: [
                        { id: 'st2', keyword: 'Then ', location: { line: 21 } },
                        { id: 'st3', keyword: 'And ', location: { line: 22 } },
                      ],
                      examples: [],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
    { hook: { id: 'h1', type: 'BEFORE_TEST_CASE' } },
    { hook: { id: 'h2', name: 'Screenshot on failure', type: 'AFTER_TEST_CASE' } },
  ];
  const pickles = [
    { id: 'p1', name: 'A note of 5000 characters', astNodeIds: ['sc1', 'row1'], text: 'I type 5000 characters' },
    { id: 'p2', name: 'A note of 5001 characters', astNodeIds: ['sc1', 'row2'], text: 'I type 5001 characters' },
  ];
  for (const pickle of pickles) {
    envelopes.push({
      pickle: {
        id: pickle.id,
        uri: 'tests\\features\\e2e\\notes.feature',
        name: pickle.name,
        astNodeIds: pickle.astNodeIds,
        tags: [{ name: '@FR-09' }],
        steps: [
          {
            id: `${pickle.id}-s0`,
            text: 'the board has these jobs',
            astNodeIds: ['bg1'],
            argument: { dataTable: { rows: [{ cells: [{ value: 'title' }] }, { cells: [{ value: 'SDET' }] }] } },
          },
          { id: `${pickle.id}-s1`, text: pickle.text, astNodeIds: ['st1'] },
        ],
      },
    });
  }
  envelopes.push({
    pickle: {
      id: 'p3',
      uri: 'tests/features/e2e/notes.feature',
      name: 'A saved note',
      astNodeIds: ['sc2'],
      tags: [{ name: '@FR-09' }, { name: '@smoke' }],
      steps: [
        { id: 'p3-s0', text: 'the board has these jobs', astNodeIds: ['bg1'] },
        {
          id: 'p3-s1',
          text: 'the note is saved',
          astNodeIds: ['st2'],
          argument: { docString: { content: 'Call back Monday' } },
        },
        { id: 'p3-s2', text: 'it shows after a reload', astNodeIds: ['st3'] },
      ],
    },
  });
  const cases = [
    { id: 'tc1', pickle: 'p1', steps: ['h1', 'p1-s0', 'p1-s1', 'h2'] },
    { id: 'tc2', pickle: 'p2', steps: ['h1', 'p2-s0', 'p2-s1', 'h2'] },
    { id: 'tc3', pickle: 'p3', steps: ['p3-s0', 'p3-s1', 'p3-s2'] },
  ];
  for (const testCase of cases) {
    envelopes.push({
      testCase: {
        id: testCase.id,
        pickleId: testCase.pickle,
        testSteps: testCase.steps.map((step) =>
          step.startsWith('h')
            ? { id: `${testCase.id}-${step}`, hookId: step }
            : { id: `${testCase.id}-${step}`, pickleStepId: step },
        ),
      },
    });
  }
  const passed = { status: 'PASSED', duration: { seconds: 0, nanos: 2_000_000 } };
  const runCase = (
    id: string,
    testCase: (typeof cases)[number],
    start: number,
    results: Record<string, object>,
    willBeRetried = false,
  ) => {
    envelopes.push({
      testCaseStarted: { id, testCaseId: testCase.id, attempt: 0, timestamp: at(start), workerId: '0' },
    });
    testCase.steps.forEach((step, index) => {
      const testStepId = `${testCase.id}-${step}`;
      envelopes.push({ testStepStarted: { testCaseStartedId: id, testStepId, timestamp: at(start + index) } });
      envelopes.push({
        testStepFinished: {
          testCaseStartedId: id,
          testStepId,
          testStepResult: results[step] ?? passed,
          timestamp: at(start + index),
        },
      });
    });
    envelopes.push({ testCaseFinished: { testCaseStartedId: id, timestamp: at(start + 5), willBeRetried } });
  };
  const [first, second, plain] = cases as [(typeof cases)[number], (typeof cases)[number], (typeof cases)[number]];
  runCase('r1', first, 10, {});
  const failure = {
    status: 'FAILED',
    duration: { seconds: 1, nanos: 0 },
    message: 'Error: expect(locator).toHaveText(expected) failed\nExpected: "Saved"\nReceived: "Too long"',
    exception: {
      type: 'Error',
      message: 'expect(locator).toHaveText(expected) failed\nExpected: "Saved"\nReceived: "Too long"',
      stackTrace: 'at notes.ts:4',
    },
  };
  runCase('r2', second, 20, options.failSecondRow === true ? { 'p2-s1': failure, h2: passed } : {});
  if (options.failSecondRow === true) {
    envelopes.push({
      attachment: {
        testCaseStartedId: 'r2',
        testStepId: 'tc2-h2',
        body: Buffer.from('png').toString('base64'),
        contentEncoding: 'BASE64',
        mediaType: 'image/png',
      },
    });
    envelopes.push({
      attachment: {
        testCaseStartedId: 'r2',
        testStepId: 'tc2-p2-s1',
        body: 'page text',
        contentEncoding: 'IDENTITY',
        mediaType: 'text/plain',
        fileName: 'page.txt',
      },
    });
  }
  if (options.retryPlain === true)
    runCase(
      'r3a',
      plain,
      30,
      { 'p3-s1': { status: 'FAILED', duration: { seconds: 0, nanos: 0 }, message: 'AssertionError: nope' } },
      true,
    );
  runCase(
    'r3',
    plain,
    40,
    options.undefinedStep === true
      ? {
          'p3-s1': { status: 'UNDEFINED', duration: { seconds: 0, nanos: 0 } },
          'p3-s2': { status: 'SKIPPED', duration: { seconds: 0, nanos: 0 } },
        }
      : {},
  );
  envelopes.push({ testRunFinished: { success: true, timestamp: at(50) } });
  return envelopes.map((envelope) => JSON.stringify(envelope)).join('\n');
}

describe('the Cucumber converter', () => {
  it('NFR-13: a passing run gives one result per scenario, with steps, data tables, doc strings, hooks and example rows', () => {
    const results = convertCucumber(messages(), 'e2e-firefox');
    const [first, , plain] = results.map((result) => result.draft);

    expect(results).toHaveLength(3);
    expect(first).toMatchObject({
      name: 'A note of 5000 characters',
      fullName: 'Notes > A note of 5000 characters',
      status: 'passed',
      file: 'tests/features/e2e/notes.feature',
      line: 12,
      suites: ['tests/features/e2e/notes.feature', 'Notes'],
      parameters: [{ name: 'length', value: '5000' }],
      labels: { tags: ['@FR-09'], browser: 'Firefox', worker: '0' },
      start: 10_500,
      stop: 15_500,
    });
    expect(first?.steps.map((step) => [step.name, step.category, step.status])).toEqual([
      ['Before hook', 'hook', 'passed'],
      ['Given the board has these jobs', 'Given', 'passed'],
      ['When I type 5000 characters', 'When', 'passed'],
      ['Screenshot on failure', 'hook', 'passed'],
    ]);
    expect(first?.steps[1]?.dataTable).toEqual([['title'], ['SDET']]);
    expect(plain?.suites).toEqual(['tests/features/e2e/notes.feature', 'Notes', 'Saving']);
    expect(plain?.line).toBe(20);
    expect(plain?.steps[1]?.docString).toBe('Call back Monday');
    expect(plain?.steps[2]?.name).toBe('And it shows after a reload');
  });

  it('NFR-13: a failing run keeps the step that failed, its error and its screenshot, and earlier attempts as retries', () => {
    const results = convertCucumber(messages({ failSecondRow: true, retryPlain: true }), 'smoke');
    const failed = results[1];
    const plain = results[2]?.draft;

    expect(failed?.draft.status).toBe('failed');
    expect(failed?.draft.error).toMatchObject({ expected: '"Saved"', actual: '"Too long"', stack: 'at notes.ts:4' });
    expect(failed?.draft.steps[2]).toMatchObject({ status: 'failed', duration: 1000 });
    // In step order: the failed step's text, then the screenshot of the hook after it.
    expect(
      failed?.attachments.map((attachment) => [attachment.name, attachment.type, String(attachment.body)]),
    ).toEqual([
      ['page.txt', 'text/plain', 'page text'],
      ['screenshot', 'image/png', 'png'],
    ]);
    expect(failed?.attachments[1]?.step).toBe(failed?.draft.steps[3]);
    // Two steps of 2 ms and the failed one of 0 ms.
    expect(plain?.retries).toEqual([{ status: 'failed', duration: 4, message: 'AssertionError: nope' }]);
    expect(plain?.status).toBe('passed');
    expect(failed?.draft.labels.browser).toBe('Chromium');
  });

  it('NFR-13: an undefined step makes the scenario broken; written results match the schema', () => {
    const results = convertCucumber(messages({ undefinedStep: true }), 'api');
    const dir = mkdtempSync(join(tmpdir(), 'board-report-cucumber-'));
    const written = writeConverted(dir, 'bdd-e2e', results);

    expect(results[2]?.draft.status).toBe('broken');
    expect(results[2]?.draft.error?.message).toBe('the step is undefined');
    expect(results[2]?.draft.labels.browser).toBeNull();
    expect(written.every((result) => TestResult.safeParse(result).success)).toBe(true);
    expect(written[0]?.labels.requirements).toEqual(['FR-09']);
    expect(scenarioStatus([{ status: 'skipped' }])).toBe('skipped');
  });

  it('NFR-13: refuses messages it cannot read', () => {
    expect(() => convertCucumber('{"pickle": 3}', 'api')).toThrow(CucumberMessagesError);
    expect(() => convertCucumber('not json', 'api')).toThrow(CucumberMessagesError);
    expect(() =>
      convertCucumber(
        JSON.stringify({ testCaseFinished: { testCaseStartedId: 'x', timestamp: at(1), willBeRetried: false } }),
        'api',
      ),
    ).toThrow(/never started/);
  });
});

const output = (overrides: Partial<CommandOutput>): CommandOutput => ({
  command: 'x',
  exitCode: 0,
  stdout: '',
  stderr: '',
  start: 1000,
  stop: 3000,
  ...overrides,
});

describe('the static converter', () => {
  it('NFR-13: one result per tsconfig: passed, failed with its errors, or broken when tsc could not run', () => {
    const [passed] = convertTsc('tsconfig.json', output({}));
    const [failed] = convertTsc(
      'tsconfig.json',
      output({
        exitCode: 2,
        stdout: "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
      }),
    );
    const [broken] = convertTsc('tests/perf/tsconfig.json', output({ exitCode: null, stderr: 'spawn ENOENT' }));

    expect(passed?.draft).toMatchObject({
      name: 'tsc --noEmit (tsconfig.json)',
      status: 'passed',
      testType: 'static',
      duration: 2000,
    });
    expect(failed?.draft.status).toBe('failed');
    expect(failed?.draft.error?.message).toContain('1 type error:\nsrc/a.ts(3,7): error TS2322');
    expect(failed?.attachments[0]?.body).toContain('TS2322');
    expect(broken?.draft.status).toBe('broken');
    expect(broken?.draft.error?.message).toContain('could not be started:\nspawn ENOENT');
  });

  it('NFR-13: one result per linted file with each rule it breaks', () => {
    const report = JSON.stringify([
      { filePath: 'C:\\repo\\src\\a.ts', messages: [] },
      {
        filePath: 'C:\\repo\\src\\b.ts',
        messages: [
          { ruleId: 'no-console', severity: 2, message: 'Unexpected console', line: 4, column: 3 },
          { ruleId: null, severity: 1, message: 'odd' },
        ],
      },
    ]);
    const [clean, dirty] = convertEslint(output({ exitCode: 1, stdout: report }), 'C:/repo');
    const [broken] = convertEslint(output({ exitCode: 2, stdout: 'Oops! Something went wrong!' }), 'C:/repo');

    expect(clean?.draft).toMatchObject({ name: 'ESLint: src/a.ts', status: 'passed', file: 'src/a.ts' });
    expect(dirty?.draft).toMatchObject({
      status: 'failed',
      file: 'src/b.ts',
      line: 4,
      parameters: [{ name: 'rules', value: 'no-console, parse', measured: true }],
    });
    expect(dirty?.draft.error?.message).toBe('4:3 error  no-console  Unexpected console\n0:0 warning  parse  odd');
    expect(broken?.draft.status).toBe('broken');
  });

  it('NFR-13: one result for formatting, naming the files that differ', () => {
    const [passed] = convertPrettier(
      output({ stdout: 'Checking formatting...\nAll matched files use Prettier code style!' }),
    );
    const [failed] = convertPrettier(
      output({
        exitCode: 1,
        stderr:
          '\u001b[33m[warn]\u001b[39m src/a.ts\n[warn] src/b.ts\n[warn] Code style issues found in 2 files. Run Prettier with --write to fix.',
      }),
    );
    const [broken] = convertPrettier(output({ exitCode: 2, stderr: 'No parser could be inferred' }));

    expect(passed?.draft.status).toBe('passed');
    expect(failed?.draft.error?.message).toBe("2 files differ from Prettier's format:\nsrc/a.ts\nsrc/b.ts");
    expect(failed?.attachments[0]?.body).not.toContain('\u001b');
    expect(broken?.draft.status).toBe('broken');
  });

  it('NFR-13: one result for the audit, with its advisories by severity', () => {
    const clean = JSON.stringify({
      vulnerabilities: {},
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
    });
    const dirty = JSON.stringify({
      vulnerabilities: { lodash: { severity: 'moderate', range: '<4.17.21' }, tar: { severity: 'critical' } },
      metadata: { vulnerabilities: { moderate: 1, critical: 1 } },
    });
    const [passed] = convertAudit(output({ stdout: clean }));
    const [failed] = convertAudit(output({ exitCode: 1, stdout: dirty }));
    const [broken] = convertAudit(output({ exitCode: 1, stdout: 'npm error' }));

    expect(passed?.draft).toMatchObject({
      name: 'NFR-02: npm audit finds no high or critical advisory',
      status: 'passed',
    });
    expect(failed?.draft.status).toBe('failed');
    expect(failed?.draft.error?.message).toBe('1 high or critical advisory:\ncritical: tar\nmoderate: lodash <4.17.21');
    expect(failed?.draft.parameters).toContainEqual({ name: 'critical', value: '1', measured: true });
    expect(broken?.draft.status).toBe('broken');
  });
});

describe('the coverage converter', () => {
  const summary = JSON.stringify({
    total: { lines: { total: 30, covered: 27, pct: 90 } },
    'C:\\repo\\src\\domain\\a.ts': { lines: { total: 10, covered: 10, pct: 100 } },
    'C:\\repo\\src\\ui\\b.ts': { lines: { total: 10, covered: 7, pct: 70 } },
    'C:\\repo\\scripts\\board-report\\c.ts': { lines: { total: 10, covered: 8, pct: 'Unknown' } },
  });

  it('NFR-13: one result per threshold, with the measured percentage, failing below it', () => {
    const thresholds = thresholdsOf({
      lines: 85,
      'src/domain/**/*.ts': { lines: 95 },
      'scripts/board-report/**/*.ts': { lines: 90 },
      functions: 5,
      perFile: true,
    });
    const results = convertCoverage(summary, thresholds, 'C:/repo', 5);

    expect(thresholds).toEqual([
      { glob: null, lines: 85 },
      { glob: 'src/domain/**/*.ts', lines: 95 },
      { glob: 'scripts/board-report/**/*.ts', lines: 90 },
    ]);
    // 25 of 30 lines overall, 10 of 10 in src/domain, 8 of 10 in scripts/board-report.
    expect(results.map(({ draft }) => [draft.name, draft.status, draft.parameters[0]?.value])).toEqual([
      ['Lines in every covered file ≥ 85 %', 'failed', '83.33 %'],
      ['Lines in src/domain/**/*.ts ≥ 95 %', 'passed', '100 %'],
      ['Lines in scripts/board-report/**/*.ts ≥ 90 %', 'failed', '80 %'],
    ]);
    expect(results[2]?.draft.error).toMatchObject({ expected: '≥ 90 %', actual: '80 %' });
    expect(thresholdsOf(undefined)).toEqual([]);
  });

  it('NFR-13: reads coverage globs like Vitest does', () => {
    expect(globPattern('src/domain/**/*.ts').test('src/domain/a.ts')).toBe(true);
    expect(globPattern('src/domain/**/*.ts').test('src/domain/deep/a.ts')).toBe(true);
    expect(globPattern('src/domain/**/*.ts').test('src/domainx/a.ts')).toBe(false);
    expect(globPattern('src/?.ts').test('src/a.ts')).toBe(true);
    expect(
      convertCoverage(
        JSON.stringify({ total: { lines: { total: 0, covered: 0, pct: 100 } } }),
        [{ glob: 'x/**', lines: 95 }],
        '/',
        1,
      )[0]?.draft.status,
    ).toBe('passed');
  });
});

describe('the k6 converter', () => {
  const summary = (crossed: boolean, fails: number) =>
    JSON.stringify({
      metrics: {
        http_req_duration: { avg: 12.345, 'p(95)': 42.7, thresholds: { 'p(95)<200': crossed } },
        checks: { passes: 99, fails, value: 0.99123, thresholds: { 'rate>0.99': false } },
        iterations: { count: 5 },
      },
      root_group: {
        name: '',
        groups: {
          board: { name: 'board', groups: {}, checks: { 'board is 200': { name: 'board is 200', passes: 99, fails } } },
        },
        checks: {},
      },
    });

  it('NFR-13: one result per threshold and one per check, failing when a threshold was crossed', () => {
    const passing = convertK6(summary(false, 0), 1, 2);
    const failing = convertK6(summary(true, 1), 1, 2);

    expect(passing.map(({ draft }) => [draft.name, draft.status, draft.suites])).toEqual([
      ['NFR-05: http_req_duration p(95)<200', 'passed', ['k6 thresholds']],
      ['NFR-05: checks rate>0.99', 'passed', ['k6 thresholds']],
      ['check: board is 200', 'passed', ['k6 checks', 'board']],
    ]);
    expect(passing[0]?.draft.parameters).toEqual([
      { name: 'avg', value: '12.35', measured: true },
      { name: 'p(95)', value: '42.70', measured: true },
    ]);
    expect(passing[1]?.draft.parameters).toContainEqual({ name: 'value', value: '0.9912', measured: true });
    expect(failing[0]?.draft.status).toBe('failed');
    expect(failing[0]?.draft.error?.actual).toBe('avg=12.35, p(95)=42.70');
    expect(failing[2]?.draft.error?.message).toBe('1 of 100 runs failed the check');
    expect(JSON.parse(String(failing[0]?.attachments[0]?.body))).toHaveProperty('metrics');
  });

  it('NFR-13: converted results are written with their attachments, labelled as performance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-report-k6-'));
    writeConverted(dir, 'perf', convertK6(summary(false, 0), 1, 2));
    const threshold = readResults(dir).find(({ result }) => result.name.startsWith('NFR-05: http_req_duration'));

    expect(threshold?.result.labels).toMatchObject({ testType: 'performance', requirements: ['NFR-05'] });
    expect(readFileSync(join(dir, threshold?.result.attachments[0]?.source ?? ''), 'utf8')).toContain('root_group');
  });

  it('NFR-13: a threshold keeps its history ID from run to run although its measured values change', () => {
    const ids = (text: string) =>
      writeConverted(mkdtempSync(join(tmpdir(), 'board-report-k6-')), 'perf', convertK6(text, 1, 2)).map(
        (result) => result.historyId,
      );

    expect(ids(summary(true, 1))).toEqual(ids(summary(false, 0)));
    expect(ids(summary(false, 0).replace('42.7', '55.1'))).toEqual(ids(summary(false, 0)));
  });
});
