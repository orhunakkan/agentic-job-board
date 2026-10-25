// README screenshots (PLAN.md Phase 8 task 3), taken with Playwright from fake data only:
//   node scripts/screenshots.ts
// Starts the app on a temporary database seeded by scripts/seed.ts, so no real job, company or person appears.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { startApp } from '../src/app.ts';
import { createLogger } from '../src/logger.ts';
import { seedDatabase } from './seed.ts';
import { createRepositories } from '../src/db/repositories/index.ts';

const OUT = new URL('../docs/screenshots/', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'jobboard-shots-'));
const app = await startApp({
  port: 0,
  dbPath: join(dir, 'shots.db'),
  linkedinSessionPath: join(dir, 'session.json'),
  claudeCommand: ['claude-is-never-started-here'], // the screenshots never press Find Now
  logger: createLogger('warn'),
});

try {
  seedDatabase(app.db, createRepositories(app.db), { count: 240, seed: 3, until: new Date().toISOString() });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const shots: { name: string; path: string; width: number; height: number; dark?: boolean }[] = [
    { name: 'board', path: '/', width: 1280, height: 900 },
    { name: 'board-dark', path: '/?tab=in-progress', width: 1280, height: 900, dark: true },
    { name: 'job-detail', path: '/jobs/12', width: 1280, height: 1100 },
    { name: 'runs', path: '/runs', width: 1280, height: 700 },
    { name: 'board-mobile', path: '/', width: 390, height: 844 },
  ];
  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      colorScheme: shot.dark === true ? 'dark' : 'light',
      deviceScaleFactor: shot.width < 500 ? 2 : 1,
    });
    await page.goto(`${app.url}${shot.path}`);
    await page.screenshot({ path: new URL(`${shot.name}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    await page.close();
    console.log(`docs/screenshots/${shot.name}.png`);
  }
  await browser.close();
} finally {
  await app.close(0);
  rmSync(dir, { recursive: true, force: true });
}
