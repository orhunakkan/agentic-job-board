import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startApp } from '../../src/app.ts';
import { BODY_LIMIT_BYTES } from '../../src/http/server.ts';
import { createLogger } from '../../src/logger.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

describe('the HTTP pipeline', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await startTestApp();
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('NFR-09: an unknown path is 404 with the standard error body', async () => {
    const response = await testApp.get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'not_found', message: 'There is nothing at this path' } });
  });

  it.each(['/api/health/', '/API/health', '/api//health'])('NFR-09: paths match exactly: %s is 404', async (path) => {
    expect((await testApp.get(path)).status).toBe(404);
  });

  it('NFR-09: a known path with the wrong method is 405 and lists the allowed ones', async () => {
    const response = await testApp.call('DELETE', '/api/profile');

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, PUT');
    expect(response.body).toEqual({ error: { code: 'method_not_allowed', message: 'Use GET or PUT for this path' } });
  });

  it('NFR-09: a write without Content-Type: application/json is 415', async () => {
    const response = await testApp.raw({
      method: 'POST',
      path: '/api/runs',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });

    expect(response.status).toBe(415);
    expect(JSON.parse(response.text)).toMatchObject({ error: { code: 'unsupported_media_type' } });
  });

  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON'])(
    'NFR-09: Content-Type "%s" is accepted',
    async (contentType) => {
      const response = await testApp.raw({
        method: 'POST',
        path: '/api/runs',
        headers: { 'Content-Type': contentType },
        body: '{}',
      });

      expect(response.status).toBe(201);
    },
  );

  it('NFR-09: a body over 1 MB is 413', async () => {
    const response = await testApp.call('PUT', '/api/profile', `"${'x'.repeat(BODY_LIMIT_BYTES)}"`);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: { code: 'payload_too_large', message: 'The request body must be at most 1 MB' },
    });
    expect((await testApp.get('/api/health')).status).toBe(200);
  });

  it('NFR-09: a body of exactly 1 MB is read', async () => {
    const body = `"${'x'.repeat(BODY_LIMIT_BYTES - 2)}"`;

    const response = await testApp.call('PUT', '/api/profile', body);

    expect(response.status).toBe(400); // valid JSON, just not a profile
    expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it.each(['{"emails": [', '', 'undefined', "{'single': 'quotes'}"])(
    'NFR-09: malformed JSON %j is a 400',
    async (body) => {
      const response = await testApp.raw({
        method: 'POST',
        path: '/api/runs',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.text)).toEqual({
        error: { code: 'invalid_json', message: 'The request body is not valid JSON' },
      });
    },
  );

  it('NFR-09: an unexpected failure is a 500 that hides the details and logs them', async () => {
    testApp.app.db.close();

    const response = await testApp.get('/api/jobs');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'internal_error',
        message: `Something went wrong; see the server log (${String(response.headers.get('x-request-id'))})`,
      },
    });
    expect(response.text).not.toMatch(/stack|sqlite|database/i);
    const logged = testApp.logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry['level'] === 'error');
    expect(logged).toMatchObject({ msg: 'unhandled error', requestId: response.headers.get('x-request-id') });
    expect(JSON.stringify(logged)).toContain('stack');
  });

  it('NFR-09: every response carries a unique request ID', async () => {
    const first = await testApp.get('/api/health');
    const second = await testApp.get('/api/nope');

    const ids = [first.headers.get('x-request-id'), second.headers.get('x-request-id')];
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id ?? ''))).toBe(true);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('NFR-09: every request is logged as one JSON line, without the query string', async () => {
    testApp.logs.length = 0;

    const response = await testApp.get('/api/jobs?q=secret-search');

    expect(testApp.logs).toHaveLength(1);
    expect(JSON.parse(testApp.logs[0] ?? '')).toEqual({
      time: expect.any(String) as unknown,
      level: 'info',
      msg: 'request',
      requestId: response.headers.get('x-request-id'),
      method: 'GET',
      path: '/api/jobs',
      status: 200,
      ms: expect.any(Number) as unknown,
    });
  });

  it('NFR-09: responses are JSON and never cached', async () => {
    const response = await testApp.get('/api/health');

    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('NFR-01: close() stops the server and closes the database, and can be called twice', async () => {
    await testApp.app.close(0);
    await testApp.app.close(0);

    expect(testApp.app.db.isOpen).toBe(false);
    await expect(fetch(`${testApp.url}/api/health`)).rejects.toThrow();
  });
});

describe('startApp', () => {
  it('NFR-01: when the port is taken, start-up fails and the database is closed again', async () => {
    const blocker = await startTestApp();
    const dir = mkdtempSync(join(tmpdir(), 'jobboard-start-'));
    try {
      const start = startApp({
        port: blocker.port,
        dbPath: join(dir, 'x.db'),
        linkedinSessionPath: join(dir, 'session.json'),
        linkedinSearchesPath: join(dir, 'linkedin-searches.json'),
        sourcesPath: join(dir, 'sources.json'),
        claudeCommand: ['claude-is-never-started-here'],
        logger: createLogger('error', () => undefined),
      });

      await expect(start).rejects.toThrow(/EADDRINUSE/);
      expect(() => {
        rmSync(dir, { recursive: true });
      }).not.toThrow(); // on Windows this fails while the database file is still open
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await blocker.close();
    }
  });
});
