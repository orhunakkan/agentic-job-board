import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Profile } from '../../src/schemas/profile.ts';
import { SAMPLE_PROFILE } from '../helpers/profiles.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

const PROFILE: Profile = SAMPLE_PROFILE;

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('GET /api/health', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await startTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('NFR-01: reports ok for the server and the database, with the app version', async () => {
    const response = await testApp.get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', db: 'ok', version: packageJson.version });
  });

  it('NFR-01: reports 503 when the database is gone', async () => {
    testApp.app.db.close();

    const response = await testApp.get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: { code: 'db_unavailable', message: 'The database is not available' } });
  });
});

describe('/api/profile', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await startTestApp({ setup: 'none' });
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('FR-01: is 404 until a profile is loaded', async () => {
    const response = await testApp.get('/api/profile');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: 'not_found', message: expect.stringContaining('PUT') as unknown },
    });
  });

  it('FR-01: a profile saved in the old shape is 404 and asks to fill it in again', async () => {
    testApp.app.db
      .prepare('INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)')
      .run(JSON.stringify({ targetRoles: ['Dispatcher'], locations: { remoteUS: true } }), 'x');

    const response = await testApp.get('/api/profile');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: 'not_found', message: expect.stringContaining('older version') as unknown },
    });
  });

  it('FR-01: PUT stores the profile and GET returns it', async () => {
    const put = await testApp.call('PUT', '/api/profile', PROFILE);
    const get = await testApp.get('/api/profile');

    expect(put.status).toBe(200);
    expect(put.body).toEqual(PROFILE);
    expect(get.status).toBe(200);
    expect(get.body).toEqual(PROFILE);
  });

  it('FR-01: PUT replaces the whole profile', async () => {
    await testApp.call('PUT', '/api/profile', PROFILE);
    await testApp.call('PUT', '/api/profile', { ...PROFILE, yearsExperience: 10, dealBreakers: [] });

    expect((await testApp.get('/api/profile')).body).toEqual({ ...PROFILE, yearsExperience: 10, dealBreakers: [] });
  });

  it('NFR-09: an invalid profile is a 400 that names every bad field, and nothing is stored', async () => {
    const response = await testApp.call('PUT', '/api/profile', { ...PROFILE, seniority: 'principal', coreSkills: [] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: 'validation_failed',
        message: 'The profile is invalid',
        details: expect.arrayContaining([
          expect.objectContaining({ path: 'seniority' }),
          expect.objectContaining({ path: 'coreSkills' }),
        ]) as unknown,
      },
    });
    expect((await testApp.get('/api/profile')).status).toBe(404);
  });

  it('NFR-09: a profile with an unknown field is rejected', async () => {
    const response = await testApp.call('PUT', '/api/profile', { ...PROFILE, remote: true });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { details: [{ path: '', message: expect.stringContaining('remote') as unknown }] },
    });
  });
});
