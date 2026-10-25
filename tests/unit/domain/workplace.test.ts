import { describe, expect, it } from 'vitest';
import { parseWorkplace, WORKPLACE_LABELS, WORKPLACES } from '../../../src/domain/workplace.ts';

describe('parseWorkplace', () => {
  it.each([
    ['Remote', 'remote'],
    [' remote ', 'remote'],
    ['Hybrid', 'hybrid'],
    ['On-site', 'on-site'],
    ['On site', 'on-site'],
    ['ONSITE', 'on-site'],
  ])('FR-19: %j is %s', (text, workplace) => {
    expect(parseWorkplace(text)).toBe(workplace);
  });

  it.each(['Full-time', '$120K/yr', '', 'Remote-first', 'Office'])('FR-19: %j is no workplace', (text) => {
    expect(parseWorkplace(text)).toBeNull();
  });

  it('FR-19: every workplace has a label', () => {
    expect(WORKPLACES.map((workplace) => WORKPLACE_LABELS[workplace])).toEqual(['Remote', 'Hybrid', 'On-site']);
  });
});
