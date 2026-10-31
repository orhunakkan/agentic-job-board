import { expect, test as setup } from '@playwright/test';
import { SAMPLE_PROFILE } from '../helpers/profiles.ts';

// Setup comes first (FR-24): the board sends the owner to /setup until a profile is saved. Both E2E servers start
// empty (playwright.config.ts), so the sample profile is saved on each before any other test runs.
const SERVERS = ['http://127.0.0.1:3100', 'http://127.0.0.1:3101'];

setup('FR-24: the sample profile is saved on both E2E servers', async ({ request }) => {
  for (const server of SERVERS) {
    const response = await request.put(`${server}/api/profile`, { data: SAMPLE_PROFILE });
    expect(response.status(), server).toBe(200);
  }
});
