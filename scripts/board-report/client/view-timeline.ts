// Timeline: when each test ran, by step and worker, so slow stretches and parallel runs are visible. The lanes are a
// picture (a click on a bar opens its test); the list under them holds the same tests as links for the keyboard.
import type { TestEntry } from '../build/data-shape.ts';
import { statusBadge, STATUSES_SHOWN, typeChip } from './badges.ts';
import { chunked, el, setVar } from './dom.ts';
import { filterBar, filterTests, filtersFrom, withFilters, type Filters } from './filters.ts';
import { formatDuration, plural } from './format.ts';
import { replaceQuery, testHref, type Route } from './route.ts';
import { card, emptyState, testLink, viewHeader } from './shell.ts';
import { report, typeTitle } from './state.ts';

interface Lane {
  label: string;
  tests: TestEntry[];
}

function lanesOf(tests: readonly TestEntry[]): { step: string; lanes: Lane[] }[] {
  const steps = new Map<string, Map<string, TestEntry[]>>();
  for (const test of tests) {
    let workers = steps.get(test.step);
    if (workers === undefined) {
      workers = new Map();
      steps.set(test.step, workers);
    }
    const key = test.worker ?? '';
    const list = workers.get(key);
    if (list === undefined) workers.set(key, [test]);
    else list.push(test);
  }
  return [...steps].map(([step, workers]) => ({
    step,
    lanes: [...workers]
      .sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }))
      .map(([worker, laneTests]) => ({ label: worker === '' ? 'Main' : `Worker ${worker}`, tests: laneTests })),
  }));
}

function stepTitle(step: string, tests: readonly TestEntry[]): string {
  const first = tests[0];
  return first === undefined ? step : `${typeTitle(first.type)} (step ${step})`;
}

function timelineChart(tests: readonly TestEntry[]): HTMLElement {
  const start = Math.min(...tests.map((test) => test.start));
  const stop = Math.max(...tests.map((test) => test.stop));
  const span = Math.max(stop - start, 1);
  const chart = el('div', { class: 'timeline' });
  const axis = el('div', { class: 'timeline-axis', 'aria-hidden': 'true' });
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const tick = el('span', { class: 'tick', text: `+${formatDuration(span * fraction)}` });
    setVar(tick, '--at', `${String(fraction * 100)}%`);
    axis.appendChild(tick);
  }
  chart.appendChild(el('div', { class: 'timeline-row timeline-axis-row' }, el('span', { class: 'lane-label' }), axis));
  for (const { step, lanes } of lanesOf(tests)) {
    chart.appendChild(el('p', { class: 'timeline-step', text: stepTitle(step, lanes[0]?.tests ?? []) }));
    for (const lane of lanes) {
      const first = Math.min(...lane.tests.map((test) => test.start));
      const last = Math.max(...lane.tests.map((test) => test.stop));
      const track = el('div', {
        class: 'lane-track',
        role: 'img',
        'aria-label': `${lane.label}: ${plural(lane.tests.length, 'test')} from +${formatDuration(first - start)} to +${formatDuration(last - start)}`,
      });
      for (const test of lane.tests) {
        const bar = el('span', {
          class: `lane-bar bar-${test.status}`,
          title: `${test.name}: ${test.status}, ${formatDuration(test.duration)}, at +${formatDuration(test.start - start)}`,
          'data-id': test.id,
        });
        setVar(bar, '--left', `${String(((test.start - start) / span) * 100)}%`);
        setVar(bar, '--width', `${String((Math.max(test.stop - test.start, 0) / span) * 100)}%`);
        track.appendChild(bar);
      }
      track.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset['id'] !== undefined)
          window.location.hash = testHref(target.dataset['id']);
      });
      chart.appendChild(
        el('div', { class: 'timeline-row' }, el('span', { class: 'lane-label', text: lane.label }), track),
      );
    }
  }
  return chart;
}

function startRow(origin: number): (test: TestEntry) => HTMLLIElement {
  return (test) =>
    el(
      'li',
      { class: 'start-row' },
      el('span', { class: 'start-at mono', text: `+${formatDuration(test.start - origin)}` }),
      statusBadge(test.status),
      testLink(test),
      typeChip(test.type),
      el('span', { class: 'muted', text: test.worker === null ? 'main' : `worker ${test.worker}` }),
      el('span', { class: 'duration', text: formatDuration(test.duration) }),
    );
}

function laneLegend(): HTMLElement {
  return el(
    'ul',
    { class: 'legend' },
    ...STATUSES_SHOWN.map((status) =>
      el('li', {}, el('span', { class: `swatch lane-bar-swatch bar-${status}`, 'aria-hidden': 'true' }), status),
    ),
  );
}

export function renderTimeline(main: HTMLElement, route: Route): void {
  const all = report().data.tests;
  const results = el('div', { class: 'timeline-wrap' });
  let filters: Filters = filtersFrom(route.params);
  const bar = filterBar(filters, (next) => {
    filters = next;
    replaceQuery('timeline', withFilters(route.params, filters));
    draw();
  });
  const draw = (): void => {
    const tests = filterTests(all, filters).sort(
      (left, right) => left.start - right.start || left.id.localeCompare(right.id),
    );
    bar.setCount(tests.length, all.length);
    if (tests.length === 0) {
      results.replaceChildren(emptyState('No test matches these filters.'));
      return;
    }
    const origin = tests[0]?.start ?? 0;
    results.replaceChildren(
      card('Lanes', 'timeline-card', laneLegend(), timelineChart(tests)),
      card('In start order', '', chunked(el('ol', { class: 'start-list' }), tests, startRow(origin))),
    );
  };
  main.replaceChildren(
    viewHeader(
      'Timeline',
      'When each test ran, by step and worker. Wide bars are slow tests; stacked lanes ran in parallel.',
    ),
    bar.element,
    results,
  );
  draw();
}
