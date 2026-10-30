import { expect, test, type Page } from '@playwright/test';
import { JobDetailSchema } from '../../src/schemas/api.ts';
import { seedJobs, seedListings, uniqueTag } from './seed.ts';

// PLAN.md §8.1 types 7 and 8: the owner's daily flows in a real browser, on every Playwright project.

function card(page: Page, title: string) {
  return page.getByRole('article', { name: title });
}

async function expectNoSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('smoke', () => {
  test('NFR-01: the app is on the loopback address and healthy @smoke', async ({ baseURL, request }) => {
    expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const health = await request.get('/api/health');

    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  test('FR-07, FR-10: the board renders and a job detail opens @smoke', async ({ page, request }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [{ title: 'Smoke SDET', company: 'Smoke Co', score: 88 }]);

    await page.goto(`/?q=${tag}`);
    await expect(page).toHaveTitle('Board · Job Board');
    await expect(page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
    await expect(card(page, job?.title ?? '')).toContainText('88 Strong');

    await page.getByRole('link', { name: job?.title ?? '', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(job?.title ?? '');
    await expect(page.getByText('Reason: Seeded reason for Smoke Co.')).toBeVisible();
  });
});

test.describe('board', () => {
  test('FR-07: ranks by score, filters by min score and search, and keeps the filters', async ({ page, request }) => {
    const tag = uniqueTag();
    await seedJobs(request, tag, [
      { title: 'Possible QA', company: 'Mid Co', score: 60 },
      { title: 'Unscored QA', company: 'Plain Co' },
      // The company is unique too, so searching for it can't match other tests' jobs.
      { title: 'Strong SDET', company: `Top Co ${tag}`, score: 91, easyApply: true },
      { title: 'Weak Tester', company: 'Low Co', score: 20 },
    ]);

    await page.goto(`/?q=${tag}`);
    const titles = page.locator('.card-title');
    await expect(titles).toHaveText([
      `Strong SDET ${tag}`,
      `Possible QA ${tag}`,
      `Weak Tester ${tag}`,
      `Unscored QA ${tag}`,
    ]);
    await expect(card(page, `Strong SDET ${tag}`)).toContainText('Easy Apply');
    await expect(card(page, `Unscored QA ${tag}`)).toContainText('Unscored');

    await page.getByLabel('Min score').selectOption('50');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(titles).toHaveText([`Strong SDET ${tag}`, `Possible QA ${tag}`]);
    await expect(page.getByLabel('Min score')).toHaveValue('50');
    await expect(page.getByLabel('Search')).toHaveValue(tag);

    await page.getByLabel('Search').fill(`Top Co ${tag}`);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(titles).toHaveText([`Strong SDET ${tag}`]);

    await page.getByLabel('Search').fill(`${tag}-nothing`);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('No jobs match these filters.')).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).first().click();
    await expect(page.getByLabel('Search')).toHaveValue('');
  });

  test('FR-08: save → applied → interviewing, with a notice each time and the history recorded', async ({
    page,
    request,
  }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [{ title: 'Workflow SDET', company: 'Flow Co', score: 85 }]);
    const title = job?.title ?? '';

    await page.goto(`/?q=${tag}`);
    await card(page, title).getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByRole('status')).toHaveText(`${title} is now Saved.`);
    // The redirect ends in #notice, so keyboard and screen-reader users land on the message.
    await expect(page.getByRole('status')).toBeFocused();
    await expect(card(page, title)).toHaveCount(0);
    await expect(page.getByLabel('Search')).toHaveValue(tag);

    await page.goto(`/?tab=saved&q=${tag}`);
    await expect(page.getByRole('link', { name: /^Saved/ })).toHaveAttribute('aria-current', 'page');
    await card(page, title)
      .getByRole('button', { name: /^Applied/ })
      .click();
    await expect(page.getByRole('status')).toHaveText(`${title} is now Applied.`);

    await page.goto(`/?tab=in-progress&q=${tag}`);
    await expect(card(page, title)).toContainText('Applied');
    await page.getByRole('link', { name: title, exact: true }).click();

    await expect(page.getByLabel('Change to').locator('option')).toHaveText(['Interviewing', 'Rejected', 'Dismissed']);
    await page.getByLabel('Change to').selectOption('interviewing');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByRole('status')).toHaveText('Status changed to Interviewing.');

    const history = page.getByRole('region', { name: 'Status history' }).getByRole('listitem');
    await expect(history).toHaveCount(4);
    await expect(history.nth(0)).toContainText('Created as New');
    await expect(history.nth(1)).toContainText('New → Saved');
    await expect(history.nth(2)).toContainText('Saved → Applied');
    await expect(history.nth(3)).toContainText('Applied → Interviewing');
  });

  test('FR-08: dismiss from the board, then restore from the Dismissed tab', async ({ page, request }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [{ title: 'Dismiss Me', company: 'Gone Co', score: 40 }]);
    const title = job?.title ?? '';

    await page.goto(`/?q=${tag}`);
    await card(page, title)
      .getByRole('button', { name: /^Dismiss/ })
      .click();
    await expect(page.getByRole('status')).toHaveText(`${title} is now Dismissed.`);

    await page.goto(`/?tab=dismissed&q=${tag}`);
    await expect(card(page, title).getByRole('button')).toHaveText([/^\s*Restore/]);
    await card(page, title)
      .getByRole('button', { name: /^Restore/ })
      .click();
    await expect(page.getByRole('status')).toHaveText(`${title} is now New.`);

    await page.goto(`/?q=${tag}`);
    await expect(card(page, title)).toBeVisible();
  });

  test('FR-08: only allowed transitions are offered, and a final status offers none', async ({ page, request }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [{ title: 'Reject Path', company: 'No Co', score: 70 }]);
    const title = job?.title ?? '';

    await page.goto(`/?q=${tag}`);
    await expect(card(page, title).getByRole('button')).toHaveText([/^\s*Save/, /^\s*Applied/, /^\s*Dismiss/]);

    await page.getByRole('link', { name: title, exact: true }).click();
    await expect(page.getByLabel('Change to').locator('option')).toHaveText(['Saved', 'Applied', 'Dismissed']);
    for (const status of ['applied', 'rejected']) {
      await page.getByLabel('Change to').selectOption(status);
      await page.getByRole('button', { name: 'Update' }).click();
    }

    await expect(page.getByText("Rejected is a final status, so it can't change any more.")).toBeVisible();
    await expect(page.getByLabel('Change to')).toHaveCount(0);
    await page.getByRole('link', { name: '← Board' }).click();
    await expect(page).toHaveURL(/tab=closed/);
  });

  test('FR-09: notes are saved and shown again, line breaks intact', async ({ page, request }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [{ title: 'Notes Job', company: 'Note Co', score: 77 }]);
    const notes = 'Recruiter: Sam\nCall back Friday <b>early</b>';

    await page.goto(`/jobs/${String(job?.id)}`);
    await page.getByRole('textbox', { name: 'Notes' }).fill(notes);
    await page.getByRole('button', { name: 'Save notes' }).click();

    await expect(page.getByRole('status')).toHaveText('Notes saved.');
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(notes);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(notes);
  });

  test('FR-10: the detail page links to LinkedIn in a new tab without opening it', async ({ page, request }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [{ title: 'Link Job', company: 'Link Co' }]);

    await page.goto(`/jobs/${String(job?.id)}`);
    const link = page.getByRole('link', { name: /Open on LinkedIn/ });

    await expect(link).toHaveAttribute('href', /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/$/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByText('Not scored yet')).toBeVisible();
  });

  test('FR-17: LinkedIn jobs and jobs from other sources are on separate views', async ({ page, request }) => {
    const tag = uniqueTag();
    await seedJobs(request, tag, [{ title: 'LinkedIn SDET', company: 'Alert Co', score: 80 }]);
    await seedListings(request, tag, [
      { source: 'greenhouse', title: 'Board SDET', company: 'Feed Co', score: 85, salary: '$150K – $180K' },
    ]);

    await page.goto(`/?q=${tag}`);
    await expect(page.locator('.card-title')).toHaveText([`LinkedIn SDET ${tag}`]);
    const views = page.getByRole('navigation', { name: 'Job sources' });
    await expect(views.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('aria-current', 'page');

    await views.getByRole('link', { name: /Other sources/ }).click();
    await expect(page).toHaveURL(/\/\?origin=other$/);
    await page.getByRole('searchbox', { name: 'Search' }).fill(tag);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/origin=other/);
    await expect(page.locator('.card-title')).toHaveText([`Board SDET ${tag}`]);
    const listed = card(page, `Board SDET ${tag}`);
    await expect(listed).toContainText('Greenhouse');
    await expect(listed).toContainText('$150K – $180K');
    await expect(listed.getByRole('link', { name: /Open on Greenhouse/ })).toHaveAttribute('target', '_blank');

    // Saving keeps the owner on the other-sources view, and the job moves to its Saved tab.
    await listed.getByRole('button', { name: /^Save/ }).click();
    await expect(page).toHaveURL(/origin=other/);
    await expect(page.getByRole('status')).toContainText('is now Saved.');
    await page.goto(`/?origin=other&tab=saved&q=${tag}`);
    await expect(page.locator('.card-title')).toHaveText([`Board SDET ${tag}`]);
    await page.goto(`/?tab=saved&q=${tag}`);
    await expect(page.locator('.card-title')).toHaveCount(0);
  });

  test('FR-17: an other-source job page shows its description and leads back to its view', async ({
    page,
    request,
  }) => {
    const tag = uniqueTag();
    const [job] = await seedListings(request, tag, [
      {
        source: 'himalayas',
        title: 'Remote QA Lead',
        company: 'Feed Co',
        description: 'About the role\n\nLead quality.\n• Playwright\n• k6',
      },
    ]);

    await page.goto(`/jobs/${String(job?.id)}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Description' })).toBeVisible();
    await expect(page.locator('.description')).toHaveText('About the role\n\nLead quality.\n• Playwright\n• k6');
    await expect(page.getByRole('link', { name: /Open on Himalayas/ })).toHaveAttribute(
      'href',
      /^https:\/\/jobs\.example\.com\/himalayas\//,
    );

    await page.getByRole('link', { name: '← Board' }).click();
    await expect(page).toHaveURL(/\/\?origin=other&tab=new$/);
  });

  test('FR-19, FR-20: a LinkedIn search job shows its workplace, the search that found it and its rubric', async ({
    page,
    request,
  }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [
      {
        title: 'Found SDET',
        company: 'Search Co',
        location: 'United States (Remote)',
        workplace: 'remote',
        description: 'About the role\n\nOwn the Playwright suite.',
        searchName: 'QA family',
        score: 86,
        rubricVersion: 'match-v1',
      },
    ]);

    await page.goto(`/?q=${tag}`);
    await expect(card(page, `Found SDET ${tag}`)).toContainText('Remote');
    await expect(card(page, `Found SDET ${tag}`)).toContainText(/Posted (just now|\d+ min ago)/);

    await page.getByRole('link', { name: `Found SDET ${tag}`, exact: true }).click();
    const details = page.getByRole('region', { name: 'Details' });
    await expect(details.getByRole('definition').filter({ hasText: 'Remote' })).toBeVisible();
    await expect(details).toContainText('match-v1: scored on the full description');
    await expect(page.getByRole('region', { name: 'Sightings' })).toContainText('Found by the search “QA family”');
    await expect(page.locator('.description')).toHaveText('About the role\n\nOwn the Playwright suite.');
    const { sourceJobId } = JobDetailSchema.parse(await (await request.get(`/api/jobs/${String(job?.id)}`)).json());
    await expect(page.getByRole('link', { name: /Open on LinkedIn/ })).toHaveAttribute(
      'href',
      `https://www.linkedin.com/jobs/view/${sourceJobId}/`,
    );
  });

  test('FR-11, FR-01: the runs and profile pages open from the main navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Runs' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Every /find-jobs run, newest first' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profile' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
  });

  test('NFR-06: the skip link is the first stop for keyboard users and jumps to the content', async ({ page }) => {
    await page.goto('/');
    // Checked in DOM order rather than by pressing Tab: desktop Safari only tabs to links when the user turns
    // that on, so a Tab press would test the browser setting, not the page.
    const first = await page.evaluate(
      () => document.querySelector('a[href], button, input, select, textarea')?.textContent,
    );
    expect(first).toBe('Skip to main content');

    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await skip.focus();
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('NFR-11: no page scrolls sideways', async ({ page, request }) => {
    const tag = uniqueTag();
    const [job] = await seedJobs(request, tag, [
      {
        title: 'A very long job title that keeps going: Senior Software Development Engineer in Test, Platform',
        company: 'Averyveryverylongcompanynamewithoutanyspacesatall Incorporated',
        location: 'San Francisco Bay Area, California, United States',
        score: 81,
        easyApply: true,
      },
    ]);

    const [listed] = await seedListings(request, tag, [
      {
        source: 'hackernews',
        title: 'Senior Software Engineer in Test, Quality Platform and Developer Productivity',
        company: 'Averyveryverylongcompanynamewithoutanyspacesatall Labs',
        salary: '$180K – $240K + equity + a very long list of benefits',
        description: `Header | Role | Remote\n\n${'Averyverylongwordwithoutanybreaks'.repeat(8)}`,
      },
    ]);

    for (const path of [
      `/?q=${tag}`,
      `/jobs/${String(job?.id)}`,
      `/?origin=other&q=${tag}`,
      `/jobs/${String(listed?.id)}`,
      '/runs',
      '/profile',
    ]) {
      await page.goto(path);
      await expectNoSideScroll(page);
    }
  });
});
