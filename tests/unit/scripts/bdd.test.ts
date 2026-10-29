import { describe, expect, it } from 'vitest';
import { profilesFor, runProfiles, UnknownSuiteError } from '../../../scripts/bdd.ts';

// scripts/bdd.ts runs the Cucumber suites behind the test:bdd scripts (PLAN.md Phase 13).

describe('scripts/bdd.ts', () => {
  it('runs integration, API and the four E2E browsers when no suite is named', () => {
    expect(profilesFor([])).toEqual(['integration', 'api', 'e2e-chromium', 'e2e-firefox', 'e2e-webkit', 'e2e-mobile']);
  });

  it('runs the profiles of the suites named, in that order', () => {
    expect(profilesFor(['e2e'])).toEqual(['e2e-chromium', 'e2e-firefox', 'e2e-webkit', 'e2e-mobile']);
    expect(profilesFor(['smoke'])).toEqual(['smoke']);
    expect(profilesFor(['api', 'integration'])).toEqual(['api', 'integration']);
  });

  it('refuses a suite it does not know', () => {
    expect(() => profilesFor(['e2e-chromium'])).toThrow(UnknownSuiteError);
  });

  it('removes each profile’s old report, runs every profile even after one fails, and names the failures', async () => {
    const calls: string[] = [];
    const result = await runProfiles(['integration', 'api', 'e2e-chromium'], {
      removeReports: (profile) => calls.push(`remove ${profile}`),
      run: (profile) => {
        calls.push(`run ${profile}`);
        return Promise.resolve(profile === 'integration' ? 1 : 0);
      },
    });

    expect(calls).toEqual([
      'remove integration',
      'run integration',
      'remove api',
      'run api',
      'remove e2e-chromium',
      'run e2e-chromium',
    ]);
    expect(result).toEqual({ failed: ['integration'] });
  });

  it('reports no failure when every profile passes', async () => {
    const result = await runProfiles(['api'], { removeReports: () => undefined, run: () => Promise.resolve(0) });

    expect(result).toEqual({ failed: [] });
  });
});
