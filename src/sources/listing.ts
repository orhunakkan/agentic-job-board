import type { ListingSource } from '../domain/job-source.ts';
import type { IncomingListing } from '../ingest/listing-ingest.ts';
import { DESCRIPTION_MAX, IncomingListingSchema } from '../schemas/api.ts';
import { htmlToText, oneLine } from './html-text.ts';

// What every feed parser builds: one listing in the shape POST /api/runs/:id/listings accepts (FR-15).

export interface RawListing {
  source: ListingSource;
  sourceJobId: string | number;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: string | number | null; // ISO text, or seconds since 1970 (Himalayas)
  salary: string | null;
  /** HTML or plain text. */
  description: string | null;
}

const LIMITS = { title: 300, company: 200, location: 300, salary: 200 } as const;

/**
 * Cleans a listing (no markup, one line where one line belongs, lengths the API accepts) and checks it with the
 * API's own schema. A listing that still doesn't fit, for example one whose link isn't https, is left out (null).
 */
export function toListing(raw: RawListing): IncomingListing | null {
  const parsed = IncomingListingSchema.safeParse({
    source: raw.source,
    sourceJobId: String(raw.sourceJobId).trim(),
    title: cut(oneLine(raw.title), LIMITS.title),
    company: cut(oneLine(raw.company), LIMITS.company),
    location: cut(oneLine(raw.location), LIMITS.location),
    url: raw.url.trim(),
    postedAt: toIsoTime(raw.postedAt),
    salary: raw.salary === null || raw.salary.trim() === '' ? null : cut(oneLine(raw.salary), LIMITS.salary),
    description: raw.description === null ? null : htmlToText(raw.description, DESCRIPTION_MAX),
  });
  return parsed.success ? parsed.data : null;
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function toIsoTime(value: string | number | null): string | null {
  if (value === null || value === '') return null;
  const time = typeof value === 'number' ? value * 1000 : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

const CURRENCY_SIGNS: Readonly<Record<string, string>> = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$' };

/** "$150K – $180K", "$60 – $75 per hour", or null when the feed gives no amount. */
export function formatSalary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
  period: string | null | undefined = null,
): string | null {
  const amounts = [min, max].filter((amount): amount is number => typeof amount === 'number' && amount > 0);
  if (amounts.length === 0) return null;
  const code = (currency ?? 'USD').toUpperCase();
  const sign = CURRENCY_SIGNS[code] ?? `${code} `;
  const shown = [...new Set(amounts)].map((amount) => `${sign}${shortAmount(amount)}`).join(' – ');
  const per = /hour/i.test(period ?? '') ? ' per hour' : /month/i.test(period ?? '') ? ' per month' : '';
  return `${shown}${per}`;
}

function shortAmount(amount: number): string {
  if (amount < 1000) return String(Math.round(amount));
  const thousands = amount / 1000;
  return `${Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}K`;
}

/** A remote job's location as the board and the rubric read it: "Remote (United States)", or just "Remote". */
export function remoteLocation(where: string | readonly string[] | null | undefined): string {
  const places = (typeof where === 'string' ? [where] : (where ?? []))
    .map((place) => place.trim())
    .filter((place) => place !== '' && !/^remote$/i.test(place));
  return places.length === 0 ? 'Remote' : `Remote (${places.join(', ')})`;
}
