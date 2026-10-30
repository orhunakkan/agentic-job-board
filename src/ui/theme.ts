import { THEMES, type Theme } from '../schemas/pages.ts';

// Light or dark (FR-23, DEC-061). Every page follows the system until the owner picks a theme with the header's
// toggle, a form that posts to /theme. The choice is kept in a cookie that holds only the word "light" or "dark",
// the app's only cookie; no page needs a script for it (DEC-006).

export const THEME_COOKIE = 'theme';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** The theme the owner picked, or null to follow the system (no cookie, or one that isn't "light" or "dark"). */
export function themeOf(cookies: Readonly<Record<string, string>> = {}): Theme | null {
  const value = cookies[THEME_COOKIE];
  return THEMES.find((theme) => theme === value) ?? null;
}

/** The Set-Cookie value that keeps the choice for a year, out of reach of scripts and of other sites' requests. */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${String(ONE_YEAR_SECONDS)}; SameSite=Lax; HttpOnly`;
}

// One-time query parameters that show a notice after a form post; switching the theme must not show it again.
const NOTICE_PARAMS = ['changed', 'cleared', 'notes'] as const;
const MAX_RETURN_LENGTH = 2000; // what ThemeFormSchema accepts

/** Where the toggle brings the owner back to: this page with its query, without the notice parameters. */
export function themeReturnPath(path: string, query: URLSearchParams): string {
  const params = new URLSearchParams(query);
  for (const name of NOTICE_PARAMS) params.delete(name);
  const search = params.toString();
  const back = search === '' ? path : `${path}?${search}`;
  return back.length <= MAX_RETURN_LENGTH ? back : '/';
}
