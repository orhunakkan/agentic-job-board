import { expect, test, type Page } from '@playwright/test';
import { TABS } from '../../src/domain/board-tabs.ts';
import { expectNoViolations } from './axe.ts';
import { PROFILE, seedJobs, seedListings, uniqueTag } from './seed.ts';

// PLAN.md §8.1 type 9, NFR-06: every page and every board tab has no axe violations against the WCAG 2.2 AA
// rules, in light and dark mode, on every Playwright project (so also at phone width).

/**
 * Opens a page with the system's scheme. Playwright's Firefox drops the emulated scheme when the first page it loads
 * sends Cross-Origin-Opener-Policy, as every page of the app does (DEF-021); set again, it holds from then on.
 */
async function open(page: Page, path: string, scheme: 'light' | 'dark'): Promise<void> {
  await page.goto(path);
  await page.emulateMedia({ colorScheme: scheme });
}

test.describe('accessibility', () => {
  // Skipped on Firefox for now (owner, 2026-10-31, DEC-070). In a full run with the default workers, axe hangs in
  // whichever of these Firefox runs fall in the busiest stretch, about 7 a run (DEF-024, open; main does the same).
  // Chromium, WebKit and mobile run every test here; Firefox still runs axe on setup and the profile form
  // (setup.spec.ts) and on board-report. Remove this line once DEF-024 is fixed.
  test.skip(({ browserName }) => browserName === 'firefox', 'DEF-024: axe hangs on Firefox in a full local run');

  let jobId = 0;
  let listedId = 0;
  let tag = '';

  test.beforeEach(async ({ request }) => {
    tag = uniqueTag();
    const jobs = await seedJobs(request, tag, [
      {
        title: 'Strong Dispatcher',
        company: 'Top Co',
        score: 92,
        rubricVersion: 'match-v2',
        easyApply: true,
        workplace: 'remote',
        description: 'About the role\n\nRun the night dispatch desk.',
        searchName: 'Dispatch family',
      },
      { title: 'Possible Nurse', company: 'Mid Co', score: 64 },
      { title: 'Weak Courier', company: 'Low Co', score: 21 },
      { title: 'Unscored Nurse', company: 'Plain Co' },
    ]);
    jobId = jobs[0]?.id ?? 0;
    const listed = await seedListings(request, tag, [
      {
        source: 'greenhouse',
        title: 'Feed Dispatcher',
        company: 'Feed Co',
        score: 81,
        salary: '$150K – $180K',
        description: 'About the role\n\nRun the night dispatch desk.\n• Load planning',
      },
      { source: 'hackernews', title: 'Feed Nurse', company: 'Post Co' },
    ]);
    listedId = listed[0]?.id ?? 0;
    expect((await request.put('/api/profile', { data: PROFILE })).status()).toBe(200);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${scheme} mode`, () => {
      test.use({ colorScheme: scheme });

      for (const tab of TABS) {
        test(`NFR-06: board, ${tab} tab`, async ({ page }) => {
          await open(page, `/?tab=${tab}`, scheme);
          await expectNoViolations(page);
        });
      }

      test('NFR-06: board with filters, scores and a notice', async ({ page }) => {
        await open(page, `/?q=${tag}&minScore=50&changed=${String(jobId)}`, scheme);
        await expect(page.getByRole('status')).toBeVisible();
        await expectNoViolations(page);
      });

      test('NFR-06: board, other sources', async ({ page }) => {
        await open(page, '/?origin=other', scheme);
        await expectNoViolations(page);
      });

      test('NFR-06: job detail from another source, with its description', async ({ page }) => {
        await open(page, `/jobs/${String(listedId)}`, scheme);
        await expectNoViolations(page);
      });

      test('NFR-06: job detail from a LinkedIn search, with workplace, rubric and search name', async ({ page }) => {
        await open(page, `/jobs/${String(jobId)}?notes=saved`, scheme);
        await expectNoViolations(page);
      });

      test('NFR-06: runs', async ({ page }) => {
        await open(page, '/runs', scheme);
        await expectNoViolations(page);
      });

      test('NFR-06: profile', async ({ page }) => {
        await open(page, '/profile', scheme);
        await expectNoViolations(page);
      });

      test('NFR-06: error page', async ({ page }) => {
        await open(page, '/jobs/999999999', scheme);
        await expectNoViolations(page);
      });
    });
  }

  // FR-23: the theme the owner chose with the toggle wins over the system, on every page. The cookie is what the
  // toggle sets (tests/e2e/theme.spec.ts uses the toggle itself).
  for (const { theme, system } of [
    { theme: 'dark', system: 'light' },
    { theme: 'light', system: 'dark' },
  ] as const) {
    test.describe(`${theme} chosen with the toggle, the system in ${system}`, () => {
      test.use({ colorScheme: system });

      test.beforeEach(async ({ context, baseURL }) => {
        await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      });

      const pages: [string, () => string][] = [
        ...TABS.map((tab): [string, () => string] => [`board, ${tab} tab`, () => `/?tab=${tab}`]),
        ['board with filters, scores and a notice', () => `/?q=${tag}&minScore=50&changed=${String(jobId)}`],
        ['board, other sources', () => '/?origin=other'],
        ['job detail from another source', () => `/jobs/${String(listedId)}`],
        ['job detail from a LinkedIn search', () => `/jobs/${String(jobId)}?notes=saved`],
        ['runs', () => '/runs'],
        ['profile', () => '/profile'],
        ['error page', () => '/jobs/999999999'],
      ];

      for (const [name, path] of pages) {
        test(`FR-23, NFR-06: ${name}`, async ({ page }) => {
          await open(page, path(), system);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expectNoViolations(page);
        });
      }
    });
  }
});
