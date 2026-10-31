// The run's environment (PLAN.md Phase 14 task 4): Node, the OS, Playwright and its browsers, k6, the commit, the
// branch, whether the working tree had uncommitted changes and, in CI, a link to the run. Read when the report is
// built; every command it runs is optional, so a missing git or k6 only leaves its line as "unknown".
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { z } from 'zod';

export interface EnvironmentEntry {
  name: string;
  value: string;
  url: string | null;
}

export interface Environment {
  /** owner/name on GitHub, for the links to requirements and source lines; null when it can't be told. */
  repository: string | null;
  commit: string | null;
  branch: string | null;
  entries: EnvironmentEntry[];
}

export interface EnvironmentSources {
  env: Readonly<Record<string, string | undefined>>;
  /** Runs a program and gives its output, or null when it can't run or fails. */
  run(program: string, args: readonly string[]): string | null;
  /** Reads a JSON file of an installed package, or null. */
  readJson(path: string): unknown;
  node: string;
  os: string;
}

const BrowsersFile = z.object({
  browsers: z.array(z.object({ name: z.string(), browserVersion: z.string().optional() })),
});

const PackageFile = z.object({ version: z.string() });

/** owner/name from a GitHub remote URL (https or ssh). */
export function repositoryOf(remote: string | null): string | null {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote?.trim() ?? '');
  return match === null ? null : `${String(match[1])}/${String(match[2])}`;
}

export function collectEnvironment(sources: EnvironmentSources = realSources()): Environment {
  const { env } = sources;
  const repository = env['GITHUB_REPOSITORY'] ?? repositoryOf(sources.run('git', ['remote', 'get-url', 'origin']));
  const commit = env['GITHUB_SHA'] ?? sources.run('git', ['rev-parse', 'HEAD'])?.trim() ?? null;
  // A pull request's branch is its head ref; other runs leave GITHUB_HEAD_REF empty.
  const headRef = env['GITHUB_HEAD_REF'] === '' ? undefined : env['GITHUB_HEAD_REF'];
  const branch =
    headRef ?? env['GITHUB_REF_NAME'] ?? sources.run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() ?? null;
  const status = sources.run('git', ['status', '--porcelain']);
  const dirty = status === null ? 'unknown' : status.trim() === '' ? 'no' : 'yes';

  const playwright = PackageFile.safeParse(sources.readJson('node_modules/@playwright/test/package.json'));
  const browsers = BrowsersFile.safeParse(sources.readJson('node_modules/playwright-core/browsers.json'));
  const browserVersion = (name: string): string =>
    (browsers.success ? browsers.data.browsers.find((browser) => browser.name === name)?.browserVersion : undefined) ??
    'unknown';
  const k6 = /v\d+\.\d+\.\d+/.exec(sources.run('k6', ['version']) ?? '')?.[0] ?? 'not installed';

  const github = repository === null ? null : `https://github.com/${repository}`;
  const runId = env['GITHUB_RUN_ID'];
  const ciRun =
    runId === undefined || repository === null
      ? null
      : `${env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${repository}/actions/runs/${runId}`;

  const entries: EnvironmentEntry[] = [
    { name: 'Node.js', value: sources.node, url: null },
    { name: 'Operating system', value: sources.os, url: null },
    { name: 'Playwright', value: playwright.success ? playwright.data.version : 'unknown', url: null },
    { name: 'Chromium', value: browserVersion('chromium'), url: null },
    { name: 'Firefox', value: browserVersion('firefox'), url: null },
    { name: 'WebKit', value: browserVersion('webkit'), url: null },
    { name: 'k6', value: k6, url: null },
    {
      name: 'Commit',
      value: commit ?? 'unknown',
      url: github === null || commit === null ? null : `${github}/commit/${commit}`,
    },
    { name: 'Branch', value: branch ?? 'unknown', url: null },
    { name: 'Uncommitted changes', value: dirty, url: null },
    { name: 'CI run', value: ciRun === null ? 'not in CI' : `run ${String(runId)}`, url: ciRun },
  ];
  return { repository, commit, branch, entries };
}

function realSources(): EnvironmentSources {
  return {
    env: process.env,
    run(program, args) {
      const result = spawnSync(program, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      return result.status === 0 ? result.stdout : null;
    },
    readJson(path) {
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
      } catch {
        return null;
      }
    },
    node: process.version,
    os: `${platform()} ${release()} (${arch()})`,
  };
}
