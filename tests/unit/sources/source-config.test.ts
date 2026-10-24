import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSourcesConfig, SourcesConfigError } from '../../../src/sources/source-config.ts';

describe('data/sources.json', () => {
  it('FR-15: needs only keywords; every feed is on and no company is watched by default', () => {
    expect(parseSourcesConfig('{"keywords":["sdet"]}', 'data/sources.json')).toEqual({
      keywords: ['sdet'],
      excludeKeywords: [],
      locations: [],
      companies: { greenhouse: [], lever: [], ashby: [], smartrecruiters: [], workable: [] },
      feeds: { remoteok: true, himalayas: true, jobicy: true, hackernews: true, adzuna: true },
    });
  });

  it('FR-15: the committed example is a valid sources file', () => {
    const example = readFileSync(new URL('../../../sources.example.json', import.meta.url), 'utf8');

    const config = parseSourcesConfig(example, 'sources.example.json');

    expect(config.keywords.length).toBeGreaterThan(0);
    expect(config.companies.greenhouse.length).toBeGreaterThan(0);
  });

  it.each([
    ['not JSON', '{keywords:', 'is not valid JSON'],
    ['no keywords', '{"keywords":[]}', 'keywords'],
    ['a typo in a key', '{"keywords":["qa"],"keyword":["sdet"]}', 'Unrecognized key'],
    ['a feed that does not exist', '{"keywords":["qa"],"feeds":{"monster":true}}', 'feeds'],
  ])('NFR-09: refuses %s, naming the problem', (_case, json, message) => {
    expect(() => parseSourcesConfig(json, 'data/sources.json')).toThrow(SourcesConfigError);
    expect(() => parseSourcesConfig(json, 'data/sources.json')).toThrow(message);
  });

  it.each(['../admin', 'example labs', 'labs/../../x', 'a?b=c', 'https://evil.example', ''])(
    'NFR-03: refuses the company name %j, which could change the URL the script asks for',
    (slug) => {
      const json = JSON.stringify({ keywords: ['qa'], companies: { greenhouse: [slug] } });

      expect(() => parseSourcesConfig(json, 'data/sources.json')).toThrow('must be the company name');
    },
  );
});
