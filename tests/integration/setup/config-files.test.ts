import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linkedInSearchesStatus, sourcesStatus } from '../../../src/setup/config-files.ts';

// Setup reads the two files with the parsers the scripts use (FR-24, DEC-066), from real temporary files.

const EXAMPLE_SEARCHES = readFileSync(new URL('../../../linkedin-searches.example.json', import.meta.url), 'utf8');
const EXAMPLE_SOURCES = readFileSync(new URL('../../../sources.example.json', import.meta.url), 'utf8');

const NOTHING_ON = {
  keywords: ['dispatcher'],
  feeds: { remoteok: false, himalayas: false, jobicy: false, hackernews: false, adzuna: false },
};

describe('the setup status of the two files', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobboard-setup-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function file(name: string, text: string): string {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  }

  describe('LinkedIn searches', () => {
    it('FR-24: a file that is not there is missing', () => {
      expect(linkedInSearchesStatus(join(dir, 'linkedin-searches.json'))).toBe('missing');
    });

    it('FR-24: the committed example is ready', () => {
      expect(linkedInSearchesStatus(file('searches.json', EXAMPLE_SEARCHES))).toBe('ready');
    });

    it.each([
      ['not JSON', '{ searches: '],
      ['no searches', '{ "searches": [] }'],
      ['a typo in an option', '{ "searches": [{ "name": "a", "keywords": "b", "workplaces": ["remote"] }] }'],
    ])('FR-24: a file with %s is invalid', (_case, text) => {
      expect(linkedInSearchesStatus(file('searches.json', text))).toBe('invalid');
    });

    it('FR-24: a folder in place of the file is invalid', () => {
      expect(linkedInSearchesStatus(dir)).toBe('invalid');
    });
  });

  describe('feeds', () => {
    it('FR-24: a file that is not there is missing', () => {
      expect(sourcesStatus(join(dir, 'sources.json'))).toBe('missing');
    });

    it('FR-24: the committed example is ready', () => {
      expect(sourcesStatus(file('sources.json', EXAMPLE_SOURCES))).toBe('ready');
    });

    it('FR-24: a file with only its keywords is ready, since every feed is on by default', () => {
      expect(sourcesStatus(file('sources.json', '{ "keywords": ["dispatcher"] }'))).toBe('ready');
    });

    it('FR-24: a file with one company board and every feed off is ready', () => {
      const config = { ...NOTHING_ON, companies: { greenhouse: ['examplefreight'] } };

      expect(sourcesStatus(file('sources.json', JSON.stringify(config)))).toBe('ready');
    });

    it('FR-24: a valid file with every feed off and no company board is not ready (invalid)', () => {
      expect(sourcesStatus(file('sources.json', JSON.stringify(NOTHING_ON)))).toBe('invalid');
    });

    it.each([
      ['not JSON', 'nope'],
      ['no keywords', '{ "keywords": [] }'],
      ['an unknown feed', '{ "keywords": ["a"], "feeds": { "monster": true } }'],
    ])('FR-24: a file with %s is invalid', (_case, text) => {
      expect(sourcesStatus(file('sources.json', text))).toBe('invalid');
    });
  });
});
