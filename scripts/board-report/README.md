# board-report

One report for every test type of this repository (PLAN.md Phase 14, DEC-058): static checks, unit, integration, API, contract, security, coverage, E2E on four browsers, accessibility, smoke, every BDD suite and the k6 load test. It is built here, from each runner's own interfaces, with no report package.

**The report shows the latest run.** Every test command empties `reports/test-results/`, runs its steps, then builds `reports/board-report/` from what they wrote, even when tests failed, and still fails when they did. `npm run test:unit` gives a report of the unit tests; `npm run test:all` gives one of everything. Earlier runs show only as history: the dots on each test and the trend charts.

```bash
npm run test:unit             # any test command: runs through scripts/board-report.ts, then builds the report
npm run test:all              # one run of every test type, then one report
npm run report                # opens reports/board-report/index.html in your browser
node scripts/board-report.ts build    # a report from whatever is in reports/test-results/
```

Arguments after `--` go to the runner of the one step named, as before: `npm run test:e2e -- tests/e2e/board.spec.ts --project chromium`.

## How a run works

| Step                                                 | Runner                                                                                | Results from                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `static`                                             | `tsc` (both configs), ESLint (JSON formatter), `prettier --check`, `npm audit --json` | `converters/static.ts`                                                          |
| `unit`, `integration`, `api`, `contract`, `security` | `vitest run --project <name>`                                                         | `reporters/vitest.ts`                                                           |
| `coverage`                                           | `vitest run --coverage` (every project, DEC-021)                                      | `reporters/vitest.ts`, then `converters/coverage.ts` on `coverage-summary.json` |
| `e2e`, `smoke`                                       | `playwright test` (smoke: `--grep @smoke --project chromium`)                         | `reporters/playwright.ts`                                                       |
| `bdd-integration`, `bdd-api`, `bdd-e2e`, `bdd-smoke` | `scripts/bdd.ts`, which adds Cucumber's `message` formatter per profile               | `converters/cucumber.ts` on `<profile>/messages.ndjson`                         |
| `perf`                                               | `k6 run --summary-export` (in `test:all` against its own app on 5,000 seeded jobs)    | `converters/k6.ts`                                                              |

Each step writes to `reports/test-results/<step>/`. The reporters write only when `scripts/board-report.ts` sets `BOARD_REPORT_RESULTS` and `BOARD_REPORT_STEP`, so running `vitest` or `playwright` directly leaves nothing behind. A step whose command fails without a failing test to show for it, or that passes but writes no result, gets a **broken** result of its own, so a run that couldn't start is never missing from the report. With `BOARD_REPORT_APPEND=1` (CI) a command neither empties the results nor builds a report; CI's last job builds one from every job's results.

## The result format (`result-schema.ts`)

One JSON file per test, `<id>-result.json`, checked with Zod when it is written and when it is read. Attachments are files next to it, named in it, never inlined.

| Field                             | Meaning                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`                          | `1`                                                                                                                                                                                                          |
| `id`                              | 16 hex characters: the history ID and the step, so it is unique within a run                                                                                                                                 |
| `historyId`                       | 16 hex characters, the same in every run of the test: its type, file, full name and parameters                                                                                                               |
| `name`, `fullName`                | The test's own name, and with its `describe` blocks or feature                                                                                                                                               |
| `status`                          | `passed`; `failed` (an assertion didn't hold); `broken` (an unexpected error, a timeout, a run that couldn't start); `skipped`                                                                               |
| `start`, `stop`, `duration`       | Milliseconds (since the epoch for `start` and `stop`)                                                                                                                                                        |
| `file`, `line`                    | The source, relative to the repository; `null` for results with no file (static checks, thresholds)                                                                                                          |
| `suites`                          | The file or feature first, then the `describe` blocks or the feature name and rule                                                                                                                           |
| `labels.testType`                 | One of the 15 types below                                                                                                                                                                                    |
| `labels.requirements`             | `FR-`/`NFR-` IDs from the start of the name or the scenario's tags, by the rule of `scripts/traceability.ts`                                                                                                 |
| `labels.tags`                     | Playwright tags, Cucumber tags                                                                                                                                                                               |
| `labels.severity`                 | `critical` for smoke and security tests, `normal` for the rest                                                                                                                                               |
| `labels.browser`, `labels.worker` | The browser project or profile, and the worker that ran it                                                                                                                                                   |
| `labels.step`                     | The `scripts/board-report.ts` step that ran it                                                                                                                                                               |
| `parameters`                      | `name`, `value`: Scenario Outline example values and `browser` and `run: smoke`, which are part of the history ID; values the run measured (a p95, a coverage percentage) carry `measured: true` and are not |
| `error`                           | `message`, `expected`, `actual`, `stack`                                                                                                                                                                     |
| `steps`                           | Nested: `name`, `category` (`pw:api`, `expect`, `test.step`, `hook`, `Given` …), `status`, `start`, `duration`, `error`, `parameters`, `dataTable`, `docString`, `attachments`, `steps`                      |
| `attachments`                     | `name`, `type` (a media type), `source` (the file next to the result)                                                                                                                                        |
| `stdout`, `stderr`                | Console output, in pieces as the runner gave them                                                                                                                                                            |
| `retries`                         | Earlier attempts in the same run: `status`, `duration`, `message`                                                                                                                                            |

**Test types:** Static, Unit, Integration, API, Contract, Security, Coverage, E2E, Accessibility (`tests/e2e/a11y.spec.ts`), Smoke, BDD integration, BDD API, BDD E2E, BDD smoke, Performance. The type comes from the step for steps of one type, and otherwise from the test's folder.

**Failure categories** (`categories.ts`): accessibility violations, missed thresholds (k6 and coverage), static-check findings, timeouts, assertion failures, and crashes (broken tests).

**History** (`history.ts`): each built report adds a line to `reports/board-report-history.jsonl` (the run's time, commit, totals by type and status, and each test's status and duration by history ID); the last 50 runs are kept. A test that switched between pass and fail in its last 10 runs is **flaky**. CI keeps the file in the Actions cache.

When a test runs in two steps (in CI the unit tests run in the static job and again for coverage), the report keeps one result for it, the worst, so a failure is never hidden by a pass.

## The report (`build/`, `client/`, `styles/`)

`reports/board-report/` holds `index.html`, the client (`app.js`), `report.css`, `data/index.js` (every test, small enough to list them all) and `data/tests/<id>.js` (one test's steps, error and attachments, loaded when the test is opened), and `attachments/<id>/`. It opens straight from disk, so a downloaded CI artifact opens with a double click.

- **Safe:** a Content Security Policy that lets the page load only its own files; no inline script; every value from a test is shown as text, never as markup; no request to anywhere. The only links out are to GitHub (requirements in PLAN.md, source lines at the run's commit, the CI run).
- **Typed:** the client is TypeScript in `client/`, checked by `tsc` and ESLint like the rest. `build/bundle.ts` removes its types with Node's `module.stripTypeScriptTypes` and joins the files, dependencies first, into one classic script, because browsers refuse module scripts from `file://`. So client files use named, relative, unrenamed imports only, and no top-level name may be declared in two files.
- **Repeatable:** the same results and history always build the same report, byte for byte, apart from the build time.

Views: **Overview** (pass rate, totals, a card per test type, trends of the last runs, the slowest tests, failures by category, flaky tests, every requirement), **By test type** (type → file or feature → suites → test), **By requirement**, **Failures**, **Timeline** (by step and worker), **Environment**, and each **test's page** (status, requirements, history dots, error with expected and actual, steps, screenshots, videos, traces with the `npx playwright show-trace` command, stdout and stderr, and the source line on GitHub). Every list can be searched and filtered; links such as `#/test/<id>` can be shared.
