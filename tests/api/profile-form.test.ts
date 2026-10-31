import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProfileSchema } from '../../src/schemas/profile.ts';
import { SAMPLE_PROFILE } from '../helpers/profiles.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// The profile form over real HTTP (FR-01, DEC-065): /profile shows the profile with an Edit button, /profile/edit is
// the form, and POST /profile saves it (303) or shows the form again with its errors and the input kept (400).

/** A nurse's profile, as the form posts it. */
const NURSE = {
  field: 'Registered nursing, critical care',
  summary: '',
  targetRoles: 'ICU Charge Nurse\r\nCritical Care Nurse',
  seniority: 'senior',
  yearsExperience: '6',
  coreSkills: 'Ventilator management\r\nPatient assessment',
  secondarySkills: '',
  credentials: 'RN license (Texas)\r\nCCRN',
  remote: '',
  hybridAreas: '',
  onsiteAreas: 'Austin, TX',
  workAuthorization: 'US citizen',
  dealBreakers: 'night shifts only',
  excludedCompanies: '',
};

describe('the profile form', () => {
  let testApp: TestApp;
  beforeEach(async () => {
    testApp = await startTestApp({ setup: 'none' });
  });
  afterEach(async () => {
    await testApp.close();
  });

  async function storedProfile(): Promise<unknown> {
    return (await testApp.get('/api/profile')).body;
  }

  it('FR-01: an empty form asks for every field in plain words, with examples only in the hints', async () => {
    const page = (await testApp.get('/profile/edit')).text;

    expect(page).toContain('<form class="profile-form" method="post" action="/profile#errors" novalidate>');
    for (const label of [
      'Your line of work',
      'In a few sentences: what you do now and what you want next',
      'Job titles you want',
      'Your level',
      'Years of experience in this line of work',
      'Your main skills, tools or specialties',
      'Other skills you have',
      'Licenses, certifications or clearances you hold',
      'Remote work: the countries or regions you can work remotely from',
      'Cities or areas where you’d work hybrid',
      'Cities or areas where you’d work on-site',
      'Open to relocating',
      'Where you can work, and whether you need sponsorship',
      'Things that rule a job out for you',
      'Companies to skip',
    ]) {
      expect(page, label).toContain(label);
    }
    // Nothing is filled in for the user: every text input is empty and no level is chosen.
    expect(page).not.toMatch(/<input[^>]*type="text"[^>]*value="[^"]/);
    expect(page).toMatch(/<textarea[^>]*name="targetRoles"[^>]*>\n<\/textarea>/);
    expect(page).toContain('<option value="" selected>Choose your level</option>');
  });

  it('FR-01: a valid form is saved and goes to the profile with a one-time notice', async () => {
    const response = await testApp.form('/profile', { ...NURSE, relocate: 'yes' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/profile?saved=yes#notice');
    expect(await storedProfile()).toEqual({
      field: 'Registered nursing, critical care',
      summary: '',
      targetRoles: ['ICU Charge Nurse', 'Critical Care Nurse'],
      seniority: 'senior',
      yearsExperience: 6,
      coreSkills: ['Ventilator management', 'Patient assessment'],
      secondarySkills: [],
      credentials: ['RN license (Texas)', 'CCRN'],
      locations: { remote: [], hybridAreas: [], onsiteAreas: ['Austin, TX'], relocate: true },
      workAuthorization: 'US citizen',
      dealBreakers: ['night shifts only'],
      excludedCompanies: [],
    });
    const profile = (await testApp.get('/profile?saved=yes')).text;
    expect(profile).toContain('<p class="notice" role="status" id="notice" tabindex="-1">Your profile is saved.');
    expect((await testApp.get('/profile')).text).not.toContain('Your profile is saved.');
  });

  it('FR-24: once the profile is saved, the board opens instead of sending the owner to setup', async () => {
    expect((await testApp.raw({ path: '/' })).status).toBe(303);

    await testApp.form('/profile', NURSE);

    expect((await testApp.raw({ path: '/' })).status).toBe(200);
  });

  it('FR-01: an invalid form is a 400 that shows each error next to its field, with a summary, and keeps the input', async () => {
    const response = await testApp.form('/profile', {
      ...NURSE,
      field: '',
      yearsExperience: 'six',
      onsiteAreas: '',
      summary: 'Kept <exactly> as typed',
    });

    expect(response.status).toBe(400);
    const page = response.text;
    expect(page).toMatch(/<div class="error-summary" id="errors" tabindex="-1" role="alert">/);
    expect(page).toContain('<a href="#profile-field">Your line of work: Enter your line of work.</a>');
    expect(page).toContain('<a href="#profile-yearsExperience">');
    expect(page).toMatch(
      /<input type="text" id="profile-field" name="field" value="" aria-invalid="true" aria-describedby="profile-field-hint profile-field-error"/,
    );
    expect(page).toContain('<p class="field-error" id="profile-field-error">Enter your line of work.</p>');
    expect(page).toContain('<p class="field-error" id="profile-yearsExperience-error">Enter a whole number from 0 to 60.</p>');
    expect(page).toContain('id="profile-locations-error"');
    expect(page).toContain('value="six"');
    expect(page).toContain('Kept &lt;exactly&gt; as typed</textarea>');
    expect(page).toMatch(/<textarea[^>]*name="credentials"[^>]*>\nRN license \(Texas\)\r?\nCCRN<\/textarea>/);
    expect(page).toContain('<option value="senior" selected>Senior</option>');
    expect(await storedProfile()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('FR-01: editing later starts from the saved profile and replaces it', async () => {
    await testApp.call('PUT', '/api/profile', SAMPLE_PROFILE);

    const form = (await testApp.get('/profile/edit')).text;
    expect(form).toContain('value="Freight and logistics dispatch"');
    expect(form).toMatch(/name="targetRoles"[^>]*>\nTruck Dispatcher\nLogistics Coordinator<\/textarea>/);
    expect(form).toContain('<option value="senior" selected>Senior</option>');

    await testApp.form('/profile', { ...NURSE, yearsExperience: '9' });

    expect(ProfileSchema.parse(await storedProfile()).yearsExperience).toBe(9);
  });

  it('FR-01: the profile page shows the profile with an Edit button, and nothing to type into', async () => {
    await testApp.call('PUT', '/api/profile', SAMPLE_PROFILE);

    const page = (await testApp.get('/profile')).text;

    expect(page).toContain('<a class="button" href="/profile/edit">Edit</a>');
    expect(/<main[\s\S]*<\/main>/.exec(page)?.[0]).not.toContain('<form');
  });

  it('FR-01: an outdated profile opens the form with the old values that still fit', async () => {
    testApp.app.db
      .prepare('INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)')
      .run(JSON.stringify({ targetRoles: ['Dispatcher'], seniority: 'staff', locations: { remoteUS: true } }), 'x');

    const form = (await testApp.get('/profile/edit')).text;

    expect(form).toContain('from an older version of the board');
    expect(form).toMatch(/name="targetRoles"[^>]*>\nDispatcher<\/textarea>/);
    expect(form).toContain('<option value="" selected>Choose your level</option>');
  });

  it('NFR-09: a body that is not the board’s form is a 400 page and stores nothing', async () => {
    const response = await testApp.form('/profile', { ...NURSE, isAdmin: 'yes' });

    expect(response.status).toBe(400);
    expect(response.text).toContain('<h1>That request is not valid</h1>');
    expect(await storedProfile()).toMatchObject({ error: { code: 'not_found' } });
  });
});
