// The labels board-report adds to every result (PLAN.md Phase 14 task 4): its test type, the requirements it covers,
// its severity, and the parameter that tells runs of the same test apart (a browser, or the smoke run), which is part
// of its history ID. Reporters and converters label a result with `labelResult` as they write it.
import { createHash } from 'node:crypto';
import { REQUIREMENTS, requirementIds, requirementTagIds } from '../traceability.ts';
import {
  RESULT_FORMAT,
  type Labels,
  type Parameter,
  type Severity,
  type Step,
  type TestResult,
  type TestType,
} from './result-schema.ts';

/** A result before labelling: everything a runner knows about the test. */
export type ResultDraft = Omit<TestResult, 'format' | 'id' | 'historyId' | 'labels'> & {
  labels: Pick<Labels, 'tags' | 'browser' | 'worker'>;
  /** Set by the converters whose results have no test file: static, coverage, performance. */
  testType?: TestType;
};

export class UnknownTestTypeError extends Error {
  override name = 'UnknownTestTypeError';
}

/** Steps whose every result has one type, whatever its file. */
const TYPE_OF_STEP: Partial<Record<Step, TestType>> = {
  static: 'static',
  smoke: 'smoke',
  'bdd-integration': 'bdd-integration',
  'bdd-api': 'bdd-api',
  'bdd-e2e': 'bdd-e2e',
  'bdd-smoke': 'bdd-smoke',
  perf: 'performance',
};

const TYPE_OF_FOLDER: readonly (readonly [RegExp, TestType])[] = [
  [/^tests\/unit\//, 'unit'],
  [/^tests\/integration\//, 'integration'],
  [/^tests\/api\//, 'api'],
  [/^tests\/contract\//, 'contract'],
  [/^tests\/security\//, 'security'],
  [/^tests\/e2e\/a11y\.spec\.ts$/, 'accessibility'],
  [/^tests\/e2e\//, 'e2e'],
  [/^tests\/features\/integration\//, 'bdd-integration'],
  [/^tests\/features\/api\//, 'bdd-api'],
  [/^tests\/features\/e2e\//, 'bdd-e2e'],
];

/** The test type: fixed by the step for some steps, set by a converter, or else read from the test's file path. */
export function testTypeOf(step: Step, file: string | null, given?: TestType): TestType {
  const byStep = TYPE_OF_STEP[step];
  if (byStep !== undefined) return byStep;
  if (given !== undefined) return given;
  const byFolder = TYPE_OF_FOLDER.find(([pattern]) => pattern.test(file ?? ''));
  if (byFolder === undefined)
    throw new UnknownTestTypeError(`no test type for ${file ?? 'a result without a file'} in the ${step} step`);
  return byFolder[1];
}

const ORDER = new Map(REQUIREMENTS.map((requirement, index) => [requirement.id, index]));

/** Every FR- or NFR- ID the name starts with or a tag names, by the rule of scripts/traceability.ts, in §3 order. */
export function requirementsOf(name: string, tags: readonly string[]): string[] {
  const ids = new Set([...requirementIds(name), ...requirementTagIds(tags)]);
  return [...ids].sort(
    (left, right) => (ORDER.get(left) ?? 999) - (ORDER.get(right) ?? 999) || left.localeCompare(right),
  );
}

const CRITICAL: ReadonlySet<TestType> = new Set(['smoke', 'bdd-smoke', 'security']);

export function severityOf(type: TestType): Severity {
  return CRITICAL.has(type) ? 'critical' : 'normal';
}

/** The browser, and for the smoke runs "smoke", as parameters, so they are part of the history ID. */
export function runParameters(type: TestType, browser: string | null, parameters: readonly Parameter[]): Parameter[] {
  const added: Parameter[] = [];
  if (browser !== null) added.push({ name: 'browser', value: browser });
  if (type === 'smoke' || type === 'bdd-smoke') added.push({ name: 'run', value: 'smoke' });
  const names = new Set(added.map((parameter) => parameter.name));
  return [...parameters.filter((parameter) => !names.has(parameter.name)), ...added];
}

function hash(...parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/** The same for every run of one test: its type, file, full name and parameters, apart from measured values. */
export function historyIdOf(
  type: TestType,
  file: string | null,
  fullName: string,
  parameters: readonly Parameter[],
): string {
  const sorted = parameters
    .filter((parameter) => parameter.measured !== true)
    .map(({ name, value }) => `${name}=${value}`)
    .sort();
  return hash(type, file, fullName, sorted);
}

export function labelResult(draft: ResultDraft, step: Step): TestResult {
  const { testType: given, labels, ...rest } = draft;
  const testType = testTypeOf(step, draft.file, given);
  const parameters = runParameters(testType, labels.browser, draft.parameters);
  const historyId = historyIdOf(testType, draft.file, draft.fullName, parameters);
  return {
    format: RESULT_FORMAT,
    id: hash(historyId, step),
    historyId,
    ...rest,
    parameters,
    labels: {
      testType,
      requirements: requirementsOf(draft.name, labels.tags),
      tags: labels.tags,
      severity: severityOf(testType),
      browser: labels.browser,
      worker: labels.worker,
      step,
    },
  };
}

/** The result's text without the colour codes runners put in their messages. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- the escape character is exactly what this removes
  return text.replaceAll(/\u001b\[[0-9;]*m/g, '');
}

/** Playwright and node:assert print "Expected: …" and "Received: …" in the message; this reads them back out. */
export function expectedAndActual(message: string): { expected: string | null; actual: string | null } {
  const text = stripAnsi(message);
  // Playwright pads the labels to line the values up ("Received string:    …").
  const expected = /^\s*Expected(?: \w+)?:[ \t]*(.*)$/m.exec(text)?.[1]?.trim() ?? '';
  const actual = /^\s*Received(?: \w+)?:[ \t]*(.*)$/m.exec(text)?.[1]?.trim() ?? '';
  return { expected: expected === '' ? null : expected, actual: actual === '' ? null : actual };
}
