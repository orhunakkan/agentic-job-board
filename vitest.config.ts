import { defineConfig } from 'vitest/config';
import { BoardReportVitestReporter } from './scripts/board-report/reporters/vitest.ts';

export default defineConfig({
  test: {
    allowOnly: false,
    passWithNoTests: false,
    // board-report (PLAN.md Phase 14) next to the default output; it writes only when scripts/board-report.ts runs Vitest.
    reporters: ['default', new BoardReportVitestReporter()],
    includeTaskLocation: true,
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
      { extends: true, test: { name: 'api', include: ['tests/api/**/*.test.ts'] } },
      { extends: true, test: { name: 'contract', include: ['tests/contract/**/*.test.ts'] } },
      { extends: true, test: { name: 'security', include: ['tests/security/**/*.test.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      // board-report's own code too (Phase 14); its client runs in the browser and is tested in E2E.
      include: ['src/**/*.ts', 'scripts/board-report/**/*.ts'],
      exclude: ['scripts/board-report/client/**'],
      reporter: ['text', 'html', 'json-summary'],
      // PLAN.md §8.3. These numbers may only go up.
      thresholds: {
        lines: 85,
        'src/domain/**/*.ts': { lines: 95 },
        'src/ingest/**/*.ts': { lines: 95 },
        'src/sources/**/*.ts': { lines: 95 }, // Phase 10: parsers of untrusted feeds, held to the ingest bar
        'scripts/board-report/**/*.ts': { lines: 90 }, // Phase 14
      },
    },
  },
});
