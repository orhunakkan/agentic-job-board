import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLinkedInSearchConfig } from '../../src/linkedin/search-config.ts';
import { linkedInSearchesStatus, sourcesStatus } from '../../src/setup/config-files.ts';
import { parseSourcesConfig } from '../../src/sources/source-config.ts';

// The committed starting points for data/linkedin-searches.json and data/sources.json (FR-15, FR-18, FR-24): they
// parse with the same schemas the scripts and setup use, and they are one made-up user's choices, not a default
// line of work. The example turns on only the feeds that carry jobs from every field (DEC-067).

const SEARCHES = fileURLToPath(new URL('../../linkedin-searches.example.json', import.meta.url));
const SOURCES = fileURLToPath(new URL('../../sources.example.json', import.meta.url));

describe('the example configs', () => {
  it('FR-18, FR-24: the LinkedIn searches example parses with the real schema and counts as ready for setup', () => {
    const config = parseLinkedInSearchConfig(readFileSync(SEARCHES, 'utf8'), 'linkedin-searches.example.json');

    expect(config.searches.length).toBeGreaterThan(1);
    expect(linkedInSearchesStatus(SEARCHES)).toBe('ready');
  });

  it('FR-15, FR-24: the feeds example parses with the real schema and counts as ready for setup', () => {
    const config = parseSourcesConfig(readFileSync(SOURCES, 'utf8'), 'sources.example.json');

    expect(config.keywords.length).toBeGreaterThan(0);
    expect(sourcesStatus(SOURCES)).toBe('ready');
  });

  it('FR-15: the feeds example turns on Adzuna and company boards, and leaves off the four feeds of mostly tech jobs', () => {
    const config = parseSourcesConfig(readFileSync(SOURCES, 'utf8'), 'sources.example.json');

    expect(config.feeds).toEqual({ remoteok: false, himalayas: false, jobicy: false, hackernews: false, adzuna: true });
    expect(Object.values(config.companies).flat().length).toBeGreaterThan(0);
  });

  it('FR-15, FR-18: both examples are written for one made-up accountant', () => {
    const searches = parseLinkedInSearchConfig(readFileSync(SEARCHES, 'utf8'), 'linkedin-searches.example.json');
    const sources = parseSourcesConfig(readFileSync(SOURCES, 'utf8'), 'sources.example.json');

    expect(searches.searches.every((search) => /accountant|accounting/i.test(search.keywords))).toBe(true);
    expect(sources.keywords).toContain('accountant');
  });
});
