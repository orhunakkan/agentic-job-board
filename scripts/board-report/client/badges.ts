// Status icons, badges, chips and status bars. A status always shows its icon and its word, never colour alone.
import type { TestEntry } from '../build/data-shape.ts';
import type { Totals } from '../history.ts';
import type { Status, TestType } from '../result-schema.ts';
import { el, setVar, svg } from './dom.ts';
import { formatPercent } from './format.ts';
import { totalOf, typeTitle } from './state.ts';

export const STATUSES_SHOWN: readonly Status[] = ['passed', 'failed', 'broken', 'skipped'];

export const STATUS_WORD: Readonly<Record<Status, string>> = {
  passed: 'Passed',
  failed: 'Failed',
  broken: 'Broken',
  skipped: 'Skipped',
};

const ICON_PATHS: Readonly<Record<Status | 'none', string>> = {
  passed: 'M4.2 8.4l2.5 2.5 5.1-5.6',
  failed: 'M5 5l6 6M11 5l-6 6',
  broken: 'M8 3.8v5.2M8 11.6v.4',
  skipped: 'M4.5 8h7',
  none: 'M8 8h.01',
};

/** A status icon drawn in currentColor; decorative, since a word always goes with it. */
export function statusIcon(status: Status | 'none', className = 'icon'): SVGSVGElement {
  return svg(
    'svg',
    { class: className, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: ICON_PATHS[status] }),
  );
}

export function statusBadge(status: Status, size: 'small' | 'large' = 'small'): HTMLSpanElement {
  return el('span', { class: `badge badge-${size} status-${status}` }, statusIcon(status), STATUS_WORD[status]);
}

/** A requirement or group's result; `null` when no test covers it. */
export function resultBadge(status: Status | null): HTMLSpanElement {
  if (status !== null) return statusBadge(status);
  return el('span', { class: 'badge badge-small status-none' }, statusIcon('none'), 'Not run');
}

export function totalsLabel(totals: Totals): string {
  return STATUSES_SHOWN.map((status) => `${String(totals[status])} ${status}`).join(', ');
}

/** A bar of the four statuses side by side, each as wide as its share. */
export function statusBar(totals: Totals, size: 'thin' | 'thick' = 'thin'): HTMLDivElement {
  const total = totalOf(totals);
  const bar = el('div', { class: `status-bar status-bar-${size}`, role: 'img', 'aria-label': totalsLabel(totals) });
  for (const status of STATUSES_SHOWN) {
    if (totals[status] === 0) continue;
    const segment = el('span', { class: `segment fill-${status}` });
    setVar(segment, '--share', `${String((totals[status] / Math.max(total, 1)) * 100)}%`);
    bar.appendChild(segment);
  }
  return bar;
}

/** "✓ 12 · ✕ 3 · ! 1 · – 2": each count with its icon and a word for screen readers. */
export function statusCounts(totals: Totals, hideZero = true): HTMLUListElement {
  const list = el('ul', { class: 'status-counts', 'aria-label': 'Results' });
  for (const status of STATUSES_SHOWN) {
    if (hideZero && totals[status] === 0) continue;
    list.appendChild(
      el(
        'li',
        { class: `count status-text-${status}` },
        statusIcon(status),
        el('span', { class: 'count-number', text: String(totals[status]) }),
        el('span', { class: 'count-word', text: status }),
      ),
    );
  }
  return list;
}

export function passRate(totals: Totals): string {
  return formatPercent(totals.passed, totalOf(totals));
}

export function typeChip(type: TestType): HTMLSpanElement {
  return el(
    'span',
    { class: `chip type-${type}` },
    el('span', { class: 'dot', 'aria-hidden': 'true' }),
    typeTitle(type),
  );
}

export function chip(text: string, className = ''): HTMLSpanElement {
  return el('span', { class: `chip ${className}`.trim(), text });
}

export function browserChip(test: TestEntry): HTMLSpanElement | null {
  return test.browser === null ? null : chip(test.browser, 'chip-browser');
}

export function flakyChip(test: TestEntry): HTMLSpanElement | null {
  return test.flaky ? chip('Flaky', 'chip-flaky') : null;
}
