import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFixtureReport } from '../helpers/board-report-fixture.ts';

// NFR-13: board-report opens from disk and makes no request to anywhere (PLAN.md Phase 14 task 7): a strict Content
// Security Policy, no inline script, every value shown as text, and no URL but its own files and GitHub.

const out = join(mkdtempSync(join(tmpdir(), 'board-report-security-')), 'report');
buildFixtureReport(out);
const html = readFileSync(join(out, 'index.html'), 'utf8');

function textFiles(dir: string): [string, string][] {
  return readdirSync(dir).flatMap((name): [string, string][] => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return textFiles(path);
    return ['.html', '.js', '.css'].includes(extname(path))
      ? [[path.slice(out.length + 1).replaceAll('\\', '/'), readFileSync(path, 'utf8')]]
      : [];
  });
}

// SVG elements are created in this namespace; it names the element type and is never fetched.
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

describe('board-report security (NFR-13)', () => {
  it('NFR-13: the page has a strict Content Security Policy', () => {
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? '';
    const directives = new Map(
      policy.split(';').map((part) => {
        const [name = '', ...values] = part.trim().split(/\s+/);
        return [name, values] as const;
      }),
    );

    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('style-src')).toEqual(["'self'"]);
    expect(directives.get('img-src')).toEqual(["'self'"]);
    expect(directives.get('media-src')).toEqual(["'self'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(policy).not.toMatch(/unsafe-|\*|https?:|data:|blob:/);
  });

  it('NFR-13: the page has no inline script, style or event handler', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=/i);
  });

  it('NFR-13: the built report holds no URL but GitHub', () => {
    const files = textFiles(out);
    const urls = files.flatMap(([path, text]) =>
      [...text.matchAll(/\b(?:https?:)?\/\/[\w.-]+\.[a-z]{2,}[^\s"'`<>)]*/gi)].map((match) => `${path}: ${match[0]}`),
    );

    expect(files.map(([path]) => path)).toEqual(
      expect.arrayContaining(['index.html', 'app.js', 'report.css', 'data/index.js']),
    );
    expect(urls.filter((url) => !url.includes(': https://github.com/') && !url.endsWith(SVG_NAMESPACE))).toEqual([]);
    expect(
      files.filter(([, text]) => /@import|url\(\s*['"]?(?:https?:)?\/\//i.test(text)).map(([path]) => path),
    ).toEqual([]);
  });

  it('NFR-13: the client code never writes markup, evaluates text or makes a request', () => {
    const client = fileURLToPath(new URL('../../scripts/board-report/client/', import.meta.url));
    const sources = readdirSync(client).filter((name) => name.endsWith('.ts'));

    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const code = readFileSync(join(client, name), 'utf8');
      expect(code, name).not.toMatch(
        /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|setAttribute\(\s*['"](?:style|on)/,
      );
    }
  });
});
