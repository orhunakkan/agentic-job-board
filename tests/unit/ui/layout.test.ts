import { describe, expect, it } from 'vitest';
import { html } from '../../../src/ui/html.ts';
import { layout, type LayoutOptions } from '../../../src/ui/layout.ts';

// The page shell's part of the light/dark toggle (FR-23): data-theme on <html> and the toggle form in the header.

function page(options: Partial<LayoutOptions> = {}): string {
  return layout({ title: 'Board', nav: 'board', theme: null, returnPath: '/', body: html`<h1>Board</h1>`, ...options });
}

function htmlTag(text: string): string {
  return /<html[^>]*>/.exec(text)?.[0] ?? '';
}

describe('the layout', () => {
  it('FR-23: puts data-theme on <html> only when the owner chose light or dark', () => {
    expect(htmlTag(page({ theme: 'dark' }))).toBe('<html lang="en" data-theme="dark">');
    expect(htmlTag(page({ theme: 'light' }))).toBe('<html lang="en" data-theme="light">');
    expect(htmlTag(page({ theme: null }))).toMatch(/^<html lang="en"\s*>$/);
    expect(page({ theme: null })).not.toContain('data-theme');
  });

  it('FR-23: renders the toggle form with two buttons, their names and the page to come back to', () => {
    const text = page({ returnPath: '/?origin=other&tab=saved' });
    const form = /<form class="theme-form"[\s\S]*?<\/form>/.exec(text)?.[0] ?? '';

    expect(form).toContain('method="post" action="/theme"');
    expect(form).toContain('<input type="hidden" name="return" value="/?origin=other&amp;tab=saved" />');
    expect(form).toMatch(
      /<button\s+type="submit"\s+class="theme-toggle"\s+name="theme"\s+value="dark"\s+data-next="dark"\s+aria-label="Switch to the dark theme"\s*>[\s\S]*?Dark theme\s*<\/button>/,
    );
    expect(form).toMatch(
      /<button\s+type="submit"\s+class="theme-toggle"\s+name="theme"\s+value="light"\s+data-next="light"\s+aria-label="Switch to the light theme"\s*>[\s\S]*?Light theme\s*<\/button>/,
    );
    expect(form.match(/<button/g)).toHaveLength(2);
  });

  it('FR-23, NFR-07: escapes the return path', () => {
    const text = page({ returnPath: '/nope?"><script>alert(1)</script>' });

    expect(text).toContain('value="/nope?&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(text).not.toContain('<script');
  });

  it('FR-23: the toggle is in the header of an error page too, which has no last run or LinkedIn status', () => {
    const text = page({ nav: null, theme: 'dark' });
    const header = /<header[\s\S]*<\/header>/.exec(text)?.[0] ?? '';

    expect(header).toContain('action="/theme"');
    expect(header).not.toContain('class="last-run"');
    expect(header).not.toContain('class="linkedin-status"');
  });

  it('FR-07: the brand keeps its name: the logo tile is hidden from screen readers', () => {
    expect(page()).toMatch(/<a class="brand" href="\/"><span class="logo" aria-hidden="true"><\/span>Job Board<\/a>/);
  });
});
