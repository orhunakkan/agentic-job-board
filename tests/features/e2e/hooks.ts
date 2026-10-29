import assert from 'node:assert/strict';
import { After, AfterAll, Before, BeforeAll, Status } from '@cucumber/cucumber';
import { chromium, devices, firefox, webkit, type Browser, type BrowserContextOptions } from '@playwright/test';
import { z } from 'zod';
import type { BoardWorld } from '../support/world.ts';

// The E2E profiles differ only in their browser (cucumber.json): Chromium, Firefox and WebKit on a desktop, and
// Pixel 7 as playwright.config.ts has them. One browser for the whole run, a fresh context for every scenario.

const BROWSERS = {
  chromium: { type: chromium, device: devices['Desktop Chrome'] },
  firefox: { type: firefox, device: devices['Desktop Firefox'] },
  webkit: { type: webkit, device: devices['Desktop Safari'] },
  mobile: { type: chromium, device: devices['Pixel 7'] },
} as const;

const Parameters = z.object({ browser: z.enum(Object.keys(BROWSERS) as [keyof typeof BROWSERS]) });

let browser: Browser | undefined;
let contextOptions: BrowserContextOptions = {};

BeforeAll(async function () {
  const { type, device } = BROWSERS[Parameters.parse(this.parameters).browser];
  browser = await type.launch();
  contextOptions = device;
});

Before(async function (this: BoardWorld) {
  assert.ok(browser, 'the browser did not start');
  const context = await browser.newContext(contextOptions);
  // Outside Playwright's runner an action waits forever by default; this fails it first, naming the element.
  context.setDefaultTimeout(10_000);
  this.page = await context.newPage();
});

// A failed scenario keeps a picture of the page in its report. support/hooks.ts closes the page after this runs.
After(async function (this: BoardWorld, { result }) {
  if (result?.status === Status.FAILED) this.attach(await this.page.screenshot({ fullPage: true }), 'image/png');
});

AfterAll(async function () {
  await browser?.close();
});
