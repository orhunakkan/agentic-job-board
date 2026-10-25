import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobListResponseSchema } from '../../src/schemas/api.ts';
import { seedBoard } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// Clear All (FR-21) and Find Now (FR-22) change the whole board or start Claude Code, so another site must never be
// able to press them: the cross-site guard refuses their form posts like every other write (NFR-01, DEC-052).

describe('board actions from another site', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await startTestApp();
    await seedBoard(testApp);
  });
  afterEach(async () => {
    await testApp.close();
  });

  async function newJobs(): Promise<number> {
    return JobListResponseSchema.parse((await testApp.get('/api/jobs?tab=new&limit=100')).body).total;
  }

  it.each<[string, Record<string, string>]>([
    ['a foreign Origin', { Origin: 'http://evil.example' }],
    ['an opaque "null" Origin', { Origin: 'null' }],
    ['Sec-Fetch-Site: cross-site', { 'Sec-Fetch-Site': 'cross-site' }],
    ['Sec-Fetch-Site: same-site', { 'Sec-Fetch-Site': 'same-site' }],
  ])('NFR-01, FR-21, FR-22: a post with %s can neither clear the board nor start Find Now', async (_case, headers) => {
    for (const path of ['/board/clear', '/board/find']) {
      const response = await testApp.raw({
        method: 'POST',
        path,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: 'origin=linkedin',
      });
      expect(response.status, path).toBe(403);
    }

    expect(await newJobs()).toBe(18);
    expect(testApp.logs.filter((line) => line.includes('find now started'))).toEqual([]);
    expect((await testApp.get('/')).text).not.toContain('id="find-now"');
  });

  it('NFR-01: Find Now and Clear All take only a POST; a link (GET) does nothing', async () => {
    for (const path of ['/board/clear?origin=linkedin', '/board/find?origin=linkedin']) {
      expect((await testApp.get(path)).status, path).toBe(405);
    }
    expect(await newJobs()).toBe(18);
  });
});
