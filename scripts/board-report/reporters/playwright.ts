// board-report's Playwright reporter (PLAN.md Phase 14 task 3), for test types 7 to 9. playwright.config.ts adds it
// next to `list` and `html`. It keeps the browser project, every step nested as Playwright reports them (its own
// actions, expect and test.step), the screenshot, video and trace files, stdout and stderr, the tags and every
// attachment a test adds. It writes only when scripts/board-report.ts names a results folder.
import { existsSync } from 'node:fs';
import type {
  FullConfig,
  Reporter,
  TestCase,
  TestError,
  TestResult as PlaywrightResult,
  TestStep as PlaywrightStep,
} from '@playwright/test/reporter';
import { expectedAndActual, labelResult, stripAnsi } from '../labels.ts';
import {
  attachmentSource,
  writeResult,
  type Attachment,
  type AttachmentFile,
  type ErrorInfo,
  type Status,
  type TestStep,
} from '../result-schema.ts';
import { repoPath, resultsTarget, type ResultsTarget } from '../target.ts';

export const BROWSER_OF_PROJECT: Readonly<Record<string, string>> = {
  chromium: 'Chromium',
  firefox: 'Firefox',
  webkit: 'WebKit',
  mobile: 'Pixel 7',
  'board-actions': 'Chromium',
};

export function errorInfo(error: TestError | undefined): ErrorInfo | null {
  if (error === undefined) return null;
  const message = stripAnsi(error.message ?? error.value ?? 'Error');
  const stack = error.stack === undefined ? null : stripAnsi(error.stack);
  return { message, ...expectedAndActual(message), stack };
}

/** A failed expect is an assertion that didn't hold; a timeout, a crash or an interrupted run is broken. */
export function statusOf(test: Pick<TestCase, 'outcome'>, result: Pick<PlaywrightResult, 'status' | 'error'>): Status {
  const outcome = test.outcome();
  if (outcome === 'skipped') return 'skipped';
  if (outcome === 'expected' || outcome === 'flaky') return 'passed';
  if (result.status === 'failed' && stripAnsi(result.error?.message ?? '').includes('expect(')) return 'failed';
  if (result.status === 'passed') return 'failed'; // marked test.fail() but passed
  return 'broken';
}

function stepStatus(step: PlaywrightStep): Status {
  if (step.error === undefined) return 'passed';
  // A test.step that a failed expect inside it ended failed with it, like the test.
  const assertion = step.category === 'expect' || stripAnsi(step.error.message ?? '').includes('expect(');
  return assertion ? 'failed' : 'broken';
}

function text(chunks: readonly (string | Buffer)[]): string[] {
  return chunks.map((chunk) => (typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
}

export class BoardReportPlaywrightReporter implements Reporter {
  private readonly target: ResultsTarget | null;
  private readonly runs = new Map<TestCase, PlaywrightResult[]>();
  private root: string;

  /** Playwright passes the reporter's options from the config first; this reporter takes none, so only `env` counts. */
  constructor(...[, env = process.env]: [options?: unknown, env?: Readonly<Record<string, string | undefined>>]) {
    this.target = resultsTarget(env);
    this.root = process.cwd();
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig): void {
    // The config file's folder is the repository root, so paths in the results are relative to it.
    this.root = config.configFile === undefined ? config.rootDir : config.configFile.replace(/[\\/][^\\/]+$/, '');
  }

  onTestEnd(test: TestCase, result: PlaywrightResult): void {
    if (this.target === null) return;
    this.runs.set(test, [...(this.runs.get(test) ?? []), result]);
  }

  /** Each test once, after its last attempt; earlier attempts become its retries. */
  onEnd(): void {
    if (this.target === null) return;
    for (const [test, attempts] of this.runs) {
      const last = attempts.at(-1);
      if (last !== undefined) this.write(this.target, test, last, attempts.slice(0, -1));
    }
  }

  private write(target: ResultsTarget, test: TestCase, result: PlaywrightResult, earlier: PlaywrightResult[]): void {
    const project = test.parent.project()?.name ?? 'unknown';
    const file = repoPath(test.location.file, this.root);
    // titlePath: '', project, file, the describe blocks, the test.
    const describes = test.titlePath().slice(3, -1);
    const status = statusOf(test, result);
    const draft = labelResult(
      {
        name: test.title,
        fullName: [...describes, test.title].join(' > '),
        status,
        start: result.startTime.getTime(),
        stop: result.startTime.getTime() + result.duration,
        duration: result.duration,
        file,
        line: test.location.line,
        suites: [file, ...describes],
        parameters: [],
        error: status === 'passed' || status === 'skipped' ? null : errorInfo(result.error),
        steps: [],
        attachments: [],
        stdout: text(result.stdout),
        stderr: text(result.stderr),
        retries: earlier.map((attempt) => ({
          status: statusOf({ outcome: () => 'unexpected' }, attempt),
          duration: attempt.duration,
          message:
            attempt.error?.message === undefined ? null : (stripAnsi(attempt.error.message).split('\n')[0] ?? null),
        })),
        labels: {
          tags: [...test.tags],
          browser: BROWSER_OF_PROJECT[project] ?? project,
          worker: `worker ${String(result.parallelIndex)}`,
        },
      },
      target.step,
    );

    const files = new Map<string, AttachmentFile>();
    const sources = new Map<PlaywrightResult['attachments'][number], Attachment>();
    result.attachments.forEach((attachment, index) => {
      if (attachment.path === undefined ? attachment.body === undefined : !existsSync(attachment.path)) return;
      const source = attachmentSource(draft.id, index, attachment.name, attachment.contentType, attachment.path);
      files.set(source, attachment.path === undefined ? { body: attachment.body ?? '' } : { from: attachment.path });
      const named: Attachment = { name: attachment.name, type: attachment.contentType, source };
      sources.set(attachment, named);
      draft.attachments.push(named);
    });
    const stepOf = (step: PlaywrightStep): TestStep => ({
      name: step.title,
      category: step.category,
      status: stepStatus(step),
      start: step.startTime.getTime(),
      duration: step.duration,
      error: errorInfo(step.error),
      parameters: step.location === undefined ? [] : [{ name: 'line', value: String(step.location.line) }],
      dataTable: null,
      docString: null,
      attachments: step.attachments.flatMap((attachment) => sources.get(attachment) ?? []),
      steps: step.steps.map(stepOf),
    });
    draft.steps.push(...result.steps.map(stepOf));
    writeResult(target.dir, draft, files);
  }
}

// eslint-disable-next-line no-restricted-syntax -- Playwright loads a reporter file by its default export
export default BoardReportPlaywrightReporter;
