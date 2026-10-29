// Hash routes that can be shared and work with Back: #/overview, #/types, #/requirements, #/failures, #/timeline,
// #/environment and #/test/<id>. A list's filters live in the query (#/types?status=failed&q=save).

export type ViewName = 'overview' | 'types' | 'requirements' | 'failures' | 'timeline' | 'environment' | 'test';

export interface Route {
  view: ViewName;
  /** The test's ID on #/test/<id>. */
  id: string | null;
  params: URLSearchParams;
}

const LIST_VIEWS: readonly ViewName[] = ['overview', 'types', 'requirements', 'failures', 'timeline', 'environment'];

function isListView(name: string): name is ViewName {
  return (LIST_VIEWS as readonly string[]).includes(name);
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const queryAt = raw.indexOf('?');
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : raw.slice(queryAt + 1));
  const [first = '', second = ''] = path.split('/');
  if (first === 'test') return { view: 'test', id: decodeURIComponent(second), params };
  return { view: isListView(first) ? first : 'overview', id: null, params };
}

export function href(view: ViewName, params?: URLSearchParams | Readonly<Record<string, string>>): string {
  const query = params === undefined ? '' : new URLSearchParams(params).toString();
  return `#/${view}${query === '' ? '' : `?${query}`}`;
}

export function testHref(id: string): string {
  return `#/test/${encodeURIComponent(id)}`;
}

/** Changes the current link's query without a new history entry, so typing in a filter doesn't fill Back. */
export function replaceQuery(view: ViewName, params: URLSearchParams): void {
  window.history.replaceState(null, '', href(view, params));
}
