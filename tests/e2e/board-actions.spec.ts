import { expect, test, type Page } from '@playwright/test';
import { expectNoViolations } from './axe.ts';
import { seedJobs, seedListings, uniqueTag } from './seed.ts';

// Clear All (FR-21) and Find Now (FR-22) in a real browser. They act on a whole view, so this file runs alone on its
// own server (playwright.config.ts, DEC-053), one test after the other; Find Now runs tests/helpers/fake-claude.ts,
// which takes 3 seconds, never Claude Code.

test.describe.configure({ mode: 'serial' });

function card(page: Page, title: string) {
  return page.getByRole('article', { name: title });
}

test('FR-21: Clear All asks first, then dismisses the New jobs of the view only; each can be restored', async ({
  page,
  request,
}) => {
  const tag = uniqueTag();
  const [strong, plain] = await seedJobs(request, tag, [
    { title: 'Clear SDET', company: 'Alpha Co', score: 84 },
    { title: 'Clear QA', company: 'Beta Co' },
  ]);
  const [listed] = await seedListings(request, tag, [{ source: 'greenhouse', title: 'Feed SDET', company: 'Feed Co' }]);

  await page.goto('/');
  const confirm = page.getByRole('button', { name: /^Dismiss \d+ jobs?$/ });
  await expect(confirm).toBeHidden();
  await page.locator('summary', { hasText: 'Clear All' }).click();
  await expect(page.getByText(/Dismiss all \d+ new LinkedIn jobs\? Each one can be restored/)).toBeVisible();
  await expectNoViolations(page);

  await confirm.click();
  const notice = page.locator('#notice');
  await expect(notice).toHaveText(/^Dismissed \d+ new LinkedIn jobs?\. Each one can be restored from\s+Dismissed\.$/);
  await expect(notice).toBeFocused();
  await expect(page.getByText('No new jobs. Press Find Now')).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Clear All' })).toHaveCount(0);

  // The other view keeps its New jobs.
  await page.getByRole('link', { name: /^Other sources/ }).click();
  await expect(card(page, listed?.title ?? '')).toBeVisible();

  // Both LinkedIn jobs are in Dismissed, and one goes back to New.
  await page.goto(`/?tab=dismissed&q=${tag}`);
  await expect(card(page, strong?.title ?? '')).toBeVisible();
  await card(page, plain?.title ?? '')
    .getByRole('button', { name: /^Restore/ })
    .click();
  await expect(page.locator('#notice')).toContainText('is now New');
  await page.goto(`/?q=${tag}`);
  await expect(page.locator('.card-title')).toHaveText([plain?.title ?? '']);
});

test('FR-22: Find Now runs in the background, is disabled meanwhile, and says when it has finished', async ({
  page,
}) => {
  await page.goto('/?origin=other');
  await page.getByRole('button', { name: 'Find Now' }).click();

  const line = page.locator('#find-now');
  await expect(line).toContainText('Find Now is running for Other sources since');
  await expect(line).toBeFocused();
  await expect(page).toHaveURL(/\/\?origin=other&tab=new#find-now$/);
  await expect(page.getByRole('button', { name: 'Find Now' })).toBeDisabled();
  await expectNoViolations(page);

  // The LinkedIn view shows the same run and can't start another.
  await page.getByRole('link', { name: /^LinkedIn/ }).click();
  await expect(page.locator('#find-now')).toContainText('Find Now is running for Other sources');
  await expect(page.getByRole('button', { name: 'Find Now' })).toBeDisabled();

  await expect(async () => {
    await page.reload();
    await expect(page.locator('#find-now')).toContainText('Find Now for Other sources finished at', { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('#find-now')).toContainText('other.log');
  await expect(page.getByRole('button', { name: 'Find Now' })).toBeEnabled();
  await expectNoViolations(page);
});
