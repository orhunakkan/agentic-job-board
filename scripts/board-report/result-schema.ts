// board-report's result format (PLAN.md Phase 14 task 2): one JSON file per test, the same for every reporter and
// converter, checked with Zod when it is written and when it is read. Attachments are files next to the result,
// named in it, never inlined. scripts/board-report/README.md documents every field.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { z } from 'zod';

export const RESULT_FORMAT = 1;

export const STATUSES = ['passed', 'failed', 'broken', 'skipped'] as const;
export const Status = z.enum(STATUSES);
export type Status = z.infer<typeof Status>;

/** Failed (an assertion didn't hold) or broken (an error): what fails a run. */
export function isFailing(status: Status): boolean {
  return status === 'failed' || status === 'broken';
}

/** The test types of PLAN.md §8.1 and the BDD layer (§8.5), in the order the report shows them. */
export const TEST_TYPES = [
  'static',
  'unit',
  'integration',
  'api',
  'contract',
  'security',
  'coverage',
  'e2e',
  'accessibility',
  'smoke',
  'bdd-integration',
  'bdd-api',
  'bdd-e2e',
  'bdd-smoke',
  'performance',
] as const;
export const TestType = z.enum(TEST_TYPES);
export type TestType = z.infer<typeof TestType>;

/** The steps of scripts/board-report.ts; each writes its results to reports/test-results/<step>/. */
export const STEPS = [
  'static',
  'unit',
  'integration',
  'api',
  'contract',
  'security',
  'coverage',
  'e2e',
  'smoke',
  'bdd-integration',
  'bdd-api',
  'bdd-e2e',
  'bdd-smoke',
  'perf',
] as const;
export const Step = z.enum(STEPS);
export type Step = z.infer<typeof Step>;

export const Severity = z.enum(['critical', 'normal']);
export type Severity = z.infer<typeof Severity>;

export const Attachment = z.strictObject({
  name: z.string(),
  /** A media type, such as image/png or application/json. */
  type: z.string(),
  /** The file's name in the result's folder. */
  source: z.string().regex(/^[\w.-]+$/),
});
export type Attachment = z.infer<typeof Attachment>;

export const ErrorInfo = z.strictObject({
  message: z.string(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  stack: z.string().nullable(),
});
export type ErrorInfo = z.infer<typeof ErrorInfo>;

export const Parameter = z.strictObject({
  name: z.string(),
  value: z.string(),
  /** A value measured in the run (a percentage, a p95), which changes from run to run: not part of the history ID. */
  measured: z.literal(true).optional(),
});
export type Parameter = z.infer<typeof Parameter>;

export interface TestStep {
  name: string;
  /** What kind of step: pw:api, expect, test.step, hook, fixture, Given, When, Then … */
  category: string | null;
  status: Status;
  start: number | null;
  duration: number | null;
  error: ErrorInfo | null;
  parameters: Parameter[];
  dataTable: string[][] | null;
  docString: string | null;
  attachments: Attachment[];
  steps: TestStep[];
}

export const TestStep: z.ZodType<TestStep> = z.lazy(() =>
  z.strictObject({
    name: z.string(),
    category: z.string().nullable(),
    status: Status,
    start: z.number().nullable(),
    duration: z.number().nonnegative().nullable(),
    error: ErrorInfo.nullable(),
    parameters: z.array(Parameter),
    dataTable: z.array(z.array(z.string())).nullable(),
    docString: z.string().nullable(),
    attachments: z.array(Attachment),
    steps: z.array(TestStep),
  }),
);

export const Labels = z.strictObject({
  testType: TestType,
  /** FR- and NFR- IDs, from the start of the test's name or its scenario's tags. */
  requirements: z.array(z.string().regex(/^N?FR-\d{2}$/)),
  tags: z.array(z.string()),
  severity: Severity,
  browser: z.string().nullable(),
  worker: z.string().nullable(),
  step: Step,
});
export type Labels = z.infer<typeof Labels>;

export const Retry = z.strictObject({
  status: Status,
  duration: z.number().nonnegative(),
  message: z.string().nullable(),
});
export type Retry = z.infer<typeof Retry>;

export const TestResult = z.strictObject({
  format: z.literal(RESULT_FORMAT),
  /** Unique within a run: the history ID and the step that ran the test. */
  id: z.string().regex(/^[0-9a-f]{16}$/),
  /** The same in every run of the same test (labels.ts). */
  historyId: z.string().regex(/^[0-9a-f]{16}$/),
  name: z.string(),
  fullName: z.string(),
  status: Status,
  start: z.number(),
  stop: z.number(),
  duration: z.number().nonnegative(),
  /** Repository-relative, with forward slashes; null for results that have no source file. */
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  /** File or feature first, then describe blocks or the scenario. */
  suites: z.array(z.string()),
  labels: Labels,
  parameters: z.array(Parameter),
  error: ErrorInfo.nullable(),
  steps: z.array(TestStep),
  attachments: z.array(Attachment),
  stdout: z.array(z.string()),
  stderr: z.array(z.string()),
  /** Earlier attempts of the same test in the same run. */
  retries: z.array(Retry),
});
export type TestResult = z.infer<typeof TestResult>;

const RESULT_SUFFIX = '-result.json';

/** A file to keep next to a result: copied from a path, or written from its content. */
export type AttachmentFile = { from: string } | { body: string | Buffer };

/** Names an attachment file after its result, its place and its type, so names never clash in a folder. */
export function attachmentSource(resultId: string, index: number, name: string, type: string, from?: string): string {
  const fromExtension = from === undefined ? '' : extname(from).toLowerCase();
  const extension = /^\.[a-z0-9]{1,8}$/.test(fromExtension) ? fromExtension : extensionOf(type);
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 40);
  return `${resultId}-${String(index)}-${slug === '' ? 'attachment' : slug}${extension}`;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'video/webm': '.webm',
  'application/zip': '.zip',
  'application/json': '.json',
  'text/markdown': '.md',
  'text/html': '.html',
  'text/plain': '.txt',
};

function extensionOf(type: string): string {
  return EXTENSIONS[type.split(';')[0]?.trim() ?? ''] ?? '.txt';
}

/** Checks the result, writes its attachment files next to it, then the result itself. */
export function writeResult(
  dir: string,
  result: TestResult,
  files: ReadonlyMap<string, AttachmentFile> = new Map(),
): string {
  const checked = TestResult.parse(result);
  mkdirSync(dir, { recursive: true });
  for (const [source, file] of files) {
    const target = join(dir, Attachment.shape.source.parse(source));
    if ('from' in file) copyFileSync(file.from, target);
    else writeFileSync(target, file.body);
  }
  const path = join(dir, `${checked.id}${RESULT_SUFFIX}`);
  writeFileSync(path, `${JSON.stringify(checked, null, 2)}\n`);
  return path;
}

export class ResultFileError extends Error {
  override name = 'ResultFileError';
}

export interface StoredResult {
  result: TestResult;
  /** The folder the result and its attachments are in. */
  dir: string;
}

/** Every result under a folder and its subfolders, checked against the format. */
export function readResults(root: string): StoredResult[] {
  if (!existsSync(root)) return [];
  const found: StoredResult[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(RESULT_SUFFIX)) found.push({ result: readResult(path), dir });
    }
  };
  walk(root);
  return found;
}

export function readResult(path: string): TestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ResultFileError(`${path} is not JSON: ${String(error)}`);
  }
  const checked = TestResult.safeParse(parsed);
  if (!checked.success) throw new ResultFileError(`${path} does not match the result format: ${checked.error.message}`);
  return checked.data;
}
