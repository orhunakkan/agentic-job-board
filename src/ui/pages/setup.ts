import type { FileStatus, ProfileStatus, SetupStatus } from '../../domain/setup.ts';
import { html, type SafeHtml } from '../html.ts';

// The setup checklist (FR-24, DEC-066): what the board needs before it looks for jobs, each with its status. The
// files' contents are never shown, only whether each one is there and valid.

export interface SetupView {
  status: SetupStatus;
  linkedinSearchesPath: string;
  sourcesPath: string;
}

const PROFILE_LABELS: Record<ProfileStatus, string> = {
  missing: 'Not filled in',
  outdated: 'Needs filling in again',
  saved: 'Saved',
};

const FILE_LABELS: Record<FileStatus, string> = {
  missing: 'Not there',
  invalid: 'Has a problem',
  ready: 'Ready',
};

export function setupPage(view: SetupView): SafeHtml {
  const { status } = view;
  return html`
    <h1>Setup</h1>
    <p>
      The board needs a few things from you before it looks for jobs: your profile, which every score is based on, and
      at least one place to search, your LinkedIn searches or the free job feeds.
    </p>
    <ol class="setup-list">
      <li class="panel setup-item" data-status="${status.profile}">
        <h2>Your profile ${chip(PROFILE_LABELS[status.profile], status.profile === 'saved')}</h2>
        ${profileStep(status.profile)}
      </li>
      <li class="panel setup-item" data-status="${status.linkedinSearches}">
        <h2>LinkedIn searches ${chip(FILE_LABELS[status.linkedinSearches], status.linkedinSearches === 'ready')}</h2>
        <p>
          The searches the LinkedIn view runs. Copy <code>linkedin-searches.example.json</code> to
          <code>${view.linkedinSearchesPath}</code> and change the searches to the jobs you want (see the README).
          ${
            status.linkedinSearches === 'invalid' &&
            html`The file is there but isn't valid: <code>node scripts/search-linkedin.ts --dry-run</code> says what is
              wrong.`
          }
        </p>
        <p>Then sign in to LinkedIn once: <code>node scripts/linkedin-login.ts</code>.</p>
      </li>
      <li class="panel setup-item" data-status="${status.sources}">
        <h2>Free job feeds ${chip(FILE_LABELS[status.sources], status.sources === 'ready')}</h2>
        <p>
          The free job feeds and company job boards the Other sources view reads. Copy
          <code>sources.example.json</code> to <code>${view.sourcesPath}</code>, then set your keywords and turn on the
          feeds you want (see the README).
          ${
            status.sources === 'invalid' &&
            html`The file is there but isn't valid, or turns nothing on:
              <code>node scripts/fetch-sources.ts --dry-run</code> says what is wrong.`
          }
        </p>
      </li>
    </ol>
    <p>
      ${
        status.ready
          ? html`Everything the board needs is there. <a href="/">Open the board</a>.`
          : html`You need your profile and at least one of the LinkedIn searches or the feeds.`
      }
    </p>
  `;
}

function profileStep(status: ProfileStatus): SafeHtml {
  if (status === 'saved') {
    return html`<p>Every score is based on it. <a href="/profile">See your profile</a> or change it there.</p>`;
  }
  const intro =
    status === 'outdated'
      ? 'Your saved profile is from an older version of the board. Fill it in again; what still fits is filled in for you.'
      : 'Your line of work, the jobs you want, your skills and where you can work. Every score is based on it.';
  return html`<p>${intro}</p>
    <p><a class="button" href="/profile/edit">Fill in your profile</a></p>`;
}

function chip(label: string, done: boolean): SafeHtml {
  return html`<span class="chip setup-status" data-done="${done ? 'yes' : 'no'}">${label}</span>`;
}
