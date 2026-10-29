import { describe, expect, it } from 'vitest';
import {
  buildMatrix,
  cucumberCases,
  playwrightCases,
  REQUIREMENTS,
  requirementIds,
  vitestCases,
} from '../../../scripts/traceability.ts';

describe('scripts/traceability.ts', () => {
  it('NFR-09: reads the requirement IDs at the start of a test name only', () => {
    expect(requirementIds('FR-07: lists the board')).toEqual(['FR-07']);
    expect(requirementIds('FR-07, FR-10, NFR-06: board and detail')).toEqual(['FR-07', 'FR-10', 'NFR-06']);
    expect(requirementIds('a helper that mentions FR-07: inside')).toEqual([]);
    expect(requirementIds('DEC-006: no script')).toEqual([]);
  });

  it('NFR-09: lists every FR and NFR of PLAN.md §3 once', () => {
    const ids = REQUIREMENTS.map((requirement) => requirement.id);

    expect(ids).toEqual([
      ...Array.from({ length: 22 }, (_, index) => `FR-${String(index + 1).padStart(2, '0')}`),
      ...Array.from({ length: 12 }, (_, index) => `NFR-${String(index + 1).padStart(2, '0')}`),
    ]);
  });

  it('NFR-09: reads Vitest and Playwright JSON reports', () => {
    const vitest = vitestCases(
      {
        testResults: [
          {
            name: 'C:/repo/tests/unit/a.test.ts',
            assertionResults: [
              { title: 'FR-01: ok', status: 'passed' },
              { title: 'FR-02: broken', status: 'failed' },
            ],
          },
        ],
      },
      'C:/repo/',
    );
    const playwright = playwrightCases({
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  title: 'NFR-06: board',
                  file: 'a11y.spec.ts',
                  tests: [
                    { projectName: 'chromium', status: 'expected' },
                    { projectName: 'webkit', status: 'unexpected' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(vitest).toEqual([
      { file: 'tests/unit/a.test.ts', name: 'FR-01: ok', passed: true },
      { file: 'tests/unit/a.test.ts', name: 'FR-02: broken', passed: false },
    ]);
    expect(playwright).toEqual([
      { file: 'tests/e2e/a11y.spec.ts', name: 'NFR-06: board [chromium]', passed: true },
      { file: 'tests/e2e/a11y.spec.ts', name: 'NFR-06: board [webkit]', passed: false },
    ]);
  });

  it('NFR-09: marks passing, failing, untested and retired requirements in the matrix', () => {
    const markdown = buildMatrix(
      [
        { file: 'tests/a.test.ts', name: 'FR-01: ok', passed: true },
        { file: 'tests/a.test.ts', name: 'FR-04: broken | piped', passed: false },
        { file: 'tests/a.test.ts', name: 'helper', passed: true },
      ],
      '2026-10-23',
      'p95 20 ms',
    );

    expect(markdown).toContain('**3 tests, 1 failing.** 1 tests check supporting rules');
    expect(markdown).toContain('| FR-01 | Candidate profile | 1/1 | ✅ pass | `tests/a.test.ts` |');
    expect(markdown).toContain('| FR-04 | Deduplication | 0/1 | ❌ 1 failing |');
    expect(markdown).toContain('| FR-07 | Board | 0/0 | ⚠️ no named test |');
    expect(markdown).toContain(
      '| FR-03 | Email parsing | 0/0 | 🗄️ retired |  | Gmail track retired in Phase 11 (DEC-041) |',
    );
    expect(markdown).toContain('- Gmail track retired in Phase 11 (DEC-041).');
    expect(markdown).toContain('last run: p95 20 ms');
    expect(markdown).toContain('❌ `tests/a.test.ts`: FR-04: broken \\| piped');
  });
});

describe('scripts/traceability.ts: the BDD scenarios (Phase 13)', () => {
  // A Cucumber JSON report as the json formatter writes it: tags include the feature's, hooks are hidden steps.
  const passed = { result: { status: 'passed' } };
  const report = [
    {
      uri: 'tests\\features\\e2e\\notes.feature',
      name: 'Notes on a job',
      tags: [{ name: '@FR-09' }],
      elements: [
        {
          type: 'scenario',
          name: 'Notes are still there after a reload',
          tags: [{ name: '@FR-09' }, { name: '@smoke' }, { name: '@FR-10' }],
          steps: [passed, { hidden: true, ...passed }],
        },
        {
          type: 'scenario',
          name: 'A note | with a pipe',
          tags: [{ name: '@FR-09' }],
          steps: [passed, { result: { status: 'undefined' } }, { result: { status: 'skipped' } }],
        },
      ],
    },
  ];

  it('NFR-09: reads a Cucumber JSON report: one case per scenario, its requirement tags, suite and browser', () => {
    expect(cucumberCases(report, 'e2e-firefox')).toEqual([
      {
        feature: 'tests/features/e2e/notes.feature',
        name: 'Notes are still there after a reload',
        suite: 'e2e',
        browser: 'Firefox',
        requirements: ['FR-09', 'FR-10'],
        passed: true,
      },
      {
        feature: 'tests/features/e2e/notes.feature',
        name: 'A note | with a pipe',
        suite: 'e2e',
        browser: 'Firefox',
        requirements: ['FR-09'],
        passed: false,
      },
    ]);
    expect(cucumberCases(report, 'e2e-mobile')[0]?.browser).toBe('Pixel 7');
    expect(
      cucumberCases([{ ...report[0], uri: 'tests/features/api/notes.feature' }], 'api').map((test) => [
        test.suite,
        test.browser,
      ]),
    ).toEqual([
      ['api', null],
      ['api', null],
    ]);
  });

  it('NFR-09: lists the BDD scenarios under their requirements, below the matrix, which stays as it was', () => {
    const cases = [{ file: 'tests/a.test.ts', name: 'FR-09: ok', passed: true }];
    const matrix = buildMatrix(cases, '2026-10-29', null);
    const markdown = buildMatrix(cases, '2026-10-29', null, [
      ...cucumberCases(report, 'e2e-chromium'),
      ...cucumberCases(report, 'e2e-webkit'),
    ]);

    expect(markdown.startsWith(matrix)).toBe(true);
    expect(markdown).toContain('## BDD scenarios');
    expect(markdown).toContain('**4 scenario runs, 2 failing.**');
    expect(markdown).toContain('| FR-09 | Notes | 4 | 2 | ❌ 2 failing |');
    expect(markdown).toContain('| FR-10 | Job detail | 2 | 2 | ✅ pass |');
    // A requirement without scenarios is left out of the BDD table.
    expect(markdown.slice(matrix.length)).not.toContain('| FR-01 |');
    expect(markdown).toContain(
      '- ✅ `tests/features/e2e/notes.feature`: Notes are still there after a reload [Chromium]',
    );
    expect(markdown).toContain('- ❌ `tests/features/e2e/notes.feature`: A note \\| with a pipe [WebKit]');
  });

  it('NFR-09: says so when there is no Cucumber report', () => {
    expect(buildMatrix([], '2026-10-29', null, [])).toContain('No Cucumber report was found');
  });

  it('NFR-02: the requirement reads as PLAN.md §3.2 has it since DEC-055', () => {
    expect(REQUIREMENTS.find((requirement) => requirement.id === 'NFR-02')?.title).toBe(
      'Every npm dependency listed in PLAN.md §7, no overrides, npm audit passes',
    );
  });
});
