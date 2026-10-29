// board-report's Vitest reporter (PLAN.md Phase 14 task 3), for test types 2 to 6. vitest.config.ts adds it next to
// the default reporter. It keeps every test with its describe blocks as suites, its duration, its error with expected
// and actual and stack, and its console output. It writes only when scripts/board-report.ts names a results folder.
import type { Reporter, SerializedError, TestCase, TestModule } from 'vitest/node';
import { labelResult, stripAnsi } from '../labels.ts';
import { writeResult, type ErrorInfo, type Status, type TestType } from '../result-schema.ts';
import { repoPath, resultsTarget, type ResultsTarget } from '../target.ts';

type ConsoleLog = Parameters<NonNullable<Reporter['onUserConsoleLog']>>[0];

interface VitestError {
  name?: string | undefined;
  message?: string | undefined;
  stack?: string | undefined;
  expected?: string | undefined;
  actual?: string | undefined;
}

/** An assertion that didn't hold is "failed"; anything else thrown is "broken". */
export function statusOfErrors(errors: readonly VitestError[]): Status {
  const assertion = errors.some(
    (error) =>
      error.expected !== undefined || error.actual !== undefined || (error.name ?? '').includes('AssertionError'),
  );
  return assertion ? 'failed' : 'broken';
}

export function errorOf(errors: readonly VitestError[]): ErrorInfo | null {
  const [first] = errors;
  if (first === undefined) return null;
  const message = errors.map((error) => stripAnsi(error.message ?? error.name ?? 'Error')).join('\n\n');
  return {
    message,
    expected: first.expected ?? null,
    actual: first.actual ?? null,
    stack: first.stack === undefined ? null : stripAnsi(first.stack),
  };
}

export class BoardReportVitestReporter implements Reporter {
  private readonly target: ResultsTarget | null;
  private readonly logs = new Map<string, { stdout: string[]; stderr: string[] }>();

  private readonly root: string;

  constructor(env: Readonly<Record<string, string | undefined>> = process.env, root: string = process.cwd()) {
    this.target = resultsTarget(env);
    this.root = root;
  }

  onUserConsoleLog(log: ConsoleLog): void {
    if (this.target === null || log.taskId === undefined) return;
    const output = this.logs.get(log.taskId) ?? { stdout: [], stderr: [] };
    output[log.type].push(log.content);
    this.logs.set(log.taskId, output);
  }

  onTestCaseResult(test: TestCase): void {
    if (this.target === null) return;
    const result = test.result();
    const diagnostic = test.diagnostic();
    const suites: string[] = [];
    for (let parent = test.parent; parent.type === 'suite'; parent = parent.parent) suites.unshift(parent.name);
    const file = repoPath(test.module.moduleId, this.root);
    const errors = result.errors ?? [];
    const status: Status =
      result.state === 'passed' ? 'passed' : result.state === 'failed' ? statusOfErrors(errors) : 'skipped';
    const start = diagnostic?.startTime ?? Date.now();
    const duration = diagnostic?.duration ?? 0;
    const output = this.logs.get(test.id) ?? { stdout: [], stderr: [] };
    this.logs.delete(test.id);
    this.write(file, {
      name: test.name,
      fullName: [...suites, test.name].join(' > '),
      status,
      start,
      stop: start + duration,
      duration,
      file,
      line: test.location?.line ?? null,
      suites: [file, ...suites],
      parameters: [],
      error: status === 'passed' ? null : errorOf(errors),
      steps: [],
      attachments: [],
      stdout: output.stdout,
      stderr: output.stderr,
      retries: Array.from({ length: diagnostic?.retryCount ?? 0 }, () => ({
        status: 'failed' as const,
        duration: 0,
        message: null,
      })),
      labels: { tags: [...(test.options.tags ?? [])], browser: null, worker: null },
    });
  }

  /** A file that couldn't run, or an error outside any test, is a broken result of its own, never lost. */
  onTestRunEnd(modules: readonly TestModule[], unhandled: readonly SerializedError[]): void {
    if (this.target === null) return;
    for (const module of modules) {
      const errors = module.errors();
      if (errors.length === 0) continue;
      const file = repoPath(module.moduleId, this.root);
      this.broken(file, `${file} could not run`, errors);
    }
    if (unhandled.length > 0) this.broken(null, 'Unhandled errors during the run', unhandled);
  }

  private broken(file: string | null, name: string, errors: readonly VitestError[]): void {
    const now = Date.now();
    this.write(file, {
      name,
      fullName: name,
      status: 'broken',
      start: now,
      stop: now,
      duration: 0,
      file,
      line: null,
      suites: [file ?? 'Vitest'],
      parameters: [],
      error: errorOf(errors),
      steps: [],
      attachments: [],
      stdout: [],
      stderr: [],
      retries: [],
      labels: { tags: [], browser: null, worker: null },
    });
  }

  private write(file: string | null, draft: Parameters<typeof labelResult>[0]): void {
    if (this.target === null) return;
    // Real tests get their type from their folder; an error outside any test file takes the step's own type.
    const { step } = this.target;
    const own: TestType =
      step === 'integration' || step === 'api' || step === 'contract' || step === 'security' ? step : 'unit';
    const fallback = !file?.startsWith('tests/') ? { testType: own } : {};
    writeResult(this.target.dir, labelResult({ ...draft, ...fallback }, step));
  }
}
