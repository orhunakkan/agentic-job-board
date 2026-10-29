import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import playwrightConfig from '../../playwright.config.ts';
import { convertCucumber } from '../../scripts/board-report/converters/cucumber.ts';
import { writeConverted } from '../../scripts/board-report/converters/write.ts';
import { BoardReportVitestReporter } from '../../scripts/board-report/reporters/vitest.ts';
import { readResults, STEPS, TestResult } from '../../scripts/board-report/result-schema.ts';
import vitestConfig from '../../vitest.config.ts';

// NFR-13: every test command goes through board-report (PLAN.md Phase 14 tasks 9, 10 and 14), every runner names its
// board-report reporter or formatter, and the results of a real small run match the result format.

const root = fileURLToPath(new URL('../../', import.meta.url));
const scripts = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).scripts;

describe('board-report is connected to every test type (NFR-13)', () => {
  const tests = Object.entries(scripts).filter(([name]) => name.startsWith('test:'));

  it('NFR-13: every test script in package.json goes through scripts/board-report.ts', () => {
    expect(tests.length).toBe(16);
    for (const [name, command] of tests) expect(command, name).toMatch(/^node scripts\/board-report\.ts [a-z0-9-]+$/);
    expect(scripts['test:all']).toBe('node scripts/board-report.ts all');
    expect(scripts['report']).toBe('node scripts/board-report/open.ts');
    // check runs the coverage step, so it writes a report too; the static gates stay as they were.
    expect(scripts['check']).toBe('npm run typecheck && npm run lint && npm run format:check && npm run test:coverage');
  });

  it('NFR-13: every step can be run on its own from an npm script', () => {
    const named = new Set(tests.map(([, command]) => command.split(' ').at(-1)));
    const viaAlias = new Map([['bdd', ['bdd-integration', 'bdd-api', 'bdd-e2e']]]);
    const reachable = new Set([...named].flatMap((step) => viaAlias.get(step ?? '') ?? [step]));

    expect(STEPS.filter((step) => !reachable.has(step))).toEqual([]);
  });

  it('NFR-13: Vitest runs board-report’s reporter next to the default one, with test locations', () => {
    const test = vitestConfig.test;

    expect(test?.reporters).toEqual(['default', expect.any(BoardReportVitestReporter)]);
    expect(test?.includeTaskLocation).toBe(true);
    expect(test?.coverage?.include).toContain('scripts/board-report/**/*.ts');
    expect(test?.coverage?.exclude).toContain('scripts/board-report/client/**');
    expect(test?.coverage?.thresholds).toMatchObject({ lines: 85, 'scripts/board-report/**/*.ts': { lines: 90 } });
  });

  it('NFR-13: Playwright runs board-report’s reporter next to list and html, and keeps screenshots, videos and traces of failures', () => {
    expect(playwrightConfig.reporter).toEqual([
      ['list'],
      ['html', { open: 'never' }],
      ['./scripts/board-report/reporters/playwright.ts'],
    ]);
    expect(playwrightConfig.use).toMatchObject({
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    });
  });

  it('NFR-13: scripts/bdd.ts adds Cucumber’s message formatter in the profile’s results folder, and cucumber.json is unchanged', () => {
    const bdd = readFileSync(join(root, 'scripts', 'bdd.ts'), 'utf8');
    const cucumber = z
      .record(z.string(), z.object({ format: z.array(z.string()) }))
      .parse(JSON.parse(readFileSync(join(root, 'cucumber.json'), 'utf8')));

    expect(bdd).toContain("...messageFormat(profile, process.env['BOARD_REPORT_RESULTS'])");
    for (const [profile, options] of Object.entries(cucumber)) {
      expect(options.format).toEqual([
        'progress',
        `json:reports/cucumber/${profile}.json`,
        `html:reports/cucumber/${profile}.html`,
      ]);
    }
  });
});

describe('a real small run matches the result format (NFR-13)', () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 120_000,
    });

  it('NFR-13: Vitest’s results', { timeout: 120_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-report-contract-'));
    const done = run(
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--project',
        'unit',
        'tests/unit/banner.test.ts',
        '--coverage.enabled=false',
      ],
      {
        BOARD_REPORT_RESULTS: dir,
        BOARD_REPORT_STEP: 'unit',
      },
    );
    const results = readResults(dir).map(({ result }) => result);

    expect(done.status, done.stderr).toBe(0);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect(TestResult.safeParse(result).success).toBe(true);
    expect(results.every((result) => result.file === 'tests/unit/banner.test.ts' && result.line !== null)).toBe(true);
  });

  it('NFR-13: Cucumber’s messages, converted', { timeout: 120_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-report-contract-'));
    const messages = relative(root, join(dir, 'messages.ndjson')).replaceAll('\\', '/');
    const done = run([
      'node_modules/@cucumber/cucumber/bin/cucumber.js',
      'tests/features/integration/run-history.feature',
      '--import',
      'tests/features/support/**/*.ts',
      '--import',
      'tests/features/integration/steps/**/*.ts',
      '--format',
      `message:${messages}`,
    ]);
    const results = writeConverted(
      join(dir, 'results'),
      'bdd-integration',
      convertCucumber(readFileSync(join(root, messages), 'utf8'), 'integration'),
    );

    expect(done.status, done.stdout).toBe(0);
    expect(results.length).toBeGreaterThan(0);
    for (const result of readResults(join(dir, 'results')))
      expect(TestResult.safeParse(result.result).success).toBe(true);
    expect(results.every((result) => result.labels.requirements.includes('FR-11'))).toBe(true);
  });
});
