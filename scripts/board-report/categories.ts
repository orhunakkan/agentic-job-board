// Failure categories (PLAN.md Phase 14 task 4): every failed or broken test falls in exactly one, and each has its
// own colour in the report.
import type { TestResult } from './result-schema.ts';

export const CATEGORIES = [
  { id: 'accessibility', title: 'Accessibility violations' },
  { id: 'thresholds', title: 'Missed thresholds (k6, coverage)' },
  { id: 'static', title: 'Static-check findings' },
  { id: 'timeouts', title: 'Timeouts' },
  { id: 'assertions', title: 'Assertion failures' },
  { id: 'crashes', title: 'Crashes (broken tests)' },
] as const;

export type Category = (typeof CATEGORIES)[number]['id'];

// Vitest "Test timed out in 5000ms", Playwright "Test timeout of 30000ms exceeded" and "Timeout 10000ms exceeded",
// Cucumber "function timed out". Not the "Timeout: 5000ms" line every failed Playwright expect prints.
const TIMEOUT = /\btimed out\b|\btimeout (?:of )?\d+\s?ms exceeded/i;

/** The category of a failed or broken result; null for a result that passed or was skipped. */
export function categoryOf(result: Pick<TestResult, 'status' | 'error' | 'labels'>): Category | null {
  if (result.status === 'passed' || result.status === 'skipped') return null;
  const type = result.labels.testType;
  if (type === 'accessibility') return 'accessibility';
  if (type === 'performance' || type === 'coverage') return 'thresholds';
  if (type === 'static') return 'static';
  if (TIMEOUT.test(result.error?.message ?? '')) return 'timeouts';
  return result.status === 'failed' ? 'assertions' : 'crashes';
}
