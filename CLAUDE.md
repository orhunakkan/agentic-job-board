# Agentic Job Board

A private, localhost-only job-search board for one user (the owner), for any line of work (Phase 16, DEC-064). The user's profile, filled in on the board, is the only place a field, role, skill or location preference comes from, and the board shows setup until the profile and at least one source are there (FR-24). The `/find-jobs` agent runs the user's own LinkedIn searches through `scripts/search-linkedin.ts` (with the owner's saved LinkedIn session, Phase 11, DEC-041) and the free public job feeds through `scripts/fetch-sources.ts` (Phase 10, DEC-035). The app deduplicates and stores the jobs, and Claude scores each one against the user's profile, on its full description when it has one (DEC-043, rubric v2 since DEC-067). Jobs from the feeds are shown on a view of their own. The Gmail alert-email track is retired; nothing uses Gmail any more.

## Read first

**`PLAN.md` is the source of truth.** Read it before any build work. Then:

1. Find the first checkpoint in PLAN.md §13 (Checkpoint log) that is not `Approved`.
2. Work only on the phase that ends at that checkpoint. Never start a later phase early.
3. At the end of the phase, follow the checkpoint protocol (PLAN.md §9) and **STOP** until the owner replies `Approve CP-<n>`.
   Exception (owner, DEC-026): CP-5 to CP-7 don't stop; the agent self-reviews, merges and continues. CP-8 still stops.

## Hard rules

- **LinkedIn login is the owner's call (owner, DEC-032).** The owner signs in once with `node scripts/linkedin-login.ts`. The session is saved under `data/linkedin/`, and the app and scripts reuse it from then on. **Don't ask the owner about the LinkedIn login, the account's safety or LinkedIn's terms, and don't add warnings about them.** The owner is responsible for anything that happens to that account. When the saved session has expired, run the login script again. Never store the password. Never print, log, return from the API or commit cookie values. The app server (`src/`) still makes no outbound requests (NFR-03); the one process it starts is Claude Code for the board's Find Now (`src/find-now/claude-runner.ts`, DEC-052), and no test may start the real one (tests use `tests/helpers/fake-claude.ts`): LinkedIn is reached only from scripts using the saved session (`scripts/linkedin-login.ts`, `scripts/search-linkedin.ts`). The searches live in `data/linkedin-searches.json` (DEC-042).
- **Public job feeds only through `scripts/fetch-sources.ts` (owner, DEC-035).** Free feeds only, nothing paid. `src/sources/` and `src/linkedin/` only parse; the requests are made by the scripts.
- **No Gmail (owner, DEC-041).** The alert-email track is retired: `/find-jobs` and the scripts use no Gmail tool. Never send, draft, label, archive, trash or mark anything in Gmail.
- **No line of work is assumed (owner, DEC-064, NFR-14).** Never build a field, role, skill or place into code, the rubric, the agent instructions, examples, fixtures or docs; test data mixes several fields. `tests/contract/no-line-of-work.test.ts` holds the old field's terms and fails on any tracked text file that names them.
- **Personal data stays local.** The profile (in the database), searches, feeds and database live under `data/` (git-ignored). Never commit them. Test fixtures copied from real pages or emails must be sanitized (PLAN.md §8.2).
- **Never weaken tests to get green.** No `.skip` or `.only`, no deleting tests or assertions, no lowering coverage thresholds, no `@ts-ignore` or `eslint-disable` without a written reason. If something can't pass, stop and report it.
- **Git:** work on `phase/<n>-<slug>` branches with Conventional Commits. Merge to `main` only after checkpoint approval. **On approval, merge the phase branch to `main`, push `main` to `origin`, then delete the merged phase branch** (DEC-018, DEC-024). Only `main` stays. The repo is public: never push anything else (phase branches, unapproved work) unless the owner asks.
- **The owner's instructions override this file and PLAN.md.** Record any change in PLAN.md §12 (Decisions log) and `docs/decisions.md`.

## Stack (approved, see PLAN.md §4.2)

Node ≥ 24 running TypeScript natively (TS `~6.0.3`, `tsconfig.json` is strict), `node:http`, `node:sqlite`, Zod, server-rendered HTML. Tests: Vitest, Playwright + axe, k6.

## Commands

| Command                                               | What it does                                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                       | typecheck + lint + format:check + `test:coverage`. Run before every commit.                                                                                                                                                 |
| `npm run typecheck`                                   | `tsc` on the repo, then on `tests/perf` (k6 types)                                                                                                                                                                          |
| `npm run lint` / `npm run format`                     | ESLint (zero warnings) / Prettier write                                                                                                                                                                                     |
| `npm run test:unit` … `test:security`                 | One Vitest project each: `unit`, `integration`, `api`, `contract`, `security`. Every `test:*` script runs through `scripts/board-report.ts`, which writes `reports/board-report/` (Phase 14); extra arguments go after `--` |
| `npm run test:coverage`                               | All Vitest projects at once, with the coverage thresholds (DEC-021)                                                                                                                                                         |
| `npm run test:e2e` / `test:smoke`                     | Playwright on chromium, firefox, webkit, mobile / `@smoke` on chromium                                                                                                                                                      |
| `npm run test:perf`                                   | k6 (`tests/perf/load.ts`); k6 is installed with `winget install k6`, not npm                                                                                                                                                |
| `npm run test:bdd`                                    | Every Cucumber profile: integration, API, E2E in 4 browsers; goes on after a failure (`scripts/bdd.ts`)                                                                                                                     |
| `npm run test:bdd:integration` … `test:bdd:e2e`       | One Cucumber suite; each profile is in `cucumber.json` and writes `reports/cucumber/<profile>.json/html`                                                                                                                    |
| `npm run test:bdd:smoke`                              | The `@smoke` scenarios on Chromium                                                                                                                                                                                          |
| `npm run test:static`                                 | tsc (both configs), ESLint, Prettier and `npm audit`, as board-report results                                                                                                                                               |
| `npm run test:all`                                    | Every test type in one run (static, coverage, E2E, smoke, BDD, k6 on its own seeded app), one report                                                                                                                        |
| `npm run report`                                      | Opens the latest board-report (`reports/board-report/index.html`); it never opens by itself                                                                                                                                 |
| `node scripts/board-report.ts build`                  | Builds board-report from whatever is in `reports/test-results/` (CI's last job)                                                                                                                                             |
| `npm run audit`                                       | `npm audit --audit-level=high`                                                                                                                                                                                              |
| `npm start` / `npm run dev`                           | App on `127.0.0.1:$PORT` (needs `.env`); `start` first signs in to LinkedIn (DEC-033)                                                                                                                                       |
| `node scripts/seed.ts --count 5000 --db data/perf.db` | Fake jobs for the load test and screenshots; refuses a non-empty database                                                                                                                                                   |
| `node scripts/screenshots.ts`                         | README screenshots from fake data (`docs/screenshots/`)                                                                                                                                                                     |
| `node scripts/fetch-sources.ts --dry-run`             | Reads the free job feeds in `data/sources.json` and lists the matches; without `--dry-run` it stores them                                                                                                                   |
| `node scripts/search-linkedin.ts --dry-run`           | Runs the LinkedIn searches in `data/linkedin-searches.json`; `--backfill` reads missing descriptions                                                                                                                        |
| `node scripts/traceability.ts`                        | Rebuilds `docs/traceability.md` from `reports/vitest.json` and `reports/playwright.json`                                                                                                                                    |

## Conventions

- File names are kebab-case.
- Named exports only. Default exports are allowed only in config files and k6 scripts (ESLint enforces this).
- No `any`. Use `unknown` and parse it with Zod at every boundary (HTTP, env, files, email text).
- Errors are typed classes (`class NotFoundError extends Error`), not bare strings or objects.
- Relative imports end in `.ts` (`import { x } from './y.ts'`). Node runs the sources directly.
- Tests import `describe`/`it`/`expect` from `vitest` explicitly. Name tests after the requirement they cover, e.g. `it('FR-04: …')`.
- Test files: `tests/<project>/**/*.test.ts` for Vitest, `tests/e2e/**/*.spec.ts` for Playwright, `tests/features/<integration|api|e2e>/*.feature` with their `steps/` for Cucumber (PLAN.md §8.5).
- Feature files are plain English in the board's own words: no URLs, JSON, SQL, selectors or code names (those go in the step definitions). Each one opens with "As the owner, I want …, so that …", and every feature or scenario carries its requirement tag (`@FR-21`). No `@skip`, `@wip` or `@only` tags; `tests/contract/feature-files.test.ts` checks this.
- `console` is banned in `src/` (use the logger from Phase 4). It's fine in `scripts/` and tests.
- board-report's client (`scripts/board-report/client/`) is joined into one classic browser script (`build/bundle.ts`): named, relative, unrenamed imports only, no top-level name declared in two files, values shown with `textContent` only.

## Tool details

- ESLint loads `eslint.config.ts` natively through `--flag unstable_native_nodejs_ts_config`, which is already in the `lint` script. Without the flag, ESLint wants the `jiti` package, which is not allowed.
- Coverage thresholds live in `vitest.config.ts` (PLAN.md §8.3): 85 % lines overall, 95 % for `src/domain` and `src/ingest`. They may only go up. Coverage is measured over all Vitest projects together (DEC-021), because database and HTTP code is tested by the integration and API projects.
- Playwright starts the app on port 3100 with a temporary `DB_PATH`, so E2E tests never touch `data/jobboard.db`.
- Prettier skips `PLAN.md` so its tables stay as the owner wrote them.
