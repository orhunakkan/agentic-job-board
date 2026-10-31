import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LinkedInSearchConfigError,
  parseLinkedInSearchConfig,
  resolveSearches,
} from '../../../src/linkedin/search-config.ts';

const PATH = 'data/linkedin-searches.json';

function config(value: unknown) {
  return parseLinkedInSearchConfig(JSON.stringify(value), PATH);
}

describe('data/linkedin-searches.json', () => {
  it('FR-18: needs only a search with a name and keywords; the rest has defaults', () => {
    const parsed = config({ searches: [{ name: 'SDET', keywords: 'sdet' }] });

    expect(parsed).toEqual({ defaults: {}, excludeKeywords: [], searches: [{ name: 'SDET', keywords: 'sdet' }] });
    expect(resolveSearches(parsed)).toEqual([
      {
        name: 'SDET',
        keywords: 'sdet',
        location: null,
        distanceMiles: null,
        postedWithin: 'since-last-run',
        workplace: [],
        experience: [],
        jobType: [],
        salaryMin: null,
        easyApply: false,
        companies: [],
        sort: 'recent',
        maxPages: 4,
      },
    ]);
  });

  it('FR-18: a search’s own options win over the defaults, and an empty list drops a default filter', () => {
    const parsed = config({
      defaults: { location: 'United States', workplace: ['remote'], maxPages: 2, postedWithin: 'week' },
      searches: [
        { name: 'A', keywords: 'qa' },
        { name: 'B', keywords: 'sdet', workplace: [], maxPages: 10, postedWithin: 36, location: 'Canada' },
      ],
    });

    const [first, second] = resolveSearches(parsed);

    expect(first).toMatchObject({
      location: 'United States',
      workplace: ['remote'],
      maxPages: 2,
      postedWithin: 'week',
    });
    expect(second).toMatchObject({ location: 'Canada', workplace: [], maxPages: 10, postedWithin: 36 });
  });

  it('FR-18: takes every option in the plan’s table', () => {
    const parsed = config({
      excludeKeywords: ['intern'],
      searches: [
        {
          name: 'Everything',
          keywords: '"test automation" OR SDET',
          location: 'United States',
          distanceMiles: 25,
          postedWithin: 'month',
          workplace: ['remote', 'hybrid', 'on-site'],
          experience: ['internship', 'entry', 'associate', 'mid-senior', 'director', 'executive'],
          jobType: ['full-time', 'contract', 'part-time', 'temporary', 'internship'],
          salaryMin: 200000,
          easyApply: true,
          companies: ['1035', '1441'],
          sort: 'relevant',
          maxPages: 1,
        },
      ],
    });

    expect(resolveSearches(parsed)[0]).toMatchObject({ distanceMiles: 25, salaryMin: 200000, easyApply: true });
  });

  it('FR-18: the committed example is a valid searches file', () => {
    const example = readFileSync(new URL('../../../linkedin-searches.example.json', import.meta.url), 'utf8');

    const parsed = parseLinkedInSearchConfig(example, 'linkedin-searches.example.json');

    expect(parsed.searches.length).toBeGreaterThan(1);
    // The defaults' location applies to every search that doesn't name its own.
    expect(resolveSearches(parsed).map((search) => search.location)).toEqual([
      'United States',
      'United States',
      'Chicago, Illinois',
    ]);
  });

  it.each([
    ['not JSON', '{searches:', 'is not valid JSON'],
    ['no searches', '{"searches":[]}', 'searches'],
    ['a typo in a key', '{"searches":[{"name":"A","keywords":"qa","workplaces":["remote"]}]}', 'Unrecognized key'],
    ['a typo in a default', '{"defaults":{"sortBy":"recent"},"searches":[{"name":"A","keywords":"qa"}]}', 'defaults'],
    ['a search without keywords', '{"searches":[{"name":"A"}]}', 'keywords'],
    [
      'two searches with one name',
      '{"searches":[{"name":"A","keywords":"qa"},{"name":"A","keywords":"x"}]}',
      'own name',
    ],
    ['an unknown workplace', '{"searches":[{"name":"A","keywords":"qa","workplace":["office"]}]}', 'workplace'],
    [
      'an unknown experience level',
      '{"searches":[{"name":"A","keywords":"qa","experience":["senior"]}]}',
      'experience',
    ],
    ['an unknown job type', '{"searches":[{"name":"A","keywords":"qa","jobType":["gig"]}]}', 'jobType'],
    ['a salary between brackets', '{"searches":[{"name":"A","keywords":"qa","salaryMin":150000}]}', 'salaryMin'],
    [
      'a distance LinkedIn does not offer',
      '{"searches":[{"name":"A","keywords":"qa","distanceMiles":30}]}',
      'distance',
    ],
    ['an unknown time window', '{"searches":[{"name":"A","keywords":"qa","postedWithin":"year"}]}', 'postedWithin'],
    ['more than 30 days in hours', '{"searches":[{"name":"A","keywords":"qa","postedWithin":721}]}', 'postedWithin'],
    ['zero hours', '{"searches":[{"name":"A","keywords":"qa","postedWithin":0}]}', 'postedWithin'],
    ['more than 10 pages', '{"searches":[{"name":"A","keywords":"qa","maxPages":11}]}', 'maxPages'],
    [
      'a company name instead of an ID',
      '{"searches":[{"name":"A","keywords":"qa","companies":["Microsoft"]}]}',
      'company ID',
    ],
    ['an unknown sort', '{"searches":[{"name":"A","keywords":"qa","sort":"newest"}]}', 'sort'],
    ['keywords on two lines', '{"searches":[{"name":"A","keywords":"qa\\nsdet"}]}', 'one line'],
    ['an empty name', '{"searches":[{"name":" ","keywords":"qa"}]}', 'name'],
  ])('NFR-09: refuses %s, naming the problem', (_case, json, message) => {
    expect(() => parseLinkedInSearchConfig(json, PATH)).toThrow(LinkedInSearchConfigError);
    expect(() => parseLinkedInSearchConfig(json, PATH)).toThrow(message);
  });

  it('NFR-09: the error names the file and every problem on its own line', () => {
    expect(() => config({ searches: [{ name: 'A', keywords: 'qa', maxPages: 0, sort: 'x' }] })).toThrow(
      /^data\/linkedin-searches\.json is not a valid LinkedIn searches file:\n {2}searches\.0\.sort: .+\n {2}searches\.0\.maxPages: /,
    );
  });
});
