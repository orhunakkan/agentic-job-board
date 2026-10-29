// Turns the report's client code (scripts/board-report/client/*.ts) into one browser script (PLAN.md Phase 14
// task 7). Browsers refuse module scripts from file://, so the files are joined, dependencies first, into one classic
// script: Node's module.stripTypeScriptTypes removes the types, and the imports and `export` keywords go, since every
// file then shares one scope. That only works for code written for it, so anything else is refused:
//   - imports are named, relative, and not renamed (`import { a } from './b.ts'`; `import type` is erased anyway)
//   - no default export, `import *` or dynamic import, no import cycle, and no top-level name declared twice
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { Script } from 'node:vm';

export class BundleError extends Error {
  override name = 'BundleError';
}

const IMPORT = /^import\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)';?/gms;

interface ClientModule {
  path: string;
  code: string;
}

/** The client's files in the order they must run: each after the files it imports. */
export function bundleClient(entry: string): string {
  const root = dirname(resolve(entry));
  const ordered: ClientModule[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (path: string): void => {
    if (done.has(path)) return;
    if (visiting.has(path)) throw new BundleError(`import cycle through ${relative(root, path)}`);
    visiting.add(path);
    const source = readFileSync(path, 'utf8');
    for (const dependency of runtimeImports(source, path, root)) visit(dependency);
    visiting.delete(path);
    done.add(path);
    ordered.push({ path, code: toScript(source, path, root) });
  };
  visit(resolve(entry));

  const body = ordered
    .map((module) => `// ${relative(root, module.path).replaceAll('\\', '/')}\n${module.code.trim()}\n`)
    .join('\n');
  const bundle = `// board-report's client, built from scripts/board-report/client/ by build/bundle.ts.\n(() => {\n'use strict';\n${body}})();\n`;
  try {
    new Script(bundle, { filename: 'app.js' });
  } catch (error) {
    throw new BundleError(`the joined client is not valid JavaScript: ${String(error)}`);
  }
  return bundle;
}

function runtimeImports(source: string, path: string, root: string): string[] {
  if (/^\s*import\s+\*|^\s*import\s+\w+\s+from|\bimport\(/m.test(source)) {
    throw new BundleError(`${relative(root, path)}: only named imports are allowed`);
  }
  if (/^export\s+default\b/m.test(source)) throw new BundleError(`${relative(root, path)}: no default export`);
  return [...source.matchAll(IMPORT)].flatMap((match) => {
    const [, typeOnly, names = '', from = ''] = match;
    if (typeOnly !== undefined) return [];
    if (!from.startsWith('./'))
      throw new BundleError(`${relative(root, path)}: imports only from ./ in the client (${from})`);
    if (/\bas\b/.test(names.replaceAll(/\btype\s+\w+\s+as\s+\w+/g, ''))) {
      throw new BundleError(`${relative(root, path)}: imports can't be renamed (${names.replaceAll(/\s+/g, ' ')})`);
    }
    return [resolve(dirname(path), from)];
  });
}

function toScript(source: string, path: string, root: string): string {
  const stripped = quietly(() => stripTypeScriptTypes(source, { mode: 'strip' }));
  const script = stripped
    .replaceAll(IMPORT, '')
    .replaceAll(/^export\s*\{\s*\};?[ \t]*$/gm, '')
    .replaceAll(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm, '');
  if (/^export\b/m.test(script)) throw new BundleError(`${relative(root, path)}: an export the bundle can't keep`);
  return script;
}

/** Runs without Node's one-time "stripTypeScriptTypes is experimental" warning, which would only clutter the output. */
function quietly<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'emitWarning');
  const emitWarning = process.emitWarning.bind(process) as (warning: string | Error, ...rest: unknown[]) => void;
  process.emitWarning = (warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (!text.includes('stripTypeScriptTypes')) {
      emitWarning(warning, ...rest);
    }
  };
  try {
    return run();
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(process, 'emitWarning');
    else Object.defineProperty(process, 'emitWarning', descriptor);
  }
}
