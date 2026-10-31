import type { Origin } from './job-source.ts';

// Setup comes first (FR-24, DEC-066). The board is set up when a valid profile is saved and at least one source is
// ready: LinkedIn searches or the free feeds. Until the profile is saved the board shows setup instead of jobs, and
// each view's Find Now waits for the profile and that view's own source.

export const PROFILE_STATUSES = ['missing', 'outdated', 'saved'] as const;
export const FILE_STATUSES = ['missing', 'invalid', 'ready'] as const;

export type ProfileStatus = (typeof PROFILE_STATUSES)[number];
export type FileStatus = (typeof FILE_STATUSES)[number];

export interface SetupStatus {
  profile: ProfileStatus;
  linkedinSearches: FileStatus;
  sources: FileStatus;
  ready: boolean;
}

export function setupStatus(parts: Omit<SetupStatus, 'ready'>): SetupStatus {
  const ready = parts.profile === 'saved' && (parts.linkedinSearches === 'ready' || parts.sources === 'ready');
  return { ...parts, ready };
}

/** Whether Find Now may run for a view: LinkedIn needs the searches, Other sources the feeds. */
export function viewReady(status: SetupStatus, origin: Origin): boolean {
  const source = origin === 'linkedin' ? status.linkedinSearches : status.sources;
  return status.profile === 'saved' && source === 'ready';
}
