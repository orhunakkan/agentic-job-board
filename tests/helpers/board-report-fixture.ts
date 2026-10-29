import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, type BuildOutcome } from '../../scripts/board-report/build/build.ts';
import type { Environment } from '../../scripts/board-report/environment.ts';
import type { HistoryRun } from '../../scripts/board-report/history.ts';
import { labelResult, type ResultDraft } from '../../scripts/board-report/labels.ts';
import {
  attachmentSource,
  writeResult,
  type AttachmentFile,
  type ErrorInfo,
  type Status,
  type Step,
  type TestStep,
  type TestType,
} from '../../scripts/board-report/result-schema.ts';

// Results of a small made-up run for board-report's own tests and the README screenshots (PLAN.md Phase 14 task 14):
// every test type, failures of each category, nested steps with a data table, a screenshot, a video and a trace.
// No result comes from a real run, so nothing personal is in them. `buildFixtureReport` builds two runs, so the
// report has history dots, trends and a flaky test.

const MEDIA = fileURLToPath(new URL('../fixtures/board-report/', import.meta.url));
const START = Date.parse('2026-10-29T12:00:00.000Z');

export const FIXTURE_ENVIRONMENT: Environment = {
  repository: 'owner/agentic-job-board',
  commit: '0123456789abcdef0123456789abcdef01234567',
  branch: 'phase/14-board-report',
  entries: [
    { name: 'Node.js', value: 'v24.22.1', url: null },
    { name: 'Operating system', value: 'linux 6.8 (x64)', url: null },
    { name: 'Playwright', value: '1.64.1', url: null },
    {
      name: 'Commit',
      value: '0123456789abcdef0123456789abcdef01234567',
      url: 'https://github.com/owner/agentic-job-board/commit/0123456789abcdef0123456789abcdef01234567',
    },
  ],
};

/** A title that must stay text everywhere in the report. */
export const HOSTILE_TITLE = '<img src=x onerror=alert(1)>';

interface FixtureTest {
  step: Step;
  name: string;
  file: string | null;
  status: Status;
  suites?: string[];
  testType?: TestType;
  browser?: string;
  tags?: string[];
  duration?: number;
  error?: ErrorInfo;
  steps?: TestStep[];
  parameters?: { name: string; value: string }[];
  media?: boolean;
  stdout?: string[];
}

function step(
  name: string,
  status: Status,
  category: string,
  steps: TestStep[] = [],
  extra: Partial<TestStep> = {},
): TestStep {
  return {
    name,
    category,
    status,
    start: null,
    duration: 12,
    error: null,
    parameters: [],
    dataTable: null,
    docString: null,
    attachments: [],
    steps,
    ...extra,
  };
}

const ASSERTION: ErrorInfo = {
  message: 'expected "saved" to be "applied"',
  expected: '"applied"',
  actual: '"saved"',
  stack: 'AssertionError: expected "saved" to be "applied"\n    at tests/unit/domain/status.test.ts:42:7',
};

const PLAYWRIGHT_FAILURE: ErrorInfo = {
  message:
    'expect(locator).toHaveText(expected) failed\n\nExpected: "Saved (1)"\nReceived: "Saved (0)"\nTimeout: 5000ms',
  expected: '"Saved (1)"',
  actual: '"Saved (0)"',
  stack: 'Error: expect(locator).toHaveText(expected) failed\n    at tests/e2e/board.spec.ts:88:5',
};

function tests(second: boolean): FixtureTest[] {
  return [
    {
      step: 'static',
      name: 'tsc --noEmit (tsconfig.json)',
      file: null,
      status: 'passed',
      testType: 'static',
      suites: ['TypeScript'],
    },
    {
      step: 'static',
      name: 'eslint: scripts/example.ts',
      file: null,
      status: 'failed',
      testType: 'static',
      suites: ['ESLint'],
      error: {
        message: '2:7 error  no-unused-vars  "unused" is assigned a value but never used',
        expected: null,
        actual: null,
        stack: null,
      },
    },
    {
      step: 'unit',
      name: 'FR-04: one job per LinkedIn job ID',
      file: 'tests/unit/domain/job.test.ts',
      status: 'passed',
      suites: ['job'],
      stdout: ['deduplicated 3 jobs\n'],
    },
    {
      step: 'unit',
      name: 'FR-08: applied follows saved',
      file: 'tests/unit/domain/status.test.ts',
      status: second ? 'failed' : 'passed',
      suites: ['status', 'transitions'],
      ...(second ? { error: ASSERTION } : {}),
    },
    {
      step: 'unit',
      name: 'formats a date',
      file: 'tests/unit/ui/format.test.ts',
      status: 'skipped',
      suites: ['format'],
    },
    {
      step: 'integration',
      name: 'FR-16: a listing seen again raises its count',
      file: 'tests/integration/listings.test.ts',
      status: 'passed',
      suites: ['listings'],
    },
    {
      step: 'api',
      name: 'NFR-09: refuses a listing without a title',
      file: 'tests/api/listings.test.ts',
      status: 'broken',
      suites: ['POST /api/runs/:id/listings'],
      error: {
        message: "TypeError: Cannot read properties of undefined (reading 'title')",
        expected: null,
        actual: null,
        stack:
          "TypeError: Cannot read properties of undefined (reading 'title')\n    at tests/api/listings.test.ts:20:11",
      },
    },
    {
      step: 'contract',
      name: 'NFR-09: every response matches its schema',
      file: 'tests/contract/api-contract.test.ts',
      status: 'passed',
      suites: ['contract'],
    },
    {
      step: 'security',
      name: 'NFR-01: binds to 127.0.0.1 only',
      file: 'tests/security/http-security.test.ts',
      status: 'passed',
      suites: ['http'],
    },
    {
      step: 'coverage',
      name: 'Lines in src ≥ 85 %',
      file: null,
      status: 'passed',
      testType: 'coverage',
      suites: ['Coverage'],
      parameters: [{ name: 'measured', value: '93.4 %' }],
    },
    {
      step: 'e2e',
      name: 'FR-07, FR-08: save a job from the board',
      file: 'tests/e2e/board.spec.ts',
      status: 'failed',
      browser: 'Chromium',
      suites: ['board'],
      error: PLAYWRIGHT_FAILURE,
      media: true,
      steps: [
        step('Before Hooks', 'passed', 'hook', [step('Create page', 'passed', 'pw:api')]),
        step('save the job', 'failed', 'test.step', [
          step('Click', 'passed', 'pw:api'),
          step('Expect "toHaveText"', 'failed', 'expect', [], { error: PLAYWRIGHT_FAILURE }),
        ]),
      ],
    },
    {
      step: 'e2e',
      name: 'FR-07, FR-08: save a job from the board',
      file: 'tests/e2e/board.spec.ts',
      status: 'passed',
      browser: 'Firefox',
      suites: ['board'],
    },
    {
      step: 'e2e',
      name: `FR-10: ${HOSTILE_TITLE}`,
      file: 'tests/e2e/board.spec.ts',
      status: 'passed',
      browser: 'WebKit',
      suites: ['board'],
    },
    {
      step: 'e2e',
      name: 'NFR-06: the board has no axe violations',
      file: 'tests/e2e/a11y.spec.ts',
      status: 'failed',
      browser: 'Pixel 7',
      suites: ['accessibility'],
      error: {
        message: 'expect(received).toEqual(expected)\n\nExpected: []\nReceived: [{"id":"color-contrast"}]',
        expected: '[]',
        actual: '[{"id":"color-contrast"}]',
        stack: null,
      },
    },
    {
      step: 'smoke',
      name: 'FR-07: the board renders @smoke',
      file: 'tests/e2e/board.spec.ts',
      status: 'passed',
      browser: 'Chromium',
      tags: ['@smoke'],
      suites: ['board'],
    },
    {
      step: 'bdd-e2e',
      name: 'Clear All empties New for one view',
      file: 'tests/features/e2e/clear-all.feature',
      status: 'passed',
      browser: 'Chromium',
      tags: ['@FR-21'],
      suites: ['Clear All', 'Clear All empties New for one view'],
      steps: [
        step('Given the board has these jobs', 'passed', 'Given', [], {
          dataTable: [
            ['title', 'view', 'status'],
            ['Senior SDET', 'LinkedIn', 'New'],
          ],
        }),
        step('When I press Clear All', 'passed', 'When'),
        step('Then the New tab is empty', 'passed', 'Then'),
      ],
    },
    {
      step: 'bdd-e2e',
      name: 'Clear All empties New for one view',
      file: 'tests/features/e2e/clear-all.feature',
      status: 'passed',
      browser: 'Firefox',
      tags: ['@FR-21'],
      suites: ['Clear All', 'Clear All empties New for one view'],
    },
    {
      step: 'bdd-smoke',
      name: 'The board renders its tabs',
      file: 'tests/features/e2e/smoke.feature',
      status: 'passed',
      browser: 'Chromium',
      tags: ['@smoke', '@FR-07'],
      suites: ['Smoke'],
    },
    {
      step: 'perf',
      name: 'NFR-05: http_req_duration p(95)<200',
      file: null,
      status: 'passed',
      testType: 'performance',
      suites: ['k6 thresholds'],
      parameters: [{ name: 'p(95)', value: '42.7 ms' }],
    },
    {
      step: 'perf',
      name: 'NFR-05: checks rate>0.99',
      file: null,
      status: second ? 'failed' : 'passed',
      testType: 'performance',
      suites: ['k6 thresholds'],
      ...(second
        ? {
            error: {
              message: 'checks rate>0.99 was not met: 0.97',
              expected: 'rate>0.99',
              actual: '0.97',
              stack: null,
            },
          }
        : {}),
    },
  ];
}

/** Writes one run's fixture results into reports-like step folders under `dir`. */
export function writeFixtureResults(dir: string, second: boolean): void {
  tests(second).forEach((test, index) => {
    const start = START + index * 250;
    const duration = test.duration ?? 40 + index * 17;
    const draft: ResultDraft = {
      name: test.name,
      fullName: [...(test.suites ?? []), test.name].join(' > '),
      status: test.status,
      start,
      stop: start + duration,
      duration,
      file: test.file,
      line: test.file === null ? null : 10 + index,
      suites: [test.file ?? test.suites?.[0] ?? 'results', ...(test.suites ?? [])],
      parameters: test.parameters ?? [],
      error: test.error ?? null,
      steps: test.steps ?? [],
      attachments: [],
      stdout: test.stdout ?? [],
      stderr: [],
      retries: [],
      labels: {
        tags: test.tags ?? [],
        browser: test.browser ?? null,
        worker: test.browser === undefined ? null : String(index % 3),
      },
      ...(test.testType === undefined ? {} : { testType: test.testType }),
    };
    const result = labelResult(draft, test.step);
    const files = new Map<string, AttachmentFile>();
    if (test.media === true) {
      const media = [
        { name: 'screenshot', type: 'image/png', from: join(MEDIA, 'screenshot.png') },
        { name: 'video', type: 'video/webm', from: join(MEDIA, 'video.webm') },
        { name: 'trace', type: 'application/zip', body: 'PK fixture trace' },
        { name: 'axe-results', type: 'application/json', body: '{"violations":[],"passes":3}' },
      ];
      media.forEach((file, place) => {
        const source = attachmentSource(result.id, place, file.name, file.type, 'from' in file ? file.from : undefined);
        files.set(source, 'from' in file ? { from: file.from } : { body: file.body });
        result.attachments.push({ name: file.name, type: file.type, source });
      });
    }
    writeResult(join(dir, test.step), result, files);
  });
}

/** Builds the fixture report as the second of two runs; returns the second build. */
export function buildFixtureReport(outDir: string): BuildOutcome {
  const work = mkdtempSync(join(tmpdir(), 'board-report-fixture-'));
  const first = join(work, 'first');
  const second = join(work, 'second');
  mkdirSync(first);
  mkdirSync(second);
  writeFixtureResults(first, false);
  writeFixtureResults(second, true);
  const previous: HistoryRun[] = buildReport({
    resultsDir: first,
    outDir: join(work, 'first-report'),
    history: [],
    environment: FIXTURE_ENVIRONMENT,
    builtAt: '2026-10-28T12:00:00.000Z',
  }).runs;
  return buildReport({
    resultsDir: second,
    outDir,
    history: previous,
    environment: FIXTURE_ENVIRONMENT,
    builtAt: '2026-10-29T12:00:00.000Z',
  });
}
