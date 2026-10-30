import { expect, test, type Page } from '@playwright/test';
import { seedJobs, uniqueTag } from './seed.ts';

// FR-23 (DEC-061): the header's light/dark toggle in a real browser, on every Playwright project. It is a form, so
// using it reloads the same page; the choice is kept in a cookie and holds on every page.

const LIGHT_BACKGROUND = 'rgb(243, 244, 251)'; // --bg
const DARK_BACKGROUND = 'rgb(10, 13, 27)';

/**
 * Opens a page with the system's scheme. Playwright's Firefox drops the emulated scheme when the first page it loads
 * sends Cross-Origin-Opener-Policy, as every page of the app does (DEF-021); set again, it holds from then on.
 */
async function open(page: Page, path: string, system: 'light' | 'dark'): Promise<void> {
  await page.goto(path);
  await page.emulateMedia({ colorScheme: system });
}

const toDark = (page: Page) => page.getByRole('button', { name: 'Switch to the dark theme' });
const toLight = (page: Page) => page.getByRole('button', { name: 'Switch to the light theme' });

async function expectTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    theme === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND,
  );
  // Exactly one button is shown: the one that switches away from the theme in effect.
  await expect(theme === 'dark' ? toLight(page) : toDark(page)).toBeVisible();
  await expect(theme === 'dark' ? toDark(page) : toLight(page)).toHaveCount(0);
}

test.describe('the theme toggle with the system in light', () => {
  test.use({ colorScheme: 'light' });

  test('FR-23: dark reloads the same page with its filters, and holds on every page until light is chosen', async ({
    page,
    request,
  }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [{ title: 'Theme SDET', company: 'Theme Co', score: 82 }]);
    const board = `/?origin=linkedin&tab=new&minScore=50&q=${tag}&sort=recent`;

    await open(page, board, 'light');
    await expectTheme(page, 'light');
    await expect(toDark(page)).toHaveText('Dark theme');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');

    await toDark(page).click();
    await expect(page).toHaveURL(board);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectTheme(page, 'dark');
    await expect(toLight(page)).toHaveText('Light theme');
    await expect(page.getByLabel('Search')).toHaveValue(tag);
    await expect(page.getByLabel('Min score')).toHaveValue('50');
    await expect(page.getByLabel('Sort')).toHaveValue('recent');
    await expect(page.locator('.card-title')).toHaveText([`Theme SDET ${tag}`]);

    const main = page.getByRole('navigation', { name: 'Main' });
    await main.getByRole('link', { name: 'Runs' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
    await expectTheme(page, 'dark');
    await main.getByRole('link', { name: 'Profile' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await expectTheme(page, 'dark');
    await page.goto(`/jobs/${String(job?.id)}`);
    await expectTheme(page, 'dark');
    await page.reload();
    await expectTheme(page, 'dark');

    await toLight(page).click();
    await expect(page).toHaveURL(`/jobs/${String(job?.id)}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectTheme(page, 'light');
    await page.goto('/runs');
    await expectTheme(page, 'light');
  });

  test('FR-23: the choice holds in a new tab, and switching never repeats a notice', async ({ page, request }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [{ title: 'Notice SDET', company: 'Notice Co', score: 70 }]);

    await open(page, `/jobs/${String(job?.id)}`, 'light');
    await page.getByRole('textbox', { name: 'Notes' }).fill('Call back');
    await page.getByRole('button', { name: 'Save notes' }).click();
    await expect(page.getByRole('status')).toHaveText('Notes saved.');

    await toDark(page).click();
    await expect(page).toHaveURL(`/jobs/${String(job?.id)}`);
    await expectTheme(page, 'dark');
    await expect(page.getByRole('status')).toHaveCount(0);

    const tab = await page.context().newPage();
    await open(tab, '/', 'light');
    await expectTheme(tab, 'dark');
  });

  test('FR-23: an error page follows the choice and has the toggle too', async ({ page }) => {
    await open(page, '/jobs/999999999', 'light');
    await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
    await toDark(page).click();
    await expect(page).toHaveURL('/jobs/999999999');
    await expectTheme(page, 'dark');
  });

  test('FR-23: exactly one toggle button can be reached with the keyboard', async ({ page, browserName }) => {
    await open(page, '/runs', 'light');

    // Desktop Safari only tabs to buttons and links when the user turns that on, so WebKit is checked by what can take
    // focus rather than by pressing Tab (as the skip-link test in board.spec.ts does).
    const focusable = await page.locator('.theme-toggle').evaluateAll(
      (buttons) =>
        buttons.filter((button) => {
          if (!(button instanceof HTMLElement)) return false;
          button.focus();
          return document.activeElement === button;
        }).length,
    );
    expect(focusable).toBe(1);

    if (browserName !== 'webkit') {
      await page.getByRole('link', { name: 'Skip to main content' }).focus();
      const stops: string[] = [];
      for (let press = 0; press < 12; press++) {
        await page.keyboard.press('Tab');
        stops.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
      }
      expect(stops.filter((label) => label.startsWith('Switch to the'))).toEqual(['Switch to the dark theme']);
    }
  });
});

test.describe('the theme toggle with the system in dark', () => {
  test.use({ colorScheme: 'dark' });

  test('FR-23: the page starts dark with "Light theme", and light holds against the system', async ({ page }) => {
    await open(page, '/profile', 'dark');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    await expectTheme(page, 'dark');
    await expect(toLight(page)).toHaveText('Light theme');

    await toLight(page).click();
    await expect(page).toHaveURL('/profile');
    await expectTheme(page, 'light');
    await page.goto('/');
    await expectTheme(page, 'light');

    await toDark(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectTheme(page, 'dark');
  });
});
