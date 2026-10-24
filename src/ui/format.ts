import type { Tab } from '../domain/board-tabs.ts';
import type { Origin } from '../domain/job-source.ts';
import type { Status } from '../domain/status.ts';

// Words and dates as the pages show them (PLAN.md §6.3). Dates are in the server's time zone, which on the
// owner's machine is their own; tests pass a fixed zone.

export const STATUS_LABELS: Readonly<Record<Status, string>> = {
  new: 'New',
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  dismissed: 'Dismissed',
};

/** The button text for moving a job to each status. */
export const ACTION_LABELS: Readonly<Record<Status, string>> = {
  new: 'Restore',
  saved: 'Save',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  dismissed: 'Dismiss',
};

export const TAB_LABELS: Readonly<Record<Tab, string>> = {
  new: 'New',
  saved: 'Saved',
  'in-progress': 'In progress',
  closed: 'Closed',
  dismissed: 'Dismissed',
};

export const ORIGIN_LABELS: Readonly<Record<Origin, string>> = {
  linkedin: 'LinkedIn',
  other: 'Other sources',
};

export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(iso));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 d ago". A time in the future counts as just now. */
export function timeAgo(iso: string, nowIso: string): string {
  const elapsed = Date.parse(nowIso) - Date.parse(iso);
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))} min ago`;
  if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))} h ago`;
  return `${String(Math.floor(elapsed / DAY))} d ago`;
}
