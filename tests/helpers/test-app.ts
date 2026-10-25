import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, type RunningApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { fakeClaudeCommand } from './fake-claude.ts';
import { fakeClock } from './fixtures.ts';

// The real app on 127.0.0.1 with a free port, its own temporary database and its own LinkedIn session path
// (PLAN.md §8.2, DEC-032), so tests never read the owner's data/. Find Now runs tests/helpers/fake-claude.ts, never
// Claude Code (FR-22).
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

export async function startTestApp(options: { claudeCommand?: readonly string[] } = {}): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'jobboard-api-'));
  const logs: string[] = [];
  const linkedinSessionPath = join(dir, 'linkedin', 'session.json');
  const dbPath = join(dir, 'test.db');
  const app = await startApp({
    port: 0,
    dbPath,
    linkedinSessionPath,
    claudeCommand: options.claudeCommand ?? fakeClaudeCommand(),
    logger: createLogger('debug', (line) => logs.push(line)),
    now: fakeClock('2026-10-23T12:00:00.000Z'),
  });

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
