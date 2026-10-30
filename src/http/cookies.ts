// The Cookie request header as name → value (FR-23). Cookies on localhost are shared by every app on any port, so
// this reads leniently: a pair without "=" or a name, or a value that isn't valid percent-encoding, is skipped and
// the rest are still read. A name sent twice keeps its first value, the most specific one (RFC 6265 §5.4).

const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const cookies = new Map<string, string>();
  for (const pair of (header ?? '').split(';')) {
    const equals = pair.indexOf('=');
    if (equals === -1) continue;
    const name = pair.slice(0, equals).trim();
    if (!NAME.test(name) || cookies.has(name)) continue;
    const quoted = pair.slice(equals + 1).trim();
    const value = decode(quoted.replace(/^"(.*)"$/, '$1'));
    if (value !== null) cookies.set(name, value);
  }
  // fromEntries defines own properties, so a cookie named "__proto__" stays data.
  return Object.fromEntries(cookies);
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
