import { z } from 'zod';
import { WORKPLACES, type Workplace } from '../domain/workplace.ts';

// data/linkedin-searches.json (PLAN.md Phase 11, FR-18, DEC-042): the owner's LinkedIn searches, with readable
// option names that src/linkedin/search-url.ts maps to LinkedIn's URL parameters. It lives in the git-ignored data/
// because it says what the owner is looking for; linkedin-searches.example.json is the committed starting point.
// Objects are strict, so a typo fails loudly.

export class LinkedInSearchConfigError extends Error {
  override name = 'LinkedInSearchConfigError';
}

export const POSTED_WITHIN_PRESETS = ['since-last-run', 'day', 'week', 'month'] as const;
export const EXPERIENCE_LEVELS = ['internship', 'entry', 'associate', 'mid-senior', 'director', 'executive'] as const;
export const JOB_TYPES = ['full-time', 'contract', 'part-time', 'temporary', 'internship'] as const;
/** LinkedIn's salary brackets: "$40,000+" to "$200,000+". */
export const SALARY_BRACKETS = [40_000, 60_000, 80_000, 100_000, 120_000, 140_000, 160_000, 180_000, 200_000] as const;
/** The distances LinkedIn's location filter offers, in miles. */
export const DISTANCES = [0, 5, 10, 25, 50, 100] as const;
export const SORTS = ['recent', 'relevant'] as const;
/** A number of hours goes up to 30 days, LinkedIn's longest "posted" window. */
export const MAX_POSTED_WITHIN_HOURS = 720;

export type PostedWithin = (typeof POSTED_WITHIN_PRESETS)[number] | number;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type JobType = (typeof JOB_TYPES)[number];
export type SalaryBracket = (typeof SALARY_BRACKETS)[number];
export type Distance = (typeof DISTANCES)[number];
export type SearchSort = (typeof SORTS)[number];

const OneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\r\n]*$/, 'must be one line');

// An option list may be empty in a search, to drop a filter that `defaults` sets.
const SearchOptionsSchema = z.strictObject({
  location: OneLine(200).optional(),
  distanceMiles: z.literal(DISTANCES).optional(),
  postedWithin: z
    .union([z.enum(POSTED_WITHIN_PRESETS), z.number().int().min(1).max(MAX_POSTED_WITHIN_HOURS)])
    .optional(),
  workplace: z.array(z.enum(WORKPLACES)).max(WORKPLACES.length).optional(),
  experience: z.array(z.enum(EXPERIENCE_LEVELS)).max(EXPERIENCE_LEVELS.length).optional(),
  jobType: z.array(z.enum(JOB_TYPES)).max(JOB_TYPES.length).optional(),
  salaryMin: z.literal(SALARY_BRACKETS).optional(),
  easyApply: z.boolean().optional(),
  /** LinkedIn company IDs, the number in a company filter (f_C=1035 is Microsoft). */
  companies: z
    .array(z.string().regex(/^\d{1,15}$/, 'must be a LinkedIn company ID (digits only)'))
    .max(50)
    .optional(),
  sort: z.enum(SORTS).optional(),
  /** 25 jobs a page. */
  maxPages: z.number().int().min(1).max(10).optional(),
});

const SearchSchema = SearchOptionsSchema.extend({
  /** A label, stored on each sighting of a job this search finds. */
  name: OneLine(100),
  /** Free text as typed into LinkedIn's search box; LinkedIn reads OR and "quoted phrases". */
  keywords: OneLine(500),
});

export const LinkedInSearchConfigSchema = z.strictObject({
  /** Options every search starts from; a search's own options win. */
  defaults: SearchOptionsSchema.default({}),
  /** A job is dropped when its title contains one of these as whole words, ignoring case (as in data/sources.json). */
  excludeKeywords: z.array(OneLine(100)).max(100).default([]),
  searches: z
    .array(SearchSchema)
    .min(1)
    .max(30)
    .refine((searches) => new Set(searches.map((search) => search.name)).size === searches.length, {
      message: 'every search needs its own name',
    }),
});

export type LinkedInSearchConfig = z.infer<typeof LinkedInSearchConfigSchema>;

/** One search with its defaults filled in: what the URL builder and the script work from. */
export interface LinkedInSearch {
  name: string;
  keywords: string;
  location: string | null;
  distanceMiles: Distance | null;
  postedWithin: PostedWithin;
  workplace: readonly Workplace[];
  experience: readonly ExperienceLevel[];
  jobType: readonly JobType[];
  salaryMin: SalaryBracket | null;
  easyApply: boolean;
  companies: readonly string[];
  sort: SearchSort;
  maxPages: number;
}

export const DEFAULT_MAX_PAGES = 4;

export function resolveSearches(config: LinkedInSearchConfig): LinkedInSearch[] {
  return config.searches.map((search) => {
    const options = { ...config.defaults, ...search };
    return {
      name: search.name,
      keywords: search.keywords,
      location: options.location ?? null,
      distanceMiles: options.distanceMiles ?? null,
      postedWithin: options.postedWithin ?? 'since-last-run',
      workplace: options.workplace ?? [],
      experience: options.experience ?? [],
      jobType: options.jobType ?? [],
      salaryMin: options.salaryMin ?? null,
      easyApply: options.easyApply ?? false,
      companies: options.companies ?? [],
      sort: options.sort ?? 'recent',
      maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
    };
  });
}

export function parseLinkedInSearchConfig(json: string, path: string): LinkedInSearchConfig {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new LinkedInSearchConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = LinkedInSearchConfigSchema.safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new LinkedInSearchConfigError(`${path} is not a valid LinkedIn searches file:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
