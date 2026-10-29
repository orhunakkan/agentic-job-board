// The steps of scripts/board-report.ts (PLAN.md Phase 14 task 8): what each one runs and how its output becomes
// results in reports/test-results/<step>/. Vitest and Playwright write their own results through board-report's
// reporters; the static checks, Cucumber, coverage and k6 are converted here once their command is done. A step whose
// command fails without a failing result to show for it gets a broken result, so a run that couldn't start is never
// missing from the report.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { convertCucumber } from './converters/cucumber.ts';
import { convertCoverage, type Threshold } from './converters/coverage.ts';
import { convertK6 } from './converters/k6.ts';
import { convertAudit, convertEslint, convertPrettier, convertTsc, type CommandOutput } from './converters/static.ts';
import { plainDraft, writeConverted, type Converted } from './converters/write.ts';
import { readResults, type Step, type TestType } from './result-schema.ts';
import { RESULTS_ENV, STEP_ENV } from './target.ts';

export interface ProcessCommand {
  program: string;
  args: string[];
  env: Record<string, string>;
  /** Keep the output for a converter instead of showing it on the console. */
  capture: boolean;
}

export interface ProcessRunner {
  run(command: ProcessCommand): Promise<CommandOutput>;
}

export interface PerfApp {
  url: string;
  close(): Promise<void>;
}

export interface StepContext {
  step: Step;
  /** reports/test-results/<step>/ */
  dir: string;
  root: string;
  /** Arguments for the runner, as `npm run test:unit -- <file>` passes them. */
  extraArgs: string[];
  processes: ProcessRunner;
  /** The coverage thresholds of vitest.config.ts. */
  thresholds: () => Promise<Threshold[]>;
  /** Only for `test:all`: an app on 5,000 seeded jobs for k6 (PLAN.md Phase 14 task 8). */
  perfApp: (() => Promise<PerfApp>) | null;
  log: (line: string) => void;
}

export interface StepRun {
  step: Step;
  /** True when every command of the step exited with 0. */
  ok: boolean;
}

const VITEST = 'node_modules/vitest/vitest.mjs';
const PLAYWRIGHT = 'node_modules/@playwright/test/cli.js';
const TSC = 'node_modules/typescript/bin/tsc';
const ESLINT = 'node_modules/eslint/bin/eslint.js';
const PRETTIER = 'node_modules/prettier/bin/prettier.cjs';

/** The type a broken "the step failed" result gets when it has no test of its own to blame. */
const TYPE_OF_STEP: Record<Step, TestType> = {
  static: 'static',
  unit: 'unit',
  integration: 'integration',
  api: 'api',
  contract: 'contract',
  security: 'security',
  coverage: 'coverage',
  e2e: 'e2e',
  smoke: 'smoke',
  'bdd-integration': 'bdd-integration',
  'bdd-api': 'bdd-api',
  'bdd-e2e': 'bdd-e2e',
  'bdd-smoke': 'bdd-smoke',
  perf: 'performance',
};

export async function runStep(context: StepContext): Promise<StepRun> {
  mkdirSync(context.dir, { recursive: true });
  const started = Date.now();
  const outputs = await runCommands(context);
  if (!outputs.every((output) => output.exitCode === 0)) {
    addBrokenIfNothingFailed(context, outputs, started);
    return { step: context.step, ok: false };
  }
  // Every runner fails a run with no tests, so a passing step without results means its results were lost.
  if (readResults(context.dir).length === 0) {
    writeBroken(
      context,
      `The ${context.step} step left no results`,
      'Its commands passed, but no test result was written.',
      started,
    );
    return { step: context.step, ok: false };
  }
  return { step: context.step, ok: true };
}

function node(context: StepContext, script: string, args: readonly string[], capture = false): ProcessCommand {
  return {
    program: process.execPath,
    args: [join(context.root, script), ...args],
    env: { [RESULTS_ENV]: context.dir, [STEP_ENV]: context.step },
    capture,
  };
}

async function runCommands(context: StepContext): Promise<CommandOutput[]> {
  const { step, processes, extraArgs } = context;
  switch (step) {
    case 'unit':
    case 'integration':
    case 'api':
    case 'contract':
    case 'security':
      return [await processes.run(node(context, VITEST, ['run', '--project', step, ...extraArgs]))];
    case 'bdd-integration':
    case 'bdd-api':
    case 'bdd-e2e':
    case 'bdd-smoke': {
      const suite = step.slice('bdd-'.length);
      const output = await processes.run(node(context, 'scripts/bdd.ts', [suite, ...extraArgs]));
      convertMessages(context);
      return [output];
    }
    case 'static':
      return runStatic(context);
    case 'coverage':
      return [await runCoverage(context)];
    case 'e2e':
      return [await processes.run(node(context, PLAYWRIGHT, ['test', ...extraArgs]))];
    case 'smoke':
      return [
        await processes.run(
          node(context, PLAYWRIGHT, ['test', '--grep', '@smoke', '--project', 'chromium', ...extraArgs]),
        ),
      ];
    case 'perf':
      return [await runPerf(context)];
  }
}

async function runStatic(context: StepContext): Promise<CommandOutput[]> {
  const { processes, root } = context;
  const steps: [string, ProcessCommand, (output: CommandOutput) => Converted[]][] = [
    ['tsc', node(context, TSC, ['--noEmit'], true), (output) => convertTsc('tsconfig.json', output)],
    [
      'tsc perf',
      node(context, TSC, ['--noEmit', '-p', 'tests/perf'], true),
      (output) => convertTsc('tests/perf/tsconfig.json', output),
    ],
    [
      'eslint',
      node(
        context,
        ESLINT,
        ['.', '--max-warnings', '0', '--flag', 'unstable_native_nodejs_ts_config', '--format', 'json'],
        true,
      ),
      (output) => convertEslint(output, root),
    ],
    ['prettier', node(context, PRETTIER, ['--check', '.'], true), convertPrettier],
    ['npm audit', npm(['audit', '--audit-level=high', '--json']), convertAudit],
  ];
  const outputs: CommandOutput[] = [];
  for (const [label, command, convert] of steps) {
    const output = await processes.run(command);
    const results = writeConverted(context.dir, 'static', convert(output));
    const failing = results.filter((result) => result.status === 'failed' || result.status === 'broken').length;
    context.log(
      `  ${output.exitCode === 0 ? '✔' : '✘'} ${label}: ${String(results.length)} checked, ${String(failing)} failing`,
    );
    outputs.push(output);
  }
  return outputs;
}

/** npm from the npm that runs this script, or from the PATH (through cmd on Windows, where npm is a .cmd file). */
function npm(args: string[]): ProcessCommand {
  const cli = process.env['npm_execpath'];
  if (cli !== undefined && /\.c?js$/.test(cli))
    return { program: process.execPath, args: [cli, ...args], env: {}, capture: true };
  return { program: process.platform === 'win32' ? 'npm.cmd' : 'npm', args, env: {}, capture: true };
}

async function runCoverage(context: StepContext): Promise<CommandOutput> {
  const started = Date.now();
  const output = await context.processes.run(node(context, VITEST, ['run', '--coverage', ...context.extraArgs]));
  const summary = join(context.root, 'coverage', 'coverage-summary.json');
  // A summary older than this run would report the coverage of another one.
  if (existsSync(summary) && statSync(summary).mtimeMs >= started - 1000) {
    writeConverted(
      context.dir,
      'coverage',
      convertCoverage(readFileSync(summary, 'utf8'), await context.thresholds(), context.root, Date.now()),
    );
  }
  return output;
}

/** Each profile's messages, written by scripts/bdd.ts to reports/test-results/<step>/<profile>/messages.ndjson. */
function convertMessages(context: StepContext): void {
  for (const profile of readdirSync(context.dir).sort()) {
    const file = join(context.dir, profile, 'messages.ndjson');
    if (!existsSync(file)) continue;
    try {
      writeConverted(join(context.dir, profile), context.step, convertCucumber(readFileSync(file, 'utf8'), profile));
    } catch (error) {
      writeBroken(context, `Cucumber ${profile}: the messages could not be read`, String(error), Date.now());
    }
  }
}

async function runPerf(context: StepContext): Promise<CommandOutput> {
  const summary = join(context.dir, 'k6-summary.json');
  rmSync(summary, { force: true });
  const app = context.perfApp === null ? null : await context.perfApp();
  const started = Date.now();
  let output: CommandOutput;
  try {
    output = await context.processes.run({
      program: 'k6',
      args: ['run', '--summary-export', summary, ...context.extraArgs, 'tests/perf/load.ts'],
      env: app === null ? {} : { BASE_URL: app.url },
      capture: false,
    });
  } finally {
    await app?.close();
  }
  if (output.exitCode === null) {
    writeBroken(
      context,
      'k6 load test',
      'k6 is not installed (install it with `winget install k6`), so the load test could not run',
      started,
    );
  } else if (existsSync(summary)) {
    writeConverted(context.dir, 'perf', convertK6(readFileSync(summary, 'utf8'), started, Date.now()));
  }
  return output;
}

function addBrokenIfNothingFailed(context: StepContext, outputs: readonly CommandOutput[], started: number): void {
  const failing = readResults(context.dir).some(
    ({ result }) => result.status === 'failed' || result.status === 'broken',
  );
  if (failing) return;
  const failed = outputs.filter((output) => output.exitCode !== 0);
  const reason = failed
    .map(
      (output) =>
        `${output.command} ${output.exitCode === null ? 'could not be started' : `exited with ${String(output.exitCode)}`}`,
    )
    .join('\n');
  writeBroken(
    context,
    `The ${context.step} step failed`,
    `${reason}\nNo test result explains it: see the command's output above it in the console.`,
    started,
  );
}

function writeBroken(context: StepContext, name: string, message: string, started: number): void {
  writeConverted(context.dir, context.step, [
    {
      draft: plainDraft({
        name,
        suites: [`${context.step} step`],
        status: 'broken',
        start: started,
        stop: Date.now(),
        error: { message, expected: null, actual: null, stack: null },
        testType: TYPE_OF_STEP[context.step],
      }),
      attachments: [],
    },
  ]);
}
