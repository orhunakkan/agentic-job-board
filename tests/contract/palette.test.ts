import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// One palette in two files (PLAN.md Phase 15 task 1, DEC-060): the board's public/app.css copies board-report's
// tokens, since the app serves only public/ and the report opens on its own from disk. Every token both stylesheets
// define has the same value in both, in light and in dark, and each defines dark the same way under the system
// setting and under data-theme="dark" (FR-23).

const BOARD = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
const REPORT = readFileSync(new URL('../../scripts/board-report/styles/report.css', import.meta.url), 'utf8');

// The tokens the board takes from board-report (task 1).
const SHARED = [
  '--bg',
  '--bg-glow',
  '--surface',
  '--surface-2',
  '--surface-3',
  '--text',
  '--muted',
  '--border',
  '--border-strong',
  '--shadow',
  '--shadow-hover',
  '--focus',
  '--link',
  '--code-bg',
  '--code-text',
  '--accent',
  '--accent-soft',
  '--accent-on-soft',
  '--header',
  '--radius',
  '--radius-sm',
  '--font',
  '--mono',
  ...['passed', 'broken', 'skipped'].flatMap((status) => [
    `--${status}`,
    `--${status}-ink`,
    `--${status}-soft`,
    `--${status}-on-soft`,
  ]),
  '--none',
  '--none-soft',
  '--none-on-soft',
];

interface Palette {
  light: Map<string, string>;
  systemDark: Map<string, string>;
  chosenDark: Map<string, string>;
}

/** The body of the first rule whose selector is exactly `selector`, braces balanced. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no "${selector}" rule`);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, index);
  }
  throw new Error(`"${selector}" is not closed`);
}

/** The custom properties a rule body (comments already removed) declares, values with their whitespace collapsed. */
function tokens(body: string): Map<string, string> {
  const declarations = body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g);
  return new Map([...declarations].map(([, name = '', value = '']) => [name, value.replace(/\s+/g, ' ').trim()]));
}

function palette(css: string): Palette {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return {
    light: tokens(block(withoutComments, ':root')),
    systemDark: tokens(
      block(block(withoutComments, '@media (prefers-color-scheme: dark)'), ":root:not([data-theme='light'])"),
    ),
    chosenDark: tokens(block(withoutComments, ":root[data-theme='dark']")),
  };
}

const board = palette(BOARD);
const report = palette(REPORT);

function shared(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...a.keys()].filter((name) => b.has(name));
}

describe('the palette the board shares with board-report (DEC-060)', () => {
  it('FR-23: the board defines every token it takes from board-report, in light', () => {
    expect(SHARED.filter((name) => !board.light.has(name))).toEqual([]);
    expect(SHARED.filter((name) => !report.light.has(name))).toEqual([]);
  });

  it('FR-23: every token both stylesheets define in light has the same value in both', () => {
    const names = shared(board.light, report.light);

    expect(names.length).toBeGreaterThanOrEqual(SHARED.length);
    for (const name of names) expect(board.light.get(name), name).toBe(report.light.get(name));
  });

  it.each(['systemDark', 'chosenDark'] as const)(
    'FR-23: every token both stylesheets define in dark (%s) has the same value in both',
    (theme) => {
      const names = shared(board[theme], report[theme]);

      expect(names.length).toBeGreaterThanOrEqual(25);
      for (const name of names) expect(board[theme].get(name), name).toBe(report[theme].get(name));
    },
  );

  it('FR-23: each stylesheet defines dark the same way for the system setting and for the toggle', () => {
    for (const { light, systemDark, chosenDark } of [board, report]) {
      expect(Object.fromEntries(chosenDark)).toEqual(Object.fromEntries(systemDark));
      // Dark changes colours only; every token it sets also exists in light.
      expect([...systemDark.keys()].filter((name) => !light.has(name))).toEqual([]);
    }
  });

  it('FR-23: the top comment of each stylesheet names the other file', () => {
    expect(/^\/\*[\s\S]*?\*\//.exec(BOARD)?.[0]).toContain('scripts/board-report/styles/report.css');
    expect(/^\/\*[\s\S]*?\*\//.exec(REPORT)?.[0]).toContain('public/app.css');
  });
});
