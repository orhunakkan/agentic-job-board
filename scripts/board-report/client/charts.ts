// Hand-drawn SVG charts: the pass-rate ring, the trends of the last runs and a test's history dots. Colours come from
// classes, so they follow the theme; every chart has a text alternative and every mark a tooltip.
import type { RunPoint } from '../build/data-shape.ts';
import type { Totals } from '../history.ts';
import type { Status } from '../result-schema.ts';
import { STATUS_WORD, STATUSES_SHOWN, statusIcon, totalsLabel } from './badges.ts';
import { el, svg, svgTitle } from './dom.ts';
import { formatCount, formatDateTime, formatDuration, formatPercent, formatShortDate, plural } from './format.ts';
import { totalOf } from './state.ts';

export function passRing(totals: Totals): HTMLElement {
  const total = totalOf(totals);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const ring = svg('svg', { class: 'ring', viewBox: '0 0 140 140', 'aria-hidden': 'true', focusable: 'false' });
  ring.appendChild(svg('circle', { class: 'ring-track', cx: 70, cy: 70, r: radius }));
  const group = svg('g', { transform: 'rotate(-90 70 70)' });
  let offset = 0;
  for (const status of STATUSES_SHOWN) {
    const length = total === 0 ? 0 : (totals[status] / total) * circumference;
    if (length === 0) continue;
    group.appendChild(
      svg(
        'circle',
        {
          class: `ring-segment stroke-${status}`,
          cx: 70,
          cy: 70,
          r: radius,
          'stroke-dasharray': `${String(length)} ${String(circumference - length)}`,
          'stroke-dashoffset': String(-offset),
        },
        svgTitle(`${formatCount(totals[status])} ${status}`),
      ),
    );
    offset += length;
  }
  ring.appendChild(group);
  const rate = formatPercent(totals.passed, total);
  return el(
    'div',
    { class: 'ring-wrap', role: 'img', 'aria-label': `Pass rate ${rate}: ${totalsLabel(totals)}` },
    ring,
    el(
      'div',
      { class: 'ring-center', 'aria-hidden': 'true' },
      el('span', { class: 'ring-value', text: rate }),
      el('span', { class: 'ring-caption', text: 'pass rate' }),
    ),
  );
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 30, left: 44 };
const INNER_WIDTH = WIDTH - PAD.left - PAD.right;
const INNER_HEIGHT = HEIGHT - PAD.top - PAD.bottom;

/** An empty trend chart; the figure around it carries the text alternative. */
function chartSvg(): SVGSVGElement {
  return svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${String(WIDTH)} ${String(HEIGHT)}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

function axes(chart: SVGSVGElement, max: number, label: (value: number) => string, points: readonly RunPoint[]): void {
  for (const fraction of [0, 0.5, 1]) {
    const y = PAD.top + INNER_HEIGHT * (1 - fraction);
    chart.appendChild(svg('line', { class: 'grid-line', x1: PAD.left, x2: WIDTH - PAD.right, y1: y, y2: y }));
    chart.appendChild(
      svg('text', {
        class: 'axis-label',
        x: PAD.left - 8,
        y: y + 4,
        'text-anchor': 'end',
        text: label(max * fraction),
      }),
    );
  }
  const first = points[0];
  const last = points.at(-1);
  if (first !== undefined) {
    chart.appendChild(
      svg('text', {
        class: 'axis-label',
        x: PAD.left,
        y: HEIGHT - 8,
        'text-anchor': 'start',
        text: formatShortDate(first.time),
      }),
    );
  }
  if (last !== undefined && points.length > 1) {
    chart.appendChild(
      svg('text', {
        class: 'axis-label',
        x: WIDTH - PAD.right,
        y: HEIGHT - 8,
        'text-anchor': 'end',
        text: formatShortDate(last.time),
      }),
    );
  }
}

function runLabel(point: RunPoint, index: number): string {
  return `Run ${String(index + 1)}, ${formatDateTime(point.time)}`;
}

/** Each run as a bar of its results, stacked passed, skipped, broken, failed from the bottom. */
export function trendBars(points: readonly RunPoint[]): HTMLElement {
  const chart = chartSvg();
  const max = niceMax(Math.max(0, ...points.map((point) => totalOf(point.totals))));
  axes(chart, max, (value) => formatCount(Math.round(value)), points);
  const band = INNER_WIDTH / Math.max(points.length, 1);
  const barWidth = Math.min(band * 0.64, 44);
  const order: readonly Status[] = ['passed', 'skipped', 'broken', 'failed'];
  points.forEach((point, index) => {
    const x = PAD.left + band * index + (band - barWidth) / 2;
    const group = svg('g', { class: 'bar-group' }, svgTitle(`${runLabel(point, index)}: ${totalsLabel(point.totals)}`));
    let base = PAD.top + INNER_HEIGHT;
    for (const status of order) {
      const height = (point.totals[status] / max) * INNER_HEIGHT;
      if (height <= 0) continue;
      base -= height;
      group.appendChild(svg('rect', { class: `fill-${status}`, x, y: base, width: barWidth, height, rx: 3 }));
    }
    chart.appendChild(group);
  });
  const last = points.at(-1);
  const summary =
    last === undefined
      ? 'No runs yet.'
      : `Results of the last ${String(points.length)} runs. Latest: ${totalsLabel(last.totals)}.`;
  return el('figure', { class: 'chart-figure', role: 'img', 'aria-label': summary }, chart);
}

/** The run's wall time as an area over the runs. */
export function durationArea(points: readonly RunPoint[]): HTMLElement {
  const chart = chartSvg();
  const max = niceMax(Math.max(0, ...points.map((point) => point.duration)));
  axes(chart, max, formatDuration, points);
  const xOf = (index: number) =>
    points.length === 1 ? PAD.left + INNER_WIDTH / 2 : PAD.left + (INNER_WIDTH * index) / (points.length - 1);
  const yOf = (value: number) => PAD.top + INNER_HEIGHT * (1 - value / max);
  const coords = points.map((point, index) => [xOf(index), yOf(point.duration)] as const);
  const gradient = svg(
    'linearGradient',
    { id: 'duration-fill', x1: 0, x2: 0, y1: 0, y2: 1 },
    svg('stop', { class: 'area-stop-top', offset: '0%' }),
    svg('stop', { class: 'area-stop-bottom', offset: '100%' }),
  );
  chart.appendChild(svg('defs', {}, gradient));
  if (coords.length > 0) {
    const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const firstX = coords[0]?.[0] ?? PAD.left;
    const lastX = coords.at(-1)?.[0] ?? PAD.left;
    const baseY = PAD.top + INNER_HEIGHT;
    if (coords.length > 1) {
      chart.appendChild(
        svg('path', {
          class: 'area-fill',
          d: `${line} L${lastX.toFixed(1)},${String(baseY)} L${firstX.toFixed(1)},${String(baseY)} Z`,
        }),
      );
    }
    chart.appendChild(svg('path', { class: 'area-line', d: line }));
    coords.forEach(([x, y], index) => {
      const point = points[index];
      if (point === undefined) return;
      chart.appendChild(
        svg(
          'circle',
          { class: 'area-dot', cx: x, cy: y, r: 5 },
          svgTitle(`${runLabel(point, index)}: ${formatDuration(point.duration)}`),
        ),
      );
    });
  }
  const last = points.at(-1);
  const summary =
    last === undefined
      ? 'No runs yet.'
      : `Duration of the last ${String(points.length)} runs. Latest: ${formatDuration(last.duration)}.`;
  return el('figure', { class: 'chart-figure', role: 'img', 'aria-label': summary }, chart);
}

/** A test's last results as dots, oldest first, each with its icon. */
export function historyDots(history: readonly Status[]): HTMLElement {
  const label =
    history.length === 0
      ? 'No earlier results'
      : `Last ${plural(history.length, 'result')}, oldest first: ${history.join(', ')}`;
  const list = el('ol', { class: 'history-dots', 'aria-label': label });
  history.forEach((status, index) => {
    const ago = history.length - 1 - index;
    list.appendChild(
      el(
        'li',
        {
          class: `history-dot fill-${status}${ago === 0 ? ' history-dot-latest' : ''}`,
          title: `${ago === 0 ? 'This run' : `${plural(ago, 'run')} ago`}: ${STATUS_WORD[status]}`,
        },
        statusIcon(status, 'dot-icon'),
        el('span', { class: 'sr-only', text: STATUS_WORD[status] }),
      ),
    );
  });
  return list;
}
