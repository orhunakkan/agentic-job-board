import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupStatus } from '../../src/domain/setup.ts';
import { setupPage } from '../../src/ui/pages/setup.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// Setup reads data/linkedin-searches.json and data/sources.json (FR-24, DEC-066). What the user wants is personal
// (NFR-08), so only each file's status ever leaves the app: never its contents, valid or not, on any reply or page.

const SECRET = 'private-search-term-5c1d';
const HOSTILE = '<script>alert(13)</script>';

describe('setup security', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await startTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  async function everything(): Promise<string> {
    const replies = await Promise.all(['/api/setup', '/setup', '/', '/?origin=other'].map((path) => testApp.get(path)));
    return replies.map((reply) => reply.text).join('\n');
  }

  it('NFR-08, FR-24: valid files never show their contents, only that they are ready', async () => {
    writeFileSync(testApp.linkedinSearchesPath, JSON.stringify({ searches: [{ name: SECRET, keywords: SECRET }] }));
    writeFileSync(testApp.sourcesPath, JSON.stringify({ keywords: [SECRET], companies: { greenhouse: [SECRET] } }));

    expect((await testApp.get('/api/setup')).body).toMatchObject({ linkedinSearches: 'ready', sources: 'ready' });
    expect(await everything()).not.toContain(SECRET);
  });

  it('NFR-08, FR-24: broken files, and the parser errors they cause, never show their contents', async () => {
    writeFileSync(testApp.linkedinSearchesPath, `{ "searches": [{ "name": "${SECRET}", "keywords": 7 }] }`);
    writeFileSync(testApp.sourcesPath, `${SECRET} ${HOSTILE} not json`);

    expect((await testApp.get('/api/setup')).body).toMatchObject({ linkedinSearches: 'invalid', sources: 'invalid' });
    const text = await everything();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('alert(13)');
  });

  it('NFR-07, FR-24: the file paths the setup page shows are escaped', () => {
    const page = setupPage({
      status: setupStatus({ profile: 'missing', linkedinSearches: 'missing', sources: 'invalid' }),
      linkedinSearchesPath: `data/${HOSTILE}.json`,
      sourcesPath: 'data/"><img src=x onerror=alert(14)>.json',
    }).toString();

    expect(page).not.toMatch(/<script|<img/);
    expect(page).toContain('data/&lt;script&gt;alert(13)&lt;/script&gt;.json');
  });
});
