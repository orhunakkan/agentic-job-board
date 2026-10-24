// Where a job came from (PLAN.md Phase 10, DEC-035, DEC-036): a LinkedIn alert email, or one of the free public
// job feeds that scripts/fetch-sources.ts reads. The board shows the two origins apart.

/** The public feeds; each listing they give is stored as a job with that source. */
export const LISTING_SOURCES = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'workable',
  'remoteok',
  'himalayas',
  'jobicy',
  'hackernews',
  'adzuna',
] as const;

export const JOB_SOURCES = ['linkedin', ...LISTING_SOURCES] as const;

export type ListingSource = (typeof LISTING_SOURCES)[number];
export type JobSource = (typeof JOB_SOURCES)[number];

/** The two views of the board (FR-17). */
export const ORIGINS = ['linkedin', 'other'] as const;

export type Origin = (typeof ORIGINS)[number];

/** The name each source goes by, as its own site writes it; the feeds' terms ask for it to be shown. */
export const SOURCE_LABELS: Readonly<Record<JobSource, string>> = {
  linkedin: 'LinkedIn',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  remoteok: 'Remote OK',
  himalayas: 'Himalayas',
  jobicy: 'Jobicy',
  hackernews: 'Hacker News',
  adzuna: 'Adzuna',
};

export function originOf(source: JobSource): Origin {
  return source === 'linkedin' ? 'linkedin' : 'other';
}

export function sourcesForOrigin(origin: Origin): readonly JobSource[] {
  return origin === 'linkedin' ? ['linkedin'] : LISTING_SOURCES;
}
