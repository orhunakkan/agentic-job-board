import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { BoardWorld } from '../../support/world.ts';
import { open, submit } from './navigate.ts';

// The header's light/dark toggle in a browser (FR-23, DEC-061), with the same locators as tests/e2e/theme.spec.ts.

type Theme = 'light' | 'dark';

const BACKGROUND: Readonly<Record<Theme, string>> = { light: 'rgb(243, 244, 251)', dark: 'rgb(10, 13, 27)' };
const SWITCH_TO: Readonly<Record<Theme, string>> = {
  light: 'Switch to the light theme',
  dark: 'Switch to the dark theme',
};

Given('my system shows pages in light', async function (this: BoardWorld) {
  await this.page.emulateMedia({ colorScheme: 'light' });
});

When('I choose the {word} theme', async function (this: BoardWorld, theme: string) {
  await submit(this, this.page.getByRole('button', { name: SWITCH_TO[theme === 'dark' ? 'dark' : 'light'] }));
});

When('I go to Profile', async function (this: BoardWorld) {
  await this.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profile' }).click();
  await expect(this.page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
});

When('I close the board and open it again', async function (this: BoardWorld) {
  const context = this.page.context();
  await this.page.close();
  this.page = await context.newPage();
  await open(this, '/');
});

Then(
  'the page is {word}, and offers the {word} theme',
  async function (this: BoardWorld, shown: string, offered: string) {
    const theme: Theme = shown === 'dark' ? 'dark' : 'light';
    const other: Theme = theme === 'dark' ? 'light' : 'dark';
    if (offered !== other) throw new Error(`a ${shown} page offers the ${other} theme, not "${offered}"`);

    await expect(this.page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(this.page.locator('body')).toHaveCSS('background-color', BACKGROUND[theme]);
    await expect(this.page.getByRole('button', { name: SWITCH_TO[other] })).toBeVisible();
    await expect(this.page.getByRole('button', { name: SWITCH_TO[theme] })).toHaveCount(0);
  },
);
