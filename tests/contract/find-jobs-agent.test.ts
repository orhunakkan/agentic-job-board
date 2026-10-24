import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AppContext } from '../../src/api/context.ts';
import { apiRoutes } from '../../src/api/routes.ts';
import { openDatabase } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createRepositories } from '../../src/db/repositories/index.ts';
import { createRouter } from '../../src/http/router.ts';
import { parseAlertEmail } from '../../src/ingest/linkedin-email-parser.ts';
import * as api from '../../src/schemas/api.ts';
import { FetchSourcesSummarySchema } from '../../src/sources/fetch-summary.ts';
import { curlCalls, labeledBlocks, readRepoFile } from '../helpers/markdown.ts';

// The agent↔app contract (PLAN.md Phase 5 task 4, FR-02, FR-06): every example payload in agent/find-jobs.md
// parses with the schema it is labeled with, and every curl call in it reaches a real API route.

const procedure = readRepoFile('agent/find-jobs.md');
const examples = labeledBlocks(procedure, 'contract');

const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  CreateRunResponseSchema: api.CreateRunResponseSchema,
  IngestEmailsRequestSchema: api.IngestEmailsRequestSchema,
  IngestEmailsResponseSchema: api.IngestEmailsResponseSchema,
  ScoresRequestSchema: api.ScoresRequestSchema,
  ScoresResponseSchema: api.ScoresResponseSchema,
  EmptyRequestSchema: api.EmptyRequestSchema,
  RunSummarySchema: api.RunSummarySchema,
  FetchSourcesSummarySchema,
};

function example(label: string): unknown {
  const block = examples.find((candidate) => candidate.label === label);
  if (block === undefined) throw new Error(`agent/find-jobs.md has no example labeled ${label}`);
  return JSON.parse(block.code) as unknown;
}

describe('agent/find-jobs.md examples match the API schemas', () => {
  it('FR-02: has an example for every request the agent sends', () => {
    expect(examples.map((block) => block.label)).toEqual(
      expect.arrayContaining(['IngestEmailsRequestSchema', 'ScoresRequestSchema', 'EmptyRequestSchema']),
    );
  });

  it.each(examples.map((block) => [block.label, block] as const))(
    'FR-02: the %s example is valid JSON that the schema accepts',
    (label, block) => {
      expect(block.lang).toBe('json');
      const schema = SCHEMAS[label];
      expect(schema, `unknown schema label ${label}`).toBeDefined();

      const result = schema?.safeParse(JSON.parse(block.code));
      expect(result?.error?.issues ?? []).toEqual([]);
    },
  );

  it('FR-03: the example email is one the parser reads, with every job in it', () => {
    const { emails } = api.IngestEmailsRequestSchema.parse(example('IngestEmailsRequestSchema'));

    for (const email of emails) {
      const parsed = parseAlertEmail(email);
      expect(parsed).not.toHaveProperty('unrecognized');
      expect('jobs' in parsed ? parsed.jobs.length : 0).toBeGreaterThan(0);
    }
  });

  it('FR-06: the example scores use the rubric version of agent/scoring-rubric.md', () => {
    const version = /\*\*Rubric version: `([^`]+)`\*\*/.exec(readRepoFile('agent/scoring-rubric.md'))?.[1];
    const { rubricVersion } = api.ScoresRequestSchema.parse(example('ScoresRequestSchema'));

    expect(version).toBeDefined();
    expect(rubricVersion).toBe(version);
  });

  it('NFR-08: the example payloads keep no URL query string (safety rule 5, DEC-027)', () => {
    const urls = examples.flatMap((block) => block.code.match(/https?:\/\/[^\s"\\]+/g) ?? []);

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => url.includes('?'))).toEqual([]);
  });
});

describe('agent/find-jobs.md calls only real API routes', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  const context: AppContext = {
    db,
    repos: createRepositories(db),
    now: () => '',
    version: 'test',
    linkedinSessionPath: 'no-session.json',
  };
  const match = createRouter(apiRoutes(context));
  const calls = curlCalls(procedure);

  it('FR-02: the procedure has a curl call for each step of PLAN.md §4.1', () => {
    expect(calls.map((call) => `${call.method} ${new URL(call.path).pathname}`)).toEqual(
      expect.arrayContaining([
        'GET /api/health',
        'GET /api/ingest/state',
        'POST /api/runs',
        'POST /api/runs/7/emails',
        'GET /api/profile',
        'GET /api/jobs',
        'POST /api/runs/7/scores',
        'POST /api/runs/7/finish',
      ]),
    );
  });

  it.each(calls.map((call) => [`${call.method} ${call.path}`, call] as const))('NFR-01: %s', (_name, call) => {
    const url = new URL(call.path);

    expect(url.origin).toBe('http://127.0.0.1:3000');
    expect(match(call.method, url.pathname).kind).toBe('found');
    if (call.method !== 'GET') {
      // Writes send JSON from a file under the git-ignored data/ folder, or an empty object inline.
      expect(call.dataFile === null || call.dataFile.startsWith('data/find-jobs/')).toBe(true);
    }
  });
});
