// Runs the Cucumber suites behind the test:bdd scripts (PLAN.md Phase 13): every profile of the suites named, one
// after another, and every one of them even when one fails, so a run always reports on each suite. Each profile's old
// report is removed before it runs, so every report in reports/cucumber/ comes from the latest run of its profile.
// Run by scripts/board-report.ts, each profile also writes Cucumber's messages to its own results folder (Phase 14).
//   node scripts/bdd.ts [integration] [api] [e2e] [smoke]     (none named: integration, api and e2e)
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITES: Readonly<Record<string, readonly string[]>> = {
  integration: ['integration'],
  api: ['api'],
  e2e: ['e2e-chromium', 'e2e-firefox', 'e2e-webkit', 'e2e-mobile'],
  smoke: ['smoke'],
};

const ALL = ['integration', 'api', 'e2e'];

export class UnknownSuiteError extends Error {
  override name = 'UnknownSuiteError';

  constructor(suite: string) {
    super(`there is no Cucumber suite "${suite}"; use ${Object.keys(SUITES).join(', ')}`);
  }
}

/** The cucumber.json profiles of the suites named, in that order. */
export function profilesFor(suites: readonly string[]): string[] {
  return (suites.length === 0 ? ALL : suites).flatMap((suite) => {
    const profiles = SUITES[suite];
    if (profiles === undefined) throw new UnknownSuiteError(suite);
    return [...profiles];
  });
}

export interface ProfileRunner {
  removeReports(profile: string): void;
  /** Runs Cucumber with the profile; resolves to its exit code. */
  run(profile: string): Promise<number>;
}

export async function runProfiles(profiles: readonly string[], runner: ProfileRunner): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const profile of profiles) {
    runner.removeReports(profile);
    if ((await runner.run(profile)) !== 0) failed.push(profile);
  }
  return { failed };
}

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * The extra formatter board-report reads (PLAN.md Phase 14 task 9): Cucumber's messages, in the profile's own folder
 * under the step's results folder. The path is relative to the repository, so no Windows drive-letter colon is read as
 * the end of the formatter's name. The profile's own formats (progress, JSON, HTML) stay as cucumber.json has them.
 */
export function messageFormat(profile: string, resultsDir: string | undefined, base = root): string[] {
  if (resultsDir === undefined || resultsDir === '') return [];
  const path = relative(base, join(resultsDir, profile, 'messages.ndjson')).replaceAll('\\', '/');
  return ['--format', `message:${path}`];
}

const CUCUMBER = fileURLToPath(new URL('../node_modules/@cucumber/cucumber/bin/cucumber.js', import.meta.url));

const cucumber: ProfileRunner = {
  removeReports(profile) {
    for (const extension of ['json', 'html']) {
      rmSync(new URL(`../reports/cucumber/${profile}.${extension}`, import.meta.url), { force: true });
    }
  },
  run(profile) {
    console.log(`\n▶ cucumber-js --profile ${profile}`);
    return new Promise((resolve, reject) => {
      const args = [CUCUMBER, '--profile', profile, ...messageFormat(profile, process.env['BOARD_REPORT_RESULTS'])];
      const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve(code ?? 1);
      });
    });
  },
};

if (import.meta.main) {
  const profiles = profilesFor(process.argv.slice(2));
  const { failed } = await runProfiles(profiles, cucumber);
  if (failed.length === 0) {
    console.log(`\nCucumber: ${String(profiles.length)} of ${String(profiles.length)} profiles passed`);
  } else {
    console.error(
      `\nCucumber: ${String(failed.length)} of ${String(profiles.length)} profiles failed: ${failed.join(', ')}`,
    );
    process.exitCode = 1;
  }
}
