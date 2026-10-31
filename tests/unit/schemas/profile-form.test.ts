import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROFILE_FORM,
  parseProfileForm,
  profileFormValues,
  profileFormValuesFromOld,
} from '../../../src/schemas/profile-form.ts';
import { SAMPLE_PROFILE } from '../../helpers/profiles.ts';

// The board's profile form (FR-01, DEC-065): every list is a textarea with one item per line, seniority a select,
// years a number input and relocate a checkbox. A browser sends every field as text, and relocate only when ticked.

/** A filled-in form as a browser posts it: an accountant, with Windows line breaks and stray blank lines. */
function form(): Record<string, string> {
  return {
    field: ' Accounting ',
    summary: 'Staff accountant at a small firm.\r\nWants a senior role.',
    targetRoles: 'Senior Accountant\r\n\r\n  Accounting Manager  \r\n',
    seniority: 'senior',
    yearsExperience: ' 7 ',
    coreSkills: 'Month-end close\nReconciliations',
    secondarySkills: '',
    credentials: 'CPA',
    remote: '',
    hybridAreas: 'Chicago, IL',
    onsiteAreas: '\n\n',
    relocate: 'yes',
    workAuthorization: 'US citizen',
    dealBreakers: 'commission only',
    excludedCompanies: '',
  };
}

describe('parseProfileForm', () => {
  it('FR-01: turns the form into a profile: one item per line, trimmed, blank lines dropped', () => {
    expect(parseProfileForm(form())).toEqual({
      ok: true,
      profile: {
        field: 'Accounting',
        summary: 'Staff accountant at a small firm.\nWants a senior role.',
        targetRoles: ['Senior Accountant', 'Accounting Manager'],
        seniority: 'senior',
        yearsExperience: 7,
        coreSkills: ['Month-end close', 'Reconciliations'],
        secondarySkills: [],
        credentials: ['CPA'],
        locations: { remote: [], hybridAreas: ['Chicago, IL'], onsiteAreas: [], relocate: true },
        workAuthorization: 'US citizen',
        dealBreakers: ['commission only'],
        excludedCompanies: [],
      },
    });
  });

  it('FR-01: an unticked checkbox is not sent, and means not relocating', () => {
    const unticked = Object.fromEntries(Object.entries(form()).filter(([name]) => name !== 'relocate'));

    const result = parseProfileForm(unticked);

    expect(result.ok && result.profile.locations.relocate).toBe(false);
  });

  it('FR-01: an empty form names every required field and keeps what was typed', () => {
    const result = parseProfileForm({ ...EMPTY_PROFILE_FORM, relocate: undefined, summary: 'Kept as typed.' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ['coreSkills', 'field', 'locations', 'seniority', 'targetRoles', 'workAuthorization', 'yearsExperience'].sort(),
    );
    expect(result.values.summary).toBe('Kept as typed.');
    expect(result.errors.field).toBe('Enter your line of work.');
    expect(result.errors.targetRoles).toBe('Enter at least one, one per line.');
    expect(result.errors.seniority).toBe('Choose your level.');
    expect(result.errors.yearsExperience).toBe('Enter a whole number from 0 to 60.');
    expect(result.errors.locations).toBe('Give at least one: a remote region, a hybrid area or an on-site area.');
  });

  it.each<[string, Record<string, string>, string, string]>([
    [
      'years that are not a number',
      { yearsExperience: 'seven' },
      'yearsExperience',
      'Enter a whole number from 0 to 60.',
    ],
    ['years above 60', { yearsExperience: '61' }, 'yearsExperience', 'Enter a whole number from 0 to 60.'],
    ['years with a decimal', { yearsExperience: '7.5' }, 'yearsExperience', 'Enter a whole number from 0 to 60.'],
    ['a level the board does not know', { seniority: 'principal' }, 'seniority', 'Choose your level.'],
    ['a line of work over 200 characters', { field: 'x'.repeat(201) }, 'field', 'Keep it to 200 characters.'],
    ['a summary over 1,000 characters', { summary: 'x'.repeat(1001) }, 'summary', 'Keep it to 1,000 characters.'],
    [
      'a role over 200 characters',
      { targetRoles: 'x'.repeat(201) },
      'targetRoles',
      'Keep each line to 200 characters.',
    ],
    [
      'more than 50 skills',
      { coreSkills: Array.from({ length: 51 }, (_, index) => `skill ${String(index)}`).join('\n') },
      'coreSkills',
      'Enter at most 50 lines.',
    ],
  ])('FR-01: %s is an error next to its field', (_case, override, field, message) => {
    const result = parseProfileForm({ ...form(), ...override });

    expect(result).toEqual({ ok: false, values: expect.any(Object) as unknown, errors: { [field]: message } });
  });

  it('FR-01: a form with an error gives back exactly what was typed, line breaks included', () => {
    const typed = { ...form(), yearsExperience: 'seven' };

    const result = parseProfileForm(typed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.values).toEqual({ ...typed, relocate: true });
  });

  it('FR-01: refuses a body that is not the board’s own form (an unknown field)', () => {
    expect(() => parseProfileForm({ ...form(), admin: 'yes' })).toThrow();
  });
});

describe('profileFormValues', () => {
  it('FR-01: fills the form from a saved profile, one item per line, so saving it again changes nothing', () => {
    const values = profileFormValues(SAMPLE_PROFILE);

    expect(values.targetRoles).toBe('Truck Dispatcher\nLogistics Coordinator');
    expect(values.yearsExperience).toBe('8');
    expect(values.relocate).toBe(false);
    const { relocate, ...text } = values;
    expect(parseProfileForm(relocate ? { ...text, relocate: 'yes' } : text)).toEqual({
      ok: true,
      profile: SAMPLE_PROFILE,
    });
  });
});

describe('profileFormValuesFromOld', () => {
  it('FR-01: keeps the old values that still fit, under their new names, and leaves out the rest', () => {
    const old = {
      targetRoles: ['Senior Accountant'],
      seniority: 'staff',
      yearsExperience: 9,
      coreSkills: ['Reconciliations', 42],
      secondarySkills: ['Excel'],
      locations: { remoteUS: true, hybridMetros: ['Chicago, IL'], onsiteMetros: [], relocate: true },
      workAuthorization: 'US citizen',
      dealBreakers: [],
      excludedCompanies: ['Example Audit LLP'],
    };

    expect(profileFormValuesFromOld(old)).toEqual({
      ...EMPTY_PROFILE_FORM,
      targetRoles: 'Senior Accountant',
      yearsExperience: '9',
      secondarySkills: 'Excel',
      hybridAreas: 'Chicago, IL',
      relocate: true,
      workAuthorization: 'US citizen',
      excludedCompanies: 'Example Audit LLP',
    });
  });

  it('FR-01: a level that still exists is kept', () => {
    expect(profileFormValuesFromOld({ seniority: 'lead' }).seniority).toBe('lead');
  });

  it.each([null, 'text', 42, ['a']])('FR-01: anything that is not an object gives an empty form (%j)', (old) => {
    expect(profileFormValuesFromOld(old)).toEqual(EMPTY_PROFILE_FORM);
  });
});
