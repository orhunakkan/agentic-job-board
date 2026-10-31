import { describe, expect, it } from 'vitest';
import { ProfileSchema, SENIORITIES } from '../../../src/schemas/profile.ts';

// Fictional profile: test data must never contain the owner's real details.
function validProfile(): Record<string, unknown> {
  return {
    field: 'Registered nursing, critical care',
    summary: 'ICU nurse for six years; looking for a charge nurse role.',
    targetRoles: ['ICU Charge Nurse', 'Critical Care Nurse'],
    seniority: 'senior',
    yearsExperience: 8,
    coreSkills: ['Ventilator management', 'Patient assessment'],
    secondarySkills: ['Epic charting'],
    credentials: ['RN license (Texas)', 'CCRN'],
    locations: { remote: [], hybridAreas: [], onsiteAreas: ['Austin, TX'], relocate: false },
    workAuthorization: 'US citizen, no sponsorship needed',
    dealBreakers: ['night shifts only'],
    excludedCompanies: ['Example Hospital Group'],
  };
}

// Valid locations: one remote region, the other lists empty.
const LOCATIONS = { remote: ['United States'], hybridAreas: [], onsiteAreas: [], relocate: false };

function without(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([k]) => k !== key));
}

describe('ProfileSchema', () => {
  it('FR-01: accepts a complete profile', () => {
    const result = ProfileSchema.safeParse(validProfile());

    expect(result.success).toBe(true);
    expect(result.data).toEqual(validProfile());
  });

  it('FR-01: accepts empty optional lists and an empty summary', () => {
    const profile = {
      ...validProfile(),
      summary: '',
      secondarySkills: [],
      credentials: [],
      dealBreakers: [],
      excludedCompanies: [],
      locations: LOCATIONS,
    };

    expect(ProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('FR-01: trims surrounding whitespace from text values', () => {
    const profile = { ...validProfile(), targetRoles: ['  Staff Accountant  '], workAuthorization: ' US citizen ' };

    const result = ProfileSchema.parse(profile);

    expect(result.targetRoles).toEqual(['Staff Accountant']);
    expect(result.workAuthorization).toBe('US citizen');
  });

  it('FR-01: knows every level from entry to executive', () => {
    expect(SENIORITIES).toEqual(['entry', 'mid', 'senior', 'lead', 'manager', 'director', 'executive']);
    for (const seniority of SENIORITIES) {
      expect(ProfileSchema.safeParse({ ...validProfile(), seniority }).success).toBe(true);
    }
  });

  it.each([
    'field',
    'summary',
    'targetRoles',
    'seniority',
    'yearsExperience',
    'coreSkills',
    'secondarySkills',
    'credentials',
    'locations',
    'workAuthorization',
    'dealBreakers',
    'excludedCompanies',
  ])('FR-01: rejects a profile without %s', (field) => {
    const result = ProfileSchema.safeParse(without(validProfile(), field));

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it.each(['remote', 'hybridAreas', 'onsiteAreas', 'relocate'])('FR-01: rejects locations without %s', (field) => {
    const locations = without(LOCATIONS, field);

    const result = ProfileSchema.safeParse({ ...validProfile(), locations });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['locations', field]);
  });

  it('FR-01: rejects locations where no remote region, hybrid area or on-site area is given', () => {
    const locations = { remote: [], hybridAreas: [], onsiteAreas: [], relocate: true };

    const result = ProfileSchema.safeParse({ ...validProfile(), locations });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.path).toEqual(['locations']);
    expect(result.error?.issues[0]?.message).toMatch(/at least one/i);
  });

  it.each([
    ['a remote region', { remote: ['Canada'], hybridAreas: [], onsiteAreas: [] }],
    ['a hybrid area', { remote: [], hybridAreas: ['Denver, CO'], onsiteAreas: [] }],
    ['an on-site area', { remote: [], hybridAreas: [], onsiteAreas: ['Leeds'] }],
  ])('FR-01: accepts locations with only %s', (_case, lists) => {
    const result = ProfileSchema.safeParse({ ...validProfile(), locations: { ...lists, relocate: false } });

    expect(result.success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['field is blank', { field: '  ' }],
    ['field is too long', { field: 'x'.repeat(201) }],
    ['summary is too long', { summary: 'x'.repeat(1001) }],
    ['targetRoles is not an array', { targetRoles: 'Dispatcher' }],
    ['targetRoles is empty', { targetRoles: [] }],
    ['a target role is blank', { targetRoles: ['   '] }],
    ['seniority is not a known level', { seniority: 'principal' }],
    ['seniority is the old junior level', { seniority: 'junior' }],
    ['seniority is the old staff level', { seniority: 'staff' }],
    ['yearsExperience is a string', { yearsExperience: '8' }],
    ['yearsExperience is negative', { yearsExperience: -1 }],
    ['yearsExperience is not a whole number', { yearsExperience: 8.5 }],
    ['yearsExperience is implausibly high', { yearsExperience: 61 }],
    ['coreSkills is empty', { coreSkills: [] }],
    ['a secondary skill is a number', { secondarySkills: [42] }],
    ['a credential is blank', { credentials: [''] }],
    ['locations is not an object', { locations: 'remote' }],
    ['workAuthorization is blank', { workAuthorization: '' }],
    ['dealBreakers is null', { dealBreakers: null }],
    ['an excluded company is too long', { excludedCompanies: ['x'.repeat(201)] }],
    ['a list has too many items', { coreSkills: Array.from({ length: 51 }, (_, index) => `skill ${String(index)}`) }],
  ])('FR-01: rejects a profile where %s', (_case, override) => {
    expect(ProfileSchema.safeParse({ ...validProfile(), ...override }).success).toBe(false);
  });

  it('FR-01: rejects wrong types inside locations', () => {
    const locations = { ...LOCATIONS, remote: true };

    expect(ProfileSchema.safeParse({ ...validProfile(), locations }).success).toBe(false);
  });

  it('FR-01: rejects unknown fields so typos are caught', () => {
    const result = ProfileSchema.safeParse({ ...validProfile(), targetRole: ['Dispatcher'] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('FR-01: rejects unknown fields inside locations', () => {
    const locations = { ...LOCATIONS, remoteEU: true };

    expect(ProfileSchema.safeParse({ ...validProfile(), locations }).success).toBe(false);
  });

  it('FR-01: rejects a profile saved in the old shape', () => {
    const old = {
      targetRoles: ['Staff Accountant'],
      seniority: 'senior',
      yearsExperience: 8,
      coreSkills: ['Reconciliations'],
      secondarySkills: [],
      locations: { remoteUS: true, hybridMetros: [], onsiteMetros: [], relocate: false },
      workAuthorization: 'US citizen',
      dealBreakers: [],
      excludedCompanies: [],
    };

    expect(ProfileSchema.safeParse(old).success).toBe(false);
  });
});
