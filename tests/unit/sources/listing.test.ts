import { describe, expect, it } from 'vitest';
import { formatSalary, remoteLocation, toListing, type RawListing } from '../../../src/sources/listing.ts';

const RAW: RawListing = {
  source: 'greenhouse',
  sourceJobId: 5550001,
  title: '  <b>Senior</b>   SDET ',
  company: 'Example Labs',
  location: 'Remote, US',
  url: 'https://job-boards.greenhouse.io/examplelabs/jobs/5550001',
  postedAt: '2026-10-20T09:00:00-04:00',
  salary: '$150K – $180K',
  description: '<p>Build the test platform.</p>',
};

describe('toListing', () => {
  it('FR-15: cleans a listing into the shape the API accepts', () => {
    expect(toListing(RAW)).toEqual({
      source: 'greenhouse',
      sourceJobId: '5550001',
      title: 'Senior SDET',
      company: 'Example Labs',
      location: 'Remote, US',
      url: 'https://job-boards.greenhouse.io/examplelabs/jobs/5550001',
      postedAt: '2026-10-20T13:00:00.000Z',
      salary: '$150K – $180K',
      description: 'Build the test platform.',
    });
  });

  it('FR-15: reads a time in seconds since 1970, and drops one it cannot read', () => {
    expect(toListing({ ...RAW, postedAt: 1_792_666_342 })?.postedAt).toBe('2026-10-22T10:52:22.000Z');
    expect(toListing({ ...RAW, postedAt: 'last Tuesday' })?.postedAt).toBeNull();
    expect(toListing({ ...RAW, postedAt: '' })?.postedAt).toBeNull();
  });

  it('FR-15: an empty salary or description becomes null', () => {
    expect(toListing({ ...RAW, salary: ' ', description: '<p></p>' })).toMatchObject({
      salary: null,
      description: null,
    });
  });

  it('FR-15: cuts long fields to what the API accepts', () => {
    const listing = toListing({ ...RAW, title: 'x'.repeat(400), description: 'y'.repeat(20_000) });

    expect(listing?.title).toHaveLength(300);
    expect(listing?.title.endsWith('…')).toBe(true);
    expect(listing?.description).toHaveLength(10_000);
  });

  it.each([
    ['a plain http link', { url: 'http://example.com/jobs/1' }],
    ['a javascript: link', { url: 'javascript:alert(1)' }],
    ['a link with a password', { url: 'https://user:pw@example.com/jobs/1' }],
    ['no title', { title: '<p></p>' }],
    ['no company', { company: ' ' }],
  ])('NFR-07: leaves out a listing with %s', (_case, change) => {
    expect(toListing({ ...RAW, ...change })).toBeNull();
  });
});

describe('formatSalary', () => {
  it.each([
    [[150_000, 180_000, 'USD', 'annual'], '$150K – $180K'],
    [[100_584, 138_303, 'usd', null], '$100.6K – $138.3K'],
    [[90_000, 90_000, 'USD', 'year'], '$90K'],
    [[60, 75, 'USD', 'per-hour-wage'], '$60 – $75 per hour'],
    [[8000, null, 'EUR', 'month'], '€8K per month'],
    [[120_000, 150_000, 'CHF', null], 'CHF 120K – CHF 150K'],
    [[0, 0, 'USD', null], null],
    [[null, undefined, null, null], null],
  ] as const)('FR-17: %j is shown as %j', ([min, max, currency, period], expected) => {
    expect(formatSalary(min, max, currency, period)).toBe(expected);
  });

  it('FR-17: assumes US dollars when the feed names no currency', () => {
    expect(formatSalary(100_000, null, null)).toBe('$100K');
  });
});

describe('remoteLocation', () => {
  it.each([
    [null, 'Remote'],
    ['', 'Remote'],
    ['USA', 'Remote (USA)'],
    ['Remote', 'Remote'],
    [['United States', ' Canada ', ''], 'Remote (United States, Canada)'],
  ] as const)('FR-17: %j is shown as %j', (where, expected) => {
    expect(remoteLocation(where)).toBe(expected);
  });
});
