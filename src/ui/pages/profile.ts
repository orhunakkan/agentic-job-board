import type { ProfileState } from '../../db/repositories/profile.ts';
import type { Profile } from '../../schemas/profile.ts';
import type { ProfileFormErrorKey, ProfileFormTextField, ProfileFormValues } from '../../schemas/profile-form.ts';
import { notice } from '../components.ts';
import { html, raw, type SafeHtml } from '../html.ts';

// The profile every score is based on (FR-01): the page that shows it with an Edit button, and the form that fills
// it in for any line of work (DEC-065). The form needs no script (DEC-006): it posts to /profile#errors, so a form
// with errors comes back scrolled to its error summary, which takes the focus.

export const SENIORITY_LABELS: Readonly<Record<Profile['seniority'], string>> = {
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior',
  lead: 'Lead',
  manager: 'Manager',
  director: 'Director',
  executive: 'Executive',
};

export function profilePage(state: ProfileState, saved: boolean): SafeHtml {
  if (state.status === 'outdated') {
    return html`
      <h1>Profile</h1>
      <p class="empty">
        Your saved profile is from an older version of the board. Fill it in again; what still fits is filled in for
        you. <a class="button" href="/profile/edit">Fill it in again</a>
      </p>
    `;
  }
  if (state.status === 'missing') {
    return html`
      <h1>Profile</h1>
      <p class="empty">
        No profile yet. Every score is based on your profile, so the board waits for it.
        <a class="button" href="/profile/edit">Fill in your profile</a>
      </p>
    `;
  }

  const { profile } = state;
  const { locations } = profile;
  const where = [
    ...locations.remote.map((region) => `Remote: ${region}`),
    ...locations.hybridAreas.map((area) => `Hybrid: ${area}`),
    ...locations.onsiteAreas.map((area) => `On-site: ${area}`),
  ];

  return html`
    <h1>Profile</h1>
    ${saved && notice('Your profile is saved. Every new score is based on it.')}
    <p>Every score is based on this profile. <a class="button" href="/profile/edit">Edit</a></p>
    <dl class="details profile">
      <dt>Line of work</dt>
      <dd>${profile.field}</dd>
      <dt>Summary</dt>
      <dd>${profile.summary === '' ? 'None' : profile.summary}</dd>
      <dt>Target roles</dt>
      <dd>${list(profile.targetRoles)}</dd>
      <dt>Seniority</dt>
      <dd>${SENIORITY_LABELS[profile.seniority]}, ${profile.yearsExperience} years of experience</dd>
      <dt>Core skills</dt>
      <dd>${list(profile.coreSkills)}</dd>
      <dt>Secondary skills</dt>
      <dd>${list(profile.secondarySkills)}</dd>
      <dt>Licenses and certifications</dt>
      <dd>${list(profile.credentials)}</dd>
      <dt>Locations</dt>
      <dd>${list(where)}${locations.relocate ? ' Open to relocation.' : ' Not relocating.'}</dd>
      <dt>Work authorization</dt>
      <dd>${profile.workAuthorization}</dd>
      <dt>Deal-breakers</dt>
      <dd>${list(profile.dealBreakers)}</dd>
      <dt>Excluded companies</dt>
      <dd>${list(profile.excludedCompanies)}</dd>
    </dl>
  `;
}

function list(items: readonly string[]): SafeHtml {
  if (items.length === 0) return html`None`;
  return html`<ul class="tags">
    ${items.map((item) => html`<li>${item}</li>`)}
  </ul>`;
}

// --- The form ------------------------------------------------------------------------------------------------------

type FormErrors = Partial<Record<ProfileFormErrorKey, string>>;

export interface ProfileFormView {
  values: ProfileFormValues;
  errors: FormErrors;
  /** Why the form is being filled in: a first profile, one saved in an older shape, or a change to the saved one. */
  reason: 'new' | 'outdated' | 'edit';
}

/** Each field's question and hint, in plain words for any line of work; examples go only in the hints. */
const FIELDS: Readonly<Record<ProfileFormTextField | 'relocate', { label: string; hint?: string }>> = {
  field: { label: 'Your line of work', hint: 'For example: registered nursing, accounting or freight dispatch.' },
  summary: {
    label: 'In a few sentences: what you do now and what you want next',
    hint: 'Optional, up to 1,000 characters.',
  },
  targetRoles: { label: 'Job titles you want', hint: 'One per line.' },
  seniority: { label: 'Your level' },
  yearsExperience: { label: 'Years of experience in this line of work', hint: 'A whole number from 0 to 60.' },
  coreSkills: { label: 'Your main skills, tools or specialties', hint: 'One per line.' },
  secondarySkills: { label: 'Other skills you have', hint: 'One per line. Optional.' },
  credentials: {
    label: 'Licenses, certifications or clearances you hold',
    hint: 'One per line. Optional. For example: RN license (Texas), CPA, CDL-A.',
  },
  remote: {
    label: 'Remote work: the countries or regions you can work remotely from',
    hint: 'One per line. Leave it empty if you don’t want remote work.',
  },
  hybridAreas: { label: 'Cities or areas where you’d work hybrid', hint: 'One per line.' },
  onsiteAreas: { label: 'Cities or areas where you’d work on-site', hint: 'One per line.' },
  relocate: { label: 'Open to relocating' },
  workAuthorization: {
    label: 'Where you can work, and whether you need sponsorship',
    hint: 'For example: US citizen, no sponsorship needed.',
  },
  dealBreakers: { label: 'Things that rule a job out for you', hint: 'One per line. Optional.' },
  excludedCompanies: { label: 'Companies to skip', hint: 'One per line. Optional.' },
};

/** The error summary lists the errors in the order the form shows their fields. */
const SUMMARY_ORDER: readonly ProfileFormErrorKey[] = [
  'field',
  'summary',
  'targetRoles',
  'seniority',
  'yearsExperience',
  'coreSkills',
  'secondarySkills',
  'credentials',
  'locations',
  'remote',
  'hybridAreas',
  'onsiteAreas',
  'relocate',
  'workAuthorization',
  'dealBreakers',
  'excludedCompanies',
];

const INTROS: Readonly<Record<ProfileFormView['reason'], string>> = {
  new: 'Every score is based on your profile, so describe your line of work and the jobs you want in your own words.',
  outdated:
    'Your saved profile is from an older version of the board. What still fits is filled in; check it and fill in the rest.',
  edit: 'Every new score is based on your profile.',
};

const SELECTED = raw('selected');
const CHECKED = raw('checked');

export function profileFormPage(view: ProfileFormView): SafeHtml {
  const { values, errors } = view;
  const field = (name: ProfileFormTextField) => textField(name, values[name], errors[name]);
  const area = (name: ProfileFormTextField, rows: number) => textArea(name, values[name], errors[name], rows);

  return html`
    <h1>${view.reason === 'edit' ? 'Edit your profile' : 'Fill in your profile'}</h1>
    ${errorSummary(errors)}
    <p>${INTROS[view.reason]}</p>
    <form class="profile-form" method="post" action="/profile#errors" novalidate>
      ${field('field')} ${area('summary', 3)} ${area('targetRoles', 3)} ${seniorityField(values.seniority, errors)}
      ${yearsField(values.yearsExperience, errors.yearsExperience)} ${area('coreSkills', 4)}
      ${area('secondarySkills', 3)} ${area('credentials', 3)} ${locationsFieldset(values, errors)}
      ${field('workAuthorization')} ${area('dealBreakers', 3)} ${area('excludedCompanies', 2)}
      <p class="form-actions">
        <button type="submit" class="button">Save profile</button>
        ${view.reason === 'edit' && html`<a href="/profile">Cancel</a>`}
      </p>
    </form>
  `;
}

function errorSummary(errors: FormErrors): SafeHtml | false {
  const entries = SUMMARY_ORDER.flatMap((key) => {
    const error = errors[key];
    return error === undefined ? [] : [{ key, error }];
  });
  if (entries.length === 0) return false;
  const name = (key: ProfileFormErrorKey) => (key === 'locations' ? 'Where you can work' : FIELDS[key].label);
  return html`<div class="error-summary" id="errors" tabindex="-1" role="alert">
    <h2>Fix ${entries.length === 1 ? 'this' : 'these'} to save your profile</h2>
    <ul>
      ${entries.map(({ key, error }) => html`<li><a href="#profile-${key}">${name(key)}: ${error}</a></li>`)}
    </ul>
  </div>`;
}

/** `aria-describedby` for a field: its hint, and its error when it has one (with aria-invalid). */
function described(name: string, hasHint: boolean, error: string | undefined): SafeHtml {
  const ids = [hasHint ? `profile-${name}-hint` : null, error === undefined ? null : `profile-${name}-error`]
    .filter((id) => id !== null)
    .join(' ');
  const invalid = error !== undefined && raw('aria-invalid="true" ');
  return ids === '' ? html`${invalid}` : html`${invalid}aria-describedby="${ids}"`;
}

function labelAndHint(name: ProfileFormTextField, error: string | undefined): SafeHtml {
  const { label, hint } = FIELDS[name];
  return html`<label for="profile-${name}">${label}</label>
    ${hint !== undefined && html`<p class="hint" id="profile-${name}-hint">${hint}</p>`} ${fieldError(name, error)}`;
}

function fieldError(name: string, error: string | undefined): SafeHtml | false {
  return error !== undefined && html`<p class="field-error" id="profile-${name}-error">${error}</p>`;
}

function textField(name: ProfileFormTextField, value: string, error: string | undefined): SafeHtml {
  const attributes = described(name, FIELDS[name].hint !== undefined, error);
  return html`<div class="field">
    ${labelAndHint(name, error)}
    <input type="text" id="profile-${name}" name="${name}" value="${value}" ${attributes} />
  </div>`;
}

function textArea(name: ProfileFormTextField, value: string, error: string | undefined, rows: number): SafeHtml {
  const attributes = described(name, FIELDS[name].hint !== undefined, error);
  return html`<div class="field">${labelAndHint(name, error)} ${textareaTag(name, value, rows, attributes)}</div>`;
}

// A textarea keeps every character between its tags, except one newline right after the opening tag, which the
// browser drops. So exactly one newline goes there, and Prettier must not reflow it. The newline after the closing
// tag keeps "</textarea><" out of the markup, which is what a textarea breakout would look like (NFR-07).
// prettier-ignore
function textareaTag(name: string, value: string, rows: number, attributes: SafeHtml): SafeHtml {
  return html`<textarea id="profile-${name}" name="${name}" rows="${rows}" ${attributes}>
${value}</textarea>
`;
}

function seniorityField(value: string, errors: FormErrors): SafeHtml {
  const known = Object.keys(SENIORITY_LABELS).includes(value);
  return html`<div class="field">
    ${labelAndHint('seniority', errors.seniority)}
    <select id="profile-seniority" name="seniority" ${described('seniority', false, errors.seniority)}>
      <option value="" ${!known && SELECTED}>Choose your level</option>
      ${Object.entries(SENIORITY_LABELS).map(
        ([level, label]) => html`<option value="${level}" ${level === value && SELECTED}>${label}</option>`,
      )}
    </select>
  </div>`;
}

function yearsField(value: string, error: string | undefined): SafeHtml {
  const attributes = described('yearsExperience', true, error);
  return html`<div class="field">
    ${labelAndHint('yearsExperience', error)}
    <input
      type="number"
      id="profile-yearsExperience"
      name="yearsExperience"
      min="0"
      max="60"
      step="1"
      inputmode="numeric"
      value="${value}"
      ${attributes}
    />
  </div>`;
}

function locationsFieldset(values: ProfileFormValues, errors: FormErrors): SafeHtml {
  const area = (name: ProfileFormTextField) => textArea(name, values[name], errors[name], 2);
  return html`<fieldset
    class="profile-locations"
    id="profile-locations"
    ${described('locations', true, errors.locations)}
  >
    <legend>Where you can work</legend>
    <p class="hint" id="profile-locations-hint">Fill in at least one of the three lists.</p>
    ${fieldError('locations', errors.locations)} ${area('remote')} ${area('hybridAreas')} ${area('onsiteAreas')}
    <div class="field field-check">
      <input type="checkbox" id="profile-relocate" name="relocate" value="yes" ${values.relocate && CHECKED} />
      <label for="profile-relocate">${FIELDS.relocate.label}</label>
    </div>
  </fieldset>`;
}
