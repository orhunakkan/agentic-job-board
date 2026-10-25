// Builds docs/traceability.md from real test results (PLAN.md Phase 8 task 1): every FR and NFR, the tests that
// name it (test names start with the IDs they cover, e.g. "FR-07, FR-10: …"), and how those tests did.
//   npx vitest run --reporter=json --outputFile=reports/vitest.json
//   PLAYWRIGHT_JSON_OUTPUT_NAME=reports/playwright.json npx playwright test --reporter=json
//   node scripts/traceability.ts [--k6 "<p95 summary>"]
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

export interface Requirement {
  id: string;
  title: string;
  /** How it is verified besides the named tests (shown in the matrix), or why it can only be checked by hand. */
  also?: string;
  /** Why the requirement no longer applies; its tests went with the feature it covered. */
  retired?: string;
}

export const REQUIREMENTS: readonly Requirement[] = [
  { id: 'FR-01', title: 'Candidate profile' },
  { id: 'FR-02', title: 'Email ingestion', retired: 'Gmail track retired in Phase 11 (DEC-041)' },
  { id: 'FR-03', title: 'Email parsing', retired: 'Gmail track retired in Phase 11 (DEC-041)' },
  { id: 'FR-04', title: 'Deduplication' },
  { id: 'FR-05', title: 'Idempotency', retired: 'Gmail track retired in Phase 11 (DEC-041)' },
  { id: 'FR-06', title: 'Triage scoring', also: 'Calibration set at CP-5: 6/6 on target' },
  { id: 'FR-07', title: 'Board' },
  { id: 'FR-08', title: 'Status workflow' },
  { id: 'FR-09', title: 'Notes' },
  { id: 'FR-10', title: 'Job detail' },
  { id: 'FR-11', title: 'Run history' },
  { id: 'FR-12', title: 'Unrecognized emails', retired: 'Gmail track retired in Phase 11 (DEC-041)' },
  {
    id: 'FR-13',
    title: 'Agent summary',
    also: 'Printed by Claude at the end of /find-jobs (agent/find-jobs.md step 6); checked by hand at CP-5',
  },
  {
    id: 'FR-14',
    title: 'LinkedIn login',
    also: 'Signing in with node scripts/linkedin-login.ts is checked by hand at CP-9 (it needs a real LinkedIn account)',
  },
  {
    id: 'FR-15',
    title: 'Other sources',
    also: 'Live dry run against the real feeds on 2026-10-24: 40 requests, 4,887 jobs, 137 matching, no failures',
  },
  { id: 'FR-16', title: 'Listing deduplication' },
  { id: 'FR-17', title: 'LinkedIn and other sources apart' },
  {
    id: 'FR-18',
    title: 'LinkedIn search',
    also: "Live runs on 2026-10-25 with the owner's session: 4 searches, 13 pages, 301 cards; comparison with a week of alert emails",
  },
  {
    id: 'FR-19',
    title: 'LinkedIn job details',
    also: 'Live job pages read on 2026-10-25 (description, salary, workplace, posted time, closed)',
  },
  {
    id: 'FR-20',
    title: 'Scoring on the description',
    also: 'Calibration set re-scored with match-v1 on 2026-10-25: 6/6 on the expected label (Agilent strong, DEC-050)',
  },
  { id: 'NFR-01', title: 'Localhost only' },
  { id: 'NFR-02', title: 'No new npm dependencies', also: '`npm run audit` in CI' },
  { id: 'NFR-03', title: 'The app server makes no outbound requests' },
  {
    id: 'NFR-04',
    title: 'Gmail read-only; from Phase 11 not used at all',
    also: 'Only search_threads and get_thread were called in every live run, the last one the Phase 11 comparison',
  },
  { id: 'NFR-05', title: 'Board and API p95 < 200 ms with 5,000 jobs', also: 'k6: `tests/perf/load.ts`' },
  { id: 'NFR-06', title: 'Accessibility: no axe violations (WCAG 2.2 AA)' },
  { id: 'NFR-07', title: 'HTML escaping and parameterized SQL' },
  { id: 'NFR-08', title: 'Personal data stays under data/; fixtures sanitized' },
  { id: 'NFR-09', title: 'Every API input validated with Zod' },
  {
    id: 'NFR-10',
    title: "Works on the owner's Windows 11 machine",
    also: "Every suite runs on the owner's Windows 11 machine (Git Bash and PowerShell); CI runs them on Linux",
  },
  { id: 'NFR-11', title: 'Responsive down to 375 px', also: 'Every E2E test also runs on the Pixel 7 project' },
  { id: 'NFR-12', title: 'The saved LinkedIn session stays local and secret' },
];

export interface TestCase {
  file: string;
  name: string;
  passed: boolean;
}

const ID_PREFIX = /^((?:N?FR-\d{2})(?:,\s*N?FR-\d{2})*):/;

export function requirementIds(name: string): string[] {
  return ID_PREFIX.exec(name)?.[1]?.split(/,\s*/) ?? [];
}

// --- Report readers ----------------------------------------------------------------------------------------

const VitestReport = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      assertionResults: z.array(z.object({ title: z.string(), status: z.string() })),
    }),
  ),
});

export function vitestCases(report: unknown, root: string): TestCase[] {
  return VitestReport.parse(report).testResults.flatMap((file) =>
    file.assertionResults.map((test) => ({
      file: relative(file.name, root),
      name: test.title,
      passed: test.status === 'passed',
    })),
  );
}

interface PlaywrightSuite {
  specs?: { title: string; file: string; tests: { projectName: string; status: string }[] }[] | undefined;
  suites?: PlaywrightSuite[] | undefined;
}

const PlaywrightSuiteSchema: z.ZodType<PlaywrightSuite> = z.lazy(() =>
  z.object({
    specs: z
      .array(
        z.object({
          title: z.string(),
          file: z.string(),
          tests: z.array(z.object({ projectName: z.string(), status: z.string() })),
        }),
      )
      .optional(),
    suites: z.array(PlaywrightSuiteSchema).optional(),
  }),
);

/** One case per spec and browser project; "expected" is a pass in Playwright's JSON report. */
export function playwrightCases(report: unknown): TestCase[] {
  const { suites } = z.object({ suites: z.array(PlaywrightSuiteSchema) }).parse(report);
  const walk = (suite: PlaywrightSuite): TestCase[] => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        file: `tests/e2e/${spec.file.replaceAll('\\', '/')}`,
        name: `${spec.title} [${test.projectName}]`,
        passed: test.status === 'expected',
      })),
    ),
    ...(suite.suites ?? []).flatMap(walk),
  ];
  return suites.flatMap(walk);
}

function relative(path: string, root: string): string {
  const normalized = path.replaceAll('\\', '/');
  const base = root.replaceAll('\\', '/');
  return normalized.startsWith(base) ? normalized.slice(base.length) : normalized;
}

// --- The matrix --------------------------------------------------------------------------------------------

export function buildMatrix(cases: readonly TestCase[], generatedAt: string, k6: string | null): string {
  const byRequirement = new Map(REQUIREMENTS.map((requirement) => [requirement.id, [] as TestCase[]]));
  for (const test of cases) {
    for (const id of requirementIds(test.name)) byRequirement.get(id)?.push(test);
  }
  const unnamed = cases.filter((test) => requirementIds(test.name).length === 0).length;
  const failed = cases.filter((test) => !test.passed).length;

  const rows = REQUIREMENTS.map((requirement) => {
    const tests = byRequirement.get(requirement.id) ?? [];
    const passed = tests.filter((test) => test.passed).length;
    const files = [...new Set(tests.map((test) => `\`${test.file}\``))].join(', ');
    const result =
      tests.length === 0
        ? requirement.retired === undefined
          ? '⚠️ no named test'
          : '🗄️ retired'
        : passed === tests.length
          ? '✅ pass'
          : `❌ ${String(tests.length - passed)} failing`;
    const also = [
      requirement.retired,
      requirement.also,
      requirement.id === 'NFR-05' && k6 !== null ? `last run: ${k6}` : undefined,
    ]
      .filter((text) => text !== undefined)
      .join('; ');
    return `| ${requirement.id} | ${requirement.title} | ${String(passed)}/${String(tests.length)} | ${result} | ${files} | ${also} |`;
  });

  const details = REQUIREMENTS.map((requirement) => {
    const tests = byRequirement.get(requirement.id) ?? [];
    const lines = tests
      .toSorted((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name))
      .map((test) => `- ${test.passed ? '✅' : '❌'} \`${test.file}\`: ${test.name.replaceAll('|', '\\|')}`);
    return [
      `<details><summary><b>${requirement.id}</b> ${requirement.title} (${String(tests.length)} tests)</summary>`,
      '',
      ...(lines.length > 0
        ? lines
        : [requirement.retired === undefined ? '- No named test.' : `- ${requirement.retired}.`]),
      '',
      '</details>',
    ].join('\n');
  });

  return `# Traceability matrix

Every requirement of PLAN.md §3, the tests that cover it, and their result in the last full run. Generated by \`scripts/traceability.ts\` from the Vitest and Playwright JSON reports on ${generatedAt}; do not edit by hand. A test covers a requirement when its name starts with the requirement's ID (\`it('FR-04: …')\`). Playwright tests count once per browser project (chromium, firefox, webkit, mobile).

**${String(cases.length)} tests, ${String(failed)} failing.** ${String(unnamed)} tests check supporting rules (tooling, helpers) and name no requirement.

| ID | Requirement | Passing | Result | Test files | Also verified by |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## Tests per requirement

${details.join('\n\n')}
`;
}

if (import.meta.main) {
  const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const k6Index = process.argv.indexOf('--k6');
  const k6 = k6Index === -1 ? null : (process.argv[k6Index + 1] ?? null);
  const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

  const cases = [
    ...vitestCases(read('reports/vitest.json'), root),
    ...playwrightCases(read('reports/playwright.json')),
  ];
  const markdown = buildMatrix(cases, new Date().toISOString().slice(0, 10), k6);
  writeFileSync(new URL('../docs/traceability.md', import.meta.url), markdown);
  console.log(
    `docs/traceability.md: ${String(cases.length)} tests, ${String(cases.filter((test) => !test.passed).length)} failing`,
  );
}
