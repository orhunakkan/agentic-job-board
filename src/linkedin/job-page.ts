import { z } from 'zod';
import { canonicalizeJobUrl, canonicalJobUrl } from '../domain/linkedin-url.ts';
import { parseWorkplace, type Workplace } from '../domain/workplace.ts';
import type { IncomingListing } from '../ingest/listing-ingest.ts';
import { DESCRIPTION_MAX, IncomingListingSchema } from '../schemas/api.ts';
import { htmlToText, oneLine } from '../sources/html-text.ts';

// What scripts/search-linkedin.ts reads from LinkedIn's pages (PLAN.md Phase 11 task 3, FR-18, FR-19). The script
// copies text out of a search card and out of a job's detail pane as it finds them on the page; this module checks
// that text (Zod at the boundary) and turns it into a job. Nothing here touches the network (NFR-03).

const Text = z.string().max(100_000);

/** One card in the search results, as the page shows it. */
export const RawSearchCardSchema = z.strictObject({
  /** The card's data-occludable-job-id (or data-job-id). */
  jobId: Text.nullable(),
  /** The title link's href, e.g. "/jobs/view/4483361330/?trackingId=…". */
  href: Text.nullable(),
  title: Text,
  company: Text,
  /** The caption lines in order: the location first, then salary and benefits when LinkedIn shows them. */
  metadata: z.array(Text).max(20),
  /** The <time> element: its datetime (a date) and its text ("41 minutes ago"). */
  listedDate: Text.nullable(),
  listedText: Text.nullable(),
  /** The footer items: "Easy Apply", "Viewed", "Promoted", "Applied", … */
  footer: z.array(Text).max(20),
});

/** A job's detail pane: what LinkedIn shows next to the results when the job is open. */
export const RawJobPageSchema = z.strictObject({
  /** The title link's href, which names the job. */
  href: Text.nullable(),
  title: Text,
  company: Text,
  /** The line under the title, split at "·": location, posted time, applicants, … */
  tertiary: z.array(Text).max(20),
  /** The buttons under it: salary, workplace and job type ("$120K/yr - $150K/yr", "Remote", "Full-time"). */
  pills: z.array(Text).max(20),
  /** The description's HTML (#job-details), or null when the pane has none. */
  descriptionHtml: Text.nullable(),
  /** Whether the pane says "No longer accepting applications". */
  closed: z.boolean(),
});

export type RawSearchCard = z.infer<typeof RawSearchCardSchema>;
export type RawJobPage = z.infer<typeof RawJobPageSchema>;

export interface SearchCard {
  jobId: string;
  title: string;
  company: string;
  location: string;
  /** When LinkedIn listed it, from the card's "2 hours ago" (or its date); null when the card shows no time. */
  listedAt: string | null;
  salary: string | null;
  easyApply: boolean;
}

export interface JobDetails {
  jobId: string;
  title: string;
  company: string;
  location: string;
  postedAt: string | null;
  salary: string | null;
  workplace: Workplace | null;
  description: string | null;
  closed: boolean;
}

export class LinkedInPageFormatError extends Error {
  override name = 'LinkedInPageFormatError';
}

const LIMITS = { title: 300, company: 200, location: 300, salary: 200 } as const;
const UNITS_MS: Readonly<Record<string, number>> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};
const RELATIVE_TIME = /(\d+)\+?\s*(second|minute|hour|day|week|month|year)s?\s+ago/i;
const JUST_NOW = /\b(?:just now|moments? ago)\b/i;
const MONEY = /[$€£]\s?\d/;

/**
 * "41 minutes ago", "Reposted 2 weeks ago" or "Just now" → that time before `now`, as ISO text; null for anything
 * else. LinkedIn rounds ("1 week ago"), so this is when the job was listed give or take a unit.
 */
export function relativeTimeToIso(text: string, now: string): string | null {
  if (JUST_NOW.test(text)) return new Date(now).toISOString();
  const match = RELATIVE_TIME.exec(text);
  if (match === null) return null;
  const [, amount = '0', unit = ''] = match;
  const unitMs = UNITS_MS[unit.toLowerCase()] ?? 0;
  return new Date(Date.parse(now) - Number(amount) * unitMs).toISOString();
}

/** "$200K/yr - $250K/yr · 401(k) benefit" → "$200K/yr - $250K/yr"; null when no line has an amount. */
export function salaryFrom(lines: readonly string[]): string | null {
  const line = lines.map(oneLine).find((candidate) => MONEY.test(candidate));
  if (line === undefined) return null;
  const amount = (line.split(' · ')[0] ?? line).trim();
  return amount === '' ? null : cut(amount, LIMITS.salary);
}

/** A search card → a job, or null when the card has no job ID, title or company (not filled in yet, or changed). */
export function toSearchCard(raw: RawSearchCard, now: string): SearchCard | null {
  const jobId = jobIdFrom(raw.jobId, raw.href);
  const title = cut(oneLine(raw.title), LIMITS.title);
  const company = cut(oneLine(raw.company), LIMITS.company);
  if (jobId === null || title === '' || company === '') return null;

  return {
    jobId,
    title,
    company,
    location: cut(oneLine(raw.metadata[0] ?? ''), LIMITS.location),
    listedAt: listedAt(raw, now),
    salary: salaryFrom(raw.metadata.slice(1)),
    easyApply: raw.footer.some((item) => /^easy apply$/i.test(oneLine(item))),
  };
}

/** A detail pane → the job's details. Throws LinkedInPageFormatError when the pane doesn't name a job. */
export function toJobDetails(raw: RawJobPage, now: string): JobDetails {
  const jobId = jobIdFrom(null, raw.href);
  const title = cut(oneLine(raw.title), LIMITS.title);
  if (jobId === null || title === '') throw new LinkedInPageFormatError('the job page shows no job title or link');

  const parts = raw.tertiary.map(oneLine).filter((part) => part !== '');
  const posted = parts.map((part) => relativeTimeToIso(part, now)).find((time) => time !== null);
  const workplace = raw.pills.map(parseWorkplace).find((found) => found !== null);
  return {
    jobId,
    title,
    company: cut(oneLine(raw.company), LIMITS.company),
    location: cut(parts[0] ?? '', LIMITS.location),
    postedAt: posted ?? null,
    salary: salaryFrom(raw.pills),
    workplace: workplace ?? null,
    description: description(raw.descriptionHtml),
    closed: raw.closed,
  };
}

/**
 * The listing scripts/search-linkedin.ts sends for a job a search found: the card, plus the job page's details when
 * they were read. Null when it doesn't fit the API (for example an empty company), so it is left out.
 */
export function linkedInListing(
  card: SearchCard,
  details: JobDetails | null,
  searchName: string | null,
): IncomingListing | null {
  const parsed = IncomingListingSchema.safeParse({
    source: 'linkedin',
    sourceJobId: card.jobId,
    title: details?.title ?? card.title,
    company: details !== null && details.company !== '' ? details.company : card.company,
    location: card.location !== '' ? card.location : (details?.location ?? ''),
    url: canonicalJobUrl(card.jobId),
    postedAt: details?.postedAt ?? card.listedAt,
    salary: details?.salary ?? card.salary,
    description: details?.description ?? null,
    workplace: details?.workplace ?? null,
    easyApply: card.easyApply,
    ...(searchName === null ? {} : { searchName }),
  });
  return parsed.success ? parsed.data : null;
}

function jobIdFrom(jobId: string | null, href: string | null): string | null {
  const trimmed = jobId?.trim() ?? '';
  if (/^\d{1,20}$/.test(trimmed)) return trimmed;
  if (href === null) return null;
  const link = URL.parse(href.trim(), 'https://www.linkedin.com');
  return link === null ? null : (canonicalizeJobUrl(link.href)?.jobId ?? null);
}

function listedAt(raw: RawSearchCard, now: string): string | null {
  const relative = raw.listedText === null ? null : relativeTimeToIso(raw.listedText, now);
  if (relative !== null) return relative;
  const date = raw.listedDate?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`).toISOString() : null;
}

/** The description as plain text, without the pane's own "About the job" heading. */
function description(html: string | null): string | null {
  if (html === null) return null;
  const text = (htmlToText(html) ?? '').replace(/^About the job\s*/i, '');
  return text === '' ? null : cut(text, DESCRIPTION_MAX);
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
