import { expect, test } from '@playwright/test';
import { TABS } from '../../src/domain/board-tabs.ts';
import { expectNoViolations } from './axe.ts';
import { PROFILE, seedJobs, seedListings, uniqueTag } from './seed.ts';

// PLAN.md §8.1 type 9, NFR-06: every page and every board tab has no axe violations against the WCAG 2.2 AA
// rules, in light and dark mode, on every Playwright project (so also at phone width).

test.describe('accessibility', () => {
  let jobId = 0;
  let listedId = 0;
  let tag = '';

  test.beforeEach(async ({ request }) => {
    tag = uniqueTag();
    const jobs = await seedJobs(request, tag, [
      {
        title: 'Strong SDET',
        company: 'Top Co',
        score: 92,
        rubricVersion: 'match-v1',
        easyApply: true,
        workplace: 'remote',
        description: 'About the role\n\nOwn the test platform.',
        searchName: 'QA family',
      },
      { title: 'Possible QA', company: 'Mid Co', score: 64 },
      { title: 'Weak Tester', company: 'Low Co', score: 21 },
      { title: 'Unscored QA', company: 'Plain Co' },
    ]);
    jobId = jobs[0]?.id ?? 0;
    const listed = await seedListings(request, tag, [
      {
        source: 'greenhouse',
        title: 'Feed SDET',
        company: 'Feed Co',
        score: 81,
        salary: '$150K – $180K',
        description: 'About the role\n\nOwn the test platform.\n• Playwright',
      },
      { source: 'hackernews', title: 'Feed QA', company: 'Post Co' },
    ]);
    listedId = listed[0]?.id ?? 0;
    expect((await request.put('/api/profile', { data: PROFILE })).status()).toBe(200);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${scheme} mode`, () => {
      test.use({ colorScheme: scheme });

      for (const tab of TABS) {
        test(`NFR-06: board, ${tab} tab`, async ({ page }) => {
          await page.goto(`/?tab=${tab}`);
          await page.emulateMedia({ colorScheme: scheme }); // Firefox drops the scheme otherwise (DEF-021)
          await expectNoViolations(page);
        });
      }

      test('NFR-06: board with filters, scores and a notice', async ({ page }) => {
        await page.goto(`/?q=${tag}&minScore=50&changed=${String(jobId)}`);
        await page.emulateMedia({ colorScheme: scheme }); // Firefox drops the scheme otherwise (DEF-021)
        await expect(page.getByRole('status')).toBeVisible();
        await expectNoViolations(page);
      });

      test('NFR-06: board, other sources', async ({ page }) => {
        await page.goto('/?origin=other');
        await page.emulateMedia({ colorScheme: scheme }); // Firefox drops the scheme otherwise (DEF-021)
        await expectNoViolations(page);
      });

      test('NFR-06: job detail from another source, with its description', async ({ page }) => {
        await page.goto(`/jobs/${String(listedId)}`);
        await page.emulateMedia({ colorScheme: scheme }); // Firefox drops the scheme otherwise (DEF-021)
        await expectNoViolations(page);
      });

      test('NFR-06: job detail from a LinkedIn search, with workplace, rubric and search name', async ({ page }) => {
        await page.goto(`/jobs/${String(jobId)}?notes=saved`);
        await page.emulateMedia({ colorScheme: scheme }); // Firefox drops the scheme otherwise (DEF-021)
        await expectNoViolations(page);
      });

      test('NFR-06: runs', async ({ page }) => {
        await page.goto('/runs');
        await page.emulateMedia({ colorScheme: scheme }); // Firefox drops the scheme otherwise (DEF-021)
        await expectNoViolations(page);
      });

      test('NFR-06: profile', async ({ page }) => {
        await page.goto('/profile');
        await page.emulateMedia({ colorScheme: scheme }); // Firefox drops the scheme otherwise (DEF-021)
        await expectNoViolations(page);
      });

      test('NFR-06: error page', async ({ page }) => {
        await page.goto('/jobs/999999999');
        await page.emulateMedia({ colorScheme: scheme }); // Firefox drops the scheme otherwise (DEF-021)
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
          await page.goto(path());
          await page.emulateMedia({ colorScheme: system }); // DEF-021
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expectNoViolations(page);
        });
      }
    });
  }
});
