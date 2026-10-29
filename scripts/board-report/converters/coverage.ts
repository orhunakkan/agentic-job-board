// Turns coverage/coverage-summary.json into results (PLAN.md Phase 14 task 3, §8.3): one per line-coverage
// threshold of vitest.config.ts, with the measured percentage as a parameter and the summary attached.
import { z } from 'zod';
import { repoPath } from '../target.ts';
import { converted, plainDraft, type Converted } from './write.ts';

const Metric = z.object({ total: z.number(), covered: z.number(), pct: z.union([z.number(), z.string()]) });
const Summary = z.record(z.string(), z.object({ lines: Metric }));

/** The `thresholds` of vitest.config.ts: a global `lines`, and `{ lines }` per glob. */
const Thresholds = z.record(
  z.string(),
  z.union([z.number(), z.object({ lines: z.number().optional() }).loose(), z.unknown()]),
);

export interface Threshold {
  /** null for the threshold over every covered file. */
  glob: string | null;
  lines: number;
}

export function thresholdsOf(config: unknown): Threshold[] {
  const thresholds = Thresholds.parse(config ?? {});
  return Object.entries(thresholds).flatMap(([key, value]): Threshold[] => {
    if (key === 'lines' && typeof value === 'number') return [{ glob: null, lines: value }];
    const lines = z.object({ lines: z.number() }).safeParse(value);
    return lines.success && key.includes('/') ? [{ glob: key, lines: lines.data.lines }] : [];
  });
}

/** A coverage glob such as src/domain/**\/*.ts as a regular expression. */
export function globPattern(glob: string): RegExp {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (glob.startsWith('**/', index)) {
      pattern += '(?:.*/)?';
      index += 2;
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

function percent(covered: number, total: number): number {
  return total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100;
}

export function convertCoverage(
  summaryText: string,
  thresholds: readonly Threshold[],
  root: string,
  time: number,
): Converted[] {
  const summary = Summary.parse(JSON.parse(summaryText));
  const files = Object.entries(summary)
    .filter(([key]) => key !== 'total')
    .map(([path, metrics]) => ({ path: repoPath(path, root), lines: metrics.lines }));
  return thresholds.map((threshold) => {
    const pattern = threshold.glob === null ? null : globPattern(threshold.glob);
    const matched = pattern === null ? files : files.filter((file) => pattern.test(file.path));
    const covered = matched.reduce((sum, file) => sum + file.lines.covered, 0);
    const total = matched.reduce((sum, file) => sum + file.lines.total, 0);
    const measured = percent(covered, total);
    const area = threshold.glob ?? 'every covered file';
    const met = measured >= threshold.lines;
    return converted(
      plainDraft({
        name: `Lines in ${area} ≥ ${String(threshold.lines)} %`,
        suites: ['Coverage thresholds'],
        status: met ? 'passed' : 'failed',
        start: time,
        stop: time,
        error: met
          ? null
          : {
              message: `line coverage of ${area} is ${String(measured)} %, below the threshold of ${String(threshold.lines)} %`,
              expected: `≥ ${String(threshold.lines)} %`,
              actual: `${String(measured)} %`,
              stack: null,
            },
        parameters: [
          { name: 'measured', value: `${String(measured)} %` },
          { name: 'threshold', value: `${String(threshold.lines)} %` },
          { name: 'lines covered', value: `${String(covered)} of ${String(total)}` },
          { name: 'files', value: String(matched.length) },
        ],
        testType: 'coverage',
      }),
      [{ name: 'coverage summary', type: 'application/json', body: summaryText }],
    );
  });
}
