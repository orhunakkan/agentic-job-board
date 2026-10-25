// Shared by every Vitest project: a predictable clock and a fake LinkedIn session.

// A clock that returns 2026-10-23T12:00:00.000Z, then one second later on each call.
export function fakeClock(start = '2026-10-23T12:00:00.000Z'): () => string {
  let time = Date.parse(start);
  return () => {
    const now = new Date(time).toISOString();
    time += 1000;
    return now;
  };
}

/** A cookie value no real session has, so tests can check it never leaks into responses, logs or output. */
export const FAKE_LINKEDIN_COOKIE_VALUE = 'FAKE-li_at-never-shown';

// A browser storage state like Playwright's, signed in to LinkedIn, with one cookie and origin from another site.
// `expires` is the sign-in cookie's expiry in seconds since the epoch (-1: lasts for the browser session).
export function fakeLinkedInStorageState(expires = Date.parse('2027-04-23T12:00:00.000Z') / 1000) {
  const cookie = { path: '/', httpOnly: true, secure: true, sameSite: 'None' as const };
  return {
    cookies: [
      { ...cookie, name: 'li_at', value: FAKE_LINKEDIN_COOKIE_VALUE, domain: '.www.linkedin.com', expires },
      { ...cookie, name: 'JSESSIONID', value: 'ajax:0000', domain: '.www.linkedin.com', expires: -1 },
      { ...cookie, name: 'tracker', value: 'other-site', domain: '.example.com', expires: -1 },
    ],
    origins: [
      { origin: 'https://www.linkedin.com', localStorage: [{ name: 'theme', value: 'dark' }] },
      { origin: 'https://example.com', localStorage: [{ name: 'x', value: 'y' }] },
    ],
  };
}
