import { z } from 'zod';
import { TABS } from '../domain/board-tabs.ts';
import { ORIGINS } from '../domain/job-source.ts';
import { STATUSES } from '../domain/status.ts';
import { IdParamSchema, intString } from './api.ts';

// Query strings and form posts of the HTML pages (PLAN.md §6.2), validated like every other input (NFR-09).
// Page queries drop unknown keys, so a stray parameter in a bookmarked URL still opens the page; form bodies
// are strict, because only our own forms post them.

export const BOARD_SORTS = ['score', 'recent', 'changed'] as const;

export const BoardQuerySchema = z.object({
  origin: z.enum(ORIGINS).default('linkedin'),
  tab: z.enum(TABS).default('new'),
  minScore: intString(0, 100).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(BOARD_SORTS).optional(),
  page: intString(1, 100_000).default(1),
  changed: IdParamSchema.optional(), // the job a form just moved, for the notice
  cleared: intString(0, Number.MAX_SAFE_INTEGER).optional(), // how many jobs Clear All just dismissed (FR-21)
});

export const JobPageQuerySchema = z.object({
  changed: IdParamSchema.optional(),
  notes: z.literal('saved').optional(),
});

/** The profile page: `saved=yes` once, after the form saved it (FR-01). */
export const ProfilePageQuerySchema = z.object({
  saved: z.literal('yes').optional(),
});

export const StatusFormSchema = z.strictObject({
  status: z.enum(STATUSES),
  return: z.string().max(2000).optional(),
});

/** Clear All (FR-21) and Find Now (FR-22): the view of the board they act on. */
export const BoardActionFormSchema = z.strictObject({
  origin: z.enum(ORIGINS),
});

/** The header's light/dark toggle (FR-23, DEC-061): the theme to switch to, and the page to come back to. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const ThemeFormSchema = z.strictObject({
  theme: z.enum(THEMES),
  return: z.string().max(2000).optional(),
});

export const NotesFormSchema = z.strictObject({
  // Browsers send textarea line breaks as CRLF; store plain LF so the 5,000-character limit counts characters.
  notes: z
    .string()
    .transform((text) => text.replace(/\r\n?/g, '\n'))
    .pipe(z.string().max(5000, 'must be at most 5,000 characters')),
});

/** Form fields and query values left empty ("Any" in a select) mean "not set". */
export function withoutEmpty(values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

/**
 * Where a form may send the browser back to: a path on this site only. Anything else (another origin,
 * "//evil.example", a backslash trick) falls back, so a crafted form can't turn the app into an open redirect.
 */
export function safeReturnPath(value: string | undefined, fallback: string): string {
  if (value === undefined || !/^\/(?![/\\])[^\s\\]*$/.test(value)) return fallback;
  const url = new URL(value, 'http://app.invalid');
  // Dot segments can collapse into "//": "/.//evil.example" parses to the path "//evil.example".
  if (url.origin !== 'http://app.invalid' || /^\/[/\\]/.test(url.pathname)) return fallback;
  return `${url.pathname}${url.search}`;
}
