import type { Locator } from '@playwright/test';
import type { BoardWorld } from '../../support/world.ts';

/** Opens a page of the scenario's own app in its browser page. */
export async function open(world: BoardWorld, path: string): Promise<void> {
  await world.page.goto(new URL(path, (await world.app()).url).href);
}

/**
 * Presses a button that posts one of the board's forms and waits until the page the app redirects to has loaded,
 * so the next step can't cut the post or its redirect short by opening another page.
 */
export async function submit(world: BoardWorld, button: Locator): Promise<void> {
  const loaded = world.page.waitForEvent('load');
  // When the button is missing, the click's error names it; the wait for a page that never comes stays quiet.
  void loaded.catch(() => undefined);
  await button.click();
  await loaded;
}
