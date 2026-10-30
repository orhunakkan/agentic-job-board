import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildReport, headline, kindOf, oneResultPerTest } from '../../../scripts/board-report/build/build.ts';
import { bundleClient, BundleError } from '../../../scripts/board-report/build/bundle.ts';
import type { ReportIndex, TestDetail } from '../../../scripts/board-report/build/data-shape.ts';
import { CONTENT_SECURITY_POLICY, reportHtml } from '../../../scripts/board-report/build/html.ts';
import {
  collectEnvironment,
  repositoryOf,
  type EnvironmentSources,
} from '../../../scripts/board-report/environment.ts';
import { labelResult } from '../../../scripts/board-report/labels.ts';
import { opener } from '../../../scripts/board-report/open.ts';
import type { StoredResult } from '../../../scripts/board-report/result-schema.ts';
import {
  buildFixtureReport,
  FIXTURE_ENVIRONMENT,
  HOSTILE_TITLE,
  writeFixtureResults,
} from '../../helpers/board-report-fixture.ts';

// Building the report (PLAN.md Phase 14 tasks 5 and 7) and the facts around it: the environment and opening it.

const temp = () => mkdtempSync(join(tmpdir(), 'board-report-build-'));

/** Runs a data script the way the page does, handing back what it passes to window.boardReport. */
function loadData(path: string): { index?: ReportIndex; tests: Map<string, TestDetail> } {
  const loaded: { index?: ReportIndex; tests: Map<string, TestDetail> } = { tests: new Map() };
  const window = {
    boardReport: {
      index: (data: ReportIndex) => (loaded.index = data),
      test: (id: string, detail: TestDetail) => loaded.tests.set(id, detail),
    },
  };
  runInNewContext(readFileSync(path, 'utf8'), { window });
  return loaded;
}

/** The detail of one test, from its own data script in the built report. */
function testDetail(out: string, id: string): TestDetail | undefined {
  return loadData(join(out, 'data', 'tests', `${id}.js`)).tests.get(id);
}

function files(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.set(relative(dir, path).replaceAll('\\', '/'), readFileSync(path, 'latin1'));
    }
  };
  walk(dir);
  return found;
}

describe('the build', () => {
  it('NFR-13: writes the page, the client, the styles, one data script for every test and one per test, and the attachments', () => {
    const out = join(temp(), 'report');
    const { index } = buildFixtureReport(out);
    const data = loadData(join(out, 'data', 'index.js'));
    const failed = index.tests.find(
      (test) => test.name === 'FR-07, FR-08: save a job from the board' && test.browser === 'Chromium',
    );
    const detail = testDetail(out, failed?.id ?? '');

    expect(data.index).toEqual(index);
    expect(index.tests).toHaveLength(20);
    expect(index.totals).toEqual({ passed: 13, failed: 5, broken: 1, skipped: 1 });
    expect(index.trend.map((point) => point.time)).toEqual(['2026-10-28T12:00:00.000Z', '2026-10-29T12:00:00.000Z']);
    expect(readdirSync(join(out, 'data', 'tests'))).toHaveLength(20);
    expect(failed).toMatchObject({
      category: 'assertions',
      errorLine: 'expect(locator).toHaveText(expected) failed',
      sourceUrl: `https://github.com/owner/agentic-job-board/blob/${String(FIXTURE_ENVIRONMENT.commit)}/tests/e2e/board.spec.ts#L20`,
      history: ['failed', 'failed'],
    });
    expect(detail?.attachments.map((attachment) => [attachment.name, attachment.kind])).toEqual([
      ['screenshot', 'image'],
      ['video', 'video'],
      ['trace', 'trace'],
      ['axe-results', 'json'],
    ]);
    expect(detail?.attachments[3]?.text).toBe('{\n  "violations": [],\n  "passes": 3\n}');
    for (const attachment of detail?.attachments ?? []) expect(existsSync(join(out, attachment.path))).toBe(true);
    expect(detail?.steps[1]?.steps[1]?.error?.expected).toBe('"Saved (1)"');
    expect(index.requirements.find((requirement) => requirement.id === 'NFR-13')?.url).toBe(
      `https://github.com/owner/agentic-job-board/blob/${String(FIXTURE_ENVIRONMENT.commit)}/PLAN.md#32-non-functional-requirements`,
    );
    expect(index.tests.filter((test) => test.flaky).map((test) => test.name)).toEqual([
      'FR-08: applied follows saved',
      'NFR-05: checks rate>0.99',
    ]);
  });

  it('NFR-13: the same results always build the same report, byte for byte, apart from the build time', () => {
    const results = temp();
    writeFixtureResults(results, true);
    const build = (builtAt: string) => {
      const out = join(temp(), 'report');
      buildReport({ resultsDir: results, outDir: out, history: [], environment: FIXTURE_ENVIRONMENT, builtAt });
      return files(out);
    };
    const first = build('2026-10-29T12:00:00.000Z');
    const second = build('2026-10-29T12:00:00.000Z');
    const later = build('2026-10-30T08:00:00.000Z');

    expect(second).toEqual(first);
    const changed = [...later].filter(([path, content]) => first.get(path) !== content).map(([path]) => path);
    expect(changed).toEqual(['data/index.js']);
    expect(later.get('data/index.js')?.replaceAll('2026-10-30T08:00:00.000Z', '2026-10-29T12:00:00.000Z')).toBe(
      first.get('data/index.js'),
    );
  });

  it('NFR-13: every value stays data: a hostile title is a JSON string in the data and never markup in the page', () => {
    const out = join(temp(), 'report');
    const { index } = buildFixtureReport(out);
    const html = readFileSync(join(out, 'index.html'), 'utf8');

    expect(index.tests.some((test) => test.name.includes(HOSTILE_TITLE))).toBe(true);
    expect(html).not.toContain(HOSTILE_TITLE);
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
    expect(reportHtml('a <b> & c')).toContain('<title>a &lt;b&gt; &amp; c</title>');
    expect(html).toContain(`content="${CONTENT_SECURITY_POLICY}"`);
    expect(readFileSync(join(out, 'data', 'index.js'), 'utf8')).toContain(JSON.stringify(HOSTILE_TITLE).slice(1, -1));
  });

  it('NFR-13: a test two steps ran keeps its worst result; a missing attachment file is left out', () => {
    const base = {
      name: 'FR-04: x',
      fullName: 'FR-04: x',
      start: 1,
      stop: 2,
      duration: 1,
      file: 'tests/unit/x.test.ts',
      line: null,
      suites: [],
      parameters: [],
      error: null,
      steps: [],
      attachments: [{ name: 'gone', type: 'text/plain', source: 'gone.txt' }],
      stdout: [],
      stderr: [],
      retries: [],
      labels: { tags: [], browser: null, worker: null },
    };
    const stored = (step: 'unit' | 'coverage', status: 'passed' | 'failed' | 'broken'): StoredResult => ({
      result: labelResult({ ...base, status }, step),
      dir: 'x',
    });
    const kept = oneResultPerTest([stored('unit', 'passed'), stored('coverage', 'failed')]);

    expect(kept.map(({ result }) => [result.status, result.labels.step])).toEqual([['failed', 'coverage']]);
    expect(oneResultPerTest([stored('coverage', 'broken'), stored('unit', 'failed')])[0]?.result.status).toBe('broken');

    const dir = temp();
    mkdirSync(join(dir, 'unit'));
    writeFileSync(join(dir, 'unit', 'a-result.json'), JSON.stringify(stored('unit', 'passed').result));
    const out = join(temp(), 'report');
    const { index } = buildReport({
      resultsDir: dir,
      outDir: out,
      history: [],
      environment: { ...FIXTURE_ENVIRONMENT, repository: null },
      builtAt: 't',
    });
    const detail = testDetail(out, index.tests[0]?.id ?? '');

    expect(detail?.attachments).toEqual([]);
    expect(index.tests[0]?.sourceUrl).toBeNull();
    expect(index.requirements[0]?.url).toBeNull();
  });

  it('NFR-13: cuts long text attachments and keeps text that is not JSON as it is', () => {
    const dir = temp();
    writeFixtureResults(dir, false);
    const unit = readdirSync(join(dir, 'unit')).find((name) => name.endsWith('-result.json')) ?? '';
    const result = JSON.parse(readFileSync(join(dir, 'unit', unit), 'utf8')) as { id: string; attachments: unknown[] };
    writeFileSync(join(dir, 'unit', 'long.txt'), 'x'.repeat(200_005));
    writeFileSync(join(dir, 'unit', 'bad.json'), '{not json');
    result.attachments = [
      { name: 'log', type: 'text/plain', source: 'long.txt' },
      { name: 'bad', type: 'application/json', source: 'bad.json' },
    ];
    writeFileSync(join(dir, 'unit', unit), JSON.stringify(result));
    const out = join(temp(), 'report');
    buildReport({ resultsDir: dir, outDir: out, history: [], environment: FIXTURE_ENVIRONMENT, builtAt: 't' });
    const detail = testDetail(out, result.id);

    expect(detail?.attachments[0]).toMatchObject({ kind: 'text', truncated: true });
    expect(detail?.attachments[0]?.text).toHaveLength(200_000);
    expect(detail?.attachments[1]).toMatchObject({ kind: 'json', text: '{not json', truncated: false });
  });

  it('NFR-13: tells each kind of attachment apart, and says the run’s result in a few words', () => {
    expect(kindOf({ name: 'shot', type: 'image/png' })).toBe('image');
    expect(kindOf({ name: 'video', type: 'video/webm' })).toBe('video');
    expect(kindOf({ name: 'a', type: 'application/vnd.x+json; charset=utf-8' })).toBe('json');
    expect(kindOf({ name: 'trace', type: 'application/zip' })).toBe('trace');
    expect(kindOf({ name: 'other', type: 'application/zip' })).toBe('file');
    expect(kindOf({ name: 'log', type: 'text/markdown' })).toBe('text');
    expect(kindOf({ name: 'log', type: 'application/x-ndjson' })).toBe('text');
    expect(headline({ totals: { passed: 0, failed: 0, broken: 0, skipped: 0 } })).toBe('no results');
    expect(headline({ totals: { passed: 1480, failed: 0, broken: 0, skipped: 2 } })).toBe('1,480 passed');
    expect(headline({ totals: { passed: 1470, failed: 8, broken: 2, skipped: 0 } })).toBe('10 failed of 1,480');
  });
});

describe('the client bundle', () => {
  function client(sources: Record<string, string>): string {
    const dir = temp();
    for (const [name, source] of Object.entries(sources)) writeFileSync(join(dir, name), source);
    return join(dir, 'main.ts');
  }

  it('NFR-13: joins the client files, dependencies first, into one classic script without types', () => {
    const bundle = bundleClient(
      client({
        'main.ts':
          "import type { X } from './types.ts';\nimport {\n  greet,\n  type Name,\n} from './greet.ts';\nconst who: Name = 'board';\nexport const done: X = greet(who);\nexport {};\n",
        'greet.ts':
          'export type Name = string;\nexport function greet(name: Name): string {\n  return `hi ${name}`;\n}\n',
        'types.ts': 'export type X = string;\n',
      }),
    );
    const sandbox: { result?: string } = {};
    runInNewContext(bundle.replace('const done', 'globalThis.result'), sandbox);

    expect(bundle.indexOf('// greet.ts')).toBeLessThan(bundle.indexOf('// main.ts'));
    expect(bundle).not.toContain('types.ts');
    expect(bundle).not.toMatch(/^\s*(?:import|export)\b/m);
    expect(sandbox.result).toBe('hi board');
  });

  it('NFR-13: refuses code that would not survive being joined', () => {
    expect(() => bundleClient(client({ 'main.ts': "import * as all from './a.ts';\n", 'a.ts': '' }))).toThrow(
      BundleError,
    );
    expect(() => bundleClient(client({ 'main.ts': "import a from './a.ts';\n", 'a.ts': '' }))).toThrow(/named imports/);
    expect(() =>
      bundleClient(client({ 'main.ts': "import { a as b } from './a.ts';\n", 'a.ts': 'export const a = 1;\n' })),
    ).toThrow(/renamed/);
    expect(() => bundleClient(client({ 'main.ts': "import { z } from 'zod';\n" }))).toThrow(/only from \.\//);
    expect(() => bundleClient(client({ 'main.ts': 'export default 1;\n' }))).toThrow(/default export/);
    expect(() =>
      bundleClient(
        client({
          'main.ts': "import { a } from './a.ts';\n",
          'a.ts': "import { b } from './main.ts';\nexport const a = 1;\n",
        }),
      ),
    ).toThrow(/cycle/);
    expect(() =>
      bundleClient(
        client({ 'main.ts': "import { a } from './a.ts';\nconst a = 2;\n", 'a.ts': 'export const a = 1;\n' }),
      ),
    ).toThrow(/not valid JavaScript/);
    expect(() => bundleClient(client({ 'main.ts': "export * from './a.ts';\n", 'a.ts': '' }))).toThrow(
      /export the bundle/,
    );
  });
});

describe('the environment', () => {
  const sources = (overrides: Partial<EnvironmentSources> = {}): EnvironmentSources => ({
    env: {},
    run: (program, args) =>
      ({
        'git remote get-url origin': 'git@github.com:owner/agentic-job-board.git\n',
        'git rev-parse HEAD': 'abc123\n',
        'git rev-parse --abbrev-ref HEAD': 'phase/14-board-report\n',
        'git status --porcelain': ' M PLAN.md\n',
        'k6 version': 'k6.exe v2.2.0 (commit/00a9a1b7f5, go1.26.5, windows/amd64)\n',
      })[[program, ...args].join(' ')] ?? null,
    readJson: (path) =>
      path.includes('browsers.json')
        ? {
            browsers: [
              { name: 'chromium', browserVersion: '156.0' },
              { name: 'firefox', browserVersion: '157.0' },
              { name: 'webkit' },
            ],
          }
        : { version: '1.64.1' },
    node: 'v24.22.1',
    os: 'win32 10.0 (x64)',
    ...overrides,
  });

  it('NFR-13: lists Node, the OS, Playwright, the browsers, k6, the commit, the branch and uncommitted changes', () => {
    const environment = collectEnvironment(sources());
    const value = (name: string) => environment.entries.find((entry) => entry.name === name);

    expect(environment).toMatchObject({
      repository: 'owner/agentic-job-board',
      commit: 'abc123',
      branch: 'phase/14-board-report',
    });
    expect(environment.entries.map((entry) => [entry.name, entry.value])).toEqual([
      ['Node.js', 'v24.22.1'],
      ['Operating system', 'win32 10.0 (x64)'],
      ['Playwright', '1.64.1'],
      ['Chromium', '156.0'],
      ['Firefox', '157.0'],
      ['WebKit', 'unknown'],
      ['k6', 'v2.2.0'],
      ['Commit', 'abc123'],
      ['Branch', 'phase/14-board-report'],
      ['Uncommitted changes', 'yes'],
      ['CI run', 'not in CI'],
    ]);
    expect(value('Commit')?.url).toBe('https://github.com/owner/agentic-job-board/commit/abc123');
  });

  it('NFR-13: in CI it links the run, and without git or k6 it says so', () => {
    const ci = collectEnvironment(
      sources({
        env: {
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_SHA: 'def',
          GITHUB_HEAD_REF: '',
          GITHUB_REF_NAME: 'main',
          GITHUB_RUN_ID: '42',
          GITHUB_SERVER_URL: 'https://github.com',
        },
      }),
    );
    const bare = collectEnvironment(sources({ run: () => null, readJson: () => null }));

    expect(ci.entries.find((entry) => entry.name === 'CI run')).toEqual({
      name: 'CI run',
      value: 'run 42',
      url: 'https://github.com/owner/repo/actions/runs/42',
    });
    expect(ci.branch).toBe('main');
    expect(collectEnvironment(sources({ env: { GITHUB_HEAD_REF: 'feature' } })).branch).toBe('feature');
    expect(bare).toMatchObject({ repository: null, commit: null, branch: null });
    expect(bare.entries.map((entry) => entry.value)).toEqual([
      'v24.22.1',
      'win32 10.0 (x64)',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'not installed',
      'unknown',
      'unknown',
      'unknown',
      'not in CI',
    ]);
    expect(collectEnvironment().entries).toHaveLength(11);
  });

  it('NFR-13: reads the repository from an https or ssh GitHub remote only', () => {
    expect(repositoryOf('https://github.com/orhunakkan/agentic-job-board.git')).toBe('orhunakkan/agentic-job-board');
    expect(repositoryOf('git@github.com:owner/repo')).toBe('owner/repo');
    expect(repositoryOf('https://gitlab.com/owner/repo.git')).toBeNull();
    expect(repositoryOf(null)).toBeNull();
  });

  it('NFR-13: npm run report opens the report with the system’s own program', () => {
    expect(opener('win32', 'C:\\r\\index.html')).toEqual({ program: 'explorer.exe', args: ['C:\\r\\index.html'] });
    expect(opener('darwin', '/r/index.html')).toEqual({ program: 'open', args: ['/r/index.html'] });
    expect(opener('linux', '/r/index.html')).toEqual({ program: 'xdg-open', args: ['/r/index.html'] });
  });
});
