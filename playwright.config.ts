import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// A separate port from the dev server (3000), so E2E never touches the owner's real database.
const PORT = 3100;
const baseURL = `http://127.0.0.1:${String(PORT)}`;

// Clear All and Find Now act on a whole view of the board, so their tests get a server of their own, on one project,
// one test at a time (DEC-053); every other test shares the first server and keeps to its own jobs.
const ACTIONS_PORT = 3101;
const actionsURL = `http://127.0.0.1:${String(ACTIONS_PORT)}`;
const ACTIONS_SPEC = /board-actions\.spec\.ts/;

// Find Now never starts Claude Code under test: both servers run tests/helpers/fake-claude.ts in its place (FR-22).
function fakeClaude(holdMs: number): string {
  return JSON.stringify([process.execPath, resolve('tests/helpers/fake-claude.ts'), String(holdMs), '0']);
}

function server(port: number, name: string, claudeCommand: string) {
  const url = `http://127.0.0.1:${String(port)}`;
  return {
    command: 'node src/main.ts',
    url: `${url}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      DB_PATH: join(tmpdir(), 'agentic-job-board-e2e', `${name}-${String(Date.now())}`, 'e2e.db'),
      LOG_LEVEL: 'warn',
      // Never the owner's saved LinkedIn login (DEC-032).
      LINKEDIN_SESSION_PATH: join(tmpdir(), 'agentic-job-board-e2e', 'no-linkedin-session.json'),
      CLAUDE_COMMAND: claudeCommand,
      // Setup (FR-24): the committed examples stand in for the LinkedIn searches and the feeds; tests/e2e/profile.setup.ts
      // saves the profile before any other test runs.
      LINKEDIN_SEARCHES_PATH: resolve('linkedin-searches.example.json'),
      SOURCES_PATH: resolve('sources.example.json'),
    },
  };
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  // board-report (PLAN.md Phase 14) next to list and html; it writes only when scripts/board-report.ts runs Playwright.
  reporter: [['list'], ['html', { open: 'never' }], ['./scripts/board-report/reporters/playwright.ts']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // The board opens only once a profile is saved (FR-24), so the profile goes onto both servers first.
    { name: 'profile', testMatch: /profile\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: ACTIONS_SPEC, dependencies: ['profile'] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: ACTIONS_SPEC, dependencies: ['profile'] },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: ACTIONS_SPEC, dependencies: ['profile'] },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: ACTIONS_SPEC, dependencies: ['profile'] },
    {
      name: 'board-actions',
      use: { ...devices['Desktop Chrome'], baseURL: actionsURL },
      testMatch: ACTIONS_SPEC,
      dependencies: ['profile'],
    },
  ],
  // Starts the real app (src/main.ts) with a fresh temporary database for every test run (DEC-012, DEC-013).
  webServer: [server(PORT, 'shared', fakeClaude(0)), server(ACTIONS_PORT, 'actions', fakeClaude(3000))],
});
