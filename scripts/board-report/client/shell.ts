// The page around the views: a skip link, the gradient header with the run's result and the theme toggle, the
// sidebar that moves between views (a top bar on a phone), and the main region the views draw into.
import type { TestEntry } from '../build/data-shape.ts';
import { statusIcon, STATUS_WORD } from './badges.ts';
import { el, svg } from './dom.ts';
import { formatCount, formatDateTime, formatDuration, shortCommit } from './format.ts';
import { href, testHref, type ViewName } from './route.ts';
import { report, totalOf } from './state.ts';
import { themeToggle } from './theme.ts';

export interface Shell {
  main: HTMLElement;
  setActive: (view: ViewName) => void;
}

const NAV: readonly { view: ViewName; label: string; icon: string }[] = [
  { view: 'overview', label: 'Overview', icon: 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z' },
  { view: 'types', label: 'By test type', icon: 'M3 3.5h10M5.5 8h7.5M8 12.5h5M3 3.5v9h2' },
  { view: 'requirements', label: 'By requirement', icon: 'M4 2.5h6l2.5 2.5v8.5H4zM6 7.5h4.5M6 10.5h4.5' },
  { view: 'failures', label: 'Failures', icon: 'M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.3' },
  { view: 'timeline', label: 'Timeline', icon: 'M2.5 4h6M5 8h8.5M3.5 12h5' },
  { view: 'environment', label: 'Environment', icon: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 7v4M8 5v.2' },
];

function navIcon(path: string): SVGSVGElement {
  return svg(
    'svg',
    { class: 'nav-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: path }),
  );
}

function logo(): SVGSVGElement {
  return svg(
    'svg',
    { class: 'logo', viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { class: 'logo-a', x: 4, y: 16, width: 6, height: 12, rx: 2 }),
    svg('rect', { class: 'logo-b', x: 13, y: 9, width: 6, height: 19, rx: 2 }),
    svg('rect', { class: 'logo-c', x: 22, y: 4, width: 6, height: 24, rx: 2 }),
  );
}

/** The run as a whole: passed when no test failed or broke, failed otherwise; null without tests. */
function runResult(tests: readonly TestEntry[]): { status: 'passed' | 'failed' | null; text: string } {
  if (tests.length === 0) return { status: null, text: 'No results' };
  const bad = tests.filter((test) => test.status === 'failed' || test.status === 'broken').length;
  if (bad === 0) return { status: 'passed', text: `${formatCount(tests.length)} tests, all green` };
  return { status: 'failed', text: `${formatCount(bad)} failed of ${formatCount(tests.length)}` };
}

function header(): HTMLElement {
  const data = report().data;
  const result = runResult(data.tests);
  const meta = el('ul', { class: 'header-meta', 'aria-label': 'This run' });
  meta.appendChild(el('li', { text: `Built ${formatDateTime(data.builtAt)}` }));
  if (data.branch !== null) meta.appendChild(el('li', { text: data.branch }));
  meta.appendChild(el('li', { class: 'mono', text: shortCommit(data.commit) }));
  meta.appendChild(el('li', { text: `Ran for ${formatDuration(data.duration)}` }));
  const pill =
    result.status === null
      ? el('span', { class: 'run-pill status-none', text: result.text })
      : el(
          'span',
          { class: `run-pill status-${result.status}` },
          statusIcon(result.status),
          STATUS_WORD[result.status],
        );
  return el(
    'header',
    { class: 'site-header' },
    el(
      'div',
      { class: 'header-inner' },
      el(
        'div',
        { class: 'brand' },
        logo(),
        el(
          'div',
          { class: 'brand-text' },
          el('p', { class: 'brand-name', text: 'board-report' }),
          el('p', { class: 'run-result' }, pill, el('span', { class: 'run-text', text: result.text })),
        ),
      ),
      el('div', { class: 'header-side' }, meta, themeToggle()),
    ),
  );
}

function navCount(view: ViewName): string | null {
  const data = report();
  switch (view) {
    case 'types':
      return formatCount(totalOf(data.data.totals));
    case 'requirements':
      return formatCount(data.testsByRequirement.size);
    case 'failures': {
      const bad = data.data.totals.failed + data.data.totals.broken;
      return bad === 0 ? null : formatCount(bad);
    }
    case 'overview':
    case 'timeline':
    case 'environment':
    case 'test':
      return null;
  }
}

export function buildShell(root: HTMLElement): Shell {
  const main = el('main', { id: 'main', class: 'main', tabindex: -1 });
  const skip = el('a', { class: 'skip-link', href: '#main', text: 'Skip to the results' });
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    const heading = main.querySelector<HTMLElement>('h1');
    (heading ?? main).focus();
  });
  const links = new Map<ViewName, HTMLAnchorElement>();
  const list = el('ul', { class: 'nav-list' });
  for (const item of NAV) {
    const count = navCount(item.view);
    const link = el(
      'a',
      {
        class: `nav-link${item.view === 'failures' && count !== null ? ' nav-link-alert' : ''}`,
        href: href(item.view),
      },
      navIcon(item.icon),
      el('span', { class: 'nav-label', text: item.label }),
      count === null ? null : el('span', { class: 'nav-count', text: count }),
    );
    links.set(item.view, link);
    list.appendChild(el('li', {}, link));
  }
  const nav = el('nav', { class: 'sidebar', 'aria-label': 'Views' }, list);
  root.replaceChildren(skip, header(), el('div', { class: 'layout' }, nav, main));
  return {
    main,
    setActive(view) {
      const active = view === 'test' ? 'types' : view;
      for (const [name, link] of links) {
        if (name === active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    },
  };
}

/** The heading and lead line every view starts with; the heading takes focus after a route change. */
export function viewHeader(title: string, lead: string | null, ...extra: (Node | null)[]): HTMLElement {
  return el(
    'div',
    { class: 'view-header' },
    el('h1', { class: 'view-title', tabindex: -1, text: title }),
    lead === null ? null : el('p', { class: 'view-lead', text: lead }),
    ...extra,
  );
}

/** A card with a heading. */
export function card(title: string, className = '', ...children: (Node | null)[]): HTMLElement {
  const id = `card-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
  return el(
    'section',
    { class: `card ${className}`.trim(), 'aria-labelledby': id },
    el('h2', { class: 'card-title', id, text: title }),
    ...children,
  );
}

export function emptyState(text: string): HTMLElement {
  return el('p', { class: 'empty', text });
}

export function testLink(test: TestEntry, className = 'test-link'): HTMLAnchorElement {
  return el('a', { class: className, href: testHref(test.id), text: test.name });
}
