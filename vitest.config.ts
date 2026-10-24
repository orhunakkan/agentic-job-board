import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    allowOnly: false,
    passWithNoTests: false,
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
      { extends: true, test: { name: 'api', include: ['tests/api/**/*.test.ts'] } },
      { extends: true, test: { name: 'contract', include: ['tests/contract/**/*.test.ts'] } },
      { extends: true, test: { name: 'security', include: ['tests/security/**/*.test.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // PLAN.md §8.3. These numbers may only go up.
      thresholds: {
        lines: 85,
        'src/domain/**/*.ts': { lines: 95 },
        'src/ingest/**/*.ts': { lines: 95 },
        'src/sources/**/*.ts': { lines: 95 }, // Phase 10: parsers of untrusted feeds, held to the ingest bar
      },
    },
  },
});
