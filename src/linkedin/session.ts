import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

// The owner's saved LinkedIn login (DEC-032). scripts/linkedin-login.ts writes it after the owner signs in by hand;
// the app reports its status and scripts feed it to a browser, so the owner signs in only once. It holds cookies,
// never the password, and lives under data/ (git-ignored). Cookie values never leave this module except inside the
// Playwright storage state handed to a browser (NFR-12).

/** LinkedIn's sign-in cookie: present only while the account is signed in. */
export const LINKEDIN_AUTH_COOKIE = 'li_at';

export const LINKEDIN_SESSION_STATES = ['missing', 'invalid', 'expired', 'active'] as const;
export type LinkedInSessionState = (typeof LINKEDIN_SESSION_STATES)[number];

/** How the page header, the start banner and the login script name each state, so they always say the same. */
export const LINKEDIN_SESSION_LABELS: Record<LinkedInSessionState, string> = {
  missing: 'not signed in',
  invalid: 'saved session unreadable',
  expired: 'session expired',
  active: 'signed in',
};

export interface LinkedInSessionStatus {
  status: LinkedInSessionState;
  savedAt: string | null;
  /** When the sign-in cookie expires; null when it lasts for the browser session or there is no session. */
  expiresAt: string | null;
}

export class LinkedInSessionError extends Error {
  override name = 'LinkedInSessionError';
}

// Playwright's storage state. Loose objects keep fields this module doesn't use (for example a cookie's
// partitionKey), so the state handed back to a browser is the one it saved.
const CookieSchema = z.looseObject({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string(),
  expires: z.number(), // seconds since the epoch; -1 for a cookie that lasts for the browser session
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']),
});

const OriginSchema = z.looseObject({
  origin: z.string(),
  localStorage: z.array(z.looseObject({ name: z.string(), value: z.string() })),
});

const StorageStateSchema = z.looseObject({ cookies: z.array(CookieSchema), origins: z.array(OriginSchema) });

export const LinkedInSessionFileSchema = z.strictObject({
  version: z.literal(1),
  savedAt: z.iso.datetime({ offset: true }),
  storageState: StorageStateSchema,
});

export type LinkedInSessionFile = z.infer<typeof LinkedInSessionFileSchema>;
export type StorageState = LinkedInSessionFile['storageState'];

/** linkedin.com and its subdomains, as a cookie domain (".linkedin.com") or a host name. */
export function isLinkedInDomain(domain: string): boolean {
  const host = domain.toLowerCase().replace(/^\./, '');
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

// Pages LinkedIn shows to a visitor who is not signed in, or while a sign-in is in progress (password, 2FA, check).
const SIGN_IN_PATHS = /^\/(?:login|checkpoint|uas|authwall)(?:\/|$)/;

/** Whether a browser on `url` is on LinkedIn's sign-in or security-check pages, so the session no longer works. */
export function isLinkedInSignInPage(url: string): boolean {
  const parsed = URL.parse(url);
  return parsed !== null && isLinkedInDomain(parsed.hostname) && SIGN_IN_PATHS.test(parsed.pathname);
}

function isLinkedInOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && isLinkedInDomain(url.hostname);
  } catch {
    return false;
  }
}

function authCookie(state: StorageState) {
  return state.cookies.find((cookie) => cookie.name === LINKEDIN_AUTH_COOKIE && isLinkedInDomain(cookie.domain));
}

/**
 * Builds the file to save from a browser's storage state, keeping only LinkedIn's cookies and storage.
 * Throws when the browser is not signed in to LinkedIn.
 */
export function createLinkedInSessionFile(storageState: unknown, savedAt: string): LinkedInSessionFile {
  const parsed = StorageStateSchema.safeParse(storageState);
  if (!parsed.success) throw new LinkedInSessionError('The browser returned a storage state this app cannot read');
  const state: StorageState = {
    ...parsed.data,
    cookies: parsed.data.cookies.filter((cookie) => isLinkedInDomain(cookie.domain)),
    origins: parsed.data.origins.filter((origin) => isLinkedInOrigin(origin.origin)),
  };
  if (authCookie(state) === undefined) {
    throw new LinkedInSessionError(`Not signed in to LinkedIn: no ${LINKEDIN_AUTH_COOKIE} cookie`);
  }
  return LinkedInSessionFileSchema.parse({ version: 1, savedAt, storageState: state });
}

/** Writes the session file, replacing the old one in a single rename. Only the owner's account may read it. */
export function saveLinkedInSession(path: string, file: LinkedInSessionFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(LinkedInSessionFileSchema.parse(file), null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

/** The saved session, or null when there is none. Throws LinkedInSessionError when the file can't be used. */
export function readLinkedInSession(path: string): LinkedInSessionFile | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LinkedInSessionError('The saved LinkedIn session is not valid JSON');
  }
  const parsed = LinkedInSessionFileSchema.safeParse(json);
  if (!parsed.success) throw new LinkedInSessionError('The saved LinkedIn session has an unknown format');
  if (authCookie(parsed.data.storageState) === undefined) {
    throw new LinkedInSessionError(`The saved LinkedIn session has no ${LINKEDIN_AUTH_COOKIE} cookie`);
  }
  return parsed.data;
}

/** Whether the saved session can still sign in, judged by the sign-in cookie's expiry at `now` (no request made). */
export function linkedInSessionStatus(path: string, now: string): LinkedInSessionStatus {
  let file: LinkedInSessionFile | null;
  try {
    file = readLinkedInSession(path);
  } catch (error) {
    if (error instanceof LinkedInSessionError) return { status: 'invalid', savedAt: null, expiresAt: null };
    throw error;
  }
  if (file === null) return { status: 'missing', savedAt: null, expiresAt: null };

  // readLinkedInSession guarantees the cookie exists.
  const expires = authCookie(file.storageState)?.expires ?? -1;
  if (expires < 0) return { status: 'active', savedAt: file.savedAt, expiresAt: null };
  const expiresAt = new Date(expires * 1000).toISOString();
  return { status: expires * 1000 > Date.parse(now) ? 'active' : 'expired', savedAt: file.savedAt, expiresAt };
}
