import type { Reply } from './respond.ts';

// Method + path routing with ":name" parameters (PLAN.md Phase 4). Paths match exactly, segment by segment.

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

export interface ApiRequest {
  method: Method;
  path: string;
  params: Readonly<Record<string, string>>;
  query: URLSearchParams;
  body: unknown; // POST/PUT/PATCH: parsed JSON, or the form fields as a string record; undefined for GET
  // The Cookie header, parsed (FR-23: the pages read the theme from it). The server always sets it; a request built
  // by hand may leave it out, which reads as no cookies.
  cookies?: Readonly<Record<string, string>>;
}

export type Handler = (request: ApiRequest) => Reply;

/** What a write route reads: a JSON body (the API) or an HTML form post (the pages). */
export type BodyKind = 'json' | 'form';

export interface Route {
  method: Method;
  path: string;
  handler: Handler;
  accepts?: BodyKind; // writes only; default 'json'
}

export type RouteMatch =
  | { kind: 'found'; route: Route; params: Record<string, string> }
  | { kind: 'not_found' }
  | { kind: 'method_not_allowed'; allowed: Method[] };

interface CompiledRoute {
  route: Route;
  segments: readonly string[];
}

export function createRouter(routes: readonly Route[]): (method: string, path: string) => RouteMatch {
  const compiled: CompiledRoute[] = routes.map((route) => ({ route, segments: route.path.split('/') }));

  return (method, path) => {
    const segments = path.split('/');
    const allowed: Method[] = [];
    for (const { route, segments: pattern } of compiled) {
      const params = matchSegments(pattern, segments);
      if (params === null) continue;
      if (route.method === method) return { kind: 'found', route, params };
      allowed.push(route.method);
    }
    return allowed.length > 0 ? { kind: 'method_not_allowed', allowed } : { kind: 'not_found' };
  };
}

function matchSegments(pattern: readonly string[], segments: readonly string[]): Record<string, string> | null {
  if (pattern.length !== segments.length) return null;

  const params: Record<string, string> = {};
  for (const [index, expected] of pattern.entries()) {
    const actual = segments[index] ?? '';
    if (expected.startsWith(':')) {
      const value = decodeSegment(actual);
      if (value === null || value === '') return null;
      params[expected.slice(1)] = value;
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null; // malformed percent-encoding: no route matches
  }
}
