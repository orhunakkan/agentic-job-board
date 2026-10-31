import { describe, expect, it } from 'vitest';
import { ThemeFormSchema } from '../../../src/schemas/pages.ts';
import { themeCookie, themeOf, themeReturnPath } from '../../../src/ui/theme.ts';

// The light/dark toggle (FR-23, DEC-061): its form, its cookie and where it comes back to.

describe('the theme toggle', () => {
  it('FR-23: the theme form takes light or dark and an optional return path', () => {
    expect(ThemeFormSchema.parse({ theme: 'dark', return: '/runs' })).toEqual({ theme: 'dark', return: '/runs' });
    expect(ThemeFormSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' });
  });

  it.each<[string, Record<string, string>]>([
    ['no theme', { return: '/' }],
    ['another theme', { theme: 'blue' }],
    ['a theme in capitals', { theme: 'Dark' }],
    ['an extra field', { theme: 'dark', admin: '1' }],
    ['a return path over 2,000 characters', { theme: 'dark', return: `/${'a'.repeat(2000)}` }],
  ])('FR-23: the theme form refuses %s', (_case, form) => {
    expect(ThemeFormSchema.safeParse(form).success).toBe(false);
  });

  it('FR-23: only a theme cookie of exactly "light" or "dark" chooses the theme; anything else follows the system', () => {
    expect(themeOf({ theme: 'dark' })).toBe('dark');
    expect(themeOf({ theme: 'light', other: 'x' })).toBe('light');
    expect(themeOf({})).toBeNull();
    expect(themeOf()).toBeNull();
    expect(themeOf({ theme: 'junk' })).toBeNull();
    expect(themeOf({ theme: 'DARK' })).toBeNull();
    expect(themeOf({ Theme: 'dark' })).toBeNull();
  });

  it('FR-23: the cookie keeps the choice for a year, for every page, away from scripts and other sites', () => {
    expect(themeCookie('dark')).toBe('theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly');
    expect(themeCookie('light')).toBe('theme=light; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly');
  });

  it('FR-23: the toggle comes back to the same page with its query, without the one-time notice parameters', () => {
    const back = (path: string, query = '') => themeReturnPath(path, new URLSearchParams(query));

    expect(back('/')).toBe('/');
    expect(back('/', 'origin=other&tab=saved&minScore=70&q=dispatcher&sort=recent&page=2')).toBe(
      '/?origin=other&tab=saved&minScore=70&q=dispatcher&sort=recent&page=2',
    );
    expect(back('/', 'tab=new&changed=12')).toBe('/?tab=new');
    expect(back('/', 'tab=new&cleared=3')).toBe('/?tab=new');
    expect(back('/jobs/7', 'notes=saved')).toBe('/jobs/7');
    expect(back('/jobs/7', 'changed=7&notes=saved')).toBe('/jobs/7');
    expect(back('/', 'q=a b&x=%3Cscript%3E')).toBe('/?q=a+b&x=%3Cscript%3E');
  });

  it('FR-23: a return path longer than the form accepts falls back to the board', () => {
    expect(themeReturnPath('/', new URLSearchParams({ q: 'x'.repeat(1998) }))).toBe('/');
    expect(themeReturnPath('/', new URLSearchParams({ q: 'x'.repeat(1996) }))).toHaveLength(2000);
  });
});
