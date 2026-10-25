import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AppContext } from '../../src/api/context.ts';
import { apiRoutes } from '../../src/api/routes.ts';
import { openDatabase } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createRepositories } from '../../src/db/repositories/index.ts';
import { RUBRICS } from '../../src/domain/score.ts';
import { createRouter } from '../../src/http/router.ts';
import { SearchLinkedInSummarySchema } from '../../src/linkedin/search-summary.ts';
import * as api from '../../src/schemas/api.ts';
import { FetchSourcesSummarySchema } from '../../src/sources/fetch-summary.ts';
import { curlCalls, labeledBlocks, readRepoFile } from '../helpers/markdown.ts';

// The agent↔app contract (PLAN.md Phase 5 task 4 and Phase 11 task 8; FR-06, FR-18, FR-20): every example payload in
// agent/find-jobs.md parses with the schema it is labeled with, and every curl call in it reaches a real API route.

const procedure = readRepoFile('agent/find-jobs.md');
const rubric = readRepoFile('agent/scoring-rubric.md');
const examples = labeledBlocks(procedure, 'contract');

const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  CreateRunResponseSchema: api.CreateRunResponseSchema,
  SearchLinkedInSummarySchema,
  FetchSourcesSummarySchema,
  ScoringQueueResponseSchema: api.ScoringQueueResponseSchema,
  ScoresRequestSchema: api.ScoresRequestSchema,
  ScoresResponseSchema: api.ScoresResponseSchema,
  EmptyRequestSchema: api.EmptyRequestSchema,
  RunSummarySchema: api.RunSummarySchema,
};

function example(label: string): unknown {
  const block = examples.find((candidate) => candidate.label === label);
  if (block === undefined) throw new Error(`agent/find-jobs.md has no example labeled ${label}`);
  return JSON.parse(block.code) as unknown;
}

describe('agent/find-jobs.md examples match the API schemas', () => {
  it('FR-20: has an example for every request the agent sends and every answer it reads', () => {
    expect(examples.map((block) => block.label).sort()).toEqual(Object.keys(SCHEMAS).sort());
  });

  it.each(examples.map((block) => [block.label, block] as const))(
    'FR-18: the %s example is valid JSON that the schema accepts',
    (label, block) => {
      expect(block.lang).toBe('json');
      const schema = SCHEMAS[label];
      expect(schema, `unknown schema label ${label}`).toBeDefined();

      const result = schema?.safeParse(JSON.parse(block.code));
      expect(result?.error?.issues ?? []).toEqual([]);
    },
  );

  it('FR-20: the scoring rubric defines exactly the rubrics the app hands out, and the example uses one', () => {
    const versions = [...rubric.matchAll(/\*\*Rubric version: `([^`]+)`\*\*/g)].map((match) => match[1]);
    const { rubricVersion } = api.ScoresRequestSchema.parse(example('ScoresRequestSchema'));

    expect(versions.sort()).toEqual([...RUBRICS].sort());
    expect(versions).toContain(rubricVersion);
  });

  it('FR-20: the queue example shows a job to score on its description and one to score on its title', () => {
    const { items } = api.ScoringQueueResponseSchema.parse(example('ScoringQueueResponseSchema'));

    expect(items.map((item) => [item.rubric, item.description === null])).toEqual([
      ['match-v1', false],
      ['triage-v1', true],
    ]);
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

  it('FR-18: the procedure has a curl call for each step, and none for the retired email ingest', () => {
    const routes = calls.map((call) => `${call.method} ${new URL(call.path).pathname}`);

    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /api/health',
        'POST /api/runs',
        'GET /api/profile',
        'GET /api/scoring/queue',
        'POST /api/runs/7/scores',
        'POST /api/runs/7/finish',
      ]),
    );
    expect(routes.filter((route) => route.includes('/emails') || route.includes('/ingest/state'))).toEqual([]);
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
