// The report's data files (PLAN.md Phase 14 task 7), shared by the build, which writes them, and the client, which
// reads them (it imports these types only, so nothing of this file reaches the browser).
//   data/index.js         window.boardReport.index(<ReportIndex>)        every test, small enough to list them all
//   data/tests/<id>.js    window.boardReport.test("<id>", <TestDetail>)  one test's details, loaded when it is opened
import type { Category } from '../categories.ts';
import type { Totals } from '../history.ts';
import type { ErrorInfo, Parameter, Severity, Status, Step, TestType } from '../result-schema.ts';

export interface TypeInfo {
  id: TestType;
  title: string;
  /** Which colour family the type's colour belongs to (PLAN.md Phase 14 task 6). */
  family: 'vitest' | 'browser' | 'bdd' | 'static' | 'performance';
}

export interface CategoryInfo {
  id: Category;
  title: string;
}

export interface RequirementInfo {
  id: string;
  title: string;
  /** PLAN.md §3 on GitHub; null when the repository can't be told. */
  url: string | null;
  retired: boolean;
}

export interface EnvironmentInfo {
  name: string;
  value: string;
  url: string | null;
}

export interface TestEntry {
  id: string;
  historyId: string;
  name: string;
  fullName: string;
  type: TestType;
  status: Status;
  /** Milliseconds since the epoch. */
  start: number;
  stop: number;
  duration: number;
  file: string | null;
  line: number | null;
  /** The source line on GitHub at the run's commit; null without a repository, commit or file. */
  sourceUrl: string | null;
  suites: string[];
  requirements: string[];
  tags: string[];
  severity: Severity;
  browser: string | null;
  worker: string | null;
  step: Step;
  parameters: Parameter[];
  category: Category | null;
  flaky: boolean;
  /** The first line of the error, for lists; null when the test has none. */
  errorLine: string | null;
  /** This test's status in its last runs, oldest first, this run last (up to 20). */
  history: Status[];
}

export interface RunPoint {
  time: string;
  commit: string | null;
  duration: number;
  totals: Totals;
}

export interface ReportIndex {
  title: 'board-report';
  builtAt: string;
  repository: string | null;
  commit: string | null;
  branch: string | null;
  types: TypeInfo[];
  categories: CategoryInfo[];
  requirements: RequirementInfo[];
  environment: EnvironmentInfo[];
  /** The last runs, oldest first, this run last. */
  trend: RunPoint[];
  totals: Totals;
  /** Wall time of the run, in milliseconds. */
  duration: number;
  tests: TestEntry[];
}

export type AttachmentKind = 'image' | 'video' | 'text' | 'json' | 'trace' | 'file';

export interface AttachmentView {
  name: string;
  type: string;
  kind: AttachmentKind;
  /** The file, relative to the report's index.html. */
  path: string;
  /** For text and JSON: the content to show (JSON pretty-printed), cut at 200 KB. */
  text: string | null;
  truncated: boolean;
}

export interface StepView {
  name: string;
  category: string | null;
  status: Status;
  duration: number | null;
  error: ErrorInfo | null;
  parameters: Parameter[];
  dataTable: string[][] | null;
  docString: string | null;
  attachments: AttachmentView[];
  steps: StepView[];
}

export interface TestDetail {
  id: string;
  error: ErrorInfo | null;
  steps: StepView[];
  attachments: AttachmentView[];
  stdout: string[];
  stderr: string[];
  retries: { status: Status; duration: number; message: string | null }[];
}
