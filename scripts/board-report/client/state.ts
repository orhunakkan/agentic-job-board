// The report's index, with the lookups the views need, built once when the index arrives.
import type { CategoryInfo, ReportIndex, RequirementInfo, TestEntry, TypeInfo } from '../build/data-shape.ts';
import type { Category } from '../categories.ts';
import type { Totals } from '../history.ts';
import type { Status, TestType } from '../result-schema.ts';

export interface Report {
  data: ReportIndex;
  byId: Map<string, TestEntry>;
  typeInfo: Map<TestType, TypeInfo>;
  categoryInfo: Map<Category, CategoryInfo>;
  requirementInfo: Map<string, RequirementInfo>;
  testsByRequirement: Map<string, TestEntry[]>;
  totalsByType: Map<TestType, Totals>;
  /** The types that have tests in this run, in the report's order. */
  presentTypes: TypeInfo[];
  browsers: string[];
  tags: string[];
}

export class ReportNotLoadedError extends Error {
  override name = 'ReportNotLoadedError';
}

let loaded: Report | null = null;

export function emptyTotalsOf(): Totals {
  return { passed: 0, failed: 0, broken: 0, skipped: 0 };
}

export function totalOf(totals: Totals): number {
  return totals.passed + totals.failed + totals.broken + totals.skipped;
}

export function totalsFor(tests: readonly TestEntry[]): Totals {
  const totals = emptyTotalsOf();
  for (const test of tests) totals[test.status] += 1;
  return totals;
}

/** The result a group of tests adds up to: failed, broken, passed, skipped; null without tests. */
export function resultOf(tests: readonly { status: Status }[]): Status | null {
  if (tests.length === 0) return null;
  const has = (status: Status) => tests.some((test) => test.status === status);
  if (has('failed')) return 'failed';
  if (has('broken')) return 'broken';
  if (has('passed')) return 'passed';
  return 'skipped';
}

export function loadReport(data: ReportIndex): Report {
  const byId = new Map<string, TestEntry>();
  const testsByRequirement = new Map<string, TestEntry[]>();
  const totalsByType = new Map<TestType, Totals>();
  const browsers = new Set<string>();
  const tags = new Set<string>();
  for (const test of data.tests) {
    byId.set(test.id, test);
    for (const requirement of test.requirements) {
      const list = testsByRequirement.get(requirement);
      if (list === undefined) testsByRequirement.set(requirement, [test]);
      else list.push(test);
    }
    let totals = totalsByType.get(test.type);
    if (totals === undefined) {
      totals = emptyTotalsOf();
      totalsByType.set(test.type, totals);
    }
    totals[test.status] += 1;
    if (test.browser !== null) browsers.add(test.browser);
    for (const tag of test.tags) tags.add(tag);
  }
  loaded = {
    data,
    byId,
    typeInfo: new Map(data.types.map((type) => [type.id, type])),
    categoryInfo: new Map(data.categories.map((category) => [category.id, category])),
    requirementInfo: new Map(data.requirements.map((requirement) => [requirement.id, requirement])),
    testsByRequirement,
    totalsByType,
    presentTypes: data.types.filter((type) => totalsByType.has(type.id)),
    browsers: [...browsers].sort((left, right) => left.localeCompare(right)),
    tags: [...tags].sort((left, right) => left.localeCompare(right)),
  };
  return loaded;
}

export function report(): Report {
  if (loaded === null) throw new ReportNotLoadedError('the report index has not been loaded');
  return loaded;
}

export function typeTitle(type: TestType): string {
  return report().typeInfo.get(type)?.title ?? type;
}
