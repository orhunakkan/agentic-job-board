// Turns `k6 run --summary-export` into results (test type 10, PLAN.md Phase 14 task 3): one per threshold of
// tests/perf/load.ts with the measured values as parameters, one per check with its pass rate, the k6 groups as
// suites, and the summary attached. In the export a threshold's `true` means it was crossed (checked with k6 2.2.0).
import { z } from 'zod';
import { converted, plainDraft, type Converted } from './write.ts';

const MetricSchema = z
  .record(z.string(), z.unknown())
  .and(z.object({ thresholds: z.record(z.string(), z.boolean()).optional() }));

interface Group {
  name: string;
  groups: Record<string, Group>;
  checks: Record<string, { name: string; passes: number; fails: number }>;
}
const GroupSchema: z.ZodType<Group> = z.lazy(() =>
  z.object({
    name: z.string(),
    groups: z.record(z.string(), GroupSchema),
    checks: z.record(z.string(), z.object({ name: z.string(), passes: z.number(), fails: z.number() })),
  }),
);

const Export = z.object({ metrics: z.record(z.string(), MetricSchema), root_group: GroupSchema });

/** The values worth showing for a metric: its percentiles and averages in ms, or its rate. */
function measured(metric: Record<string, unknown>): { name: string; value: string }[] {
  return Object.entries(metric)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, value]) => ({ name, value: formatValue(name, value) }));
}

/** A rate to four decimals; any other value as it is when whole, else to two decimals. */
function formatValue(name: string, value: number): string {
  if (name === 'value' || name === 'rate') return String(Math.round(value * 10_000) / 10_000);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

export function convertK6(summaryText: string, start: number, stop: number): Converted[] {
  const summary = Export.parse(JSON.parse(summaryText));
  const attachment = [{ name: 'k6 summary', type: 'application/json', body: summaryText }];
  const thresholds = Object.entries(summary.metrics).flatMap(([metric, values]) =>
    Object.entries(values.thresholds ?? {}).map(([rule, crossed]) => {
      const name = `NFR-05: ${metric} ${rule}`;
      const shown = measured(values);
      return converted(
        plainDraft({
          name,
          suites: ['k6 thresholds'],
          status: crossed ? 'failed' : 'passed',
          start,
          stop,
          error: crossed
            ? {
                message: `the k6 threshold ${metric} ${rule} was crossed`,
                expected: rule,
                actual: shown.map(({ name: key, value }) => `${key}=${value}`).join(', '),
                stack: null,
              }
            : null,
          parameters: shown,
          testType: 'performance',
        }),
        attachment,
      );
    }),
  );

  const checks: Converted[] = [];
  const walk = (group: Group, path: string[]): void => {
    for (const check of Object.values(group.checks)) {
      const runs = check.passes + check.fails;
      const rate = runs === 0 ? 1 : check.passes / runs;
      checks.push(
        converted(
          plainDraft({
            name: `check: ${check.name}`,
            suites: ['k6 checks', ...path],
            status: check.fails === 0 ? 'passed' : 'failed',
            start,
            stop,
            error:
              check.fails === 0
                ? null
                : {
                    message: `${String(check.fails)} of ${String(runs)} runs failed the check`,
                    expected: '100 %',
                    actual: `${(rate * 100).toFixed(2)} %`,
                    stack: null,
                  },
            parameters: [
              { name: 'passes', value: String(check.passes) },
              { name: 'fails', value: String(check.fails) },
              { name: 'pass rate', value: `${(rate * 100).toFixed(2)} %` },
            ],
            testType: 'performance',
          }),
        ),
      );
    }
    for (const child of Object.values(group.groups)) walk(child, [...path, child.name]);
  };
  walk(summary.root_group, []);
  return [...thresholds, ...checks];
}
