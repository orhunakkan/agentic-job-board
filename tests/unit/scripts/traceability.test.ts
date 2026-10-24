import { describe, expect, it } from 'vitest';
import {
  buildMatrix,
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
      ...Array.from({ length: 17 }, (_, index) => `FR-${String(index + 1).padStart(2, '0')}`),
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

  it('NFR-09: marks passing, failing and untested requirements in the matrix', () => {
    const markdown = buildMatrix(
      [
        { file: 'tests/a.test.ts', name: 'FR-01: ok', passed: true },
        { file: 'tests/a.test.ts', name: 'FR-02: broken | piped', passed: false },
        { file: 'tests/a.test.ts', name: 'helper', passed: true },
      ],
      '2026-10-23',
      'p95 20 ms',
    );

    expect(markdown).toContain('**3 tests, 1 failing.** 1 tests check supporting rules');
    expect(markdown).toContain('| FR-01 | Candidate profile | 1/1 | ✅ pass | `tests/a.test.ts` |');
    expect(markdown).toContain('| FR-02 | Email ingestion | 0/1 | ❌ 1 failing |');
    expect(markdown).toContain('| FR-03 | Email parsing | 0/0 | ⚠️ no named test |');
    expect(markdown).toContain('last run: p95 20 ms');
    expect(markdown).toContain('❌ `tests/a.test.ts`: FR-02: broken \\| piped');
  });
});
