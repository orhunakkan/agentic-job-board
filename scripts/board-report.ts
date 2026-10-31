// board-report's command (PLAN.md Phase 14 task 8): every test script in package.json runs through it.
//   node scripts/board-report.ts <step>... [-- extra arguments for the one step's runner]
//   node scripts/board-report.ts all       one run of every test type, then one report (npm run test:all)
//   node scripts/board-report.ts build     a report from whatever results are in reports/test-results/
// Steps: static, unit, integration, api, contract, security, coverage, e2e, smoke, bdd-integration, bdd-api, bdd-e2e,
// bdd-smoke, perf (and `bdd` for the first three BDD suites). What a command does is in board-report/command.ts.
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from '../src/app.ts';
import { createRepositories } from '../src/db/repositories/index.ts';
import { createLogger } from '../src/logger.ts';
import { buildReport } from './board-report/build/build.ts';
import { githubSummary, planOf, runCommand, type CommandDeps } from './board-report/command.ts';
import { thresholdsOf } from './board-report/converters/coverage.ts';
import { collectEnvironment } from './board-report/environment.ts';
import { readHistory, writeHistory } from './board-report/history.ts';
import { processRunner } from './board-report/processes.ts';
import { runStep, type PerfApp } from './board-report/steps.ts';
import { seedDatabase } from './seed.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const RESULTS = join(root, 'reports', 'test-results');
const REPORT = join(root, 'reports', 'board-report');
const HISTORY = join(root, 'reports', 'board-report-history.jsonl');

/** `test:all` runs k6 against its own app on 5,000 fake jobs, like CI does (PLAN.md Phase 14 task 8). */
async function startPerfApp(): Promise<PerfApp> {
  const dir = mkdtempSync(join(tmpdir(), 'board-report-perf-'));
  const app = await startApp({
    port: 0,
    dbPath: join(dir, 'perf.db'),
    linkedinSessionPath: join(dir, 'no-session.json'),
    linkedinSearchesPath: join(dir, 'no-linkedin-searches.json'),
    sourcesPath: join(dir, 'no-sources.json'),
    claudeCommand: ['claude-is-never-started-by-the-load-test'],
    logger: createLogger('warn'),
  });
  seedDatabase(app.db, createRepositories(app.db), { count: 5000, seed: 1, until: new Date().toISOString() });
  console.log(`  k6 target: ${app.url} (5,000 seeded jobs)`);
  return {
    url: app.url,
    async close() {
      await app.close(0);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function coverageThresholds() {
  const config = (await import('../vitest.config.ts')).default;
  return thresholdsOf(config.test?.coverage?.thresholds);
}

const deps: CommandDeps = {
  append: process.env['BOARD_REPORT_APPEND'] === '1',
  clean() {
    rmSync(RESULTS, { recursive: true, force: true });
  },
  runStep(step, plan) {
    return runStep({
      step,
      dir: join(RESULTS, step),
      root,
      extraArgs: plan.extraArgs,
      processes: processRunner(root),
      thresholds: coverageThresholds,
      perfApp: plan.managedPerf ? startPerfApp : null,
      log: (line) => {
        console.log(line);
      },
    });
  },
  build() {
    const { index, runs } = buildReport({
      resultsDir: RESULTS,
      outDir: REPORT,
      history: readHistory(HISTORY),
      environment: collectEnvironment(),
      builtAt: new Date().toISOString(),
    });
    writeHistory(HISTORY, runs);
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary !== undefined && summary !== '') appendFileSync(summary, githubSummary(index));
    return index;
  },
  log(line) {
    console.log(line);
  },
};

if (import.meta.main) {
  process.exitCode = await runCommand(planOf(process.argv.slice(2)), deps);
}
