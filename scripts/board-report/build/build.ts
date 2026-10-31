// Builds the report from a run's results (PLAN.md Phase 14 tasks 5 and 7): reports/board-report/ gets index.html,
// the client (app.js), the styles, one data script with every test and one per test, and the attachments. The same
// results and history always give the same report, byte for byte, apart from the build time.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIREMENTS } from '../../traceability.ts';
import { CATEGORIES, categoryOf } from '../categories.ts';
import type { Environment } from '../environment.ts';
import { DOTS, isFlaky, statusesOf, summarizeRun, withRun, type HistoryRun } from '../history.ts';
import { stripAnsi } from '../labels.ts';
import {
  readResults,
  TEST_TYPES,
  type Attachment,
  type Status,
  type StoredResult,
  type TestResult,
  type TestStep,
  type TestType,
} from '../result-schema.ts';
import { bundleClient } from './bundle.ts';
import type {
  AttachmentKind,
  AttachmentView,
  ReportIndex,
  StepView,
  TestDetail,
  TestEntry,
  TypeInfo,
} from './data-shape.ts';
import { reportHtml } from './html.ts';

const CLIENT_ENTRY = fileURLToPath(new URL('../client/main.ts', import.meta.url));
const STYLES = fileURLToPath(new URL('../styles/report.css', import.meta.url));
const TEXT_LIMIT = 200_000;

export const TYPE_INFO: Readonly<Record<TestType, Omit<TypeInfo, 'id'>>> = {
  static: { title: 'Static', family: 'static' },
  unit: { title: 'Unit', family: 'vitest' },
  integration: { title: 'Integration', family: 'vitest' },
  api: { title: 'API', family: 'vitest' },
  contract: { title: 'Contract', family: 'vitest' },
  security: { title: 'Security', family: 'vitest' },
  coverage: { title: 'Coverage', family: 'vitest' },
  e2e: { title: 'E2E', family: 'browser' },
  accessibility: { title: 'Accessibility', family: 'browser' },
  smoke: { title: 'Smoke', family: 'browser' },
  'bdd-integration': { title: 'BDD integration', family: 'bdd' },
  'bdd-api': { title: 'BDD API', family: 'bdd' },
  'bdd-e2e': { title: 'BDD E2E', family: 'bdd' },
  'bdd-smoke': { title: 'BDD smoke', family: 'bdd' },
  performance: { title: 'Performance', family: 'performance' },
};

export interface BuildOptions {
  resultsDir: string;
  outDir: string;
  /** The earlier runs, oldest first; this run is added to them. */
  history: readonly HistoryRun[];
  environment: Environment;
  builtAt: string;
}

export interface BuildOutcome {
  index: ReportIndex;
  /** This run, as a line of the history. */
  run: HistoryRun;
  /** The history with this run added, the last 50 kept. */
  runs: HistoryRun[];
}

const RANK: Readonly<Record<Status, number>> = { broken: 0, failed: 1, passed: 2, skipped: 3 };
const TYPE_ORDER = new Map<TestType, number>(TEST_TYPES.map((type, index) => [type, index]));

function compare(left: TestResult, right: TestResult): number {
  return (
    (TYPE_ORDER.get(left.labels.testType) ?? 0) - (TYPE_ORDER.get(right.labels.testType) ?? 0) ||
    (left.file ?? '').localeCompare(right.file ?? '') ||
    left.fullName.localeCompare(right.fullName) ||
    (left.labels.browser ?? '').localeCompare(right.labels.browser ?? '') ||
    left.id.localeCompare(right.id)
  );
}

/**
 * One result per test. A test that two steps ran (in CI the unit tests run in the static job and again for coverage)
 * keeps its worst result, so a failure is never hidden by a pass.
 */
export function oneResultPerTest(stored: readonly StoredResult[]): StoredResult[] {
  const byHistory = new Map<string, StoredResult>();
  for (const entry of [...stored].sort((left, right) => compare(left.result, right.result))) {
    const kept = byHistory.get(entry.result.historyId);
    if (kept === undefined || RANK[entry.result.status] < RANK[kept.result.status])
      byHistory.set(entry.result.historyId, entry);
  }
  return [...byHistory.values()].sort((left, right) => compare(left.result, right.result));
}

export function buildReport(options: BuildOptions): BuildOutcome {
  const stored = oneResultPerTest(readResults(options.resultsDir));
  const results = stored.map((entry) => entry.result);
  const { repository, commit, branch } = options.environment;
  const run = summarizeRun(results, options.builtAt, commit);
  const runs = withRun(options.history, run);
  const github = repository === null ? null : `https://github.com/${repository}/blob/${commit ?? 'main'}`;

  const index: ReportIndex = {
    title: 'board-report',
    builtAt: options.builtAt,
    repository,
    commit,
    branch,
    types: TEST_TYPES.map((id) => ({ id, ...TYPE_INFO[id] })),
    categories: CATEGORIES.map(({ id, title }) => ({ id, title })),
    requirements: REQUIREMENTS.map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      url:
        github === null
          ? null
          : `${github}/PLAN.md#${requirement.id.startsWith('NFR') ? '32-non-functional-requirements' : '31-functional-requirements'}`,
      retired: requirement.retired !== undefined,
    })),
    environment: options.environment.entries,
    trend: runs.map((point) => ({
      time: point.time,
      commit: point.commit,
      duration: point.duration,
      totals: point.totals,
    })),
    totals: run.totals,
    duration: run.duration,
    tests: results.map((result) => entryOf(result, runs, github)),
  };

  rmSync(options.outDir, { recursive: true, force: true });
  mkdirSync(join(options.outDir, 'data', 'tests'), { recursive: true });
  writeFileSync(join(options.outDir, 'index.html'), reportHtml(`board-report: ${headline(run)}`));
  writeFileSync(join(options.outDir, 'app.js'), bundleClient(CLIENT_ENTRY));
  copyFileSync(STYLES, join(options.outDir, 'report.css'));
  writeFileSync(join(options.outDir, 'data', 'index.js'), `window.boardReport.index(${JSON.stringify(index)});\n`);
  for (const entry of stored) {
    const detail = detailOf(entry, options.outDir);
    writeFileSync(
      join(options.outDir, 'data', 'tests', `${entry.result.id}.js`),
      `window.boardReport.test(${JSON.stringify(entry.result.id)}, ${JSON.stringify(detail)});\n`,
    );
  }
  return { index, run, runs };
}

/** "12 failed of 1,480" or "1,480 passed": the run's result in a few words. */
export function headline(run: Pick<HistoryRun, 'totals'>): string {
  const { passed, failed, broken, skipped } = run.totals;
  const total = passed + failed + broken + skipped;
  const count = (value: number) => value.toLocaleString('en-US');
  if (total === 0) return 'no results';
  if (failed + broken === 0) return `${count(passed)} passed`;
  return `${count(failed + broken)} failed of ${count(total)}`;
}

function entryOf(result: TestResult, runs: readonly HistoryRun[], github: string | null): TestEntry {
  return {
    id: result.id,
    historyId: result.historyId,
    name: result.name,
    fullName: result.fullName,
    type: result.labels.testType,
    status: result.status,
    start: result.start,
    stop: result.stop,
    duration: result.duration,
    file: result.file,
    line: result.line,
    sourceUrl:
      github === null || result.file === null
        ? null
        : `${github}/${result.file}${result.line === null ? '' : `#L${String(result.line)}`}`,
    suites: result.suites,
    requirements: result.labels.requirements,
    tags: result.labels.tags,
    severity: result.labels.severity,
    browser: result.labels.browser,
    worker: result.labels.worker,
    step: result.labels.step,
    parameters: result.parameters,
    category: categoryOf(result),
    flaky: isFlaky(result.historyId, runs),
    errorLine:
      result.error === null
        ? null
        : (stripAnsi(result.error.message)
            .split('\n')
            .find((line) => line.trim() !== '')
            ?.trim() ?? null),
    history: statusesOf(result.historyId, runs, DOTS),
  };
}

function detailOf({ result, dir }: StoredResult, outDir: string): TestDetail {
  const attach = (attachment: Attachment): AttachmentView[] => {
    const from = join(dir, attachment.source);
    if (!existsSync(from)) return [];
    const path = `attachments/${result.id}/${attachment.source}`;
    mkdirSync(join(outDir, 'attachments', result.id), { recursive: true });
    copyFileSync(from, join(outDir, path));
    const kind = kindOf(attachment);
    return [{ name: attachment.name, type: attachment.type, kind, path, ...shownText(from, kind) }];
  };
  const stepOf = (step: TestStep): StepView => ({
    name: step.name,
    category: step.category,
    status: step.status,
    duration: step.duration,
    error: step.error,
    parameters: step.parameters,
    dataTable: step.dataTable,
    docString: step.docString,
    attachments: step.attachments.flatMap(attach),
    steps: step.steps.map(stepOf),
  });
  return {
    id: result.id,
    error: result.error,
    steps: result.steps.map(stepOf),
    attachments: result.attachments.flatMap(attach),
    stdout: result.stdout,
    stderr: result.stderr,
    retries: result.retries,
  };
}

export function kindOf(attachment: Pick<Attachment, 'name' | 'type'>): AttachmentKind {
  const type = attachment.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type === 'application/zip' && attachment.name === 'trace') return 'trace';
  if (type.startsWith('text/') || type === 'application/x-ndjson') return 'text';
  return 'file';
}

/** The text the report shows for a text or JSON attachment (JSON pretty-printed), cut at TEXT_LIMIT. */
function shownText(file: string, kind: AttachmentKind): Pick<AttachmentView, 'text' | 'truncated'> {
  if (kind !== 'text' && kind !== 'json') return { text: null, truncated: false };
  const raw = readFileSync(file, 'utf8');
  const text = kind === 'json' ? prettyJson(raw) : raw;
  return { text: text.slice(0, TEXT_LIMIT), truncated: text.length > TEXT_LIMIT };
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
