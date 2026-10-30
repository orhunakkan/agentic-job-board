# Defect log

Every defect found while building the Agentic Job Board (PLAN.md Phase 8 task 2), in the owner's `DEF-###` format. Numbering continues after DEF-001 to DEF-004, which this repository's older history already uses for an earlier project. Severity follows [`test-strategy.md`](test-strategy.md) §10. Each fix comes with a regression test that fails before the fix and passes after it.

## Summary

| ID      | Title                                                                 | Severity | Found by                         | Status | Fix commit |
| ------- | --------------------------------------------------------------------- | -------- | -------------------------------- | ------ | ---------- |
| DEF-005 | `prettier --check` fails on a fresh Windows checkout                  | Medium   | Static gate (Phase 0)            | Fixed  | `8e47927`  |
| DEF-006 | Coverage gate can't pass: database code counted at 0 %                | Medium   | Coverage gate (Phase 3)          | Fixed  | `792d2f2`  |
| DEF-007 | A repeat sighting keeps a job's old title, location and flags         | Medium   | Owner review (CP-3)              | Fixed  | `5a61ef1`  |
| DEF-008 | "1 school alum" can be stored as a job's location                     | Medium   | Live run (Phase 5)               | Fixed  | `73578ee`  |
| DEF-009 | Every board form is refused with 403 in a real browser                | High     | E2E suite (Phase 6)              | Fixed  | `02e20f9`  |
| DEF-010 | The return-path guard lets dot segments collapse into `//`            | Low      | Code review (Phase 6)            | Fixed  | `5767497`  |
| DEF-011 | A board page past the end shows "No new jobs" while jobs exist        | Medium   | Code review (Phase 6)            | Fixed  | `5767497`  |
| DEF-012 | Status notices are not announced, and focus is lost after a form post | Low      | Code review (Phase 6)            | Fixed  | `5767497`  |
| DEF-013 | Every card's buttons and LinkedIn link have the same accessible name  | Low      | Code review (Phase 6)            | Fixed  | `5767497`  |
| DEF-014 | The CI browser job times out while installing browsers                | High     | First CI run on GitHub (Phase 7) | Fixed  | see below  |
| DEF-015 | A LinkedIn search reads only 7 of the 25 jobs on a page               | High     | Live dry run (Phase 11)          | Fixed  | `11d0c37`  |
| DEF-016 | Most LinkedIn jobs are stored without their description               | High     | Live dry run (Phase 11)          | Fixed  | `11d0c37`  |
| DEF-017 | One job page that won't load stops the whole LinkedIn run             | Medium   | Integration test (Phase 11)      | Fixed  | `11d0c37`  |
| DEF-018 | A Chromium page test times out when the whole suite runs              | Low      | `npm run check` (Phase 11)       | Fixed  | `9fd2dee`  |
| DEF-019 | Seeding fake jobs is slow enough to time out its test                 | Low      | `npm run check` (Phase 11)       | Fixed  | `0bc72c8`  |
| DEF-020 | The `/find-jobs` command's write rule never matched                   | High     | Real CLI check (Phase 12)        | Fixed  | `ed0daab`  |
| DEF-021 | The Firefox dark-mode accessibility runs checked the light theme      | Low      | E2E suite (Phase 15)             | Fixed  | `9133cd9`  |

Open defects: none.

## Details

### DEF-005: `prettier --check` fails on a fresh Windows checkout

- **Severity:** Medium (a quality gate fails for reasons unrelated to the code)
- **Steps:** clone the repository on Windows with `core.autocrlf=true`, run `npm ci`, then `npm run format:check`.
- **Expected:** every file passes.
- **Actual:** every file is reported, because Git checked them out with CRLF line endings and Prettier expects LF.
- **Fix:** `.gitattributes` forces LF on checkout (DEC-014). **Status:** Fixed in `8e47927`.

### DEF-006: Coverage gate can't pass: database code counted at 0 %

- **Severity:** Medium
- **Steps:** run `npm run test:unit` with coverage after Phase 3.
- **Expected:** the coverage thresholds of PLAN.md §8.3 reflect how well the code is tested.
- **Actual:** overall line coverage was 39 % and the ingest service 0 %, because database code is tested in the integration project, which unit-only coverage ignores.
- **Fix:** coverage is measured over every Vitest project together (`npm run test:coverage`); the thresholds are unchanged (DEC-021). **Status:** Fixed in `792d2f2`.

### DEF-007: A repeat sighting keeps a job's old title, location and flags

- **Severity:** Medium
- **Steps:** ingest an email with a job, then a newer email where the same job shows "This company is actively hiring".
- **Expected:** the board shows the current flags.
- **Actual:** only the first sighting's details were kept.
- **Fix:** a sighting from a newer email refreshes the title, company, location and flags; an older one only widens first and last seen (DEC-023). **Status:** Fixed in `5a61ef1`.

### DEF-008: "1 school alum" can be stored as a job's location

- **Severity:** Medium
- **Steps:** ingest a digest where a job block has no location line and the insight line `1 school alum`.
- **Expected:** the location is empty.
- **Actual:** the location is `1 school alum`. The parser knew `N company alum(ni)` but not this newer school variant, first seen in the owner's emails on 2026-10-22 during the Phase 5 live run.
- **Fix:** the insight pattern accepts `company` or `school` alumni lines; unit tests cover both. **Status:** Fixed in `73578ee`.

### DEF-009: Every board form is refused with 403 in a real browser

- **Severity:** High (FR-08 and FR-09 can't be used from the UI)
- **Steps:** open the board in Chromium and click **Save** on a card.
- **Expected:** the job moves to Saved.
- **Actual:** a 403 "Requests from other sites are not allowed" page. With `Referrer-Policy: no-referrer`, browsers send `Origin: null` on the app's own form posts, and the cross-site guard correctly refuses a null origin. The API tests didn't catch it because they set headers by hand; the E2E suite did.
- **Fix:** `Referrer-Policy: same-origin` (DEC-029). Links to other sites still send no referrer. **Status:** Fixed in `02e20f9`.

### DEF-010: The return-path guard lets dot segments collapse into `//`

- **Severity:** Low (not exploitable: the route reparses the result and redirects to a local path)
- **Steps:** call `safeReturnPath('/.//evil.example', '/x')`.
- **Expected:** `/x` (refused).
- **Actual:** `//evil.example`, a protocol-relative URL, because URL parsing removes the `.` segment after the check.
- **Fix:** the parsed path is checked again. Unit tests cover `/.//`, `/a/..//` and `/%2e%2e//`. **Status:** Fixed in `5767497`.

### DEF-011: A board page past the end shows "No new jobs" while jobs exist

- **Severity:** Medium
- **Steps:** with 51 new jobs, open page 2 and dismiss its only job.
- **Expected:** the board shows the last page that has jobs.
- **Actual:** an empty page with "No new jobs. Run /find-jobs…" and no pager.
- **Fix:** the page number is clamped to the last page (DEC-030). **Status:** Fixed in `5767497`.

### DEF-012: Status notices are not announced, and focus is lost after a form post

- **Severity:** Low (accessibility, NFR-06)
- **Steps:** with a screen reader, dismiss a card in the middle of the board.
- **Expected:** the result is announced, and focus lands near where the user was.
- **Actual:** a `role="status"` message on a freshly loaded page is not announced, and focus goes back to the top of the page.
- **Fix:** redirects end in `#notice`, and the notice can take focus; an E2E test checks that it does. **Status:** Fixed in `5767497`.

### DEF-013: Every card's buttons and LinkedIn link have the same accessible name

- **Severity:** Low (accessibility, NFR-06)
- **Steps:** list the board's buttons with a screen reader.
- **Expected:** each button says which job it acts on.
- **Actual:** dozens of identical "Save", "Dismiss" and "Open on LinkedIn" entries.
- **Fix:** each button and link carries the job title in visually hidden text. **Status:** Fixed in `5767497`.

### DEF-014: The CI browser job times out while installing browsers

- **Severity:** High (the E2E, accessibility and smoke gates never run in CI)
- **Steps:** push to `main`; watch the "E2E, accessibility and smoke" job.
- **Expected:** browsers install in a minute or two, then the tests run.
- **Actual:** `npx playwright install --with-deps` spent 20 minutes downloading WebKit's media libraries from the runner's Ubuntu mirror at a few KB/s, and the job hit its timeout. Nothing in the app was at fault; the job depended on a slow external mirror.
- **Fix:** the job runs in the official `mcr.microsoft.com/playwright` image, which has the browsers and their libraries preinstalled, so there is no apt step. A unit test keeps the image tag equal to the installed `@playwright/test` version. **Status:** Fixed on `main` (merge of `phase/7-ci-fix`).

### DEF-015: A LinkedIn search reads only 7 of the 25 jobs on a page

- **Severity:** High (most jobs a search finds never reach the board)
- **Steps:** `node scripts/search-linkedin.ts --dry-run --no-details --search "Senior QA"` with the live session.
- **Expected:** 25 jobs per full page, up to `maxPages`.
- **Actual:** "page 1: 7 jobs", and the search stopped, since a page under 25 counts as the last. LinkedIn shows the first 7 cards and adds the other 18 about a second later; the script counted after half a second of no change.
- **Fix:** the list counts as loaded only when the number of cards has stayed the same for 2 s (DEC-045). The saved pages can't reproduce LinkedIn's staged loading, so the live run is the check: 4 pages, 100 jobs. **Status:** Fixed in `11d0c37`.

### DEF-016: Most LinkedIn jobs are stored without their description

- **Severity:** High (jobs without a description are scored on their title only, FR-20)
- **Steps:** a live dry run reading job pages for one search page.
- **Expected:** every open job comes with its description.
- **Actual:** 21 of 25 jobs had none, and others had only the short "Desired skills" part. The description's box appears before its text, and its parts arrive one after another.
- **Fix:** the script waits for text in the box, then until its length stops changing. The live re-check read 3,313 to 5,380 characters for the jobs that had come back empty or short. **Status:** Fixed in `11d0c37`.

### DEF-017: One job page that won't load stops the whole LinkedIn run

- **Severity:** Medium
- **Steps:** a search whose second new job answers with HTTP 404.
- **Expected:** that job is sent from its search card and reported; the other job pages are still read.
- **Actual:** any error status counted as LinkedIn limiting requests, so the script stopped reading LinkedIn for the rest of the run.
- **Fix:** only 429, 999 and 5xx answers (or an empty error page) count as LinkedIn limiting requests; any other page that doesn't show the job fails that job only. The saved-pages test now includes a job without a page. **Status:** Fixed in `11d0c37`.

### DEF-018: A Chromium page test times out when the whole suite runs

- **Severity:** Low (a flaky test, no product defect)
- **Steps:** `npm run check`, which runs every Vitest project at once.
- **Expected:** the sign-in redirect test passes every time.
- **Actual:** it failed once in a full run with a timeout instead of "sign in again": the saved-page tests gave a page 3 s, too little on a busy machine. Three further full runs passed.
- **Fix:** the saved-page tests give a page 8 s and the two whole-script tests 30 s. **Status:** Fixed in `9fd2dee`.

### DEF-019: Seeding fake jobs is slow enough to time out its test

- **Severity:** Low (a test timeout and a slower load-test setup, no wrong data)
- **Steps:** `npm run check`; `node scripts/seed.ts --count 5000 --db data/perf.db`.
- **Expected:** the seed test finishes well inside 5 s; 5,000 jobs seed in under a second.
- **Actual:** the test timed out once in a full run, and 5,000 jobs took 13 s. Since Phase 11 the seed brings its jobs in as LinkedIn listings, and each listing was its own transaction and commit.
- **Fix:** all search pages are seeded in one transaction, which each listing's transaction joins; 5,000 jobs take 0.24 s. **Status:** Fixed in `0bc72c8`.

### DEF-020: The `/find-jobs` command's write rule never matched

- **Severity:** High for Find Now (a headless run could not write its score files, so nothing would be scored, FR-22); Low for `/find-jobs` typed by hand (each payload file asked the owner first)
- **Steps:** start Claude Code with the command's tools as `--allowedTools`, as Find Now does.
- **Expected:** writing payload files under `data/find-jobs/` is pre-approved.
- **Actual:** Claude Code warns that `Write(/data/find-jobs/**)` "is not matched by file permission checks — only Edit(path) rules are". Under `--permission-mode dontAsk` every payload write would be refused.
- **Fix:** the command pre-approves `Edit(/data/find-jobs/**)`, which covers every file-writing tool for the same folder; Find Now passes the same rule, and the security test expects it. Found by a check of the real CLI with the exact flags in Phase 12. **Status:** Fixed in `ed0daab`.

### DEF-021: The Firefox dark-mode accessibility runs checked the light theme

- **Severity:** Low (a gap in the tests, not in the app: no page was wrong, but Firefox's dark theme went unchecked by axe since Phase 6)
- **Steps:** run `tests/e2e/a11y.spec.ts` on the `firefox` project with `colorScheme: 'dark'`, and read `matchMedia('(prefers-color-scheme: dark)').matches` on the page.
- **Expected:** `true`, so axe checks the dark palette.
- **Actual:** `false`. Playwright's Firefox (1.64.1) drops the emulated colour scheme when the first page a tab loads sends `Cross-Origin-Opener-Policy: same-origin`, as every page of the app does (NFR-01). A plain page, or one with only the CSP, keeps it. Found when the new FR-23 test checked the page's background colour with the system in dark.
- **Fix:** the E2E and accessibility tests set the scheme again with `page.emulateMedia` after the first load, which holds through later navigations and form posts; the existing accessibility tests gained that line after each `goto` (DEC-062). All 192 accessibility runs pass with Firefox really in dark. **Status:** Fixed in `9133cd9`.
