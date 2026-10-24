import { describe, expect, it } from 'vitest';
import {
  JOB_SOURCES,
  LISTING_SOURCES,
  ORIGINS,
  originOf,
  SOURCE_LABELS,
  sourcesForOrigin,
} from '../../../src/domain/job-source.ts';

describe('job sources', () => {
  it('FR-15: has LinkedIn plus the ten free feeds of PLAN.md Phase 10', () => {
    expect(LISTING_SOURCES).toEqual([
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
    ]);
    expect(JOB_SOURCES).toEqual(['linkedin', ...LISTING_SOURCES]);
  });

  it('FR-17: the board has a LinkedIn view and an other-sources view', () => {
    expect(ORIGINS).toEqual(['linkedin', 'other']);
  });

  it('FR-17: only LinkedIn jobs are in the LinkedIn view', () => {
    expect(originOf('linkedin')).toBe('linkedin');
    expect(sourcesForOrigin('linkedin')).toEqual(['linkedin']);
  });

  it.each(LISTING_SOURCES)('FR-17: %s jobs are in the other-sources view', (source) => {
    expect(originOf(source)).toBe('other');
    expect(sourcesForOrigin('other')).toContain(source);
  });

  it('FR-17: every source and only those two views cover every job', () => {
    expect([...sourcesForOrigin('linkedin'), ...sourcesForOrigin('other')].sort()).toEqual([...JOB_SOURCES].sort());
  });

  it('FR-17: names each source the way its site does', () => {
    expect(SOURCE_LABELS).toMatchObject({ remoteok: 'Remote OK', hackernews: 'Hacker News', linkedin: 'LinkedIn' });
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([...JOB_SOURCES].sort());
  });
});
