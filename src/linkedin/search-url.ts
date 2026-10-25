import type { Workplace } from '../domain/workplace.ts';
import type {
  ExperienceLevel,
  JobType,
  LinkedInSearch,
  PostedWithin,
  SalaryBracket,
  SearchSort,
} from './search-config.ts';

// One LinkedIn search and page → its search-page URL (PLAN.md Phase 11 task 2, FR-18). Pure, and it only ever builds
// https://www.linkedin.com/jobs/search/ URLs: every value goes into the query string, encoded. The parameter codes
// were checked against the live search page's filter bar on 2026-10-24 (each value's label, e.g. f_WT=3 "Hybrid").

export const SEARCH_PAGE_URL = 'https://www.linkedin.com/jobs/search/';
/** Jobs on one search page; `start` moves in steps of this. */
export const SEARCH_PAGE_SIZE = 25;

const HOUR = 3600;
const DAY = 24 * HOUR;
/** `since-last-run` on the first run, when no earlier run searched LinkedIn. */
export const FIRST_RUN_WINDOW_SECONDS = 7 * DAY;
/** Added to `since-last-run`, so a job posted while the last run was going is not missed. */
export const OVERLAP_SECONDS = HOUR;
export const MAX_WINDOW_SECONDS = 30 * DAY;

const PRESET_SECONDS = { day: DAY, week: 7 * DAY, month: MAX_WINDOW_SECONDS } as const;

const WORKPLACE_CODES: Readonly<Record<Workplace, string>> = { 'on-site': '1', remote: '2', hybrid: '3' };
const EXPERIENCE_CODES: Readonly<Record<ExperienceLevel, string>> = {
  internship: '1',
  entry: '2',
  associate: '3',
  'mid-senior': '4',
  director: '5',
  executive: '6',
};
const JOB_TYPE_CODES: Readonly<Record<JobType, string>> = {
  'full-time': 'F',
  'part-time': 'P',
  contract: 'C',
  temporary: 'T',
  internship: 'I',
};
const SALARY_CODES: Readonly<Record<SalaryBracket, string>> = {
  40_000: '1',
  60_000: '2',
  80_000: '3',
  100_000: '4',
  120_000: '5',
  140_000: '6',
  160_000: '7',
  180_000: '8',
  200_000: '9',
};
const SORT_CODES: Readonly<Record<SearchSort, string>> = { recent: 'DD', relevant: 'R' };

/**
 * How far back a search looks, in seconds. `since-last-run` covers the time since the last run that searched
 * LinkedIn plus an hour of overlap, at least that hour and at most a month; the first run covers a week.
 */
export function windowSeconds(postedWithin: PostedWithin, lastSearchAt: string | null, now: string): number {
  if (typeof postedWithin === 'number') return postedWithin * HOUR;
  if (postedWithin !== 'since-last-run') return PRESET_SECONDS[postedWithin];
  if (lastSearchAt === null) return FIRST_RUN_WINDOW_SECONDS;
  const elapsed = Math.ceil((Date.parse(now) - Date.parse(lastSearchAt)) / 1000);
  return Math.min(Math.max(elapsed, 0) + OVERLAP_SECONDS, MAX_WINDOW_SECONDS);
}

/** The URL of one page (0 is the first) of a search, limited to jobs posted in the last `window` seconds. */
export function searchUrl(search: LinkedInSearch, page: number, window: number): string {
  const params = new URLSearchParams({ keywords: search.keywords });
  if (search.location !== null) params.set('location', search.location);
  if (search.distanceMiles !== null) params.set('distance', String(search.distanceMiles));
  params.set('f_TPR', `r${String(window)}`);
  setList(
    params,
    'f_WT',
    search.workplace.map((workplace) => WORKPLACE_CODES[workplace]),
  );
  setList(
    params,
    'f_E',
    search.experience.map((level) => EXPERIENCE_CODES[level]),
  );
  setList(
    params,
    'f_JT',
    search.jobType.map((type) => JOB_TYPE_CODES[type]),
  );
  if (search.salaryMin !== null) params.set('f_SB2', SALARY_CODES[search.salaryMin]);
  if (search.easyApply) params.set('f_AL', 'true');
  setList(params, 'f_C', search.companies);
  params.set('sortBy', SORT_CODES[search.sort]);
  if (page > 0) params.set('start', String(page * SEARCH_PAGE_SIZE));
  // URLSearchParams writes a space as "+"; a "+" typed in the keywords is already "%2B", so this changes spaces only.
  return `${SEARCH_PAGE_URL}?${params.toString().replace(/\+/g, '%20')}`;
}

/** LinkedIn takes several values of one filter as a comma-separated list, each value once. */
function setList(params: URLSearchParams, name: string, codes: readonly string[]): void {
  if (codes.length > 0) params.set(name, [...new Set(codes)].join(','));
}
