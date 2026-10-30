// Overview: the pass-rate ring and tiles, a card per test type, the trends of the last runs, the slowest tests,
// failures by category, flaky tests and every requirement as a chip coloured by its result.
import type { Totals } from '../history.ts';
import type { Status } from '../result-schema.ts';
import {
  browserChip,
  passRate,
  resultBadge,
  statusBar,
  statusBadge,
  statusCounts,
  statusIcon,
  STATUSES_SHOWN,
  typeChip,
} from './badges.ts';
import { durationArea, historyDots, passRing, trendBars } from './charts.ts';
import { el, setVar } from './dom.ts';
import { formatCount, formatDuration, plural } from './format.ts';
import { href } from './route.ts';
import { card, emptyState, testLink, viewHeader } from './shell.ts';
import { report, resultOf, totalOf } from './state.ts';

function tile(label: string, value: string, className: string, icon: Status | null): HTMLElement {
  return el(
    'li',
    { class: `tile ${className}` },
    el('span', { class: 'tile-label' }, icon === null ? null : statusIcon(icon), label),
    el('span', { class: 'tile-value', text: value }),
  );
}

function hero(totals: Totals, duration: number): HTMLElement {
  const total = totalOf(totals);
  const tiles = el(
    'ul',
    { class: 'tiles', 'aria-label': 'Totals' },
    tile('Total', formatCount(total), 'tile-total', null),
    tile('Passed', formatCount(totals.passed), 'tile-passed', 'passed'),
    tile('Failed', formatCount(totals.failed), 'tile-failed', 'failed'),
    tile('Broken', formatCount(totals.broken), 'tile-broken', 'broken'),
    tile('Skipped', formatCount(totals.skipped), 'tile-skipped', 'skipped'),
    tile('Duration', formatDuration(duration), 'tile-duration', null),
  );
  return el(
    'section',
    { class: 'hero', 'aria-label': 'Summary' },
    el('div', { class: 'card hero-ring' }, passRing(totals), statusCounts(totals, false)),
    tiles,
  );
}

function typeCards(): HTMLElement {
  const data = report();
  const grid = el('ul', { class: 'type-grid' });
  for (const type of data.presentTypes) {
    const totals = data.totalsByType.get(type.id);
    if (totals === undefined) continue;
    grid.appendChild(
      el(
        'li',
        { class: `type-card type-${type.id}` },
        el(
          'div',
          { class: 'type-card-head' },
          el(
            'a',
            { class: 'type-card-title', href: href('types', { type: type.id }) },
            el('span', { class: 'dot', 'aria-hidden': 'true' }),
            type.title,
          ),
          el('span', { class: 'type-card-rate', text: passRate(totals) }),
        ),
        el('p', { class: 'type-card-count', text: plural(totalOf(totals), 'test') }),
        statusBar(totals, 'thick'),
        statusCounts(totals),
      ),
    );
  }
  return card('Test types', 'span-all', data.presentTypes.length === 0 ? emptyState('No test ran in this run.') : grid);
}

function statusLegend(): HTMLElement {
  return el(
    'ul',
    { class: 'legend', 'aria-hidden': 'true' },
    ...STATUSES_SHOWN.map((status) => el('li', {}, el('span', { class: `swatch fill-${status}` }), status)),
  );
}

function trends(): HTMLElement[] {
  const trend = report().data.trend;
  return [
    card('Results by run', 'chart-card', trendBars(trend), statusLegend()),
    card('Duration by run', 'chart-card', durationArea(trend)),
  ];
}

function slowest(): HTMLElement {
  const tests = [...report().data.tests].sort((left, right) => right.duration - left.duration).slice(0, 10);
  const longest = tests[0]?.duration ?? 1;
  const list = el('ol', { class: 'rank-list' });
  for (const test of tests) {
    const bar = el('span', { class: `rank-bar type-${test.type}`, 'aria-hidden': 'true' });
    setVar(bar, '--share', `${String(Math.max(2, (test.duration / Math.max(longest, 1)) * 100))}%`);
    list.appendChild(
      el(
        'li',
        { class: 'rank-item' },
        el(
          'div',
          { class: 'rank-head' },
          testLink(test),
          el('span', { class: 'rank-value', text: formatDuration(test.duration) }),
        ),
        el('div', { class: 'rank-meta' }, typeChip(test.type), browserChip(test), statusBadge(test.status)),
        el('span', { class: 'rank-track', 'aria-hidden': 'true' }, bar),
      ),
    );
  }
  return card('10 slowest tests', '', tests.length === 0 ? emptyState('No tests.') : list);
}

function failuresByCategory(): HTMLElement {
  const data = report();
  const counts = new Map<string, number>();
  for (const test of data.data.tests) {
    if (test.category !== null) counts.set(test.category, (counts.get(test.category) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) return card('Failures by category', '', emptyState('Nothing failed in this run.'));
  const bar = el('div', {
    class: 'status-bar status-bar-thick category-bar',
    role: 'img',
    'aria-label': data.data.categories
      .filter((category) => counts.has(category.id))
      .map((category) => `${String(counts.get(category.id) ?? 0)} ${category.title}`)
      .join(', '),
  });
  const list = el('ul', { class: 'category-list' });
  for (const category of data.data.categories) {
    const count = counts.get(category.id) ?? 0;
    if (count === 0) continue;
    const segment = el('span', { class: `segment category-${category.id}` });
    setVar(segment, '--share', `${String((count / total) * 100)}%`);
    bar.appendChild(segment);
    list.appendChild(
      el(
        'li',
        { class: `category-item category-${category.id}` },
        el('span', { class: 'swatch', 'aria-hidden': 'true' }),
        el('a', { href: href('failures', { category: category.id }), text: category.title }),
        el('span', { class: 'category-count', text: formatCount(count) }),
      ),
    );
  }
  return card('Failures by category', '', bar, list);
}

function flaky(): HTMLElement {
  const tests = report().data.tests.filter((test) => test.flaky);
  if (tests.length === 0) return card('Flaky tests', '', emptyState('No test switched between pass and fail lately.'));
  const list = el('ul', { class: 'flaky-list' });
  for (const test of tests) {
    list.appendChild(
      el(
        'li',
        { class: 'flaky-item' },
        el('div', { class: 'flaky-head' }, testLink(test), typeChip(test.type), browserChip(test)),
        historyDots(test.history),
      ),
    );
  }
  return card('Flaky tests', '', list);
}

function requirementChips(): HTMLElement {
  const data = report();
  const list = el('ul', { class: 'req-chips' });
  for (const requirement of data.data.requirements) {
    if (requirement.retired) continue;
    const tests = data.testsByRequirement.get(requirement.id) ?? [];
    const result = resultOf(tests);
    const name = result ?? 'not run';
    list.appendChild(
      el(
        'li',
        {},
        el(
          'a',
          {
            class: `req-chip status-${result ?? 'none'}`,
            href: href('requirements', { req: requirement.id }),
            title: `${requirement.title} (${name}, ${plural(tests.length, 'test')})`,
            'aria-label': `${requirement.id}: ${name}`,
          },
          statusIcon(result ?? 'none'),
          requirement.id,
        ),
      ),
    );
  }
  return card(
    'Requirements',
    'span-all',
    el('p', {
      class: 'card-lead',
      text: 'Every requirement of the plan, coloured by the result of the tests that cover it.',
    }),
    list,
    el('ul', { class: 'legend' }, ...[...STATUSES_SHOWN, null].map((status) => el('li', {}, resultBadge(status)))),
  );
}

export function renderOverview(main: HTMLElement): void {
  const data = report().data;
  main.replaceChildren(
    viewHeader(
      'Overview',
      `The latest run: ${plural(data.tests.length, 'test')} of ${plural(report().presentTypes.length, 'test type')}.`,
    ),
    hero(data.totals, data.duration),
    el(
      'div',
      { class: 'grid' },
      typeCards(),
      ...trends(),
      slowest(),
      el('div', { class: 'stack' }, failuresByCategory(), flaky()),
      requirementChips(),
    ),
  );
}
