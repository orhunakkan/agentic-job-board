import { describe, expect, it } from 'vitest';
import { containsAny, isWanted, type FilterRules } from '../../../src/sources/filter.ts';

const RULES: FilterRules = {
  keywords: ['rn', 'dispatcher', 'patient care', 'charge nurse', 'registered nurse'],
  excludeKeywords: ['intern', 'junior'],
  locations: ['remote', 'united states', 'usa', 'us'],
};

describe('the listing filter', () => {
  it.each([
    ['Senior RN, Cardiac', true],
    ['Dispatcher II', true],
    ['Lead Patient Care Technician (Nights)', true],
    ['Registered Nurse', true],
    ['Senior Charge Nurse', true],
    ['RN/LPN Float Pool', true],
    ['Learning Designer - Kearney', false],
    ['Senior Nurse', false],
    ['Charge Nursery Manager', false],
  ])('FR-15: the title %j matches the keywords: %s', (title, expected) => {
    expect(containsAny(title, RULES.keywords)).toBe(expected);
  });

  it('FR-15: matches whole words only, ignoring case and accents around them', () => {
    expect(containsAny('ÉRN lead', ['rn'])).toBe(false);
    expect(containsAny('rn', ['RN'])).toBe(true);
    expect(containsAny('C++ developer', ['c++'])).toBe(true);
  });

  it('FR-15: keeps a matching title in a wanted location', () => {
    expect(isWanted({ title: 'Senior Dispatcher', location: 'Remote (United States)' }, RULES)).toBe(true);
  });

  it('FR-15: keeps a matching title without a location', () => {
    expect(isWanted({ title: 'Senior Dispatcher', location: '' }, RULES)).toBe(true);
  });

  it('FR-15: drops an excluded title even when it matches', () => {
    expect(isWanted({ title: 'RN Intern', location: 'Remote' }, RULES)).toBe(false);
  });

  it('FR-15: drops a location the user did not list', () => {
    expect(isWanted({ title: 'Senior Dispatcher', location: 'Berlin, Germany' }, RULES)).toBe(false);
  });

  it('FR-15: with no locations listed, any location is kept', () => {
    expect(isWanted({ title: 'Senior Dispatcher', location: 'Berlin, Germany' }, { ...RULES, locations: [] })).toBe(
      true,
    );
  });
});
