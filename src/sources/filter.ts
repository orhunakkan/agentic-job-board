import type { SourcesConfig } from './source-config.ts';

// Which listings are worth sending to the app (FR-15). The feeds carry every kind of job; only titles in the
// owner's target family should reach the board and the scoring.

/** Whether `text` contains one of `terms` as whole words, ignoring case: "qa" matches "Senior QA", not "Qatar". */
export function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => wholeWords(term).test(text));
}

function wholeWords(term: string): RegExp {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

export type FilterRules = Pick<SourcesConfig, 'keywords' | 'excludeKeywords' | 'locations'>;

export function isWanted(listing: { title: string; location: string }, rules: FilterRules): boolean {
  if (!containsAny(listing.title, rules.keywords)) return false;
  if (containsAny(listing.title, rules.excludeKeywords)) return false;
  return rules.locations.length === 0 || listing.location === '' || containsAny(listing.location, rules.locations);
}
