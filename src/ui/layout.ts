import type { RunRecord } from '../db/repositories/runs.ts';
import { LINKEDIN_SESSION_LABELS, type LinkedInSessionStatus } from '../linkedin/session.ts';
import type { Theme } from '../schemas/pages.ts';
import { formatDateTime } from './format.ts';
import { html, raw, type SafeHtml } from './html.ts';

// The HTML shell of every page (PLAN.md Phase 6): language, title, skip link, header with the last run and the
// LinkedIn sign-in status (FR-14), nav, and the light/dark toggle (FR-23).

export type NavItem = 'board' | 'runs' | 'profile';

export interface LayoutOptions {
  title: string;
  nav: NavItem | null;
  lastRun?: RunRecord | null; // left out on error pages, where the database may be the problem
  linkedin?: LinkedInSessionStatus; // left out on error pages too
  theme: Theme | null; // the owner's choice from the theme cookie; null follows the system (FR-23)
  returnPath: string; // where the theme toggle comes back to: this page, without its one-time notice
  body: SafeHtml;
}

const NAV: readonly { item: NavItem; href: string; label: string }[] = [
  { item: 'board', href: '/', label: 'Board' },
  { item: 'runs', href: '/runs', label: 'Runs' },
  { item: 'profile', href: '/profile', label: 'Profile' },
];

export function layout(options: LayoutOptions): string {
  const page = html`<!doctype html>
    <html lang="en" ${options.theme !== null && html`data-theme="${options.theme}"`}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${options.title} · Job Board</title>
        <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/static/app.css" />
      </head>
      <body>
        <a class="skip-link" href="#main">Skip to main content</a>
        <header class="site-header">
          <div class="wrap header-row">
            <a class="brand" href="/"><span class="logo" aria-hidden="true"></span>Job Board</a>
            <nav aria-label="Main">
              <ul class="nav">
                ${NAV.map(
                  ({ item, href, label }) =>
                    html`<li><a href="${href}" ${item === options.nav && CURRENT}>${label}</a></li>`,
                )}
              </ul>
            </nav>
            <div class="header-side">
              ${options.lastRun !== undefined && html`<p class="last-run">${lastRunLine(options.lastRun)}</p>`}
              ${options.linkedin !== undefined && linkedinStatus(options.linkedin)} ${themeToggle(options.returnPath)}
            </div>
          </div>
        </header>
        <main id="main" class="wrap" tabindex="-1">${options.body}</main>
      </body>
    </html> `;
  return page.value;
}

/** Marks the link to the page being shown (also used by the board tabs). */
export const CURRENT = raw('aria-current="page"');

/**
 * The light/dark toggle (FR-23, DEC-061): a form, so it needs no script. app.css shows only the button that switches
 * away from the theme in effect, whether the system or the cookie chose it, and hides the other with display: none,
 * so the keyboard and screen readers meet exactly one. The text and names are board-report's.
 */
function themeToggle(returnPath: string): SafeHtml {
  return html`<form class="theme-form" method="post" action="/theme">
    <input type="hidden" name="return" value="${returnPath}" />
    <button
      type="submit"
      class="theme-toggle"
      name="theme"
      value="dark"
      data-next="dark"
      aria-label="Switch to the dark theme"
    >
      <span class="theme-icon" aria-hidden="true"></span>Dark theme
    </button>
    <button
      type="submit"
      class="theme-toggle"
      name="theme"
      value="light"
      data-next="light"
      aria-label="Switch to the light theme"
    >
      <span class="theme-icon" aria-hidden="true"></span>Light theme
    </button>
  </form>`;
}

function lastRunLine(run: RunRecord | null): SafeHtml {
  if (run === null) return html`No runs yet: run <code>/find-jobs</code> in Claude Code`;
  return html`Last run: <a href="/runs">${formatDateTime(run.startedAt)}</a> · ${run.jobsNew} new · ${run.jobsSeenAgain}
    seen again`;
}

function linkedinStatus(session: LinkedInSessionStatus): SafeHtml {
  return html`<p class="linkedin-status" data-status="${session.status}">${linkedinLine(session)}</p>`;
}

// The text carries the status; the coloured dot in app.css only repeats it.
function linkedinLine(session: LinkedInSessionStatus): SafeHtml {
  const label = html`LinkedIn: <strong>${LINKEDIN_SESSION_LABELS[session.status]}</strong>`;
  if (session.status !== 'active') return html`${label} · sign in with <code>node scripts/linkedin-login.ts</code>`;
  const checked = session.savedAt !== null && html` · checked ${formatDateTime(session.savedAt)}`;
  return html`${label}${checked}`;
}
