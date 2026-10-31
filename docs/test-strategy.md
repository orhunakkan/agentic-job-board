# Test Strategy — Agentic Job Board

|                      |                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Product**          | Agentic Job Board: a private, localhost-only tracker for the owner's LinkedIn searches and free job feeds, with AI scoring          |
| **Owner / approver** | Orhun Akkan                                                                                                                         |
| **Status**           | v1.1: written in Phase 0 (CP-0), updated in Phase 11 when LinkedIn searches replaced the alert emails (DEC-041)                     |
| **Related**          | [`PLAN.md`](../PLAN.md) (requirements §3, testing §8), [`decisions.md`](decisions.md), `traceability.md` and `defects.md` (Phase 8) |

## 1. Purpose

This document explains how the Agentic Job Board is tested, why each layer exists, and what "done" means at each stage. The product is small, but it is tested like a production system: ten test types, from static analysis to load testing, each aimed at a specific risk.

## 2. Scope

### 2.1 In scope

| Area                 | What we verify                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LinkedIn searches    | Search options become LinkedIn's URL parameters; search cards and job pages become jobs with description, salary, workplace and posted time (FR-18, FR-19)      |
| Deduplication        | One job per source and job ID; a LinkedIn job found again, or known from an alert email, is the same job (FR-04, FR-16, FR-18)                                  |
| Domain rules         | Status workflow (all 49 from/to pairs), score-to-label bands, URL canonicalization (FR-06, FR-08)                                                               |
| Persistence          | Migrations, repositories, transactions and rollback on `node:sqlite`                                                                                            |
| JSON API             | Every endpoint and status code: 200/201, 400, 404, 409, 413, 415 (FR-06, FR-11, FR-20, NFR-09)                                                                  |
| Agent ↔ app contract | The payloads `/find-jobs` sends and the answers it reads (scripts' summaries, scoring queue) match their Zod schemas                                            |
| Security             | Loopback binding, DNS-rebinding guard, same-origin form posts, output escaping, parameterized SQL, security headers, no stored tracking tokens (NFR-01, NFR-07) |
| UI                   | Board, job detail, runs and profile pages: flows, responsiveness and accessibility (FR-07, FR-09, FR-10, NFR-06, NFR-11)                                        |
| Performance          | p95 latency and error rate with 5,000 jobs (NFR-05)                                                                                                             |

### 2.2 Out of scope

| Item                                               | Reason                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality of Claude's scores (AI evals, red-teaming) | Post-MVP R4. In the MVP, scores are checked by hand against a six-job calibration set at CP-5.                                                                   |
| LinkedIn and the job feeds themselves              | Third-party systems. We test against sanitized copies of their pages and answers, never against the live services; the live check is by hand at each checkpoint. |
| Multi-user, authentication, hosting                | Not part of the MVP (R6).                                                                                                                                        |
| Browsers older than the current Playwright builds  | Single owner on current browsers.                                                                                                                                |

## 3. Risks and how they are tested

| #    | Risk                                                                              | Likelihood                   | Impact | Mitigation (test type)                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------- | ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | LinkedIn changes its search page and jobs are silently lost                       | Medium                       | High   | Script tests on saved, sanitized copies of the pages in Chromium; a search whose cards can't be read is reported in the run summary, never silently empty                           |
| R-02 | Duplicate jobs flood the board                                                    | High (searches repeat a lot) | Medium | Integration tests for dedupe by source and job ID, one sighting per run, and jobs from the email years matched by their LinkedIn ID                                                 |
| R-03 | Tracking tokens (`otpToken`, `midToken`) or personal data get stored or committed | Medium                       | High   | URL canonicalizer unit tests; a security test that no stored URL has a query string; `.gitignore` test; fixture review at CP-2                                                      |
| R-04 | Job text (titles, descriptions) injects HTML or script into the board             | Low                          | High   | Escaping unit tests; security tests with `<script>` titles, descriptions and search names on every page                                                                             |
| R-05 | A web page in the owner's browser drives the local API (CSRF, DNS rebinding)      | Low                          | High   | Security tests: wrong `Host` → 421, cross-site post → 403                                                                                                                           |
| R-06 | Prompt injection in a job description changes the agent's behavior                | Medium                       | Medium | The agent reads descriptions as data, never instructions (procedure and rubric, checked by a security test); the app validates every score with Zod and rejects inconsistent labels |
| R-07 | Invalid status changes corrupt the history                                        | Medium                       | Medium | Table-driven unit test on all 49 pairs; API test for 409; E2E checks that invalid transitions are not offered                                                                       |
| R-08 | The board becomes slow as jobs pile up                                            | Low                          | Medium | k6 with 5,000 seeded jobs, p95 < 200 ms                                                                                                                                             |
| R-09 | Pages are unusable with a keyboard or screen reader                               | Medium                       | Medium | axe on every page and tab, plus keyboard-focus checks in E2E                                                                                                                        |
| R-10 | Tests are weakened to get to green                                                | Medium                       | High   | Written rules (CLAUDE.md, PLAN.md §8.4); `forbidOnly` / `allowOnly: false`; coverage thresholds that may only go up; review at every checkpoint                                     |

## 4. Test levels

The pyramid runs from many fast, isolated tests at the bottom to a few slow, broad tests at the top. Each level has its own Vitest project or tool, so it can be run on its own.

| #   | Type          | Tool                                                 | Location                 | What it proves                                                                                                    | From phase                   |
| --- | ------------- | ---------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Static        | `tsc` (strict), ESLint `strictTypeChecked`, Prettier | whole repo               | Types are sound, risky patterns are banned (floating promises, non-exhaustive switches, `any`), code is formatted | 0                            |
| 2   | Unit          | Vitest + v8 coverage                                 | `tests/unit`             | Pure logic: search URLs, page readers, feed parsers, URL canonicalizer, status machine, score bands, escaping     | 1                            |
| 3   | Integration   | Vitest + `node:sqlite`, Chromium for saved pages     | `tests/integration`      | Migrations, repositories, listing ingest, transactions, both scripts against a real app                           | 3                            |
| 4   | API           | Vitest + built-in `fetch` against a real server      | `tests/api`              | Every endpoint and error code                                                                                     | 4                            |
| 5   | Contract      | Vitest + Zod                                         | `tests/contract`         | Every response matches its schema; the agent's example payloads match the request schemas                         | 4                            |
| 6   | Security      | Vitest + `fetch`                                     | `tests/security`         | Threat-model checks (see R-03, R-04, R-05) and `npm audit`                                                        | 0 (`.gitignore`), 4 (server) |
| 7   | End-to-end    | Playwright: Chromium, Firefox, WebKit, Pixel 7       | `tests/e2e`              | Real user flows: filter, save, apply, interview, notes, dismiss and restore                                       | 6                            |
| 8   | Smoke         | Playwright `@smoke` on Chromium                      | `tests/e2e` (tagged)     | The app starts, health is ok, the board renders, a job opens                                                      | 6                            |
| 9   | Accessibility | `@axe-core/playwright`                               | `tests/e2e/a11y.spec.ts` | Zero WCAG 2.2 AA violations on every page and tab                                                                 | 6                            |
| 10  | Performance   | k6 (TypeScript scripts)                              | `tests/perf`             | p95 < 200 ms and < 1 % errors with 5,000 jobs                                                                     | 7                            |

**BDD layer (Phase 13, DEC-056):** types 3, 4, 7 and 8 also have Cucumber scenarios in `tests/features/`, the requirements written in plain English (`Given` / `When` / `Then`) and run by Cucumber.js on top of the tests above, which stay as they are:

| #   | Type        | Scenarios                                     | What a scenario drives                                          | Command                        |
| --- | ----------- | --------------------------------------------- | --------------------------------------------------------------- | ------------------------------ |
| 3   | Integration | `tests/features/integration/`                 | The services on a temporary database; rows checked with SQL     | `npm run test:bdd:integration` |
| 4   | API         | `tests/features/api/`                         | A real app over HTTP: the JSON API and the board's form posts   | `npm run test:bdd:api`         |
| 7   | End-to-end  | `tests/features/e2e/`                         | The board in Chromium, Firefox, WebKit and Pixel 7 (Playwright) | `npm run test:bdd:e2e`         |
| 8   | Smoke       | `tests/features/e2e/smoke.feature` (`@smoke`) | The app starts, the board, a job and the runs page, on Chromium | `npm run test:bdd:smoke`       |

Every scenario is tagged with its requirement and starts from a clean app; Vitest keeps the edge cases. The scenarios run outside Vitest, so they don't count toward coverage. How to read and run them: [`tests/features/README.md`](../tests/features/README.md).

**Design principle:** deterministic code is tested deterministically. Reading pages, deduplication, storage and validation are code with full test coverage. Claude does only the scoring, and the app still validates every score it receives.

## 5. Test data

- **Saved LinkedIn pages** (`tests/fixtures/linkedin/`) are copies of a live search page, job pane, closed job pane and no-results page, cut down to what the script reads and **sanitized**: made-up companies, jobs and tracking values; no logos, scripts, header or member links. A security test checks them.
- **The email years** (`tests/fixtures/email-years.json`): the rows the retired email ingest stored for three sanitized alert emails (reviewed at CP-2), so tests can check that old jobs keep their history.
- **Hand-written edge cases:** cards that never fill in, unreadable pages, a page past the last result, closed jobs, `<script>` in every field, and LinkedIn refusing requests.
- **Databases:** every test file gets its own temporary SQLite file and deletes it afterwards. E2E uses a separate server on port 3100 with a temporary database. No test ever reads or writes `data/`.
- **E2E isolation:** all Playwright projects share one E2E server, so every test seeds its own jobs through the JSON API (`tests/e2e/seed.ts`), with a unique tag in each title and company, unique LinkedIn IDs, and the board filtered by that tag. Tests then run fully parallel without seeing each other's jobs.
- **Performance data:** `scripts/seed.ts` generates 5,000 realistic fake jobs through the real listing ingest and status services, as LinkedIn searches would bring them, the same every time for a given `--seed`. No real data is used, and it refuses to write into a database that already has jobs. To run the load test:

  ```bash
  node scripts/seed.ts --count 5000 --db data/perf.db
  PORT=3000 DB_PATH=data/perf.db LOG_LEVEL=warn node src/main.ts    # in a second terminal
  npm run test:perf                                                  # k6, BASE_URL=http://127.0.0.1:3000
  ```

## 6. Environments

| Environment                                                    | Used for                                                             | Notes                                                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner's machine (Windows 11, Node 24, Git Bash and PowerShell) | All levels                                                           | The reference environment (NFR-10)                                                                                                                                  |
| GitHub Actions (`.github/workflows/ci.yml`)                    | Static + unit → all Vitest projects with coverage → E2E/smoke → perf | On the owner's Linux Mint laptop (self-hosted runner) when `CI_RUNNER` is set (DEC-039), except pull requests, which run on GitHub's runners; nightly too (DEC-063) |
| Browsers                                                       | Chromium, Firefox, WebKit, Pixel 7 emulation                         | Installed with `npx playwright install`                                                                                                                             |
| k6                                                             | Load tests                                                           | Installed with `winget install k6` (not an npm package)                                                                                                             |

## 7. Entry and exit criteria

### 7.1 Entry criteria (before a phase starts)

- The previous checkpoint is `Approved` in PLAN.md §13 (or, for CP-5 to CP-7, `Done (DEC-026)`: the owner reviews the final product at CP-8).
- `npm ci` succeeds and `npm run check` is green on `main`.
- The phase's requirements and acceptance criteria are clear. Open questions are answered by the owner before work starts.

### 7.2 Exit criteria (before a checkpoint is reported)

- Every gate that applies to the phase is green (PLAN.md §8.4):

  | From phase | Gate                                                                                            |
  | ---------- | ----------------------------------------------------------------------------------------------- |
  | 1          | `npm run check` (typecheck, lint, format, all Vitest + coverage)                                |
  | 3          | `npm run test:integration`                                                                      |
  | 4          | `npm run test:api`, `test:contract`, `test:security`                                            |
  | 6          | `npm run test:e2e`, `test:smoke`                                                                |
  | 7          | `npm run test:perf`                                                                             |
  | 13         | `npm run test:bdd`, `test:bdd:smoke`                                                            |
  | always     | `npm run audit` passes and every dependency in `package.json` is listed in PLAN.md §7 (DEC-055) |

- Coverage meets §8 below.
- Every defect found in the phase is logged with its status.
- The checkpoint report lists real results, deviations and open questions.

### 7.3 Suspension criteria

Work stops and the owner is asked when:

- a test can't pass without weakening it
- a requirement turns out to be wrong or impossible

## 8. Coverage targets

| Area                       | Line coverage | Enforced by                   |
| -------------------------- | ------------- | ----------------------------- |
| `src/domain`, `src/ingest` | ≥ 95 %        | `vitest.config.ts` thresholds |
| All of `src`               | ≥ 85 %        | `vitest.config.ts` thresholds |

Coverage is measured over all Vitest projects together (`npm run test:coverage`, DEC-021): database and HTTP code is covered by the integration and API tests, not by unit tests. Thresholds may only go up. Coverage is a floor, not the goal: every requirement must also map to at least one named test in `docs/traceability.md` (Phase 8).

## 9. Rules for keeping tests honest

- No `.skip` or `.only`. `.only` is also blocked by config (`allowOnly: false`, `forbidOnly: true`).
- No deleted tests or weakened assertions, and no lowered thresholds.
- No `@ts-ignore` or `eslint-disable` without a written reason next to it.
- No stubbing of the code under test. Fakes are allowed only at real boundaries (the clock, the filesystem location).
- Test names start with the requirement ID they cover (`FR-04: …`), so the traceability matrix can be built from the test output.

## 10. Defect management

Defects are logged in `docs/defects.md` with ID (`DEF-###`), title, severity, steps, expected, actual, status and fix commit.

| Severity | Meaning                                                     |
| -------- | ----------------------------------------------------------- |
| Critical | Data loss, personal data exposure, or the app doesn't start |
| High     | A requirement is not met and there is no workaround         |
| Medium   | A requirement is partly met, or there is a workaround       |
| Low      | Cosmetic or minor                                           |

A fix comes with a regression test that fails before the fix and passes after it.

## 11. Reporting

Each checkpoint report includes the gate output, pass and fail counts, and coverage percentages. The final report (CP-8) adds the traceability matrix and the defect summary.

**board-report (Phase 14, DEC-058, NFR-13).** Every test command writes one report of that run to `reports/board-report/` (`npm run report` opens it): every test type it ran, each test with its requirements, steps, error with expected and actual, attachments (screenshots, videos, traces, axe results, raw tool output) and console output, plus history and trends of the last runs. The report shows the latest run only: `npm run test:unit` gives the unit tests, `npm run test:all` gives every type at once. It is built even when tests fail, and the command still fails. CI builds one per run from every job's results (the `board-report` artifact) and writes the totals and failures to the run's summary page. The other reports (Vitest's coverage, Playwright's and Cucumber's HTML reports, k6's summary) and `docs/traceability.md` stay as they are. How it works and its result format: [`scripts/board-report/README.md`](../scripts/board-report/README.md).
