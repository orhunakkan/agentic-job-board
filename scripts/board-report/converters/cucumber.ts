// Turns Cucumber's `message` output (one NDJSON file per profile, PLAN.md Phase 14 task 3) into results: one per
// scenario run, with its feature as suite, every Given, When and Then as a step with its data table or text block,
// Scenario Outline example rows as parameters, hooks as steps, its tags, the step that failed and its error, and
// its attachments, such as the failure screenshot of tests/features/e2e/hooks.ts.
import { z } from 'zod';
import { expectedAndActual, stripAnsi, type ResultDraft } from '../labels.ts';
import type { ErrorInfo, Parameter, Retry, Status, TestStep } from '../result-schema.ts';
import { converted, type Converted, type ConvertedAttachment } from './write.ts';

export const BROWSER_OF_PROFILE: Readonly<Record<string, string>> = {
  'e2e-chromium': 'Chromium',
  'e2e-firefox': 'Firefox',
  'e2e-webkit': 'WebKit',
  'e2e-mobile': 'Pixel 7',
  smoke: 'Chromium',
};

const Timestamp = z.object({ seconds: z.number(), nanos: z.number() });
type Timestamp = z.infer<typeof Timestamp>;
const Cells = z.object({ cells: z.array(z.object({ value: z.string() })) });
const Location = z.object({ line: z.number() });

const GherkinStep = z.object({ id: z.string(), keyword: z.string(), location: Location });
const Examples = z.object({
  tableHeader: Cells.optional(),
  tableBody: z.array(Cells.extend({ id: z.string(), location: Location })),
});
const Scenario = z.object({
  id: z.string(),
  name: z.string(),
  location: Location,
  steps: z.array(GherkinStep),
  examples: z.array(Examples),
});
const Background = z.object({ steps: z.array(GherkinStep) });

interface Child {
  scenario?: z.infer<typeof Scenario> | undefined;
  background?: z.infer<typeof Background> | undefined;
  rule?: { name: string; children: Child[] } | undefined;
}
const Child: z.ZodType<Child> = z.lazy(() =>
  z.object({
    scenario: Scenario.optional(),
    background: Background.optional(),
    rule: z.object({ name: z.string(), children: z.array(Child) }).optional(),
  }),
);

const Envelope = z.object({
  gherkinDocument: z
    .object({ uri: z.string(), feature: z.object({ name: z.string(), children: z.array(Child) }).optional() })
    .optional(),
  pickle: z
    .object({
      id: z.string(),
      uri: z.string(),
      name: z.string(),
      astNodeIds: z.array(z.string()),
      tags: z.array(z.object({ name: z.string() })),
      steps: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          astNodeIds: z.array(z.string()),
          argument: z
            .object({
              dataTable: z.object({ rows: z.array(Cells) }).optional(),
              docString: z.object({ content: z.string() }).optional(),
            })
            .optional(),
        }),
      ),
    })
    .optional(),
  hook: z.object({ id: z.string(), name: z.string().optional(), type: z.string().optional() }).optional(),
  testCase: z
    .object({
      id: z.string(),
      pickleId: z.string(),
      testSteps: z.array(
        z.object({ id: z.string(), pickleStepId: z.string().optional(), hookId: z.string().optional() }),
      ),
    })
    .optional(),
  testCaseStarted: z
    .object({
      id: z.string(),
      testCaseId: z.string(),
      attempt: z.number(),
      timestamp: Timestamp,
      workerId: z.string().optional(),
    })
    .optional(),
  testStepStarted: z.object({ testCaseStartedId: z.string(), testStepId: z.string(), timestamp: Timestamp }).optional(),
  testStepFinished: z
    .object({
      testCaseStartedId: z.string(),
      testStepId: z.string(),
      testStepResult: z.object({
        status: z.string(),
        duration: Timestamp,
        message: z.string().optional(),
        exception: z
          .object({ type: z.string(), message: z.string().optional(), stackTrace: z.string().optional() })
          .optional(),
      }),
    })
    .optional(),
  testCaseFinished: z
    .object({ testCaseStartedId: z.string(), timestamp: Timestamp, willBeRetried: z.boolean() })
    .optional(),
  attachment: z
    .object({
      testCaseStartedId: z.string().optional(),
      testStepId: z.string().optional(),
      body: z.string(),
      contentEncoding: z.string(),
      mediaType: z.string(),
      fileName: z.string().optional(),
    })
    .optional(),
});
type Envelope = z.infer<typeof Envelope>;
type Pickle = NonNullable<Envelope['pickle']>;
type TestCase = NonNullable<Envelope['testCase']>;
type TestCaseStarted = NonNullable<Envelope['testCaseStarted']>;
type TestCaseFinished = NonNullable<Envelope['testCaseFinished']>;
type StepResult = NonNullable<Envelope['testStepFinished']>['testStepResult'];
type MessageAttachment = NonNullable<Envelope['attachment']>;

export class CucumberMessagesError extends Error {
  override name = 'CucumberMessagesError';
}

function ms(time: Timestamp): number {
  return time.seconds * 1000 + Math.round(time.nanos / 1e6);
}

function stepStatus(result: StepResult): Status {
  switch (result.status) {
    case 'PASSED':
      return 'passed';
    case 'SKIPPED':
      return 'skipped';
    case 'FAILED':
      return /AssertionError|expect\(/.test(`${result.exception?.type ?? ''} ${result.message ?? ''}`)
        ? 'failed'
        : 'broken';
    default:
      // UNDEFINED, PENDING, AMBIGUOUS and UNKNOWN fail the run under `strict`: the scenario couldn't run as written.
      return 'broken';
  }
}

function errorOf(result: StepResult): ErrorInfo | null {
  if (result.status === 'PASSED' || result.status === 'SKIPPED') return null;
  const raw = result.exception?.message ?? result.message ?? `the step is ${result.status.toLowerCase()}`;
  const message = stripAnsi(raw);
  const stack = result.exception?.stackTrace ?? result.message ?? null;
  return { message, ...expectedAndActual(message), stack: stack === null ? null : stripAnsi(stack) };
}

/** Worst of the steps: broken, then failed; passed when any passed; skipped only when every step was skipped. */
export function scenarioStatus(steps: readonly Pick<TestStep, 'status'>[]): Status {
  const statuses = new Set(steps.map((step) => step.status));
  if (statuses.has('broken')) return 'broken';
  if (statuses.has('failed')) return 'failed';
  if (statuses.has('passed')) return 'passed';
  return 'skipped';
}

function parseEnvelopes(ndjson: string, profile: string): Envelope[] {
  return ndjson
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      try {
        return Envelope.parse(JSON.parse(line));
      } catch (error) {
        throw new CucumberMessagesError(
          `line ${String(index + 1)} of the ${profile} messages can't be read: ${String(error)}`,
        );
      }
    });
}

/** Everything a profile's messages say, by ID. Step starts, results and attachments are keyed by `<run>/<step>`. */
interface Messages {
  gherkinSteps: Map<string, z.infer<typeof GherkinStep>>;
  scenarios: Map<string, { scenario: z.infer<typeof Scenario>; feature: string; rule: string | null }>;
  exampleRows: Map<string, { header: string[]; values: string[]; line: number }>;
  pickles: Map<string, Pickle>;
  hooks: Map<string, NonNullable<Envelope['hook']>>;
  testCases: Map<string, TestCase>;
  started: Map<string, TestCaseStarted>;
  stepStarts: Map<string, number>;
  stepResults: Map<string, StepResult>;
  attachments: Map<string, MessageAttachment[]>;
  finished: TestCaseFinished[];
}

function indexMessages(envelopes: readonly Envelope[]): Messages {
  const messages: Messages = {
    gherkinSteps: new Map(),
    scenarios: new Map(),
    exampleRows: new Map(),
    pickles: new Map(),
    hooks: new Map(),
    testCases: new Map(),
    started: new Map(),
    stepStarts: new Map(),
    stepResults: new Map(),
    attachments: new Map(),
    finished: [],
  };
  for (const envelope of envelopes) {
    if (envelope.gherkinDocument?.feature !== undefined)
      addFeature(messages, envelope.gherkinDocument.feature.children, envelope.gherkinDocument.feature.name, null);
    if (envelope.pickle !== undefined) messages.pickles.set(envelope.pickle.id, envelope.pickle);
    if (envelope.hook !== undefined) messages.hooks.set(envelope.hook.id, envelope.hook);
    if (envelope.testCase !== undefined) messages.testCases.set(envelope.testCase.id, envelope.testCase);
    if (envelope.testCaseStarted !== undefined)
      messages.started.set(envelope.testCaseStarted.id, envelope.testCaseStarted);
    if (envelope.testStepStarted !== undefined) {
      const { testCaseStartedId, testStepId, timestamp } = envelope.testStepStarted;
      messages.stepStarts.set(`${testCaseStartedId}/${testStepId}`, ms(timestamp));
    }
    if (envelope.testStepFinished !== undefined) {
      const { testCaseStartedId, testStepId, testStepResult } = envelope.testStepFinished;
      messages.stepResults.set(`${testCaseStartedId}/${testStepId}`, testStepResult);
    }
    if (envelope.attachment?.testCaseStartedId !== undefined) {
      const key = `${envelope.attachment.testCaseStartedId}/${envelope.attachment.testStepId ?? ''}`;
      messages.attachments.set(key, [...(messages.attachments.get(key) ?? []), envelope.attachment]);
    }
    if (envelope.testCaseFinished !== undefined) messages.finished.push(envelope.testCaseFinished);
  }
  return messages;
}

/** The Gherkin steps, scenarios and example rows of a feature, its rules' included. */
function addFeature(messages: Messages, children: readonly Child[], feature: string, rule: string | null): void {
  for (const child of children) {
    for (const step of [...(child.background?.steps ?? []), ...(child.scenario?.steps ?? [])])
      messages.gherkinSteps.set(step.id, step);
    if (child.scenario !== undefined) {
      messages.scenarios.set(child.scenario.id, { scenario: child.scenario, feature, rule });
      for (const examples of child.scenario.examples) {
        const header = examples.tableHeader?.cells.map((cell) => cell.value) ?? [];
        for (const row of examples.tableBody) {
          messages.exampleRows.set(row.id, {
            header,
            values: row.cells.map((cell) => cell.value),
            line: row.location.line,
          });
        }
      }
    }
    if (child.rule !== undefined) addFeature(messages, child.rule.children, feature, child.rule.name);
  }
}

/** The scenario's steps as they ran, hooks included, and the files they attached. */
function stepsOf(
  messages: Messages,
  run: TestCaseStarted,
  testCase: TestCase,
  pickle: Pickle,
): { steps: TestStep[]; files: ConvertedAttachment[] } {
  const files: ConvertedAttachment[] = [];
  let seenPickleStep = false;
  const steps = testCase.testSteps.map((testStep): TestStep => {
    const key = `${run.id}/${testStep.id}`;
    const result = messages.stepResults.get(key);
    const pickleStep = pickle.steps.find((step) => step.id === testStep.pickleStepId);
    const gherkin = pickleStep === undefined ? undefined : messages.gherkinSteps.get(pickleStep.astNodeIds[0] ?? '');
    if (pickleStep !== undefined) seenPickleStep = true;
    const hook = testStep.hookId === undefined ? undefined : messages.hooks.get(testStep.hookId);
    const hookName = hook?.name ?? (seenPickleStep ? 'After hook' : 'Before hook');
    const keyword = gherkin?.keyword.trim() ?? null;
    const step: TestStep = {
      name: pickleStep === undefined ? hookName : `${keyword ?? ''} ${pickleStep.text}`.trim(),
      category: pickleStep === undefined ? 'hook' : keyword,
      status: result === undefined ? 'skipped' : stepStatus(result),
      start: messages.stepStarts.get(key) ?? null,
      duration: result === undefined ? null : ms(result.duration),
      error: result === undefined ? null : errorOf(result),
      parameters: [],
      dataTable: pickleStep?.argument?.dataTable?.rows.map((row) => row.cells.map((cell) => cell.value)) ?? null,
      docString: pickleStep?.argument?.docString?.content ?? null,
      attachments: [],
      steps: [],
    };
    for (const attachment of messages.attachments.get(key) ?? []) files.push(attachmentFile(attachment, step));
    return step;
  });
  return { steps, files };
}

function attachmentFile(attachment: MessageAttachment, step: TestStep): ConvertedAttachment {
  return {
    name: attachment.fileName ?? (attachment.mediaType.startsWith('image/') ? 'screenshot' : 'attachment'),
    type: attachment.mediaType,
    body: attachment.contentEncoding === 'BASE64' ? Buffer.from(attachment.body, 'base64') : attachment.body,
    step,
  };
}

/** Where the scenario is: its file, feature and rule as suites, its line, and its example row as parameters. */
function placeOf(messages: Messages, pickle: Pickle): Pick<ResultDraft, 'file' | 'line' | 'suites' | 'parameters'> {
  const found = messages.scenarios.get(pickle.astNodeIds[0] ?? '');
  const row = messages.exampleRows.get(pickle.astNodeIds[1] ?? '');
  const parameters: Parameter[] =
    row === undefined ? [] : row.header.map((name, index) => ({ name, value: row.values[index] ?? '' }));
  const file = pickle.uri.replaceAll('\\', '/');
  const feature = found?.feature ?? file;
  const suites = [file, feature, ...(found?.rule === null || found?.rule === undefined ? [] : [found.rule])];
  return { file, line: row?.line ?? found?.scenario.location.line ?? null, suites, parameters };
}

/** One converted result per scenario run in a profile's messages (its last attempt; earlier ones are retries). */
export function convertCucumber(ndjson: string, profile: string): Converted[] {
  const messages = indexMessages(parseEnvelopes(ndjson, profile));
  const browser = BROWSER_OF_PROFILE[profile] ?? null;
  const earlier = new Map<string, Retry[]>();
  const results: Converted[] = [];

  for (const done of messages.finished) {
    const run = messages.started.get(done.testCaseStartedId);
    const testCase = run === undefined ? undefined : messages.testCases.get(run.testCaseId);
    const pickle = testCase === undefined ? undefined : messages.pickles.get(testCase.pickleId);
    if (run === undefined || testCase === undefined || pickle === undefined) {
      throw new CucumberMessagesError(`the ${profile} messages end a scenario they never started`);
    }
    const { steps, files } = stepsOf(messages, run, testCase, pickle);
    const status = scenarioStatus(steps);
    const error = steps.find((step) => step.error !== null)?.error ?? null;
    if (done.willBeRetried) {
      const duration = steps.map((step) => step.duration ?? 0).reduce((sum, value) => sum + value, 0);
      earlier.set(testCase.pickleId, [
        ...(earlier.get(testCase.pickleId) ?? []),
        { status, duration, message: error?.message ?? null },
      ]);
      continue;
    }

    const start = ms(run.timestamp);
    const stop = Math.max(ms(done.timestamp), start);
    const place = placeOf(messages, pickle);
    const draft: ResultDraft = {
      name: pickle.name,
      fullName: [...place.suites.slice(1), pickle.name].join(' > '),
      status,
      start,
      stop,
      duration: stop - start,
      ...place,
      error,
      steps,
      attachments: [],
      stdout: [],
      stderr: [],
      retries: earlier.get(testCase.pickleId) ?? [],
      labels: { tags: pickle.tags.map((tag) => tag.name), browser, worker: run.workerId ?? null },
    };
    results.push(converted(draft, files));
  }
  return results;
}
