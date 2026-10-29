// Environment: where and from what the run was made (Node, the OS, the browsers, k6, the commit, CI).
import { el, externalLink } from './dom.ts';
import { formatDateTime, formatDuration, plural } from './format.ts';
import { card, viewHeader } from './shell.ts';
import { report } from './state.ts';

function row(name: string, value: Node | string): HTMLTableRowElement {
  return el('tr', {}, el('th', { scope: 'row', text: name }), el('td', {}, value));
}

export function renderEnvironment(main: HTMLElement): void {
  const data = report().data;
  const runTable = el(
    'table',
    { class: 'kv-table' },
    el('caption', { class: 'sr-only', text: 'This report' }),
    el(
      'tbody',
      {},
      row('Built', formatDateTime(data.builtAt)),
      row('Tests', plural(data.tests.length, 'test')),
      row('Run duration', formatDuration(data.duration)),
      row('Repository', data.repository ?? 'unknown'),
      row('Branch', data.branch ?? 'unknown'),
      row('Commit', el('span', { class: 'mono', text: data.commit ?? 'unknown' })),
      row('Runs in the history', String(data.trend.length)),
    ),
  );
  const environment = el('tbody', {});
  for (const entry of data.environment) {
    environment.appendChild(row(entry.name, entry.url === null ? entry.value : externalLink(entry.url, entry.value)));
  }
  main.replaceChildren(
    viewHeader('Environment', 'Where the run was made, and with what.'),
    el(
      'div',
      { class: 'grid' },
      card(
        'This report',
        '',
        el('div', { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': 'This report' }, runTable),
      ),
      card(
        'Run environment',
        '',
        data.environment.length === 0
          ? el('p', { class: 'empty', text: 'The run recorded no environment.' })
          : el(
              'div',
              { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': 'Run environment' },
              el(
                'table',
                { class: 'kv-table' },
                el('caption', { class: 'sr-only', text: 'Run environment' }),
                environment,
              ),
            ),
      ),
    ),
  );
}
