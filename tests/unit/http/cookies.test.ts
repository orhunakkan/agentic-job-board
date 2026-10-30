import { describe, expect, it } from 'vitest';
import { parseCookies } from '../../../src/http/cookies.ts';

// The Cookie header as name → value (FR-23: the pages read the owner's theme from it).

describe('parseCookies', () => {
  it('FR-23: a request without a Cookie header, or with an empty one, has no cookies', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('  ;  ; ')).toEqual({});
  });

  it('FR-23: reads every cookie of the header, spaces around them ignored', () => {
    expect(parseCookies('theme=dark')).toEqual({ theme: 'dark' });
    expect(parseCookies('a=1; theme=light;b=two ;  c = 3')).toEqual({ a: '1', theme: 'light', b: 'two', c: '3' });
  });

  it('FR-23: a malformed header gives no cookies, and a malformed pair is skipped while the rest are read', () => {
    expect(parseCookies('garbage')).toEqual({});
    expect(parseCookies('=dark')).toEqual({});
    expect(parseCookies('the me=dark')).toEqual({});
    expect(parseCookies('bad=%E0%A4%A; theme=dark; flag')).toEqual({ theme: 'dark' });
  });

  it('FR-23: a name sent twice keeps its first value, the most specific one', () => {
    expect(parseCookies('theme=dark; theme=light')).toEqual({ theme: 'dark' });
  });

  it('FR-23: decodes percent-encoding and drops the quotes around a value', () => {
    expect(parseCookies('name=a%20b; quoted="dark"; empty=')).toEqual({ name: 'a b', quoted: 'dark', empty: '' });
  });

  it('NFR-09: a cookie named __proto__ stays data and never reaches the prototype', () => {
    const cookies = parseCookies('__proto__=x; theme=dark');

    expect(Object.getPrototypeOf(cookies)).toBe(Object.prototype);
    expect(Object.keys(cookies)).toEqual(['__proto__', 'theme']);
  });
});
