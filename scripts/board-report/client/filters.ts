// Search and filters for every list: text in the name, file, requirement or tag; status, test type, browser, tag and
// severity. They live in the link's query, so a filtered list can be shared.
import type { TestEntry } from '../build/data-shape.ts';
import type { Severity, Status, TestType } from '../result-schema.ts';
import { STATUS_WORD, STATUSES_SHOWN } from './badges.ts';
import { el, selectEl } from './dom.ts';
import { formatCount } from './format.ts';
import { report } from './state.ts';

export interface Filters {
  q: string;
  status: Status | '';
  type: TestType | '';
  browser: string;
  tag: string;
  severity: Severity | '';
}

const FILTER_KEYS = ['q', 'status', 'type', 'browser', 'tag', 'severity'] as const;

function isStatus(value: string): value is Status {
  return (STATUSES_SHOWN as readonly string[]).includes(value);
}

export function filtersFrom(params: URLSearchParams): Filters {
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const severity = params.get('severity') ?? '';
  return {
    q: params.get('q') ?? '',
    status: isStatus(status) ? status : '',
    type: report().typeInfo.has(type as TestType) ? (type as TestType) : '',
    browser: params.get('browser') ?? '',
    tag: params.get('tag') ?? '',
    severity: severity === 'critical' || severity === 'normal' ? severity : '',
  };
}

/** The params with the filters written in (empty ones left out), other params kept. */
export function withFilters(params: URLSearchParams, filters: Filters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of FILTER_KEYS) {
    const value = filters[key].trim();
    if (value === '') next.delete(key);
    else next.set(key, value);
  }
  return next;
}

export function hasFilters(filters: Filters): boolean {
  return FILTER_KEYS.some((key) => filters[key].trim() !== '');
}

const haystacks = new Map<string, string>();

function haystackOf(test: TestEntry): string {
  let text = haystacks.get(test.id);
  if (text === undefined) {
    text = [test.name, test.fullName, test.file ?? '', ...test.requirements, ...test.tags, test.browser ?? '']
      .join('\n')
      .toLowerCase();
    haystacks.set(test.id, text);
  }
  return text;
}

export function matchesFilters(test: TestEntry, filters: Filters): boolean {
  if (filters.status !== '' && test.status !== filters.status) return false;
  if (filters.type !== '' && test.type !== filters.type) return false;
  if (filters.browser !== '' && test.browser !== filters.browser) return false;
  if (filters.tag !== '' && !test.tags.includes(filters.tag)) return false;
  if (filters.severity !== '' && test.severity !== filters.severity) return false;
  const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = haystackOf(test);
  return words.every((word) => text.includes(word));
}

export function filterTests(tests: readonly TestEntry[], filters: Filters): TestEntry[] {
  return hasFilters(filters) ? tests.filter((test) => matchesFilters(test, filters)) : [...tests];
}

export interface FilterBar {
  element: HTMLElement;
  /** Updates the "12 of 40 tests" line, read out politely. */
  setCount: (shown: number, total: number, noun?: string) => void;
}

function select(
  id: string,
  label: string,
  value: string,
  all: string,
  options: readonly (readonly [string, string])[],
): HTMLElement {
  const control = selectEl({ id, class: 'select' }, el('option', { value: '', text: all }));
  for (const [optionValue, text] of options) control.appendChild(el('option', { value: optionValue, text }));
  control.value = options.some(([optionValue]) => optionValue === value) ? value : '';
  return el('div', { class: 'field' }, el('label', { for: id, text: label }), control);
}

/** The search box and the filters; calls `onChange` as the owner types or picks. */
export function filterBar(filters: Filters, onChange: (filters: Filters) => void): FilterBar {
  const data = report();
  const form = el('form', { class: 'filter-bar card', role: 'search', 'aria-label': 'Filter tests' });
  const search = el('input', {
    id: 'filter-q',
    class: 'input',
    type: 'search',
    value: filters.q,
    placeholder: 'Name, file, requirement or tag',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  form.appendChild(
    el('div', { class: 'field field-search' }, el('label', { for: 'filter-q', text: 'Search' }), search),
  );
  form.appendChild(
    select(
      'filter-status',
      'Status',
      filters.status,
      'All',
      STATUSES_SHOWN.map((status) => [status, STATUS_WORD[status]] as const),
    ),
  );
  form.appendChild(
    select(
      'filter-type',
      'Test type',
      filters.type,
      'All',
      data.presentTypes.map((type) => [type.id, type.title] as const),
    ),
  );
  form.appendChild(
    select(
      'filter-browser',
      'Browser',
      filters.browser,
      'All',
      data.browsers.map((browser) => [browser, browser] as const),
    ),
  );
  form.appendChild(
    select(
      'filter-tag',
      'Tag',
      filters.tag,
      'All',
      data.tags.map((tag) => [tag, tag] as const),
    ),
  );
  form.appendChild(
    select('filter-severity', 'Severity', filters.severity, 'All', [
      ['critical', 'Critical'],
      ['normal', 'Normal'],
    ]),
  );
  const reset = el('button', { type: 'button', class: 'button button-ghost', text: 'Clear filters' });
  const count = el('p', { class: 'filter-count', 'aria-live': 'polite' });
  form.appendChild(el('div', { class: 'field field-actions' }, reset));
  const element = el('div', { class: 'filter-wrap' }, form, count);

  const valueOf = (id: string): string => form.querySelector<HTMLSelectElement>(`#${id}`)?.value ?? '';
  const read = (): Filters => {
    const status = valueOf('filter-status');
    const type = valueOf('filter-type');
    const severity = valueOf('filter-severity');
    return {
      q: search.value,
      status: isStatus(status) ? status : '',
      type: data.typeInfo.has(type as TestType) ? (type as TestType) : '',
      browser: valueOf('filter-browser'),
      tag: valueOf('filter-tag'),
      severity: severity === 'critical' || severity === 'normal' ? severity : '',
    };
  };
  let timer: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      onChange(read());
    }, 120);
  });
  form.addEventListener('change', (event) => {
    if (event.target !== search) onChange(read());
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    window.clearTimeout(timer);
    onChange(read());
  });
  reset.addEventListener('click', () => {
    search.value = '';
    for (const control of form.querySelectorAll('select')) control.value = '';
    window.clearTimeout(timer);
    onChange(read());
    search.focus();
  });
  return {
    element,
    setCount(shown, total, noun = 'tests') {
      count.textContent =
        shown === total ? `${formatCount(total)} ${noun}` : `${formatCount(shown)} of ${formatCount(total)} ${noun}`;
    },
  };
}
