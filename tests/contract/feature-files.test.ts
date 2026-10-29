import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { REQUIREMENTS } from '../../scripts/traceability.ts';

// The Cucumber layer keeps to its own rules (PLAN.md §8.5, Phase 13 task 11): every scenario names the requirement it
// covers, nothing skips a scenario, the feature files read as plain English, and each profile in cucumber.json loads
// only its own folder.

const root = fileURLToPath(new URL('../../', import.meta.url));
const featuresDir = join(root, 'tests', 'features');

interface Scenario {
  name: string;
  /** Its own tags and its feature's. */
  tags: string[];
}

interface FeatureFile {
  path: string;
  suite: string;
  text: string;
  scenarios: Scenario[];
}

function featureFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return featureFiles(path);
    return entry.name.endsWith('.feature') ? [path] : [];
  });
}

/** Just enough of Gherkin for these checks: the tags above `Feature:` and above each scenario. */
function parse(path: string): FeatureFile {
  // Read the same however the working tree spells line endings.
  const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const name = relative(root, path).replaceAll('\\', '/');
  const scenarios: Scenario[] = [];
  let featureTags: string[] = [];
  let pending: string[] = [];
  for (const line of text.split('\n').map((raw) => raw.trim())) {
    if (line.startsWith('@')) {
      pending.push(...line.split(/\s+/));
    } else if (line.startsWith('Feature:')) {
      featureTags = pending;
      pending = [];
    } else if (/^Scenario(?: Outline)?:/.test(line)) {
      scenarios.push({ name: line.replace(/^Scenario(?: Outline)?:\s*/, ''), tags: [...featureTags, ...pending] });
      pending = [];
    } else if (line !== '') {
      pending = [];
    }
  }
  return { path: name, suite: name.split('/')[2] ?? '', text, scenarios };
}

const features = featureFiles(featuresDir).map(parse);
const REQUIREMENT_TAG = /^@(N?FR-\d{2})$/;
const requirementsOf = (tags: readonly string[]) => tags.flatMap((tag) => REQUIREMENT_TAG.exec(tag)?.[1] ?? []);

describe('feature files (PLAN.md §8.5)', () => {
  it('there are feature files for integration, API and E2E', () => {
    expect([...new Set(features.map((feature) => feature.suite))].sort()).toEqual(['api', 'e2e', 'integration']);
  });

  it.each(features.map((feature) => [feature.path, feature] as const))(
    '%s: every scenario is tagged with a requirement',
    (_, feature) => {
      expect(feature.scenarios.length).toBeGreaterThan(0);
      for (const scenario of feature.scenarios) {
        expect(requirementsOf(scenario.tags), scenario.name).not.toEqual([]);
      }
    },
  );

  it.each(features.map((feature) => [feature.path, feature] as const))(
    '%s: no scenario is skipped, left as work in progress or run alone',
    (_, feature) => {
      expect(feature.text).not.toMatch(/@(?:skip|wip|only|ignore|pending)\b/i);
    },
  );

  it.each(features.map((feature) => [feature.path, feature] as const))(
    '%s: names only requirements of PLAN.md §3 that still apply',
    (_, feature) => {
      const known = new Map(REQUIREMENTS.map((requirement) => [requirement.id, requirement]));
      for (const id of feature.scenarios.flatMap((scenario) => requirementsOf(scenario.tags))) {
        expect(known.has(id), id).toBe(true);
        expect(known.get(id)?.retired, id).toBeUndefined();
      }
    },
  );

  it.each(features.map((feature) => [feature.path, feature] as const))(
    '%s: reads as plain English, with no URLs, JSON, SQL, selectors or code names',
    (_, feature) => {
      expect(feature.text).not.toMatch(/https?:|\/api\/|[{}]|\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE)\b/);
      expect(feature.text).not.toMatch(/#[a-z][\w-]*|\.[a-z][\w-]+\s*\{|\bdata-[a-z]|\b[a-z]+_[a-z_]+\b/);
      // camelCase names such as sourceJobId; "LinkedIn" starts with a capital, so it doesn't count.
      expect(feature.text).not.toMatch(/\b[a-z]+[A-Z]\w*\b/);
    },
  );

  it.each(features.map((feature) => [feature.path, feature] as const))(
    '%s: opens with "As the owner, I want …, so that …" and has at most one Background',
    (_, feature) => {
      expect(feature.text).toMatch(/^\s*Feature: .+\n\s+As the owner,\n\s+I want .+\n\s+so that .+\.\n/m);
      expect(feature.text.match(/^\s*Background:/gm)?.length ?? 0).toBeLessThanOrEqual(1);
    },
  );

  // Phase 13 tasks 3 to 6: the requirements each suite has scenarios for.
  const EXPECTED: readonly (readonly [string, readonly string[]])[] = [
    ['integration', ['FR-08', 'FR-11', 'FR-16', 'FR-18', 'FR-21']],
    [
      'api',
      ['FR-06', 'FR-07', 'FR-08', 'FR-09', 'FR-10', 'FR-11', 'FR-16', 'FR-17', 'FR-18', 'FR-20', 'FR-21', 'FR-22'],
    ],
    ['e2e', ['FR-07', 'FR-08', 'FR-09', 'FR-10', 'FR-17', 'FR-21', 'FR-22']],
  ];

  it.each(EXPECTED)('the %s scenarios cover %j', (suite, ids) => {
    const covered = features
      .filter((feature) => feature.suite === suite)
      .flatMap((feature) => feature.scenarios.flatMap((scenario) => requirementsOf(scenario.tags)));
    for (const id of ids) expect(covered, id).toContain(id);
  });

  it('the API scenarios also cover NFR-01 and NFR-09', () => {
    const covered = features
      .filter((feature) => feature.suite === 'api')
      .flatMap((feature) => feature.scenarios.flatMap((scenario) => requirementsOf(scenario.tags)));
    expect(covered).toEqual(expect.arrayContaining(['NFR-01', 'NFR-09']));
  });

  it('the smoke scenarios are in e2e/smoke.feature, each tagged @smoke and with its requirement', () => {
    const smoke = features.find((feature) => feature.path === 'tests/features/e2e/smoke.feature');
    expect(smoke?.scenarios.map((scenario) => scenario.tags)).toEqual([
      ['@smoke', '@NFR-01'],
      ['@smoke', '@FR-07'],
      ['@smoke', '@FR-10'],
      ['@smoke', '@FR-11'],
    ]);
    const elsewhere = features.filter((feature) => feature !== smoke && feature.text.includes('@smoke'));
    expect(elsewhere.map((feature) => feature.path)).toEqual([]);
  });
});

const Profile = z
  .object({
    paths: z.array(z.string()),
    import: z.array(z.string()),
    format: z.array(z.string()),
    strict: z.literal(true),
    parallel: z.literal(0),
    worldParameters: z.object({ browser: z.enum(['chromium', 'firefox', 'webkit', 'mobile']) }).optional(),
    tags: z.string().optional(),
  })
  .strict();

const PROFILES = ['integration', 'api', 'e2e-chromium', 'e2e-firefox', 'e2e-webkit', 'e2e-mobile', 'smoke'];

describe('cucumber.json', () => {
  const profiles = z.record(z.string(), Profile).parse(JSON.parse(readFileSync(join(root, 'cucumber.json'), 'utf8')));

  it('has one profile per suite and browser, plus smoke', () => {
    expect(Object.keys(profiles)).toEqual(PROFILES);
  });

  it.each(PROFILES)(
    '%s: strict, one scenario at a time, its own folder only, JSON and HTML reports of its own',
    (name) => {
      const profile = profiles[name];
      const suite = name.startsWith('e2e') || name === 'smoke' ? 'e2e' : name;
      const steps =
        suite === 'e2e'
          ? ['tests/features/e2e/steps/**/*.ts', 'tests/features/e2e/hooks.ts']
          : [`tests/features/${suite}/steps/**/*.ts`];

      expect(profile?.paths).toEqual([`tests/features/${suite}/**/*.feature`]);
      expect(profile?.import).toEqual(['tests/features/support/**/*.ts', ...steps]);
      expect(profile?.format).toEqual([
        'progress',
        `json:reports/cucumber/${name}.json`,
        `html:reports/cucumber/${name}.html`,
      ]);
      expect(profile?.worldParameters?.browser).toBe(
        suite === 'e2e' ? (name === 'smoke' ? 'chromium' : name.slice('e2e-'.length)) : undefined,
      );
    },
  );

  it('filters by tag only in the smoke profile, and only for @smoke', () => {
    expect(Object.entries(profiles).flatMap(([name, profile]) => (profile.tags === undefined ? [] : [name]))).toEqual([
      'smoke',
    ]);
    expect(profiles['smoke']?.tags).toBe('@smoke');
  });
});
