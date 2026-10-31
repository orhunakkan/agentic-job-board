import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('toolchain', () => {
  it('NFR-10: runs on Node 24 or newer', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(24);
  });

  it('NFR-10: CI runs E2E in the Playwright image of the installed @playwright/test version (DEF-014)', () => {
    const lock = z
      .object({ packages: z.record(z.string(), z.object({ version: z.string().optional() })) })
      .parse(JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')));
    const installed = lock.packages['node_modules/@playwright/test']?.version;
    const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

    expect(installed).toBeDefined();
    // A mismatch would run the tests against browsers built for another Playwright version.
    expect(workflow).toContain(`image: mcr.microsoft.com/playwright:v${String(installed)}-noble`);
  });

  it('NFR-10: CI keeps every pull request off the self-hosted runner and runs nightly (DEC-063)', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const runsOn = [...workflow.matchAll(/^ {4}runs-on: (.+)$/gm)].map((match) => match[1]);

    expect(runsOn).toHaveLength(6);
    for (const runner of runsOn) {
      expect(runner).toBe("${{ (github.event_name != 'pull_request' && vars.CI_RUNNER) || 'ubuntu-26.04' }}");
    }
    expect(workflow).toMatch(/^ {2}schedule:\r?\n {4}- cron: '0 8 \* \* \*'$/m);
  });
});
