import { z } from 'zod';
import { ProfileSchema, SENIORITIES, type Profile } from './profile.ts';

// The board's profile form (FR-01, DEC-065), POST /profile. Every list is a textarea with one item per line; lines
// are trimmed and blank ones dropped. Seniority is a select, years a number input, relocate a checkbox, which a
// browser sends only when it is ticked. The form is parsed into ProfileSchema, and each problem is reported next to
// its field in plain words, with what was typed kept.

/** The form's text fields, in the order the form shows them. */
export const PROFILE_FORM_TEXT_FIELDS = [
  'field',
  'summary',
  'targetRoles',
  'seniority',
  'yearsExperience',
  'coreSkills',
  'secondarySkills',
  'credentials',
  'remote',
  'hybridAreas',
  'onsiteAreas',
  'workAuthorization',
  'dealBreakers',
  'excludedCompanies',
] as const;

export type ProfileFormTextField = (typeof PROFILE_FORM_TEXT_FIELDS)[number];

/** What the form shows: the text as typed, and whether relocate is ticked. */
export type ProfileFormValues = Record<ProfileFormTextField, string> & { relocate: boolean };

/** Where an error is shown: next to one field, or (`locations`) above the three location lists. */
export type ProfileFormErrorKey = ProfileFormTextField | 'relocate' | 'locations';

export type ProfileFormResult =
  | { ok: true; profile: Profile }
  | { ok: false; values: ProfileFormValues; errors: Partial<Record<ProfileFormErrorKey, string>> };

export const EMPTY_PROFILE_FORM: ProfileFormValues = {
  ...(Object.fromEntries(PROFILE_FORM_TEXT_FIELDS.map((name) => [name, ''])) as Record<ProfileFormTextField, string>),
  relocate: false,
};

// No length limit on the raw text (the 1 MB body limit bounds it): the real limits are ProfileSchema's, reported next
// to each field, so a long paste keeps the rest of the form.
const FormText = z.string().default('');

/** The body only the board's own form posts; anything else is a 400 like any bad form (NFR-09). */
export const ProfileFormSchema = z.strictObject({
  ...(Object.fromEntries(PROFILE_FORM_TEXT_FIELDS.map((name) => [name, FormText])) as Record<
    ProfileFormTextField,
    typeof FormText
  >),
  relocate: z.literal('yes').optional(),
});

const LISTS = new Set<ProfileFormTextField>([
  'targetRoles',
  'coreSkills',
  'secondarySkills',
  'credentials',
  'remote',
  'hybridAreas',
  'onsiteAreas',
  'dealBreakers',
  'excludedCompanies',
]);

const REQUIRED_TEXT: Partial<Record<ProfileFormErrorKey, string>> = {
  field: 'Enter your line of work.',
  workAuthorization: 'Say where you can work, and whether you need sponsorship.',
};

/** Parses a posted form. Throws (a ZodError) only for a body that isn't the board's own form. */
export function parseProfileForm(body: unknown): ProfileFormResult {
  const form = ProfileFormSchema.parse(body);
  const { relocate, ...text } = form;
  const values: ProfileFormValues = { ...text, relocate: relocate === 'yes' };

  const years = text.yearsExperience.trim();
  const candidate = {
    field: text.field,
    summary: text.summary.replace(/\r\n?/g, '\n'),
    targetRoles: lines(text.targetRoles),
    seniority: text.seniority,
    yearsExperience: /^\d{1,3}$/.test(years) ? Number(years) : Number.NaN,
    coreSkills: lines(text.coreSkills),
    secondarySkills: lines(text.secondarySkills),
    credentials: lines(text.credentials),
    locations: {
      remote: lines(text.remote),
      hybridAreas: lines(text.hybridAreas),
      onsiteAreas: lines(text.onsiteAreas),
      relocate: values.relocate,
    },
    workAuthorization: text.workAuthorization,
    dealBreakers: lines(text.dealBreakers),
    excludedCompanies: lines(text.excludedCompanies),
  };

  const parsed = ProfileSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, profile: parsed.data };

  const errors: Partial<Record<ProfileFormErrorKey, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = errorKey(issue.path);
    errors[key] ??= message(key, issue);
  }
  return { ok: false, values, errors };
}

/** The form filled in from a saved profile; saving it again gives the same profile. */
export function profileFormValues(profile: Profile): ProfileFormValues {
  return {
    field: profile.field,
    summary: profile.summary,
    targetRoles: profile.targetRoles.join('\n'),
    seniority: profile.seniority,
    yearsExperience: String(profile.yearsExperience),
    coreSkills: profile.coreSkills.join('\n'),
    secondarySkills: profile.secondarySkills.join('\n'),
    credentials: profile.credentials.join('\n'),
    remote: profile.locations.remote.join('\n'),
    hybridAreas: profile.locations.hybridAreas.join('\n'),
    onsiteAreas: profile.locations.onsiteAreas.join('\n'),
    relocate: profile.locations.relocate,
    workAuthorization: profile.workAuthorization,
    dealBreakers: profile.dealBreakers.join('\n'),
    excludedCompanies: profile.excludedCompanies.join('\n'),
  };
}

// The old profile's fields that still mean the same, under their new names (DEC-065). `remoteUS` has no region to
// carry over, so remote starts empty.
const OLD_LISTS: readonly [ProfileFormTextField, (old: Record<string, unknown>) => unknown][] = [
  ['targetRoles', (old) => old['targetRoles']],
  ['coreSkills', (old) => old['coreSkills']],
  ['secondarySkills', (old) => old['secondarySkills']],
  ['hybridAreas', (old) => locationsOf(old)['hybridMetros']],
  ['onsiteAreas', (old) => locationsOf(old)['onsiteMetros']],
  ['dealBreakers', (old) => old['dealBreakers']],
  ['excludedCompanies', (old) => old['excludedCompanies']],
];

const OldList = ProfileSchema.shape.secondarySkills;

/** The form prefilled from a profile saved in an older shape: only the values that still fit. */
export function profileFormValuesFromOld(old: unknown): ProfileFormValues {
  if (typeof old !== 'object' || old === null || Array.isArray(old)) return { ...EMPTY_PROFILE_FORM };
  const record = old as Record<string, unknown>;
  const values: ProfileFormValues = { ...EMPTY_PROFILE_FORM };

  for (const [name, read] of OLD_LISTS) {
    const list = OldList.safeParse(read(record));
    if (list.success) values[name] = list.data.join('\n');
  }
  const seniority = z.enum(SENIORITIES).safeParse(record['seniority']);
  if (seniority.success) values.seniority = seniority.data;
  const years = ProfileSchema.shape.yearsExperience.safeParse(record['yearsExperience']);
  if (years.success) values.yearsExperience = String(years.data);
  const authorization = ProfileSchema.shape.workAuthorization.safeParse(record['workAuthorization']);
  if (authorization.success) values.workAuthorization = authorization.data;
  values.relocate = locationsOf(record)['relocate'] === true;
  return values;
}

function locationsOf(old: Record<string, unknown>): Record<string, unknown> {
  const locations = old['locations'];
  return typeof locations === 'object' && locations !== null ? (locations as Record<string, unknown>) : {};
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function errorKey(path: readonly PropertyKey[]): ProfileFormErrorKey {
  const [first, second] = path;
  if (first === 'locations') {
    return second === 'remote' || second === 'hybridAreas' || second === 'onsiteAreas' || second === 'relocate'
      ? second
      : 'locations';
  }
  return first as ProfileFormTextField;
}

function message(key: ProfileFormErrorKey, issue: z.core.$ZodIssue): string {
  if (key === 'locations') return `${issue.message}.`;
  if (key === 'seniority') return 'Choose your level.';
  if (key === 'yearsExperience') return 'Enter a whole number from 0 to 60.';
  if (key === 'summary') return 'Keep it to 1,000 characters.';
  const list = LISTS.has(key as ProfileFormTextField);
  if (issue.code === 'too_big') {
    if (!list) return 'Keep it to 200 characters.';
    return issue.path.length > (key === 'remote' || key === 'hybridAreas' || key === 'onsiteAreas' ? 2 : 1)
      ? 'Keep each line to 200 characters.'
      : 'Enter at most 50 lines.';
  }
  if (list) return 'Enter at least one, one per line.';
  return REQUIRED_TEXT[key] ?? 'Check this field.';
}
