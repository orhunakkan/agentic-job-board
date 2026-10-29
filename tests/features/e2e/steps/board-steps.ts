import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import { expect, type Locator } from '@playwright/test';
import type { Tab } from '../../../../src/domain/board-tabs.ts';
import type { Origin } from '../../../../src/domain/job-source.ts';
import type { Status } from '../../../../src/domain/status.ts';
import { ACTION_LABELS, ORIGIN_LABELS } from '../../../../src/ui/format.ts';
import { putOnBoard } from '../../support/board-api.ts';
import { jobRow, jobRows } from '../../support/board-data.ts';
import type { BoardWorld } from '../../support/world.ts';
import { open, submit } from './navigate.ts';

// The board in a browser, with the same role- and label-based locators as tests/e2e/ (FR-07, FR-08, FR-17).

function card(world: BoardWorld, title: string): Locator {
  return world.page.getByRole('article', { name: title, exact: true });
}

function cardTitles(world: BoardWorld): Locator {
  return world.page.locator('.card-title');
}

async function applyFilters(world: BoardWorld): Promise<void> {
  await world.page.getByRole('button', { name: 'Apply' }).click();
}

Given('the board has these jobs:', async function (this: BoardWorld, table: DataTable) {
  await putOnBoard(this, jobRows(table));
});

Given('the board has a new LinkedIn job {string}', async function (this: BoardWorld, title: string) {
  await putOnBoard(this, [jobRow({ title })]);
});

Given(
  'the board has a new LinkedIn job {string} scored {int}',
  async function (this: BoardWorld, title: string, score: number) {
    await putOnBoard(this, [jobRow({ title, score })]);
  },
);

When('I open the board', async function (this: BoardWorld) {
  await open(this, '/');
});

When('I open the {view} view', async function (this: BoardWorld, view: Origin) {
  await open(this, '/');
  await this.page
    .getByRole('navigation', { name: 'Job sources' })
    .getByRole('link', { name: new RegExp(`^${ORIGIN_LABELS[view]}`) })
    .click();
});

async function pressOnCard(world: BoardWorld, title: string, action: Status): Promise<void> {
  world.current = title;
  await submit(world, card(world, title).getByRole('button', { name: new RegExp(`^${ACTION_LABELS[action]}\\b`) }));
}

When('I save {string}', async function (this: BoardWorld, title: string) {
  await pressOnCard(this, title, 'saved');
});

When('I dismiss {string}', async function (this: BoardWorld, title: string) {
  await pressOnCard(this, title, 'dismissed');
});

When('I restore {string}', async function (this: BoardWorld, title: string) {
  await pressOnCard(this, title, 'new');
});

When('I mark {string} as {status}', async function (this: BoardWorld, title: string, status: Status) {
  await pressOnCard(this, title, status);
});

Then('the board/page says {string}', async function (this: BoardWorld, message: string) {
  const notice = this.page.locator('#notice');
  await expect(notice).toHaveText(message);
  // The form's redirect ends in #notice, so keyboard and screen-reader users land on the message.
  await expect(notice).toBeFocused();
});

Then('{string} is on the {tab} tab', async function (this: BoardWorld, title: string, tab: Tab) {
  await open(this, `/?tab=${tab}`);
  await expect(card(this, title)).toBeVisible();
});

Then('{string} is not on the {tab} tab', async function (this: BoardWorld, title: string, tab: Tab) {
  await open(this, `/?tab=${tab}`);
  await expect(card(this, title)).toHaveCount(0);
});

Then('the board lists {titles}, in that order', async function (this: BoardWorld, titles: string[]) {
  await expect(cardTitles(this)).toHaveText(titles);
});

Then('the board lists {titles}', async function (this: BoardWorld, titles: string[]) {
  await expect(cardTitles(this)).toHaveCount(titles.length);
  for (const title of titles) await expect(card(this, title)).toBeVisible();
});

Then('the card for {string} offers {titles}', async function (this: BoardWorld, title: string, actions: string[]) {
  await expect(card(this, title).getByRole('button')).toHaveText(
    actions.map((action) => new RegExp(`^\\s*${action}:`)),
  );
});

When('I filter for a minimum score of {int}', async function (this: BoardWorld, minScore: number) {
  await this.page.getByLabel('Min score').selectOption(String(minScore));
  await applyFilters(this);
});

Then('the filter still shows a minimum score of {int}', async function (this: BoardWorld, minScore: number) {
  await expect(this.page.getByLabel('Min score')).toHaveValue(String(minScore));
});

When('I search for {string}', async function (this: BoardWorld, text: string) {
  await this.page.getByRole('searchbox', { name: 'Search' }).fill(text);
  await applyFilters(this);
});

When('I sort by {word}', async function (this: BoardWorld, order: string) {
  await this.page.getByLabel('Sort').selectOption({ label: order });
  await applyFilters(this);
});

Then(
  'the switch shows {int} New jobs on LinkedIn and {int} on Other sources',
  async function (this: BoardWorld, linkedin: number, other: number) {
    const views = this.page.getByRole('navigation', { name: 'Job sources' });
    // Screen readers hear "new" after each number (DEC-054).
    await expect(views.getByRole('link', { name: `LinkedIn ${String(linkedin)} new` })).toBeVisible();
    await expect(views.getByRole('link', { name: `Other sources ${String(other)} new` })).toBeVisible();
  },
);

Then('the card for {string} names {word}', async function (this: BoardWorld, title: string, source: string) {
  await expect(card(this, title).locator('.flag', { hasText: source })).toBeVisible();
});

Then(
  'the card for {string} links to the job with {string}, in a new tab',
  async function (this: BoardWorld, title: string, text: string) {
    const link = card(this, title).getByRole('link', { name: new RegExp(`^${text}`) });
    await expect(link).toHaveAttribute('href', this.knownListing(title).url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  },
);
