import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, type RunningApp } from '../../src/app.ts';
import { createRepositories } from '../../src/db/repositories/index.ts';
import { createLogger } from '../../src/logger.ts';
import { fakeClaudeCommand } from './fake-claude.ts';
import { fakeClock } from './fixtures.ts';
import { SAMPLE_PROFILE } from './profiles.ts';

// The real app on 127.0.0.1 with a free port, its own temporary database and its own LinkedIn session path
// (PLAN.md §8.2, DEC-032), so tests never read the owner's data/. Find Now runs tests/helpers/fake-claude.ts, never
// Claude Code (FR-22).
// By default the app starts set up (FR-24): the sample profile is saved and both the LinkedIn searches and the feeds
// files are there, since most tests are about something else. `setup: 'none'` starts it empty, as on a first run.
// `call` uses the built-in fetch (API tests); `raw` uses node:http so tests can set any header,
// including Host, which fetch does not allow.

export interface ApiResponse {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

export interface TestApp {
  app: RunningApp;
  url: string;
  port: number;
  logs: string[];
  /** Where this app looks for the saved LinkedIn login; tests write a fake one here. */
  linkedinSessionPath: string;
  /** Where this app looks for the LinkedIn searches and the feeds (FR-24); tests may write their own here. */
  linkedinSearchesPath: string;
  sourcesPath: string;
  dbPath: string;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse>;
  get(path: string): Promise<ApiResponse>;
  post(path: string, body?: unknown): Promise<ApiResponse>;
  /** Posts an HTML form as a browser on this site would; redirects are returned, not followed. */
  form(path: string, fields: Record<string, string>, headers?: Record<string, string>): Promise<ApiResponse>;
  raw(options: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<RawResponse>;
  close(): Promise<void>;
}

/** One made-up LinkedIn search, valid for setup (FR-24). */
export const TEST_LINKEDIN_SEARCHES = { searches: [{ name: 'Dispatch jobs', keywords: 'dispatcher' }] };

/** A valid feeds file with one company board on and every other feed off, so setup counts it as ready (FR-24). */
export const TEST_SOURCES = {
  keywords: ['dispatcher'],
  companies: { greenhouse: ['examplefreight'] },
  feeds: { remoteok: false, himalayas: false, jobicy: false, hackernews: false, adzuna: false },
};

export interface TestAppOptions {
  claudeCommand?: readonly string[];
  /** 'ready' (default): profile and both files there; 'none': an empty board, as on a first run. */
  setup?: 'ready' | 'none';
}

export async function startTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'jobboard-api-'));
  const logs: string[] = [];
  const linkedinSessionPath = join(dir, 'linkedin', 'session.json');
  const linkedinSearchesPath = join(dir, 'linkedin-searches.json');
  const sourcesPath = join(dir, 'sources.json');
  const dbPath = join(dir, 'test.db');
  const app = await startApp({
    port: 0,
    dbPath,
    linkedinSessionPath,
    linkedinSearchesPath,
    sourcesPath,
    claudeCommand: options.claudeCommand ?? fakeClaudeCommand(),
    logger: createLogger('debug', (line) => logs.push(line)),
    now: fakeClock('2026-10-23T12:00:00.000Z'),
  });
  if ((options.setup ?? 'ready') === 'ready') {
    createRepositories(app.db).profile.put(SAMPLE_PROFILE, '2026-10-23T11:00:00.000Z');
    writeFileSync(linkedinSearchesPath, JSON.stringify(TEST_LINKEDIN_SEARCHES));
    writeFileSync(sourcesPath, JSON.stringify(TEST_SOURCES));
  }

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json', ...headers };
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(`${app.url}${path}`, init);
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      // HTML pages and redirects have no JSON body; their markup is in `text`.
      body: response.headers.get('content-type')?.startsWith('application/json')
        ? (JSON.parse(text) as unknown)
        : undefined,
    };
  }

  function raw(options: { method?: string; path: string; headers?: Record<string, string>; body?: string }) {
    return new Promise<RawResponse>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: app.port,
          method: options.method ?? 'GET',
          path: options.path,
          headers: { Host: `127.0.0.1:${String(app.port)}`, ...options.headers },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              text: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      request.on('error', reject);
      request.end(options.body);
    });
  }

  return {
    app,
    url: app.url,
    port: app.port,
    logs,
    linkedinSessionPath,
    linkedinSearchesPath,
    sourcesPath,
    dbPath,
    call,
    get: (path) => call('GET', path),
    post: (path, body = {}) => call('POST', path, body),
    async form(path, fields, headers = {}) {
      const response = await fetch(`${app.url}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: app.url,
          'Sec-Fetch-Site': 'same-origin',
          ...headers,
        },
        body: new URLSearchParams(fields).toString(),
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, text, body: undefined };
    },
    raw,
    async close() {
      await app.close(0);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
