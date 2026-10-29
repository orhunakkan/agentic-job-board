import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'node_modules/',
    'dist/',
    'coverage/',
    'data/',
    'playwright-report/',
    'test-results/',
    'blob-report/',
    'tests/perf/results/',
    // Test reports, board-report's built pages among them (PLAN.md Phase 14); git-ignored like coverage/.
    'reports/',
    // Local-only tooling (git-excluded on the owner's machine), not part of the app.
    '.claude/',
    '.playwright/',
    '.playwright-cli/',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Named exports only; default exports are reserved for config files and k6 scripts.
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    ignores: ['tests/perf/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports (see CLAUDE.md conventions).' },
      ],
    },
  },
);
