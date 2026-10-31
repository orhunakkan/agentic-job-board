import type { Profile } from '../../schemas/profile.ts';
import { html, type SafeHtml } from '../html.ts';

// The candidate profile every score is based on, read-only (FR-01).

export function profilePage(profile: Profile | null): SafeHtml {
  if (profile === null) {
    return html`
      <h1>Profile</h1>
      <p class="empty">
        No profile loaded yet. Load <code>data/profile.json</code> with <code>PUT /api/profile</code> (see the README).
        Until then, <code>/find-jobs</code> can read emails but not score jobs.
      </p>
    `;
  }

  const { locations } = profile;
  const where = [
    ...locations.remote.map((region) => `Remote: ${region}`),
    ...locations.hybridAreas.map((area) => `Hybrid: ${area}`),
    ...locations.onsiteAreas.map((area) => `On-site: ${area}`),
  ];

  return html`
    <h1>Profile</h1>
    <p>
      Read-only. Every triage score is based on this profile. To change it, edit <code>data/profile.json</code> and load
      it again with <code>PUT /api/profile</code>.
    </p>
    <dl class="details profile">
      <dt>Line of work</dt>
      <dd>${profile.field}</dd>
      <dt>Summary</dt>
      <dd>${profile.summary === '' ? 'None' : profile.summary}</dd>
      <dt>Target roles</dt>
      <dd>${list(profile.targetRoles)}</dd>
      <dt>Seniority</dt>
      <dd>${capitalize(profile.seniority)}, ${profile.yearsExperience} years of experience</dd>
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

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
