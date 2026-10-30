import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { RunFinishedError, RunNotFoundError } from '../ingest/run-errors.ts';
import { InvalidTransitionError, JobNotFoundError } from '../jobs/status-service.ts';
import type { Logger } from '../logger.ts';
import { parseCookies } from './cookies.ts';
import { errorBody, HttpError, queryObject, type Reply } from './respond.ts';
import { createRouter, type RouteMatch, type Route } from './router.ts';
import {
  isAllowedHost,
  isCrossSite,
  isFormContentType,
  isJsonContentType,
  isStateChanging,
  SECURITY_HEADERS,
} from './security.ts';

// The request pipeline (PLAN.md Phases 4 and 6), in order:
//   Host check (421) → cross-site check on writes (403) → route (404/405) → content type on writes: JSON for
//   the API, a form post for pages (415) → body ≤ 1 MB (413) → valid JSON or form (400) → handler → reply
//   with security headers.
// Errors under /api/ are JSON (§6.1); everywhere else they are an HTML page, so the browser shows a real page.
// Every request gets an ID (X-Request-Id) and one log line.

export const BODY_LIMIT_BYTES = 1024 * 1024;
// Past the limit the body is read and thrown away so the client still gets its 413; past this, the socket is cut.
const DISCARD_LIMIT_BYTES = 16 * BODY_LIMIT_BYTES;

/** What an error page may know of the request: where it was going and its cookies (the theme, FR-23). */
export interface ErrorRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  cookies: Readonly<Record<string, string>>;
}

/** Renders an error as a complete HTML page for paths outside /api/. */
export type ErrorPage = (status: number, message: string, request: ErrorRequest) => string;

type Match = (method: string, path: string) => RouteMatch;

interface Failure {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  headers?: Readonly<Record<string, string>>;
}

export function createAppServer(
  routes: readonly Route[],
  logger: Logger,
  errorPage: ErrorPage = plainErrorPage,
): Server {
  const match = createRouter(routes);
  return createServer((request, response) => {
    void handle(request, response, match, logger, errorPage);
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  match: Match,
  logger: Logger,
  errorPage: ErrorPage,
): Promise<void> {
  const started = performance.now();
  const requestId = randomUUID();
  const method = request.method ?? '';
  const cookies = parseCookies(request.headers.cookie);
  let path = '';
  let query = new URLSearchParams();

  let reply: Reply;
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    path = url.pathname;
    query = url.searchParams;
    reply = await dispatch(request, method, url, match, cookies);
  } catch (error) {
    const failure = toFailure(error, logger, requestId);
    const page = () => errorPage(failure.status, failure.message, { method, path: path || '/', query, cookies });
    reply = isApiPath(path)
      ? { status: failure.status, body: errorBody(failure.code, failure.message, failure.details) }
      : { status: failure.status, text: page(), contentType: HTML };
    if (failure.headers !== undefined) reply.headers = failure.headers;
  }

  send(response, reply, requestId);
  logger.info('request', {
    requestId,
    method,
    path,
    status: reply.status,
    ms: Math.round(performance.now() - started),
  });
}

const HTML = 'text/html; charset=utf-8';

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

async function dispatch(
  request: IncomingMessage,
  method: string,
  url: URL,
  match: Match,
  cookies: Readonly<Record<string, string>>,
): Promise<Reply> {
  const port = request.socket.localPort ?? 0;
  if (!isAllowedHost(request.headers.host, port)) {
    throw new HttpError(421, 'misdirected_request', 'This server only answers to 127.0.0.1 or localhost on its port');
  }
  if (isStateChanging(method) && isCrossSite(request.headers, port)) {
    throw new HttpError(403, 'cross_site_request', 'Requests from other sites are not allowed');
  }

  const found = match(method, url.pathname);
  if (found.kind === 'not_found') throw new HttpError(404, 'not_found', 'There is nothing at this path');
  if (found.kind === 'method_not_allowed') throw new MethodNotAllowed(found.allowed);

  let body: unknown;
  if (isStateChanging(method)) {
    if ((found.route.accepts ?? 'json') === 'json') {
      if (!isJsonContentType(request.headers['content-type'])) {
        throw new HttpError(415, 'unsupported_media_type', 'Send the body as JSON with Content-Type: application/json');
      }
      body = parseJson(await readBody(request));
    } else {
      if (!isFormContentType(request.headers['content-type'])) {
        throw new HttpError(415, 'unsupported_media_type', 'Send the form as application/x-www-form-urlencoded');
      }
      body = queryObject(new URLSearchParams((await readBody(request)).toString('utf8')), 'form');
    }
  }

  return found.route.handler({
    method: found.route.method,
    path: url.pathname,
    params: found.params,
    query: url.searchParams,
    body,
    cookies,
  });
}

class MethodNotAllowed extends Error {
  override name = 'MethodNotAllowed';
  readonly allowed: readonly string[];

  constructor(allowed: readonly string[]) {
    super(`Use ${allowed.join(' or ')} for this path`);
    this.allowed = allowed;
  }
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  const tooLarge = () => new HttpError(413, 'payload_too_large', 'The request body must be at most 1 MB');
  if (Number(request.headers['content-length'] ?? 0) > DISCARD_LIMIT_BYTES) {
    request.destroy();
    return Promise.reject(tooLarge());
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_LIMIT_BYTES) chunks.push(chunk);
      else if (size > DISCARD_LIMIT_BYTES) request.destroy();
    });
    request.on('end', () => {
      if (size > BODY_LIMIT_BYTES) reject(tooLarge());
      else resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON');
  }
}

function toFailure(error: unknown, logger: Logger, requestId: string): Failure {
  if (error instanceof HttpError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof MethodNotAllowed) {
    return {
      status: 405,
      code: 'method_not_allowed',
      message: error.message,
      headers: { Allow: error.allowed.join(', ') },
    };
  }
  if (error instanceof JobNotFoundError || error instanceof RunNotFoundError) {
    return { status: 404, code: 'not_found', message: error.message };
  }
  if (error instanceof InvalidTransitionError) {
    return {
      status: 409,
      code: 'invalid_transition',
      message: error.message,
      details: { from: error.from, to: error.to },
    };
  }
  if (error instanceof RunFinishedError) {
    return { status: 409, code: 'run_finished', message: error.message };
  }

  logger.error('unhandled error', { requestId, error });
  return { status: 500, code: 'internal_error', message: `Something went wrong; see the server log (${requestId})` };
}

// Used when the app is started without a page renderer (only tests do that).
function plainErrorPage(status: number, message: string): string {
  const escaped = message.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);
  return `<!doctype html><title>Error ${String(status)}</title><p>${escaped}</p>`;
}

function send(response: ServerResponse, reply: Reply, requestId: string): void {
  if (response.headersSent || response.destroyed) return;

  const [payload, contentType] =
    'text' in reply ? [reply.text, reply.contentType] : [JSON.stringify(reply.body), 'application/json; charset=utf-8'];
  response.writeHead(reply.status, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
    ...reply.headers,
  });
  response.end(payload);
}
