// What one board-report command does (PLAN.md Phase 14 task 8, option 1 of DEC-058): empty the results, run every
// step named one after another (all of them, even after a failure), build the report even when tests failed, print a
// short summary and exit with the tests' result. With BOARD_REPORT_APPEND=1 (CI) it neither empties the results nor
// builds a report; `build` builds one from whatever results are there.
import type { ReportIndex } from './build/data-shape.ts';
import { headline, TYPE_INFO } from './build/build.ts';
import { totalsOf, type Totals } from './history.ts';
import { isFailing, Step, STEPS, TEST_TYPES, type TestType } from './result-schema.ts';
import type { StepRun } from './steps.ts';

/** Names that stand for several steps. `all` is one run of every test type (`npm run test:all`). */
export const ALIASES: Readonly<Record<string, readonly Step[]>> = {
  all: ['static', 'coverage', 'e2e', 'smoke', 'bdd-integration', 'bdd-api', 'bdd-e2e', 'bdd-smoke', 'perf'],
  bdd: ['bdd-integration', 'bdd-api', 'bdd-e2e'],
};

export interface CommandPlan {
  steps: Step[];
  /** Passed on to the runner of the one step named, as `npm run test:unit -- tests/unit/x.test.ts`. */
  extraArgs: string[];
  /** `all` starts its own app on seeded jobs for k6; `perf` alone uses the app the owner started (Phase 7). */
  managedPerf: boolean;
  buildOnly: boolean;
}

export class CommandLineError extends Error {
  override name = 'CommandLineError';
}

export function planOf(argv: readonly string[]): CommandPlan {
  if (argv[0] === 'build') {
    if (argv.length > 1) throw new CommandLineError('`build` takes no other argument');
    return { steps: [], extraArgs: [], managedPerf: false, buildOnly: true };
  }
  const steps: Step[] = [];
  let index = 0;
  let managedPerf = false;
  for (; index < argv.length; index += 1) {
    const name = argv[index] ?? '';
    const alias = ALIASES[name];
    const step = Step.safeParse(name);
    if (alias !== undefined) {
      steps.push(...alias);
      managedPerf ||= name === 'all';
    } else if (step.success) steps.push(step.data);
    else break;
  }
  const extraArgs = argv.slice(index);
  if (steps.length === 0) {
    throw new CommandLineError(`name a step (${STEPS.join(', ')}), ${Object.keys(ALIASES).join(' or ')}, or build`);
  }
  if (extraArgs.length > 0 && steps.length > 1) {
    throw new CommandLineError(
      `extra arguments (${extraArgs.join(' ')}) need exactly one step, not ${steps.join(', ')}`,
    );
  }
  return { steps, extraArgs, managedPerf, buildOnly: false };
}

export interface CommandDeps {
  append: boolean;
  /** Empties reports/test-results/. */
  clean(): void;
  runStep(step: Step, plan: CommandPlan): Promise<StepRun>;
  /** Builds reports/board-report/ and adds the run to the history. */
  build(): ReportIndex;
  log(line: string): void;
}

export async function runCommand(plan: CommandPlan, deps: CommandDeps): Promise<number> {
  if (plan.buildOnly) {
    const index = deps.build();
    for (const line of summaryLines(index)) deps.log(line);
    return 0;
  }
  if (!deps.append) deps.clean();
  const failedSteps: Step[] = [];
  for (const step of plan.steps) {
    deps.log(`\n▶ board-report: ${step}`);
    const run = await deps.runStep(step, plan);
    if (!run.ok) failedSteps.push(step);
  }
  if (deps.append) {
    deps.log(`\nboard-report: results kept in reports/test-results/ (BOARD_REPORT_APPEND=1, no report built)`);
  } else {
    const index = deps.build();
    for (const line of summaryLines(index)) deps.log(line);
    if (index.totals.failed + index.totals.broken > 0 && failedSteps.length === 0) return 1;
  }
  if (failedSteps.length > 0) deps.log(`board-report: failed steps: ${failedSteps.join(', ')}`);
  return failedSteps.length > 0 ? 1 : 0;
}

const FAILURES_SHOWN = 20;

/** Each test type that has tests in the report, in the report's order, with its totals. */
function totalsByType(index: ReportIndex): { type: TestType; totals: Totals }[] {
  return TEST_TYPES.flatMap((type) => {
    const tests = index.tests.filter((test) => test.type === type);
    return tests.length === 0 ? [] : [{ type, totals: totalsOf(tests) }];
  });
}

/** The short summary printed after a run: totals by type, the failures by name, and where the report is. */
export function summaryLines(index: ReportIndex): string[] {
  const lines = ['', `board-report: ${headline(index)}`];
  for (const { type, totals } of totalsByType(index)) {
    const failing = totals.failed + totals.broken;
    lines.push(
      `  ${failing === 0 ? '✔' : '✘'} ${TYPE_INFO[type].title.padEnd(16)} ${String(totals.passed).padStart(5)} passed` +
        (failing === 0 ? '' : `, ${String(failing)} failed`) +
        (totals.skipped === 0 ? '' : `, ${String(totals.skipped)} skipped`),
    );
  }
  const failures = index.tests.filter((test) => isFailing(test.status));
  if (failures.length > 0) {
    lines.push('', 'Failures:');
    for (const test of failures.slice(0, FAILURES_SHOWN)) {
      lines.push(`  ✘ [${TYPE_INFO[test.type].title}${test.browser === null ? '' : `, ${test.browser}`}] ${test.name}`);
    }
    if (failures.length > FAILURES_SHOWN) lines.push(`  … and ${String(failures.length - FAILURES_SHOWN)} more`);
  }
  lines.push('', 'Report: reports/board-report/index.html (open it with `npm run report`)');
  return lines;
}

/** The run's totals by type and its failures, for the GitHub Actions summary page (PLAN.md Phase 14 task 12). */
export function githubSummary(index: ReportIndex): string {
  const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
  const rows = totalsByType(index).map(
    ({ type, totals }) =>
      `| ${TYPE_INFO[type].title} | ${String(totals.passed)} | ${String(totals.failed)} | ${String(totals.broken)} | ${String(totals.skipped)} |`,
  );
  const failures = index.tests
    .filter((test) => isFailing(test.status))
    .map(
      (test) =>
        `- ❌ **${cell(TYPE_INFO[test.type].title)}**${test.browser === null ? '' : ` (${test.browser})`}: ${cell(test.name)}${test.errorLine === null ? '' : ` — ${cell(test.errorLine).slice(0, 200)}`}`,
    );
  return [
    `## board-report: ${headline(index)}`,
    '',
    '| Test type | Passed | Failed | Broken | Skipped |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...(failures.length === 0 ? ['No failures.'] : ['### Failures', '', ...failures]),
    '',
    'Download the `board-report` artifact and open `index.html`.',
    '',
  ].join('\n');
}
