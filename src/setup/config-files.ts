import { readFileSync } from 'node:fs';
import type { FileStatus } from '../domain/setup.ts';
import { parseLinkedInSearchConfig } from '../linkedin/search-config.ts';
import { parseSourcesConfig, type SourcesConfig } from '../sources/source-config.ts';

// Whether data/linkedin-searches.json and data/sources.json are there and valid (FR-24, DEC-066), read with the same
// parsers the scripts use. Only the status leaves this module, never the files' contents. Reading a local file is
// not an outbound request (NFR-03).

export function linkedInSearchesStatus(path: string): FileStatus {
  return fileStatus(path, (json) => {
    parseLinkedInSearchConfig(json, path);
    return true;
  });
}

/** Ready when the file is valid and turns on at least one feed or company board. */
export function sourcesStatus(path: string): FileStatus {
  return fileStatus(path, (json) => anythingOn(parseSourcesConfig(json, path)));
}

function anythingOn(config: SourcesConfig): boolean {
  return Object.values(config.feeds).some(Boolean) || Object.values(config.companies).some((slugs) => slugs.length > 0);
}

function fileStatus(path: string, isReady: (json: string) => boolean): FileStatus {
  let json: string;
  try {
    json = readFileSync(path, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid';
  }
  try {
    return isReady(json) ? 'ready' : 'invalid';
  } catch {
    return 'invalid';
  }
}
