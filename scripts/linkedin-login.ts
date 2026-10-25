// Signs the owner in to LinkedIn once and saves the session for the app and scripts to reuse (DEC-032, DEC-033):
//   node scripts/linkedin-login.ts             opens a browser; if it isn't signed in already, the owner signs in by
//                                              hand (2FA included); then the session is saved
//   node scripts/linkedin-login.ts --ensure    checks the saved session in a hidden browser, refreshes it, and opens
//                                              the sign-in window only when LinkedIn no longer accepts it. Never
//                                              fails. `npm start` does the same through scripts/start.ts
//   node scripts/linkedin-login.ts --check     prints the saved session's status (no browser, no request)
//   options: --session <path>   session file (default LINKEDIN_SESSION_PATH, else data/linkedin/session.json)
//            --channel <name>   msedge (default on Windows), chrome or chromium (Playwright's own build)
// The browser keeps its own profile next to the session file (browser-profile/), so later runs are usually signed in
// already. The owner types the password into LinkedIn's page: this script never sees or stores it, and it never
// prints a cookie value. Other scripts feed the saved session to a browser with
// `browser.newContext({ storageState: readLinkedInSession(path)?.storageState })`.
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs, styleText } from 'node:util';
import { chromium, type BrowserContext } from '@playwright/test';
import { DEFAULT_LINKEDIN_SESSION_PATH } from '../src/config.ts';
import {
  createLinkedInSessionFile,
  isLinkedInSignInPage,
  LINKEDIN_AUTH_COOKIE,
  LINKEDIN_SESSION_LABELS,
  linkedInSessionStatus,
  saveLinkedInSession,
  type LinkedInSessionStatus,
} from '../src/linkedin/session.ts';
import { formatDateTime } from '../src/ui/format.ts';

const SIGN_IN_URL = 'https://www.linkedin.com/login';
const FEED_URL = 'https://www.linkedin.com/feed/';
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
// Expiry dates are often a year away, so they carry the year. Declared before the CLI code below runs.
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export interface LinkedInLoginOptions {
  sessionPath: string;
  /** msedge, chrome or chromium (Playwright's own build). */
  channel: string;
}

export function defaultLoginOptions(env: NodeJS.ProcessEnv = process.env): LinkedInLoginOptions {
  return {
    sessionPath: env['LINKEDIN_SESSION_PATH'] ?? DEFAULT_LINKEDIN_SESSION_PATH,
    channel: process.platform === 'win32' ? 'msedge' : 'chromium',
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      ensure: { type: 'boolean', default: false },
      session: { type: 'string' },
      channel: { type: 'string' },
    },
  });
  const defaults = defaultLoginOptions();
  const options = { sessionPath: values.session ?? defaults.sessionPath, channel: values.channel ?? defaults.channel };

  if (values.check) {
    const status = currentStatus(options);
    console.log(describeLinkedInSession(status, options.sessionPath));
    process.exitCode = status.status === 'active' ? 0 : 1;
  } else if (values.ensure) {
    await ensureLinkedInSession(options);
  } else {
    process.exitCode = (await signIn(options)) ? 0 : 1;
  }
}

/**
 * Makes sure the saved session still signs in: verifies and refreshes it in a hidden browser, and opens the sign-in
 * window only when LinkedIn no longer accepts it. Never throws, so whatever runs next (the app) always starts.
 * `quiet` leaves out the success line, for callers that show the status themselves.
 */
export async function ensureLinkedInSession(
  options: LinkedInLoginOptions,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<void> {
  if (currentStatus(options).status === 'active') {
    const verified = await verify(options);
    if (verified === 'signed-in') {
      if (!quiet) console.log(describeLinkedInSession(currentStatus(options), options.sessionPath));
      return;
    }
    if (verified === 'unreachable') {
      console.log(warning('LinkedIn could not be reached; keeping the saved session as it is.'));
      return;
    }
  }
  console.log(warning('LinkedIn needs you to sign in. A browser window is opening…'));
  if (!(await signIn(options))) {
    console.log(warning('Continuing without a LinkedIn session. Sign in later with: node scripts/linkedin-login.ts'));
  }
}

/** Opens LinkedIn in a hidden browser with the saved profile; refreshes the saved session when it is accepted. */
async function verify(options: LinkedInLoginOptions): Promise<'signed-in' | 'signed-out' | 'unreachable'> {
  const context = await openBrowser(options, { headless: true });
  if (context === null) return 'unreachable';
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    try {
      await page.goto(FEED_URL, { waitUntil: 'domcontentloaded' });
    } catch {
      return 'unreachable';
    }
    if (!(await signedIn(context))) return 'signed-out';
    save(options, await context.storageState());
    return 'signed-in';
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Opens a visible browser and waits for the owner to sign in. Returns whether a session was saved. */
async function signIn(options: LinkedInLoginOptions): Promise<boolean> {
  const context = await openBrowser(options, { headless: false });
  if (context === null) return false;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(SIGN_IN_URL);

    if (!(await signedIn(context))) {
      console.log(styleText('dim', 'Sign in to LinkedIn in the browser window. Waiting up to 10 minutes…'));
      const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
      while (!(await signedIn(context))) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for the LinkedIn sign-in');
        await sleep(1000);
      }
    }

    save(options, await context.storageState());
    console.log(describeLinkedInSession(currentStatus(options), options.sessionPath));
    return true;
  } catch (error) {
    // Closing the window ends the context; say so instead of printing Playwright's stack.
    if (error instanceof Error && /closed/i.test(error.message)) {
      console.error(warning('The browser was closed before the sign-in finished. Nothing was saved.'));
    } else {
      console.error(warning(error instanceof Error ? error.message : String(error)));
    }
    return false;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function openBrowser(
  options: LinkedInLoginOptions,
  { headless }: { headless: boolean },
): Promise<BrowserContext | null> {
  try {
    return await chromium.launchPersistentContext(join(dirname(options.sessionPath), 'browser-profile'), {
      headless,
      viewport: null,
      ...(options.channel === 'chromium' ? {} : { channel: options.channel }),
    });
  } catch (error) {
    // Most often the profile is in use by another sign-in window, or the browser isn't installed.
    const reason = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
    console.error(warning(`Could not open ${options.channel}: ${reason}`));
    return null;
  }
}

/** Signed in once LinkedIn has set its sign-in cookie and no tab is on a sign-in or security-check page. */
async function signedIn(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies('https://www.linkedin.com');
  if (!cookies.some((cookie) => cookie.name === LINKEDIN_AUTH_COOKIE)) return false;
  return context.pages().every((page) => !isLinkedInSignInPage(page.url()));
}

function save(options: LinkedInLoginOptions, storageState: unknown): void {
  saveLinkedInSession(options.sessionPath, createLinkedInSessionFile(storageState, new Date().toISOString()));
}

function currentStatus(options: LinkedInLoginOptions): LinkedInSessionStatus {
  return linkedInSessionStatus(options.sessionPath, new Date().toISOString());
}

function warning(text: string): string {
  return `${styleText('yellow', '!')} ${text}`;
}

/** One coloured line: "✔ LinkedIn: signed in · saved … · expires …", or what is wrong and how to fix it. */
export function describeLinkedInSession(status: LinkedInSessionStatus, sessionPath: string): string {
  const label = `LinkedIn: ${LINKEDIN_SESSION_LABELS[status.status]}`;
  const fix = styleText('dim', ` · run node scripts/linkedin-login.ts`);
  switch (status.status) {
    case 'missing':
      return `${styleText('yellow', `✘ ${label}`)} ${styleText('dim', `(no ${sessionPath})`)}${fix}`;
    case 'invalid':
      return `${styleText('yellow', `✘ ${label}`)} ${styleText('dim', `(${sessionPath})`)}${fix}`;
    case 'expired':
      return `${styleText('yellow', `✘ ${label} ${formatDay(String(status.expiresAt))}`)}${fix}`;
    case 'active': {
      const saved = status.savedAt === null ? '' : ` · saved ${formatDateTime(status.savedAt)}`;
      const expires = ` · expires ${status.expiresAt === null ? 'with the browser session' : formatDay(status.expiresAt)}`;
      return `${styleText('green', `✔ ${label}`)}${styleText('dim', saved + expires)}`;
    }
  }
}

function formatDay(iso: string): string {
  return DAY.format(new Date(iso));
}
