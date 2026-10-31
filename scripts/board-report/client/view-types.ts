// By test type: a tree of type, then file or feature, then describe blocks or scenario, then test, with counts and a
// status bar on every level. Collapsed by default; a group draws its children only when it is first opened. Enter or
// Space opens and closes a group; the arrow keys move through the tree, open (→) and close (←).
import type { TestEntry } from '../build/data-shape.ts';
import type { Totals } from '../history.ts';
import type { TestType } from '../result-schema.ts';
import { browserChip, flakyChip, statusBadge, statusBar } from './badges.ts';
import { chunked, el, svg, uid } from './dom.ts';
import { filterBar, filterTests, filtersFrom, hasFilters, withFilters, type Filters } from './filters.ts';
import { formatDuration, plural } from './format.ts';
import { replaceQuery, type Route } from './route.ts';
import { emptyState, testLink, viewHeader } from './shell.ts';
import { emptyTotalsOf, report, totalOf, typeTitle } from './state.ts';

interface TreeNode {
  label: string;
  type: TestType | null;
  children: Map<string, TreeNode>;
  tests: TestEntry[];
  totals: Totals;
}

/** Up to this many matching tests, a filtered tree opens by itself. */
const OPEN_FILTERED = 200;

function node(label: string, type: TestType | null): TreeNode {
  return { label, type, children: new Map(), tests: [], totals: emptyTotalsOf() };
}

function buildTree(tests: readonly TestEntry[]): TreeNode[] {
  const roots = new Map<TestType, TreeNode>();
  const data = report();
  for (const test of tests) {
    let current = roots.get(test.type);
    if (current === undefined) {
      current = node(typeTitle(test.type), test.type);
      roots.set(test.type, current);
    }
    current.totals[test.status] += 1;
    // A result without a source file repeats its first suite in place of the file (ESLint › ESLint): shown once.
    const suites = test.suites.filter((label, index) => index === 0 || label !== test.suites[index - 1]);
    const path = suites.length > 0 ? suites : [test.file ?? 'Results'];
    for (const label of path) {
      let next: TreeNode | undefined = current.children.get(label);
      if (next === undefined) {
        next = node(label, null);
        current.children.set(label, next);
      }
      next.totals[test.status] += 1;
      current = next;
    }
    current.tests.push(test);
  }
  return data.presentTypes.flatMap((type) => {
    const root = roots.get(type.id);
    return root === undefined ? [] : [root];
  });
}

function chevron(): SVGSVGElement {
  return svg(
    'svg',
    { class: 'chevron', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: 'M6 3.5l4.5 4.5L6 12.5' }),
  );
}

function testRow(test: TestEntry): HTMLLIElement {
  return el(
    'li',
    { class: 'tree-test' },
    statusBadge(test.status),
    el('span', { class: 'tree-test-name' }, testLink(test, 'tree-link test-link')),
    el(
      'span',
      { class: 'tree-test-meta' },
      flakyChip(test),
      browserChip(test),
      el('span', { class: 'duration', text: formatDuration(test.duration) }),
    ),
  );
}

/** How each group draws its children, the first time it is opened. */
const drawers = new WeakMap<HTMLLIElement, () => void>();

/** A group's own toggle, not the toggle of a group inside it. */
function toggleOf(item: HTMLLIElement): HTMLButtonElement | null {
  return item.querySelector<HTMLButtonElement>(':scope > .tree-row .tree-toggle');
}

function setOpen(item: HTMLLIElement, open: boolean): void {
  const toggle = toggleOf(item);
  const group = item.querySelector<HTMLElement>(':scope > .tree-group');
  if (toggle === null || group === null) return;
  if (open && group.dataset['drawn'] !== 'yes') {
    drawers.get(item)?.();
    group.dataset['drawn'] = 'yes';
  }
  toggle.setAttribute('aria-expanded', String(open));
  group.hidden = !open;
}

function groupItem(tree: TreeNode, depth: number, openAll: boolean): HTMLLIElement {
  const groupId = uid('tree-group');
  const toggle = el(
    'button',
    { type: 'button', class: 'tree-toggle', 'aria-expanded': 'false', 'aria-controls': groupId },
    chevron(),
    tree.type === null ? null : el('span', { class: 'dot', 'aria-hidden': 'true' }),
    el('span', { class: 'tree-label', text: tree.label }),
  );
  const total = totalOf(tree.totals);
  const row = el(
    'div',
    { class: 'tree-row' },
    toggle,
    el('span', { class: 'tree-count', text: plural(total, 'test') }),
    statusBar(tree.totals),
  );
  const group = el('ul', { class: 'tree-group', id: groupId, hidden: true });
  const item = el(
    'li',
    { class: `tree-item depth-${String(Math.min(depth, 4))}${tree.type === null ? '' : ` type-${tree.type}`}` },
    row,
    group,
  );
  drawers.set(item, () => {
    for (const child of tree.children.values()) group.appendChild(groupItem(child, depth + 1, openAll));
    if (tree.tests.length > 0) {
      const tests = el('ul', { class: 'tree-tests' });
      group.appendChild(el('li', { class: 'tree-tests-holder' }, chunked(tests, tree.tests, testRow)));
    }
  });
  toggle.addEventListener('click', () => {
    setOpen(item, toggle.getAttribute('aria-expanded') !== 'true');
  });
  if (openAll) setOpen(item, true);
  return item;
}

function visibleItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.tree-toggle, .tree-link')].filter(
    (item) => item.closest('[hidden]') === null,
  );
}

function onTreeKey(root: HTMLElement, event: KeyboardEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches('.tree-toggle, .tree-link')) return;
  const items = visibleItems(root);
  const index = items.indexOf(target);
  const focusAt = (at: number): void => {
    const next = items[Math.max(0, Math.min(items.length - 1, at))];
    next?.focus();
  };
  const item = target.closest<HTMLLIElement>('li.tree-item');
  const isToggle = target.classList.contains('tree-toggle');
  const open = isToggle && target.getAttribute('aria-expanded') === 'true';
  switch (event.key) {
    case 'ArrowDown':
      focusAt(index + 1);
      break;
    case 'ArrowUp':
      focusAt(index - 1);
      break;
    case 'Home':
      focusAt(0);
      break;
    case 'End':
      focusAt(items.length - 1);
      break;
    case 'ArrowRight':
      if (isToggle && !open && item !== null) setOpen(item, true);
      else if (isToggle) focusAt(index + 1);
      break;
    case 'ArrowLeft': {
      if (isToggle && open && item !== null) {
        setOpen(item, false);
        break;
      }
      const owner = isToggle ? item?.parentElement?.closest<HTMLLIElement>('li.tree-item') : item;
      if (owner !== null && owner !== undefined) toggleOf(owner)?.focus();
      break;
    }
    default:
      return;
  }
  event.preventDefault();
}

export function renderTypes(main: HTMLElement, route: Route): void {
  const all = report().data.tests;
  const results = el('div', { class: 'tree-wrap' });
  let filters: Filters = filtersFrom(route.params);
  const bar = filterBar(filters, (next) => {
    filters = next;
    replaceQuery('types', withFilters(route.params, filters));
    draw();
  });
  const expandAll = el('button', { type: 'button', class: 'button button-ghost', text: 'Expand all' });
  const collapseAll = el('button', { type: 'button', class: 'button button-ghost', text: 'Collapse all' });
  const draw = (): void => {
    const tests = filterTests(all, filters);
    bar.setCount(tests.length, all.length);
    if (tests.length === 0) {
      results.replaceChildren(emptyState('No test matches these filters.'));
      return;
    }
    const openAll = hasFilters(filters) && tests.length <= OPEN_FILTERED;
    const tree = el('ul', { class: 'tree', 'aria-label': 'Tests by type' });
    for (const root of buildTree(tests)) tree.appendChild(groupItem(root, 0, openAll));
    tree.addEventListener('keydown', (event) => {
      onTreeKey(tree, event);
    });
    results.replaceChildren(tree);
  };
  const setAll = (open: boolean): void => {
    // Opening draws one level at a time, so repeat until nothing closed is left (each level is drawn once).
    for (;;) {
      const closed = [...results.querySelectorAll<HTMLLIElement>('li.tree-item')].filter(
        (item) => toggleOf(item)?.getAttribute('aria-expanded') !== String(open),
      );
      if (closed.length === 0) break;
      for (const item of closed) setOpen(item, open);
      if (!open) break;
    }
  };
  expandAll.addEventListener('click', () => {
    setAll(true);
  });
  collapseAll.addEventListener('click', () => {
    setAll(false);
  });
  main.replaceChildren(
    viewHeader('By test type', 'Every test of the run by type, then file or feature, then describe block or scenario.'),
    bar.element,
    el('div', { class: 'toolbar' }, expandAll, collapseAll),
    results,
  );
  draw();
}
