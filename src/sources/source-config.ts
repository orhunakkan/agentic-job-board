import { z } from 'zod';

// data/sources.json (PLAN.md Phase 10, FR-15): which free feeds scripts/fetch-sources.ts reads and which of their
// jobs it keeps. It lives in the git-ignored data/ because the watchlist says where the owner wants to work;
// sources.example.json is the committed starting point. Objects are strict, so a typo fails loudly.

export class SourcesConfigError extends Error {
  override name = 'SourcesConfigError';
}

const Term = z.string().trim().min(1).max(100);
const Terms = z.array(Term).max(100);

// A company's name on its job board, as it appears in the board's URL (boards.greenhouse.io/<slug>). Only these
// characters, so a slug can never change which host or path the script asks for.
const Slug = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'must be the company name from its job board URL');
const Slugs = z.array(Slug).max(300).default([]);

export const SourcesConfigSchema = z.strictObject({
  /** A job is kept when its title contains one of these, as whole words, ignoring case. */
  keywords: Terms.min(1),
  /** …and none of these. */
  excludeKeywords: Terms.default([]),
  /** …and its location contains one of these, or it has no location. Empty: any location. */
  locations: Terms.default([]),
  /** Company job boards to read in full; one request per company. */
  companies: z
    .strictObject({
      greenhouse: Slugs,
      lever: Slugs,
      ashby: Slugs,
      smartrecruiters: Slugs,
      workable: Slugs,
    })
    .default({ greenhouse: [], lever: [], ashby: [], smartrecruiters: [], workable: [] }),
  /** Feeds across many companies. Adzuna also needs ADZUNA_APP_ID and ADZUNA_APP_KEY (a free key) in .env. */
  feeds: z
    .strictObject({
      remoteok: z.boolean().default(true),
      himalayas: z.boolean().default(true),
      jobicy: z.boolean().default(true),
      hackernews: z.boolean().default(true),
      adzuna: z.boolean().default(true),
    })
    .default({ remoteok: true, himalayas: true, jobicy: true, hackernews: true, adzuna: true }),
});

export type SourcesConfig = z.infer<typeof SourcesConfigSchema>;

export function parseSourcesConfig(json: string, path: string): SourcesConfig {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SourcesConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = SourcesConfigSchema.safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new SourcesConfigError(`${path} is not a valid sources file:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
