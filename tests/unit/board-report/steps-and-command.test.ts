import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReportIndex } from '../../../scripts/board-report/build/data-shape.ts';
import {
  ALIASES,
  CommandLineError,
  githubSummary,
  planOf,
  runCommand,
  summaryLines,
  type CommandDeps,
} from '../../../scripts/board-report/command.ts';
import type { CommandOutput } from '../../../scripts/board-report/converters/static.ts';
import { labelResult } from '../../../scripts/board-report/labels.ts';
import {
  readResults,
  STEPS,
  writeResult,
  type Status,
  type Step,
} from '../../../scripts/board-report/result-schema.ts';
import { runStep, type ProcessCommand, type StepContext } from '../../../scripts/board-report/steps.ts';
import { buildFixtureReport } from '../../helpers/board-report-fixture.ts';

// scripts/board-report.ts and its steps (PLAN.md Phase 14 task 8), with a fake runner in place of the real tools,
// like the ProfileRunner of scripts/bdd.ts.

const temp = () => mkdtempSync(join(tmpdir(), 'board-report-steps-'));

function writeTest(dir: string, step: Step, status: Status, file = 'tests/unit/a.test.ts'): void {
  writeResult(
    dir,
    labelResult(
      {
        name: `a ${status} test`,
        fullName: `a ${status} test`,
        status,
        start: 1,
        stop: 2,
        duration: 1,
        file,
        line: null,
        suites: [file],
        parameters: [],
        error: null,
        steps: [],
        attachments: [],
        stdout: [],
        stderr: [],
        retries: [],
        labels: { tags: [], browser: null, worker: null },
      },
      step,
    ),
  );
}

/** The results folder a step hands its runner. */
const resultsOf = (command: ProcessCommand) => command.env['BOARD_REPORT_RESULTS'] ?? '';

type Play = (command: ProcessCommand) => Partial<CommandOutput>;

function context(step: Step, play: Play, overrides: Partial<StepContext> = {}) {
  const root = temp();
  const dir = join(root, 'reports', 'test-results', step);
  const commands: ProcessCommand[] = [];
  const log: string[] = [];
  const value: StepContext = {
    step,
    dir,
    root,
    extraArgs: [],
    processes: {
      run(command) {
        commands.push(command);
        return Promise.resolve({
          command: command.args.join(' '),
          exitCode: 0,
          stdout: '',
          stderr: '',
          start: 1,
          stop: 2,
          ...play(command),
        });
      },
    },
    thresholds: () => Promise.resolve([{ glob: null, lines: 85 }]),
    perfApp: null,
    log: (line) => log.push(line),
    ...overrides,
  };
  return { value, commands, log, dir, root };
}

const MESSAGES = [
  {
    gherkinDocument: {
      uri: 'tests/features/api/notes.feature',
      feature: {
        name: 'Notes',
        children: [
          {
            scenario: {
              id: 's',
              name: 'A note',
              location: { line: 3 },
              steps: [{ id: 'g', keyword: 'Given ', location: { line: 4 } }],
              examples: [],
            },
          },
        ],
      },
    },
  },
  {
    pickle: {
      id: 'p',
      uri: 'tests/features/api/notes.feature',
      name: 'A note',
      astNodeIds: ['s'],
      tags: [{ name: '@FR-09' }],
      steps: [{ id: 'ps', text: 'a job', astNodeIds: ['g'] }],
    },
  },
  { testCase: { id: 'c', pickleId: 'p', testSteps: [{ id: 't', pickleStepId: 'ps' }] } },
  { testCaseStarted: { id: 'r', testCaseId: 'c', attempt: 0, timestamp: { seconds: 1, nanos: 0 } } },
  {
    testStepFinished: {
      testCaseStartedId: 'r',
      testStepId: 't',
      testStepResult: { status: 'PASSED', duration: { seconds: 0, nanos: 0 } },
    },
  },
  { testCaseFinished: { testCaseStartedId: 'r', timestamp: { seconds: 2, nanos: 0 }, willBeRetried: false } },
]
  .map((envelope) => JSON.stringify(envelope))
  .join('\n');

describe('the steps', () => {
  it('NFR-13: each step runs its own runner, with the results folder and step in the environment', async () => {
    const runs: Record<string, string[]> = {};
    for (const step of ['unit', 'contract', 'e2e', 'smoke', 'bdd-e2e', 'bdd-smoke'] as const) {
      const { value, commands, dir } = context(step, (command) => {
        writeTest(
          resultsOf(command),
          step,
          'passed',
          step.startsWith('bdd')
            ? 'tests/features/e2e/a.feature'
            : step === 'e2e' || step === 'smoke'
              ? 'tests/e2e/a.spec.ts'
              : `tests/${step}/a.test.ts`,
        );
        return {};
      });
      value.extraArgs = ['--extra'];
      expect(await runStep(value)).toEqual({ step, ok: true });
      expect(commands[0]?.env).toEqual({ BOARD_REPORT_RESULTS: dir, BOARD_REPORT_STEP: step });
      runs[step] = commands[0]?.args.slice(1).map((arg) => arg.replaceAll('\\', '/')) ?? [];
    }

    expect(runs).toEqual({
      unit: ['run', '--project', 'unit', '--extra'],
      contract: ['run', '--project', 'contract', '--extra'],
      e2e: ['test', '--extra'],
      smoke: ['test', '--grep', '@smoke', '--project', 'chromium', '--extra'],
      'bdd-e2e': ['e2e', '--extra'],
      'bdd-smoke': ['smoke', '--extra'],
    });
  });

  it('NFR-13: the static step runs tsc twice, ESLint, Prettier and npm audit, and turns their output into results', async () => {
    const audit = JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { high: 0, critical: 0 } } });
    const { value, commands, log, dir } = context('static', (command) => {
      const args = command.args.join(' ');
      if (args.includes('eslint'))
        return {
          exitCode: 1,
          stdout: JSON.stringify([
            {
              filePath: 'src/a.ts',
              messages: [{ ruleId: 'no-console', severity: 2, message: 'no', line: 1, column: 1 }],
            },
          ]),
        };
      if (args.includes('audit')) return { stdout: audit };
      return {};
    });
    const run = await runStep(value);
    const results = readResults(dir).map(({ result }) => [result.name, result.status]);

    expect(run.ok).toBe(false);
    expect(commands.map((command) => command.args.at(-1))).toEqual(['--noEmit', 'tests/perf', 'json', '.', '--json']);
    expect(commands.every((command) => command.capture)).toBe(true);
    expect(results).toHaveLength(5);
    expect(results).toContainEqual(['ESLint: src/a.ts', 'failed']);
    expect(results).toContainEqual(['NFR-02: npm audit finds no high or critical advisory', 'passed']);
    expect(log).toContain('  ✘ eslint: 1 checked, 1 failing');
    expect(log).toContain('  ✔ tsc: 1 checked, 0 failing');
  });

  it('NFR-13: the coverage step runs every project with coverage and turns a fresh summary into threshold results', async () => {
    const { value, commands, dir, root } = context('coverage', (command) => {
      writeTest(resultsOf(command), 'coverage', 'passed', 'tests/api/a.test.ts');
      mkdirSync(join(root, 'coverage'), { recursive: true });
      writeFileSync(
        join(root, 'coverage', 'coverage-summary.json'),
        JSON.stringify({
          total: { lines: { total: 10, covered: 9, pct: 90 } },
          [`${root}/src/a.ts`]: { lines: { total: 10, covered: 9, pct: 90 } },
        }),
      );
      return {};
    });
    await runStep(value);
    const results = readResults(dir).map(({ result }) => [result.name, result.labels.testType]);

    expect(commands[0]?.args.slice(1)).toEqual(['run', '--coverage']);
    expect(results).toContainEqual(['Lines in every covered file ≥ 85 %', 'coverage']);
    expect(results).toContainEqual(['a passed test', 'api']);
  });

  it('NFR-13: a coverage summary older than the run is not reported', async () => {
    const { value, dir, root } = context('coverage', (command) => {
      writeTest(resultsOf(command), 'coverage', 'passed');
      return {};
    });
    mkdirSync(join(root, 'coverage'));
    writeFileSync(join(root, 'coverage', 'coverage-summary.json'), '{}');
    utimesSync(join(root, 'coverage', 'coverage-summary.json'), new Date(0), new Date(0));
    await runStep(value);

    expect(readResults(dir).map(({ result }) => result.name)).toEqual(['a passed test']);
  });

  it('NFR-13: a BDD step turns each profile’s messages into results, and unreadable messages into a broken one', async () => {
    const { value, dir } = context('bdd-api', (command) => {
      const results = resultsOf(command);
      mkdirSync(join(results, 'api'), { recursive: true });
      mkdirSync(join(results, 'broken-profile'), { recursive: true });
      mkdirSync(join(results, 'empty-profile'), { recursive: true });
      writeFileSync(join(results, 'api', 'messages.ndjson'), MESSAGES);
      writeFileSync(join(results, 'broken-profile', 'messages.ndjson'), 'not json');
      return {};
    });
    await runStep(value);
    const results = readResults(dir).map(({ result }) => [result.name, result.status, result.labels.testType]);

    expect(results).toContainEqual(['A note', 'passed', 'bdd-api']);
    expect(results).toContainEqual(['Cucumber broken-profile: the messages could not be read', 'broken', 'bdd-api']);
  });

  it('NFR-13: the perf step runs k6 with a summary export and turns it into results', async () => {
    const summary = JSON.stringify({
      metrics: { http_req_duration: { 'p(95)': 40, thresholds: { 'p(95)<200': false } } },
      root_group: { name: '', groups: {}, checks: {} },
    });
    let closed = false;
    const { value, commands, dir } = context(
      'perf',
      (command) => {
        writeFileSync(command.args[2] ?? '', summary);
        return {};
      },
      {
        perfApp: () =>
          Promise.resolve({
            url: 'http://127.0.0.1:4567',
            close: () => {
              closed = true;
              return Promise.resolve();
            },
          }),
      },
    );
    expect((await runStep(value)).ok).toBe(true);

    expect(commands[0]).toMatchObject({ program: 'k6', env: { BASE_URL: 'http://127.0.0.1:4567' } });
    expect(commands[0]?.args.at(-1)).toBe('tests/perf/load.ts');
    expect(closed).toBe(true);
    expect(readResults(dir).map(({ result }) => result.name)).toEqual(['NFR-05: http_req_duration p(95)<200']);
  });

  it('NFR-13: without k6 the perf step is broken with that reason, and the command fails', async () => {
    const { value, dir } = context('perf', () => ({ exitCode: null }));
    const run = await runStep(value);
    const results = readResults(dir).map(({ result }) => result);

    expect(run.ok).toBe(false);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'broken', labels: { testType: 'performance' } });
    expect(results[0]?.error?.message).toContain('k6 is not installed');
  });

  it('NFR-13: a failed command with no failing result to show for it gets a broken result; one with a failure does not', async () => {
    const silent = context('e2e', () => ({ exitCode: 1 }));
    const explained = context('unit', (command) => {
      writeTest(resultsOf(command), 'unit', 'failed');
      return { exitCode: 1 };
    });
    await runStep(silent.value);
    await runStep(explained.value);

    expect(readResults(silent.dir).map(({ result }) => [result.name, result.status, result.labels.testType])).toEqual([
      ['The e2e step failed', 'broken', 'e2e'],
    ]);
    expect(readResults(explained.dir).map(({ result }) => result.name)).toEqual(['a failed test']);
  });

  it('NFR-13: a step that passes but leaves no results is broken', async () => {
    const { value, dir } = context('security', () => ({}));
    const run = await runStep(value);

    expect(run.ok).toBe(false);
    expect(readResults(dir).map(({ result }) => [result.name, result.labels.testType])).toEqual([
      ['The security step left no results', 'security'],
    ]);
  });
});

describe('the command', () => {
  it('NFR-13: reads steps, aliases and extra arguments from the command line', () => {
    expect(planOf(['unit'])).toEqual({ steps: ['unit'], extraArgs: [], managedPerf: false, buildOnly: false });
    expect(planOf(['e2e', 'tests/e2e/board.spec.ts', '--project', 'chromium'])).toMatchObject({
      steps: ['e2e'],
      extraArgs: ['tests/e2e/board.spec.ts', '--project', 'chromium'],
    });
    expect(planOf(['all'])).toMatchObject({ steps: ALIASES['all'], managedPerf: true });
    expect(planOf(['bdd'])).toMatchObject({ steps: ['bdd-integration', 'bdd-api', 'bdd-e2e'], managedPerf: false });
    expect(planOf(['perf'])).toMatchObject({ steps: ['perf'], managedPerf: false });
    expect(planOf(['build'])).toMatchObject({ buildOnly: true });
    expect(() => planOf([])).toThrow(CommandLineError);
    expect(() => planOf(['nope'])).toThrow(CommandLineError);
    expect(() => planOf(['bdd', '--name', 'x'])).toThrow(/exactly one step/);
    expect(() => planOf(['build', 'x'])).toThrow(CommandLineError);
  });

  it('NFR-13: `all` covers every test type: static, coverage, E2E, smoke, every BDD suite and perf', () => {
    expect(ALIASES['all']).toEqual([
      'static',
      'coverage',
      'e2e',
      'smoke',
      'bdd-integration',
      'bdd-api',
      'bdd-e2e',
      'bdd-smoke',
      'perf',
    ]);
    expect(STEPS.filter((step) => !(ALIASES['all'] ?? []).includes(step))).toEqual([
      'unit',
      'integration',
      'api',
      'contract',
      'security',
    ]);
  });

  const index = (failed: number): ReportIndex => {
    const built = buildFixtureReport(join(temp(), 'report')).index;
    return { ...built, totals: { ...built.totals, failed, broken: 0 } };
  };

  function deps(stepResult: (step: Step) => boolean, failed: number, append = false) {
    const calls: string[] = [];
    const value: CommandDeps = {
      append,
      clean: () => calls.push('clean'),
      runStep: (step: Step) => {
        calls.push(`run ${step}`);
        return Promise.resolve({ step, ok: stepResult(step) });
      },
      build: () => {
        calls.push('build');
        return index(failed);
      },
      log: () => undefined,
    };
    return { value, calls };
  }

  it('NFR-13: empties the results first, runs every step even after a failure, builds the report and keeps the failing exit code', async () => {
    const { value, calls } = deps((step) => step !== 'static', 0);
    const code = await runCommand(planOf(['static', 'coverage']), value);

    expect(calls).toEqual(['clean', 'run static', 'run coverage', 'build']);
    expect(code).toBe(1);
  });

  it('NFR-13: fails when the report holds a failure even if every step exited 0, and passes when all is green', async () => {
    expect(await runCommand(planOf(['unit']), deps(() => true, 2).value)).toBe(1);
    expect(await runCommand(planOf(['unit']), deps(() => true, 0).value)).toBe(0);
  });

  it('NFR-13: with BOARD_REPORT_APPEND=1 it neither empties the results nor builds a report', async () => {
    const failing = deps(() => false, 0, true);
    const passing = deps(() => true, 0, true);

    expect(await runCommand(planOf(['unit']), failing.value)).toBe(1);
    expect(failing.calls).toEqual(['run unit']);
    expect(await runCommand(planOf(['unit']), passing.value)).toBe(0);
  });

  it('NFR-13: `build` only builds a report from the results that are there', async () => {
    const { value, calls } = deps(() => true, 3);

    expect(await runCommand(planOf(['build']), value)).toBe(0);
    expect(calls).toEqual(['build']);
  });

  it('NFR-13: the summary lists totals by type, the failures by name and where the report is', () => {
    const built = buildFixtureReport(join(temp(), 'report')).index;
    const sample = built.tests[1];
    if (sample === undefined) throw new Error('the fixture has fewer than two tests');
    const lines = summaryLines(built);
    const many = summaryLines({
      ...built,
      tests: Array.from({ length: 25 }, (_, n) => ({
        ...sample,
        id: String(n),
        name: `failing ${String(n)}`,
        status: 'failed' as const,
      })),
    });

    expect(lines[1]).toBe('board-report: 6 failed of 20');
    expect(lines).toContain('  ✘ Unit                 1 passed, 1 failed, 1 skipped');
    expect(lines).toContain('  ✘ [E2E, Chromium] FR-07, FR-08: save a job from the board');
    expect(lines.at(-1)).toBe('Report: reports/board-report/index.html (open it with `npm run report`)');
    expect(many).toContain('  … and 5 more');
  });

  it('NFR-13: the GitHub summary has the totals by type and every failure, with pipes escaped', () => {
    const built = buildFixtureReport(join(temp(), 'report')).index;
    const markdown = githubSummary(built);
    const clean = githubSummary({ ...built, tests: built.tests.filter((test) => test.status === 'passed') });

    expect(markdown).toContain('## board-report: 6 failed of 20');
    expect(markdown).toContain('| Unit | 1 | 1 | 0 | 1 |');
    expect(markdown).toContain(
      '- ❌ **Accessibility** (Pixel 7): NFR-06: the board has no axe violations — expect(received).toEqual(expected)',
    );
    expect(
      githubSummary({
        ...built,
        tests: built.tests
          .slice(1, 2)
          .map((test) => ({ ...test, name: 'a | b', status: 'failed' as const, errorLine: null })),
      }),
    ).toContain('a \\| b');
    expect(clean).toContain('No failures.');
  });
});
