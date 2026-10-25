// Where a job is done (PLAN.md Phase 11, FR-19): LinkedIn's job page says remote, hybrid or on-site. Other sources
// rarely say, so a job's workplace is often unknown (null).

export const WORKPLACES = ['remote', 'hybrid', 'on-site'] as const;

export type Workplace = (typeof WORKPLACES)[number];

export const WORKPLACE_LABELS: Readonly<Record<Workplace, string>> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  'on-site': 'On-site',
};

/** "Remote", "Hybrid", "On-site" or "Onsite" as LinkedIn writes them, ignoring case; null for anything else. */
export function parseWorkplace(text: string): Workplace | null {
  const word = text.trim().toLowerCase().replace(/[\s-]/g, '');
  if (word === 'remote') return 'remote';
  if (word === 'hybrid') return 'hybrid';
  if (word === 'onsite') return 'on-site';
  return null;
}
