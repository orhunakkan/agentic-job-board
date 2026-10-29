import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from '@playwright/test';

// NFR-06: the WCAG 2.2 AA rules every page is checked against (PLAN.md §8.1 type 9).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

export async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // board-report shows the full results of every page checked (PLAN.md Phase 14 task 9).
  await test
    .info()
    .attach(`axe results: ${page.url()}`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary).toEqual([]);
}
