import { defineParameterType } from '@cucumber/cucumber';
import type { Tab } from '../../../src/domain/board-tabs.ts';
import type { Origin } from '../../../src/domain/job-source.ts';
import type { Status } from '../../../src/domain/status.ts';

// The board's own words in a step (PLAN.md §8.5): statuses, tabs and views as the board labels them, lists of job
// titles, and counts written the way a reader writes them ("5,000").

const STATUSES: Readonly<Record<string, Status>> = {
  New: 'new',
  Saved: 'saved',
  Applied: 'applied',
  Interviewing: 'interviewing',
  Offer: 'offer',
  Rejected: 'rejected',
  Dismissed: 'dismissed',
};

const TABS: Readonly<Record<string, Tab>> = {
  New: 'new',
  Saved: 'saved',
  'In progress': 'in-progress',
  Closed: 'closed',
  Dismissed: 'dismissed',
};

const VIEWS: Readonly<Record<string, Origin>> = { LinkedIn: 'linkedin', 'Other sources': 'other' };

function named<T>(names: Readonly<Record<string, T>>, kind: string) {
  return (name: string): T => {
    const value = names[name];
    if (value === undefined) throw new Error(`"${name}" is not a ${kind}; use one of ${Object.keys(names).join(', ')}`);
    return value;
  };
}

export const statusNamed = named(STATUSES, 'status');
export const tabNamed = named(TABS, 'tab');
export const viewNamed = named(VIEWS, 'view');

defineParameterType({
  name: 'status',
  regexp: /New|Saved|Applied|Interviewing|Offer|Rejected|Dismissed/,
  transformer: statusNamed,
});

defineParameterType({
  name: 'tab',
  regexp: /New|Saved|In progress|Closed|Dismissed/,
  transformer: tabNamed,
  // "New", "Saved" and "Dismissed" are statuses too; snippets for new steps use {status}.
  useForSnippets: false,
});

defineParameterType({ name: 'view', regexp: /LinkedIn|Other sources/, transformer: viewNamed });

// "Senior SDET", "QA Lead" and "Test Architect": one or more quoted titles.
defineParameterType({
  name: 'titles',
  regexp: /"[^"]+"(?:(?:, | and )"[^"]+")*/,
  transformer: (text: string): string[] => [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? ''),
  useForSnippets: false,
});

// 5000 or 5,000.
defineParameterType({
  name: 'count',
  regexp: /\d{1,3}(?:,\d{3})+|\d+/,
  transformer: (text: string): number => Number(text.replaceAll(',', '')),
  useForSnippets: false,
});
