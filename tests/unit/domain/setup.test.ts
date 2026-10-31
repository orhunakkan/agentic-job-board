import { describe, expect, it } from 'vitest';
import {
  FILE_STATUSES,
  PROFILE_STATUSES,
  setupStatus,
  viewReady,
  type FileStatus,
  type ProfileStatus,
} from '../../../src/domain/setup.ts';

// Setup comes first (FR-24, DEC-066): the board is set up when a valid profile is saved and at least one source is
// ready; each view's Find Now also needs its own source.

const COMBINATIONS: [ProfileStatus, FileStatus, FileStatus][] = PROFILE_STATUSES.flatMap((profile) =>
  FILE_STATUSES.flatMap((linkedinSearches) =>
    FILE_STATUSES.map((sources): [ProfileStatus, FileStatus, FileStatus] => [profile, linkedinSearches, sources]),
  ),
);

describe('setupStatus', () => {
  it('FR-24: covers all 27 combinations of the profile and the two files', () => {
    expect(COMBINATIONS).toHaveLength(27);
  });

  it.each(COMBINATIONS)('FR-24: profile %s, LinkedIn searches %s, feeds %s', (profile, linkedinSearches, sources) => {
    const status = setupStatus({ profile, linkedinSearches, sources });

    const expected = profile === 'saved' && (linkedinSearches === 'ready' || sources === 'ready');
    expect(status).toEqual({ profile, linkedinSearches, sources, ready: expected });
  });
});

describe('viewReady', () => {
  it.each(COMBINATIONS)(
    'FR-24: Find Now on each view needs the profile and that view’s own source (profile %s, searches %s, feeds %s)',
    (profile, linkedinSearches, sources) => {
      const status = setupStatus({ profile, linkedinSearches, sources });

      expect(viewReady(status, 'linkedin')).toBe(profile === 'saved' && linkedinSearches === 'ready');
      expect(viewReady(status, 'other')).toBe(profile === 'saved' && sources === 'ready');
    },
  );
});
