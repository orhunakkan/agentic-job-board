// Failures: every failed or broken test, grouped by failure category, with the first line of its error.
import type { TestEntry } from '../build/data-shape.ts';
import type { Category } from '../categories.ts';
import { browserChip, flakyChip, statusBadge, typeChip } from './badges.ts';
import { chunked, el } from './dom.ts';
import { filterBar, filterTests, filtersFrom, withFilters, type Filters } from './filters.ts';
import { formatCount } from './format.ts';
import { href, replaceQuery, type Route } from './route.ts';
import { emptyState, testLink, viewHeader } from './shell.ts';
import { report } from './state.ts';

function failureRow(test: TestEntry): HTMLLIElement {
  return el(
    'li',
    { class: 'failure' },
    el('div', { class: 'failure-head' }, statusBadge(test.status), testLink(test)),
    el(
      'div',
      { class: 'failure-meta' },
      typeChip(test.type),
      browserChip(test),
      flakyChip(test),
      test.file === null ? null : el('span', { class: 'muted mono', text: test.file }),
    ),
    test.errorLine === null ? null : el('code', { class: 'error-line', text: test.errorLine }),
  );
}

export function renderFailures(main: HTMLElement, route: Route): void {
  const data = report();
  const failing = data.data.tests.filter((test) => test.status === 'failed' || test.status === 'broken');
  const results = el('div', { class: 'failure-groups' });
  let filters: Filters = filtersFrom(route.params);
  const categoryParam = route.params.get('category');
  const only = data.categoryInfo.has(categoryParam as Category) ? (categoryParam as Category) : null;
  const bar = filterBar(filters, (next) => {
    filters = next;
    replaceQuery('failures', withFilters(route.params, filters));
    draw();
  });
  const draw = (): void => {
    const tests = filterTests(failing, filters).filter((test) => only === null || test.category === only);
    bar.setCount(tests.length, failing.length, 'failures');
    if (failing.length === 0) {
      results.replaceChildren(
        el('div', { class: 'card all-green' }, emptyState('No failed or broken tests in this run. All green!')),
      );
      return;
    }
    if (tests.length === 0) {
      results.replaceChildren(emptyState('No failure matches these filters.'));
      return;
    }
    const groups: HTMLElement[] = [];
    for (const category of data.data.categories) {
      const inCategory = tests.filter((test) => test.category === category.id);
      if (inCategory.length === 0) continue;
      const id = `failures-${category.id}`;
      groups.push(
        el(
          'section',
          { class: `card failure-group category-${category.id}`, 'aria-labelledby': id },
          el(
            'h2',
            { class: 'card-title', id },
            el('span', { class: 'swatch', 'aria-hidden': 'true' }),
            category.title,
            el('span', { class: 'pill', text: formatCount(inCategory.length) }),
          ),
          chunked(el('ul', { class: 'failure-list' }), inCategory, failureRow),
        ),
      );
    }
    results.replaceChildren(...groups);
  };
  const title = only === null ? 'Failures' : `Failures: ${data.categoryInfo.get(only)?.title ?? only}`;
  main.replaceChildren(
    viewHeader(
      title,
      'Every failed or broken test, grouped by what went wrong.',
      only === null
        ? null
        : el('p', { class: 'view-lead' }, el('a', { href: href('failures'), text: 'Show every category' })),
    ),
    bar.element,
    results,
  );
  draw();
}
