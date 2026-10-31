// By requirement: one card per FR-/NFR- ID with its title and result, a link to the plan, and every test that covers
// it grouped by test type.
import type { RequirementInfo, TestEntry } from '../build/data-shape.ts';
import type { TestType } from '../result-schema.ts';
import { browserChip, chip, resultBadge, statusBadge, typeChip } from './badges.ts';
import { chunked, el, externalLink } from './dom.ts';
import { filterBar, filtersFrom, hasFilters, matchesFilters, withFilters, type Filters } from './filters.ts';
import { plural } from './format.ts';
import { href, replaceQuery, type Route } from './route.ts';
import { emptyState, testLink, viewHeader } from './shell.ts';
import { report, resultOf } from './state.ts';

interface RequirementView {
  requirement: RequirementInfo;
  /** Every test that covers it in this run. */
  all: TestEntry[];
  /** The ones the filters let through. */
  shown: TestEntry[];
}

function requirementCard(view: RequirementView): HTMLLIElement {
  const { requirement, all, shown } = view;
  const data = report();
  const headingId = `req-${requirement.id}`;
  const body = el('div', { class: 'req-body' });
  if (all.length === 0) {
    body.appendChild(emptyState('No test covers this requirement in this run.'));
  } else {
    const byType = new Map<TestType, TestEntry[]>();
    for (const test of shown) {
      const list = byType.get(test.type);
      if (list === undefined) byType.set(test.type, [test]);
      else list.push(test);
    }
    for (const type of data.presentTypes) {
      const tests = byType.get(type.id);
      if (tests === undefined) continue;
      const list = el('ul', { class: 'req-tests' });
      for (const test of tests) {
        list.appendChild(el('li', {}, statusBadge(test.status), testLink(test), browserChip(test)));
      }
      body.appendChild(
        el(
          'div',
          { class: 'req-type' },
          el(
            'h3',
            { class: 'req-type-title' },
            typeChip(type.id),
            el('span', { class: 'muted', text: plural(tests.length, 'test') }),
          ),
          list,
        ),
      );
    }
  }
  return el(
    'li',
    { class: `req-card card${requirement.retired ? ' req-retired' : ''}` },
    el(
      'article',
      { 'aria-labelledby': headingId },
      el(
        'div',
        { class: 'req-head' },
        el(
          'h2',
          { class: 'req-title', id: headingId },
          el('span', { class: 'req-id', text: requirement.id }),
          el('span', { class: 'req-name', text: requirement.title }),
        ),
        el(
          'div',
          { class: 'req-side' },
          requirement.retired ? chip('Retired', 'chip-muted') : null,
          resultBadge(resultOf(all)),
          el('span', { class: 'muted', text: plural(all.length, 'test') }),
          requirement.url === null
            ? null
            : externalLink(requirement.url, 'In the plan', {
                class: 'req-plan',
                'aria-label': `${requirement.id} in the plan`,
              }),
        ),
      ),
      body,
    ),
  );
}

export function renderRequirements(main: HTMLElement, route: Route): void {
  const data = report();
  const results = el('div', {});
  let filters: Filters = filtersFrom(route.params);
  const only = route.params.get('req');
  const bar = filterBar(filters, (next) => {
    filters = next;
    replaceQuery('requirements', withFilters(route.params, filters));
    draw();
  });
  const draw = (): void => {
    const words = filters.q.trim().toLowerCase();
    const testFilters: Filters = { ...filters, q: '' };
    const filtered = hasFilters(testFilters);
    const views: RequirementView[] = [];
    for (const requirement of data.data.requirements) {
      if (only !== null && requirement.id !== only) continue;
      const all = data.testsByRequirement.get(requirement.id) ?? [];
      const titleMatches = words === '' || `${requirement.id} ${requirement.title}`.toLowerCase().includes(words);
      const shown = all.filter(
        (test) => matchesFilters(test, testFilters) && (titleMatches || matchesFilters(test, filters)),
      );
      if (filtered && shown.length === 0) continue;
      if (!filtered && !titleMatches && shown.length === 0) continue;
      if (requirement.retired && all.length === 0 && only === null) continue;
      views.push({ requirement, all, shown });
    }
    bar.setCount(
      views.length,
      data.data.requirements.filter(
        (requirement) => !requirement.retired || data.testsByRequirement.has(requirement.id),
      ).length,
      'requirements',
    );
    if (views.length === 0) {
      results.replaceChildren(emptyState('No requirement matches these filters.'));
      return;
    }
    const list = el('ul', { class: 'req-list' });
    results.replaceChildren(chunked(list, views, requirementCard, 60, 'requirements'));
  };
  main.replaceChildren(
    viewHeader(
      'By requirement',
      'Each requirement of the plan with the tests that cover it, grouped by test type.',
      only === null
        ? null
        : el('p', { class: 'view-lead' }, el('a', { href: href('requirements'), text: 'Show every requirement' })),
    ),
    bar.element,
    results,
  );
  draw();
}
