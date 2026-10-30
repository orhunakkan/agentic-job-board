import { describe, expect, it } from 'vitest';
import { ProfileSchema } from '../../../src/schemas/profile.ts';

// Fictional profile: test data must never contain the owner's real details.
function validProfile(): Record<string, unknown> {
  return {
    targetRoles: ['Senior QA Engineer', 'SDET'],
    seniority: 'senior',
    yearsExperience: 8,
    coreSkills: ['Playwright', 'TypeScript'],
    secondarySkills: ['Java'],
    locations: { remoteUS: true, hybridMetros: ['Springfield, IL'], onsiteMetros: [], relocate: false },
    workAuthorization: 'US, no sponsorship needed',
    dealBreakers: ['manual-only roles'],
    excludedCompanies: ['Example Corp'],
  };
}

// Valid locations with every list empty.
const LOCATIONS = { remoteUS: true, hybridMetros: [], onsiteMetros: [], relocate: false };

function without(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([k]) => k !== key));
}

describe('ProfileSchema', () => {
  it('FR-01: accepts a complete profile', () => {
    const result = ProfileSchema.safeParse(validProfile());

    expect(result.success).toBe(true);
    expect(result.data).toEqual(validProfile());
  });

  it('FR-01: accepts empty optional lists', () => {
    const profile = {
      ...validProfile(),
      secondarySkills: [],
      dealBreakers: [],
      excludedCompanies: [],
      locations: LOCATIONS,
    };

    expect(ProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('FR-01: trims surrounding whitespace from text values', () => {
    const profile = { ...validProfile(), targetRoles: ['  SDET  '], workAuthorization: ' US citizen ' };

    const result = ProfileSchema.parse(profile);

    expect(result.targetRoles).toEqual(['SDET']);
    expect(result.workAuthorization).toBe('US citizen');
  });

  it.each([
    'targetRoles',
    'seniority',
    'yearsExperience',
    'coreSkills',
    'secondarySkills',
    'locations',
    'workAuthorization',
    'dealBreakers',
    'excludedCompanies',
  ])('FR-01: rejects a profile without %s', (field) => {
    const result = ProfileSchema.safeParse(without(validProfile(), field));

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it.each(['remoteUS', 'hybridMetros', 'onsiteMetros', 'relocate'])('FR-01: rejects locations without %s', (field) => {
    const locations = without(LOCATIONS, field);

    const result = ProfileSchema.safeParse({ ...validProfile(), locations });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['locations', field]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['targetRoles is not an array', { targetRoles: 'SDET' }],
    ['targetRoles is empty', { targetRoles: [] }],
    ['a target role is blank', { targetRoles: ['   '] }],
    ['seniority is not a known level', { seniority: 'principal' }],
    ['yearsExperience is a string', { yearsExperience: '8' }],
    ['yearsExperience is negative', { yearsExperience: -1 }],
    ['yearsExperience is not a whole number', { yearsExperience: 8.5 }],
    ['yearsExperience is implausibly high', { yearsExperience: 61 }],
    ['coreSkills is empty', { coreSkills: [] }],
    ['a secondary skill is a number', { secondarySkills: [42] }],
    ['locations is not an object', { locations: 'remote' }],
    ['workAuthorization is blank', { workAuthorization: '' }],
    ['dealBreakers is null', { dealBreakers: null }],
    ['an excluded company is too long', { excludedCompanies: ['x'.repeat(201)] }],
    ['a list has too many items', { coreSkills: Array.from({ length: 51 }, (_, index) => `skill ${String(index)}`) }],
  ])('FR-01: rejects a profile where %s', (_case, override) => {
    expect(ProfileSchema.safeParse({ ...validProfile(), ...override }).success).toBe(false);
  });

  it('FR-01: rejects wrong types inside locations', () => {
    const locations = { ...LOCATIONS, remoteUS: 'yes' };

    expect(ProfileSchema.safeParse({ ...validProfile(), locations }).success).toBe(false);
  });

  it('FR-01: rejects unknown fields so typos are caught', () => {
    const result = ProfileSchema.safeParse({ ...validProfile(), targetRole: ['SDET'] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('FR-01: rejects unknown fields inside locations', () => {
    const locations = { ...LOCATIONS, remoteEU: true };

    expect(ProfileSchema.safeParse({ ...validProfile(), locations }).success).toBe(false);
  });
});
