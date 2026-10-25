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
          await expectNoViolations(page);
        });
      }

      test('NFR-06: board with filters, scores and a notice', async ({ page }) => {
        await page.goto(`/?q=${tag}&minScore=50&changed=${String(jobId)}`);
        await expect(page.getByRole('status')).toBeVisible();
        await expectNoViolations(page);
      });

      test('NFR-06: board, other sources', async ({ page }) => {
        await page.goto('/?origin=other');
        await expectNoViolations(page);
      });

      test('NFR-06: job detail from another source, with its description', async ({ page }) => {
        await page.goto(`/jobs/${String(listedId)}`);
        await expectNoViolations(page);
      });

      test('NFR-06: job detail from a LinkedIn search, with workplace, rubric and search name', async ({ page }) => {
        await page.goto(`/jobs/${String(jobId)}?notes=saved`);
        await expectNoViolations(page);
      });

      test('NFR-06: runs', async ({ page }) => {
        await page.goto('/runs');
        await expectNoViolations(page);
      });

      test('NFR-06: profile', async ({ page }) => {
        await page.goto('/profile');
        await expectNoViolations(page);
      });

      test('NFR-06: error page', async ({ page }) => {
        await page.goto('/jobs/999999999');
        await expectNoViolations(page);
      });
    });
  }
});
