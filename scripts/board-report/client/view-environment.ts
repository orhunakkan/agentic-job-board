// Environment: where and from what the run was made (Node, the OS, the browsers, k6, the commit, CI).
import { el, externalLink, scrollingTable } from './dom.ts';
import { formatDateTime, formatDuration, plural } from './format.ts';
import { card, emptyState, viewHeader } from './shell.ts';
import { report } from './state.ts';

function row(name: string, value: Node | string): HTMLTableRowElement {
  return el('tr', {}, el('th', { scope: 'row', text: name }), el('td', {}, value));
}

/** A table of names and values, captioned for screen readers with the name of the card it is in. */
function kvTable(caption: string, body: HTMLTableSectionElement): HTMLElement {
  return scrollingTable(
    caption,
    el('table', { class: 'kv-table' }, el('caption', { class: 'sr-only', text: caption }), body),
  );
}

export function renderEnvironment(main: HTMLElement): void {
  const data = report().data;
  const run = el(
    'tbody',
    {},
    row('Built', formatDateTime(data.builtAt)),
    row('Tests', plural(data.tests.length, 'test')),
    row('Run duration', formatDuration(data.duration)),
    row('Repository', data.repository ?? 'unknown'),
    row('Branch', data.branch ?? 'unknown'),
    row('Commit', el('span', { class: 'mono', text: data.commit ?? 'unknown' })),
    row('Runs in the history', String(data.trend.length)),
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
      card('This report', '', kvTable('This report', run)),
      card(
        'Run environment',
        '',
        data.environment.length === 0
          ? emptyState('The run recorded no environment.')
          : kvTable('Run environment', environment),
      ),
    ),
  );
}
