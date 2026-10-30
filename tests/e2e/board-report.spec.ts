import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { BuildOutcome } from '../../scripts/board-report/build/build.ts';
import type { TestEntry } from '../../scripts/board-report/build/data-shape.ts';
import { buildFixtureReport, HOSTILE_TITLE } from '../helpers/board-report-fixture.ts';
import { expectNoViolations } from './axe.ts';

// PLAN.md Phase 14 task 14, NFR-13: board-report's pages in a real browser, on every Playwright project, opened
// straight from disk (file://) on a report built from fixture results: two runs, every test type, failures, nested
// steps, a screenshot, a video, a trace and a title that must stay text.

let outcome: BuildOutcome;
let reportUrl = '';

test.beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'board-report-e2e-'));
  outcome = buildFixtureReport(dir);
  reportUrl = pathToFileURL(join(dir, 'index.html')).href;
});

function tests(): TestEntry[] {
  return outcome.index.tests;
}

function find(predicate: (entry: TestEntry) => boolean): TestEntry {
  const found = tests().find(predicate);
  if (found === undefined) throw new Error('the fixture report has no such test');
  return found;
}

function failedE2e(): TestEntry {
  return find((entry) => entry.type === 'e2e' && entry.status === 'failed');
}

function countOf(predicate: (entry: TestEntry) => boolean): number {
  return tests().filter(predicate).length;
}

/** Opens the report at a route and waits until the view is drawn and its entrance animation is over. */
async function open(page: Page, route = ''): Promise<void> {
  await page.goto(`${reportUrl}${route}`);
  await settle(page);
}

async function settle(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await animationsDone(page);
}

/** Waits until no animation or transition is running, so axe sees the colours the page settles on. */
async function animationsDone(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
}

function filterCount(page: Page) {
  return page.locator('.filter-count');
}

function shown(count: number, total: number, noun = 'tests'): string {
  return count === total ? `${String(total)} ${noun}` : `${String(count)} of ${String(total)} ${noun}`;
}

async function expectNoSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const ROUTES = ['#/overview', '#/types', '#/requirements', '#/failures', '#/timeline', '#/environment'] as const;

test.describe('board-report', () => {
  // Several tests here walk every view of the report, with axe or a click on each. WebKit draws the views two to three
  // times slower than the other engines, and on the CI runner those tests took 22–34 s of the 30 s budget once the
  // suite grew (DEF-022), so WebKit gets the triple budget. Every assertion stays as it is.
  test.beforeEach(({ browserName }) => {
    test.slow(browserName === 'webkit', 'WebKit walks the report’s views slowly (DEF-022)');
  });

  test('NFR-13: the overview shows the run’s totals, pass rate, test types and trends', async ({ page }) => {
    await open(page);
    const { totals } = outcome.index;
    const total = totals.passed + totals.failed + totals.broken + totals.skipped;

    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    const tiles = page.getByRole('list', { name: 'Totals' }).getByRole('listitem');
    await expect(tiles.filter({ hasText: 'Total' })).toContainText(String(total));
    await expect(tiles.filter({ hasText: 'Passed' })).toContainText(String(totals.passed));
    await expect(tiles.filter({ hasText: 'Failed' })).toContainText(String(totals.failed));
    await expect(tiles.filter({ hasText: 'Broken' })).toContainText(String(totals.broken));
    await expect(tiles.filter({ hasText: 'Skipped' })).toContainText(String(totals.skipped));
    await expect(tiles.filter({ hasText: 'Duration' })).toContainText(/\d/);

    const rate = ((totals.passed / total) * 100).toFixed(1);
    await expect(page.getByRole('img', { name: new RegExp(`^Pass rate ${rate} %`) })).toBeVisible();
    await expect(page.getByRole('banner')).toContainText(
      `${String(totals.failed + totals.broken)} failed of ${String(total)}`,
    );

    const types = page.getByRole('region', { name: 'Test types' });
    for (const type of ['Static', 'Unit', 'E2E', 'BDD E2E', 'Performance']) {
      await expect(types.getByRole('link', { name: type, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: '10 slowest tests' }).getByRole('listitem')).toHaveCount(10);
    await expect(page.getByRole('region', { name: 'Failures by category' })).toContainText('Assertion failures');
  });

  test('NFR-13: the type tree opens and closes with the mouse', async ({ page }) => {
    await open(page, '#/types');
    const unit = page.getByRole('button', { name: 'Unit', exact: true });
    const file = page.getByRole('button', { name: 'tests/unit/domain/status.test.ts' });

    await expect(unit).toHaveAttribute('aria-expanded', 'false');
    await expect(file).toBeHidden();
    await unit.click();
    await expect(unit).toHaveAttribute('aria-expanded', 'true');
    await expect(file).toBeVisible();
    await file.click();
    await page.getByRole('button', { name: 'status', exact: true }).click();
    await page.getByRole('button', { name: 'transitions', exact: true }).click();
    await expect(page.getByRole('link', { name: 'FR-08: applied follows saved' })).toBeVisible();

    await unit.click();
    await expect(unit).toHaveAttribute('aria-expanded', 'false');
    await expect(file).toBeHidden();

    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.getByRole('link', { name: 'Clear All empties New for one view' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(page.getByRole('link', { name: 'Clear All empties New for one view' })).toHaveCount(0);
    await expect(unit).toHaveAttribute('aria-expanded', 'false');
  });

  test('NFR-13: the type tree opens and closes with the keyboard', async ({ page }) => {
    await open(page, '#/types');
    const e2e = page.getByRole('button', { name: 'E2E', exact: true });
    const file = page.getByRole('button', { name: 'tests/e2e/board.spec.ts' });
    const suite = page.getByRole('button', { name: 'board', exact: true });

    await e2e.focus();
    await page.keyboard.press('Enter');
    await expect(e2e).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(file).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(file).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(suite).toBeFocused();
    await page.keyboard.press('Space');
    await expect(suite).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('link', { name: 'FR-07, FR-08: save a job from the board' }).first()).toBeFocused();

    await page.keyboard.press('ArrowLeft');
    await expect(suite).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(suite).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowLeft');
    await expect(file).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(file).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowUp');
    await expect(e2e).toBeFocused();
    await page.keyboard.press('Space');
    await expect(e2e).toHaveAttribute('aria-expanded', 'false');
    await expect(file).toBeHidden();
  });

  test('NFR-13: search and every filter narrow the lists and live in the link', async ({ page }) => {
    await open(page, '#/types');
    const total = tests().length;
    await expect(filterCount(page)).toHaveText(shown(total, total));

    await page.getByRole('searchbox', { name: 'Search' }).fill('clear all');
    await expect(filterCount(page)).toHaveText(
      shown(
        countOf((entry) => entry.name.startsWith('Clear All')),
        total,
      ),
    );
    await expect(page.getByRole('link', { name: 'Clear All empties New for one view' })).toHaveCount(2);
    await expect(page).toHaveURL(/#\/types\?q=clear\+all$/);
    await page.getByRole('searchbox', { name: 'Search' }).fill('FR-21');
    await expect(filterCount(page)).toHaveText(
      shown(
        countOf((entry) => entry.requirements.includes('FR-21')),
        total,
      ),
    );
    await page.getByRole('searchbox', { name: 'Search' }).fill('tests/api/');
    await expect(filterCount(page)).toHaveText(
      shown(
        countOf((entry) => entry.file?.startsWith('tests/api/') ?? false),
        total,
      ),
    );
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(filterCount(page)).toHaveText(shown(total, total));

    const filters: [string, string, (entry: TestEntry) => boolean][] = [
      ['Status', 'failed', (entry) => entry.status === 'failed'],
      ['Test type', 'e2e', (entry) => entry.type === 'e2e'],
      ['Browser', 'Firefox', (entry) => entry.browser === 'Firefox'],
      ['Tag', '@smoke', (entry) => entry.tags.includes('@smoke')],
      ['Severity', 'critical', (entry) => entry.severity === 'critical'],
    ];
    for (const [label, value, predicate] of filters) {
      await page.getByLabel(label, { exact: true }).selectOption(value);
      const expected = countOf(predicate);
      expect(expected).toBeGreaterThan(0);
      await expect(filterCount(page)).toHaveText(shown(expected, total));
      await expect(page.locator('.tree-test')).toHaveCount(expected);
      await page.getByLabel(label, { exact: true }).selectOption('');
      await expect(filterCount(page)).toHaveText(shown(total, total));
    }

    await page.getByLabel('Status', { exact: true }).selectOption('failed');
    await page.getByLabel('Test type', { exact: true }).selectOption('e2e');
    await expect(page).toHaveURL(/status=failed&type=e2e/);
    await page.reload();
    await settle(page);
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue('failed');
    await expect(filterCount(page)).toHaveText(
      shown(
        countOf((entry) => entry.status === 'failed' && entry.type === 'e2e'),
        total,
      ),
    );

    await open(page, '#/failures');
    const failing = countOf((entry) => entry.status === 'failed' || entry.status === 'broken');
    await expect(filterCount(page)).toHaveText(shown(failing, failing, 'failures'));
    await page.getByLabel('Status', { exact: true }).selectOption('broken');
    await expect(filterCount(page)).toHaveText(
      shown(
        countOf((entry) => entry.status === 'broken'),
        failing,
        'failures',
      ),
    );
    await expect(page.getByRole('region', { name: /Crashes/ })).toContainText(
      "Cannot read properties of undefined (reading 'title')",
    );

    await open(page, '#/timeline');
    await page.getByRole('searchbox', { name: 'Search' }).fill('NFR-05');
    const perf = countOf((entry) => entry.requirements.includes('NFR-05'));
    await expect(filterCount(page)).toHaveText(shown(perf, total));
    await expect(page.getByRole('region', { name: 'In start order' }).getByRole('listitem')).toHaveCount(perf);
  });

  test('NFR-13: a failed test’s page shows its error, steps, screenshot, video and trace', async ({ page }) => {
    const failed = failedE2e();
    await open(page, `#/test/${failed.id}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(failed.name);
    const about = page.getByRole('list', { name: 'About this test' });
    await expect(about).toContainText('Failed');
    await expect(about).toContainText('E2E');
    await expect(about).toContainText('Chromium');
    await expect(about.getByRole('link', { name: 'FR-07' })).toHaveAttribute('href', '#/requirements?req=FR-07');
    const source = page.getByRole('link', { name: `${failed.file ?? ''}:${String(failed.line)}` });
    await expect(source).toHaveAttribute('href', failed.sourceUrl ?? '');
    await expect(source).toHaveAttribute('target', '_blank');

    const error = page.getByRole('region', { name: 'Error' });
    await expect(error).toContainText('expect(locator).toHaveText(expected) failed');
    await expect(error.getByRole('heading', { name: 'Expected' })).toBeVisible();
    await expect(error.getByRole('heading', { name: 'Actual' })).toBeVisible();
    await expect(error.locator('.diff-expected pre')).toHaveText('"Saved (1)"');
    await expect(error.locator('.diff-actual pre')).toHaveText('"Saved (0)"');
    const stack = error.getByText('at tests/e2e/board.spec.ts:88:5');
    await expect(stack).toBeHidden();
    await error.getByText('Stack trace').click();
    await expect(stack).toBeVisible();

    const steps = page.getByRole('region', { name: 'Steps' });
    await expect(steps.getByText('save the job')).toBeVisible();
    await expect(steps.getByText('Expect "toHaveText"')).toBeVisible();
    await expect(steps.getByText('Create page')).toBeHidden();
    await steps.getByText('Before Hooks').click();
    await expect(steps.getByText('Create page')).toBeVisible();

    const screenshot = page.getByAltText('screenshot', { exact: true });
    await expect(screenshot).toHaveAttribute('src', new RegExp(`^attachments/${failed.id}/.+screenshot\\.png$`));
    await expect.poll(() => screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Open screenshot full size' }).click();
    const dialog = page.getByRole('dialog', { name: 'screenshot' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('video')).toHaveAttribute('src', new RegExp(`^attachments/${failed.id}/.+video\\.webm$`));
    await expect(page.locator('video')).toHaveAttribute('controls', '');
    await expect(page.getByText(/^npx playwright show-trace attachments\/.+trace\.zip$/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Attachments' })).toContainText('"violations": []');
  });

  test('NFR-13: the requirement view lists each requirement with its tests by type', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: 'FR-08: failed' }).click();
    await expect(page).toHaveURL(/#\/requirements\?req=FR-08$/);
    await settle(page);

    const card = page.getByRole('article');
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { level: 2 })).toContainText('FR-08');
    await expect(card).toContainText('Failed');
    await expect(card.getByRole('heading', { level: 3 })).toHaveText([/^Unit/, /^E2E/]);
    await expect(card.getByRole('link', { name: 'FR-08: applied follows saved' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'FR-07, FR-08: save a job from the board' })).toHaveCount(2);
    const plan = card.getByRole('link', { name: 'FR-08 in the plan' });
    await expect(plan).toHaveAttribute('href', /^https:\/\/github\.com\/.+\/PLAN\.md#31-functional-requirements$/);
    await expect(plan).toHaveAttribute('rel', 'noopener noreferrer');

    await page.getByRole('link', { name: 'Show every requirement' }).click();
    await expect(page).toHaveURL(/#\/requirements$/);
    await expect.poll(() => page.getByRole('article').count()).toBeGreaterThan(10);
    await settle(page);
    await page.getByRole('searchbox', { name: 'Search' }).fill('NFR-05');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('article')).toContainText('Performance');
  });

  test('NFR-13: history dots and trends show both runs', async ({ page }) => {
    await open(page);
    expect(outcome.index.trend).toHaveLength(2);
    await expect(page.getByRole('img', { name: /^Results of the last 2 runs\./ })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Duration of the last 2 runs\./ })).toBeVisible();
    const flaky = page.getByRole('region', { name: 'Flaky tests' });
    await expect(flaky.getByRole('link', { name: 'FR-08: applied follows saved' })).toBeVisible();

    await flaky.getByRole('link', { name: 'FR-08: applied follows saved' }).click();
    await settle(page);
    const dots = page.getByRole('list', { name: 'Last 2 results, oldest first: passed, failed' });
    await expect(dots.getByRole('listitem')).toHaveCount(2);
    await expect(dots.getByRole('listitem').last()).toHaveAttribute('title', 'This run: Failed');
    await expect(page.getByRole('list', { name: 'About this test' })).toContainText('Flaky');
  });

  test('NFR-13: the theme toggle switches light and dark and is remembered', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    const html = page.locator('html');
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await background();

    await page.getByRole('button', { name: 'Switch to the dark theme' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    expect(await background()).not.toBe(light);
    await expect(page.getByRole('button', { name: 'Switch to the light theme' })).toBeVisible();

    await page.reload();
    await settle(page);
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Switch to the light theme' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await background()).toBe(light);
  });

  test('NFR-13: the theme toggle still works when the browser keeps nothing', async ({ page }) => {
    await page.addInitScript(() => {
      const blocked = (): never => {
        throw new Error('storage is blocked');
      };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    await page.getByRole('button', { name: 'Switch to the light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(errors).toEqual([]);
  });

  test('NFR-13: a shared link opens the right test, and Back returns', async ({ page }) => {
    const failed = failedE2e();
    await open(page, `#/test/${failed.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(failed.name);
    await expect(page.getByRole('region', { name: 'Error' })).toBeVisible();

    await open(page, '#/overview');
    const slowest = page.getByRole('region', { name: '10 slowest tests' });
    const first = [...tests()].sort((left, right) => right.duration - left.duration)[0];
    await slowest.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`#/test/${first?.id ?? ''}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first?.name ?? '');
    await page.goBack();
    await expect(page).toHaveURL(/#\/overview$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Failures' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Failures' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

    await open(page, '#/test/0000000000000000');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test not found');
  });

  test('NFR-13: the report opens from file:// with no errors and no Content Security Policy violation', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const seen: string[] = [];
      Object.defineProperty(window, 'cspViolations', { value: seen });
      document.addEventListener('securitypolicyviolation', (event) => {
        seen.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    await open(page);
    expect(page.url().startsWith('file://')).toBe(true);
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Timeline' }).click();
    for (const route of ROUTES) {
      await page
        .getByRole('navigation', { name: 'Views' })
        .getByRole('link')
        .filter({ hasText: viewName(route) })
        .click();
      await expect(page).toHaveURL((url) => url.hash === route);
      await settle(page);
    }
    await open(page, `#/test/${failedE2e().id}`);
    await expect(page.getByRole('region', { name: 'Steps' })).toBeVisible();

    const violations = await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('NFR-13: every view fits 375 px with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const route of [...ROUTES, `#/test/${failedE2e().id}`]) {
      await open(page, route);
      await expectNoSideScroll(page);
    }
    await open(page, '#/types');
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expectNoSideScroll(page);
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
  });

  test('NFR-13: a hostile test title stays text', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    const hostile = find((entry) => entry.name.includes(HOSTILE_TITLE));

    await open(page, '#/types?q=onerror');
    await expect(page.getByRole('link', { name: hostile.name })).toBeVisible();
    await open(page, `#/test/${hostile.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(hostile.name);
    await open(page);
    await expect(page.getByText(hostile.name).first()).toBeVisible();

    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(dialogs).toBe(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`NFR-13: axe finds no violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const route of [...ROUTES, `#/types?status=failed`, `#/test/${failedE2e().id}`]) {
        await open(page, route);
        if (route.startsWith('#/test/')) await expect(page.getByRole('region', { name: 'Steps' })).toBeVisible();
        await expectNoViolations(page);
      }
    });
  }

  test('NFR-13: axe finds no violations after switching to dark with the toggle', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    await page.getByRole('button', { name: 'Switch to the dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await animationsDone(page);
    await expectNoViolations(page);
  });
});

function viewName(route: (typeof ROUTES)[number]): string {
  const names: Record<(typeof ROUTES)[number], string> = {
    '#/overview': 'Overview',
    '#/types': 'By test type',
    '#/requirements': 'By requirement',
    '#/failures': 'Failures',
    '#/timeline': 'Timeline',
    '#/environment': 'Environment',
  };
  return names[route];
}
