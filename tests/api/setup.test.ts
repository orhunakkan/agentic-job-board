import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SetupResponseSchema } from '../../src/schemas/api.ts';
import { SAMPLE_PROFILE } from '../helpers/profiles.ts';
import { startTestApp, TEST_LINKEDIN_SEARCHES, TEST_SOURCES, type TestApp } from '../helpers/test-app.ts';

// Setup comes first (FR-24, DEC-066) over real HTTP: GET /api/setup, the 409 on POST /api/runs, the board sending the
// owner to /setup until a profile is saved, and each view's Find Now waiting for its own source.

// A word that is only in the files, so a test can check their contents never reach a reply.
const SECRET = 'only-in-the-file-7f3a';

describe('setup', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await startTestApp({ setup: 'none' });
  });
  afterEach(async () => {
    await testApp.close();
  });

  const setup = async () => SetupResponseSchema.parse((await testApp.get('/api/setup')).body);
  const saveProfile = () => testApp.call('PUT', '/api/profile', SAMPLE_PROFILE);
  const writeSearches = (value: unknown) => {
    writeFileSync(testApp.linkedinSearchesPath, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const writeSources = (value: unknown) => {
    writeFileSync(testApp.sourcesPath, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const saveOldProfile = () => {
    testApp.app.db
      .prepare('INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)')
      .run(JSON.stringify({ targetRoles: ['Dispatcher'], locations: { remoteUS: true } }), 'x');
  };

  describe('GET /api/setup', () => {
    it('FR-24: on a first run nothing is there and the board is not ready', async () => {
      const response = await testApp.get('/api/setup');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        profile: 'missing',
        linkedinSearches: 'missing',
        sources: 'missing',
        ready: false,
      });
    });

    it('FR-24: a saved profile alone is not enough', async () => {
      await saveProfile();

      expect(await setup()).toEqual({
        profile: 'saved',
        linkedinSearches: 'missing',
        sources: 'missing',
        ready: false,
      });
    });

    it('FR-24: a profile and the LinkedIn searches are ready', async () => {
      await saveProfile();
      writeSearches(TEST_LINKEDIN_SEARCHES);

      expect(await setup()).toEqual({ profile: 'saved', linkedinSearches: 'ready', sources: 'missing', ready: true });
    });

    it('FR-24: a profile and the feeds are ready', async () => {
      await saveProfile();
      writeSources(TEST_SOURCES);

      expect(await setup()).toEqual({ profile: 'saved', linkedinSearches: 'missing', sources: 'ready', ready: true });
    });

    it('FR-24: both files without a profile are not ready', async () => {
      writeSearches(TEST_LINKEDIN_SEARCHES);
      writeSources(TEST_SOURCES);

      expect(await setup()).toEqual({ profile: 'missing', linkedinSearches: 'ready', sources: 'ready', ready: false });
    });

    it('FR-24: a profile in the old shape is outdated, which is not ready', async () => {
      saveOldProfile();
      writeSources(TEST_SOURCES);

      expect(await setup()).toEqual({
        profile: 'outdated',
        linkedinSearches: 'missing',
        sources: 'ready',
        ready: false,
      });
    });

    it('FR-24: broken files are invalid, and their contents never appear in the reply', async () => {
      await saveProfile();
      writeSearches(`{ "searches": [{ "name": "${SECRET}" }] }`);
      writeSources(`{ "keywords": ["${SECRET}"], "feeds": { "${SECRET}": true } }`);

      const response = await testApp.get('/api/setup');

      expect(response.body).toEqual({
        profile: 'saved',
        linkedinSearches: 'invalid',
        sources: 'invalid',
        ready: false,
      });
      expect(response.text).not.toContain(SECRET);
    });

    it('FR-24: a file created while the app runs counts at once', async () => {
      await saveProfile();
      expect((await setup()).ready).toBe(false);

      writeSources(TEST_SOURCES);

      expect((await setup()).ready).toBe(true);
    });
  });

  describe('POST /api/runs', () => {
    it('FR-24: is refused with 409 setup_required, naming what is missing, until the board is set up', async () => {
      const response = await testApp.post('/api/runs');

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          code: 'setup_required',
          message: expect.stringContaining('/setup') as unknown,
          details: { profile: 'missing', linkedinSearches: 'missing', sources: 'missing' },
        },
      });
      expect(testApp.app.db.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({ n: 0 });
    });

    it('FR-24, FR-11: starts a run once the profile and one source are there', async () => {
      await saveProfile();
      expect((await testApp.post('/api/runs')).body).toMatchObject({
        error: { details: { profile: 'saved', linkedinSearches: 'missing', sources: 'missing' } },
      });

      writeSearches(TEST_LINKEDIN_SEARCHES);
      const response = await testApp.post('/api/runs');

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ runId: 1 });
    });
  });

  describe('the board', () => {
    it('FR-24: sends the owner to /setup while there is no profile, on both views', async () => {
      for (const path of ['/', '/?origin=other', '/?tab=saved&q=nurse']) {
        const response = await testApp.raw({ path });

        expect(response.status, path).toBe(303);
        expect(response.headers.location, path).toBe('/setup');
      }
    });

    it('FR-24: sends the owner to /setup while the profile is outdated', async () => {
      saveOldProfile();

      expect((await testApp.raw({ path: '/' })).headers.location).toBe('/setup');
    });

    it('FR-24: Runs, Profile, job pages and error pages still open without a profile', async () => {
      for (const [path, status] of [
        ['/runs', 200],
        ['/profile', 200],
        ['/setup', 200],
        ['/jobs/1', 404],
        ['/nope', 404],
      ] as const) {
        expect((await testApp.get(path)).status, path).toBe(status);
      }
    });

    it('FR-24: with a profile but no source ready, the board opens with a notice that links to Setup', async () => {
      await saveProfile();

      const response = await testApp.get('/');

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/<p class="notice setup-notice"[^>]*>[\s\S]*<a href="\/setup">Setup<\/a>/);
    });

    it('FR-24: once a source is ready the notice is gone', async () => {
      await saveProfile();
      writeSources(TEST_SOURCES);

      expect((await testApp.get('/')).text).not.toContain('setup-notice');
    });
  });

  describe('the setup page', () => {
    it('FR-24: lists the profile, the LinkedIn searches and the feeds, each with its status', async () => {
      const page = (await testApp.get('/setup')).text;

      expect(page).toContain('<h1>Setup</h1>');
      expect(page).toMatch(/Your profile[\s\S]*Not filled in[\s\S]*<a class="button" href="\/profile\/edit">/);
      expect(page).toMatch(/LinkedIn searches[\s\S]*Not there[\s\S]*linkedin-searches\.example\.json/);
      expect(page).toContain('node scripts/linkedin-login.ts');
      expect(page).toMatch(/Free job feeds[\s\S]*Not there[\s\S]*sources\.example\.json/);
      expect(page).toContain(testApp.linkedinSearchesPath.replaceAll('\\', '\\'));
    });

    it('FR-24: shows saved, ready and broken files as such, without their contents', async () => {
      await saveProfile();
      writeSearches(TEST_LINKEDIN_SEARCHES);
      writeSources(`{ "keywords": ["${SECRET}"], "feeds": { "x": true } }`);

      const page = (await testApp.get('/setup')).text;

      expect(page).toMatch(/Your profile[\s\S]*Saved/);
      expect(page).toMatch(/LinkedIn searches[\s\S]*Ready/);
      expect(page).toMatch(/Free job feeds[\s\S]*Has a problem/);
      expect(page).not.toContain(SECRET);
    });

    it('FR-24: asks to fill in an outdated profile again', async () => {
      saveOldProfile();

      expect((await testApp.get('/setup')).text).toMatch(/Your profile[\s\S]*Needs filling in again/);
    });
  });

  describe('Find Now', () => {
    it('FR-24, FR-22: each view’s Find Now is disabled, with its reason, until that view’s source is ready', async () => {
      await saveProfile();
      writeSources(TEST_SOURCES);

      const linkedin = (await testApp.get('/')).text;
      const other = (await testApp.get('/?origin=other')).text;

      expect(linkedin).toMatch(/<button type="submit" class="button" disabled aria-describedby="find-now-reason">/);
      expect(linkedin).toMatch(
        /<p class="find-now-reason" id="find-now-reason" tabindex="-1">[\s\S]*LinkedIn searches/,
      );
      expect(other).toMatch(/<button type="submit" class="button" >Find Now<\/button>/);
      expect(other).not.toContain('find-now-reason');
    });

    it('FR-24, FR-22: pressing Find Now on a view that is not ready starts nothing', async () => {
      await saveProfile();
      writeSources(TEST_SOURCES);

      const response = await testApp.form('/board/find', { origin: 'linkedin' });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/?tab=new#find-now-reason');
      expect((await testApp.get('/')).text).not.toContain('id="find-now"');
    });
  });
});
