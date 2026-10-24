# Agentic Job Board

[![CI](https://github.com/orhunakkan/agentic-job-board/actions/workflows/ci.yml/badge.svg)](https://github.com/orhunakkan/agentic-job-board/actions/workflows/ci.yml)

A private, localhost-only command center for one person's LinkedIn job hunt, and a testing-pyramid showcase.

LinkedIn already sends several job-alert emails a day, about six jobs each, with many repeats. Running **`/find-jobs`** in Claude Code reads the new alerts from Gmail (read-only), and the app parses and deduplicates them with deterministic, tested code. The same run reads free public job feeds (company job boards, remote job boards, Hacker News "Who is hiring?"), and the board shows those jobs on a view of their own. Claude then scores each new job from 0 to 100 against the owner's profile, with a one-line reason. The board at http://127.0.0.1:3000 ranks the jobs by fit and tracks each one: saved → applied → interviewing → offer or rejected, plus notes.

[`PLAN.md`](PLAN.md) is the full plan and the source of truth.

![The board: new jobs ranked by triage score, with filters and status actions](docs/screenshots/board.png)

| Job detail                                                                                    | Dark mode, In progress tab                                                  | Phone (390 px)                                                          |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ![Job detail with status form, notes, history and sightings](docs/screenshots/job-detail.png) | ![The board in dark mode, In progress tab](docs/screenshots/board-dark.png) | ![The board on a phone-sized screen](docs/screenshots/board-mobile.png) |

Screenshots are taken with Playwright from fake data (`node scripts/screenshots.ts`); no real job or person appears in them.

## How it works

```
/find-jobs (Claude Code)                          App (Node 24, TypeScript, 127.0.0.1 only)
  1. GET  /api/ingest/state      ───────────────►  where the last run stopped
  2. Gmail search + read (read-only)
  3. POST /api/runs              ───────────────►  start a run
  4. POST /api/runs/:id/emails   ───────────────►  parse, deduplicate by LinkedIn job ID, store
  5. node scripts/fetch-sources.ts --run <id>
       reads the free job feeds, filters by keyword
     POST /api/runs/:id/listings ───────────────►  deduplicate by source and job ID, store
  5c. score the new jobs with agent/scoring-rubric.md
  6. POST /api/runs/:id/scores   ───────────────►  validate and store (all or nothing)
  7. POST /api/runs/:id/finish   ───────────────►  summary with the top 5 new jobs
```

Code does everything deterministic (parsing, deduplication, storage, validation), so it can be tested. Claude does only what needs judgment (scoring). The app never calls an AI model and needs no API key.

- **Stack:** Node 24 running TypeScript natively, `node:http`, `node:sqlite`, Zod, server-rendered HTML with no client-side JavaScript. The only runtime dependency is `zod`.
- **Agent:** [`agent/find-jobs.md`](agent/find-jobs.md) (the procedure and its safety rules) and [`agent/scoring-rubric.md`](agent/scoring-rubric.md) (rubric `triage-v1` and its calibration set).
- **Docs:** [API and pages](docs/api.md), [test strategy](docs/test-strategy.md), [traceability matrix](docs/traceability.md), [defect log](docs/defects.md), [decisions](docs/decisions.md).

## Setup

Needs Node 24 or newer, on Windows, macOS or Linux.

```bash
npm ci
npx playwright install        # browsers for the E2E tests
winget install k6             # load tests only; on macOS: brew install k6
cp .env.example .env          # PORT=3000, DB_PATH=data/jobboard.db, LOG_LEVEL=info
```

## Running

```bash
npm start                     # signs in to LinkedIn, then serves http://127.0.0.1:3000 (never other addresses)
```

In a terminal it prints the board address on a line of its own, the LinkedIn status and one short coloured line per request. Piped or in CI, the logs are JSON lines (`LOG_FORMAT=json|pretty` overrides this):

```text
  Job Board is running

  ➜  http://127.0.0.1:3000/

  LinkedIn  ● signed in · checked Oct 24, 6:45 AM
  Database  data/jobboard.db
  Stop      Ctrl+C

06:45:59  200  GET /  3 ms
```

The first start creates `data/jobboard.db`. Load your profile once (it is the basis of every score):

```bash
curl -s -X PUT http://127.0.0.1:3000/api/profile \
  -H "Content-Type: application/json" --data-binary @data/profile.json
```

Then, in Claude Code in this folder, with the Gmail connector enabled:

```text
/find-jobs
```

The command file lives in `.claude/commands/find-jobs.md`, which is not committed; its exact content is in [`agent/find-jobs.md`](agent/find-jobs.md#installing-the-command). It pre-approves only Gmail `search_threads` and `get_thread`, `curl`, `node scripts/fetch-sources.ts --run …`, and payload files under `data/find-jobs/`. Deny any other Gmail tool if asked.

Open the board at http://127.0.0.1:3000/. Stop the server with Ctrl+C: it finishes open requests and closes the database.

### Other job sources

Besides the LinkedIn alerts, `/find-jobs` reads free public job feeds (PLAN.md Phase 10, DEC-035). None of them costs anything, and only Adzuna needs a (free) key:

| Kind               | Feeds                                                            | What is read                                                  |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Company job boards | Greenhouse, Lever, Ashby, SmartRecruiters, Workable              | Every open job of each company in your watchlist              |
| Remote job boards  | Remote OK, Himalayas, Jobicy                                     | Their latest remote jobs (Himalayas: a US search per keyword) |
| Community          | Hacker News "Ask HN: Who is hiring?"                             | The posts of the newest monthly thread                        |
| Aggregator         | Adzuna, only with `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` in `.env` | A US search per keyword                                       |

Only jobs whose title matches your keywords (and whose location matches, when you list locations) reach the board. Set them up once:

```bash
cp sources.example.json data/sources.json     # keywords, excluded words, locations, company watchlist, feeds on/off
node scripts/fetch-sources.ts --dry-run       # lists what would be stored; sends nothing
node scripts/fetch-sources.ts                 # stores them now, as a run of its own (the app must be running)
```

A company in the watchlist is its name in its job board's address, for example `gitlab` for `job-boards.greenhouse.io/gitlab`. The board shows **LinkedIn** and **Other sources** as two views, each with its own tabs; a card from a feed names its source and links to the job there. Jobs from both are scored with the same rubric, so their scores compare.

### LinkedIn login

`npm start` signs you in to LinkedIn before it starts the app. It checks the saved session in a hidden browser and refreshes it. Only when LinkedIn no longer accepts the session does it open a window for you to sign in (2FA included). Every page header shows **LinkedIn: signed in** and when the session was last checked. The same steps by hand:

```bash
node scripts/linkedin-login.ts            # opens Edge (Windows) or Chromium; sign in by hand, 2FA included
node scripts/linkedin-login.ts --check    # active / expired / missing, without opening a browser
curl -s http://127.0.0.1:3000/api/linkedin/session
```

The session (cookies only, never the password) is saved to `data/linkedin/session.json`, and the browser profile to `data/linkedin/browser-profile/`. Both are git-ignored. `--channel chrome` or `--channel chromium` picks another browser, and `LINKEDIN_SESSION_PATH` moves the file. Using your LinkedIn account this way is your decision and your responsibility (DEC-032).

## Testing pyramid

Ten test types, each run by one command. Every test name starts with the requirement it covers (`it('FR-04: …')`), and [`docs/traceability.md`](docs/traceability.md) maps every requirement to its tests and their latest result.

| #   | Type          | Tool                                           | What it proves                                                                                        | Command                                                     |
| --- | ------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Static        | tsc (strict), ESLint, Prettier                 | Types, `strictTypeChecked` lint rules, formatting                                                     | `npm run typecheck`, `npm run lint`, `npm run format:check` |
| 2   | Unit          | Vitest                                         | Email parser on sanitized real fixtures, status machine (all 49 pairs), HTML escaping, …              | `npm run test:unit`                                         |
| 3   | Integration   | Vitest + `node:sqlite` (temp DB per test)      | Migrations, repositories, idempotent ingest, deduplication, history                                   | `npm run test:integration`                                  |
| 4   | API           | Vitest + `fetch` against the real server       | Every endpoint and page, every status code                                                            | `npm run test:api`                                          |
| 5   | Contract      | Vitest + Zod                                   | Every response matches its schema; the agent's example payloads parse                                 | `npm run test:contract`                                     |
| 6   | Security      | Vitest                                         | Localhost-only, DNS-rebinding and cross-site guards, escaping, no tokens stored, no outbound requests | `npm run test:security`                                     |
| 7   | E2E           | Playwright: Chromium, Firefox, WebKit, Pixel 7 | Filter, save → applied → interviewing, notes, dismiss and restore                                     | `npm run test:e2e`                                          |
| 8   | Smoke         | Playwright `@smoke`                            | The app starts, the board renders, a job opens                                                        | `npm run test:smoke`                                        |
| 9   | Accessibility | `@axe-core/playwright`                         | No WCAG 2.2 AA violations on any page or tab, light and dark                                          | part of `npm run test:e2e`                                  |
| 10  | Performance   | k6                                             | p95 < 200 ms with 5,000 jobs and 20 users (last run: p95 22.5 ms, 0 % errors)                         | `npm run test:perf`                                         |

```bash
npm run check                 # typecheck, lint, format, and every Vitest project with coverage thresholds
npm run audit                 # npm audit --audit-level=high
```

Coverage is measured over every Vitest project together: ≥ 85 % of lines overall and ≥ 95 % in `src/domain`, `src/ingest` and `src/sources` (currently about 96 %). The load test needs a seeded database and a running app:

```bash
node scripts/seed.ts --count 5000 --db data/perf.db
PORT=3000 DB_PATH=data/perf.db LOG_LEVEL=warn node src/main.ts    # in a second terminal
npm run test:perf
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs static checks and unit tests, then every Vitest project with coverage, then E2E and smoke on four browser projects. The load test runs on demand.

## Privacy and safety

- **Public job feeds only through one script.** `scripts/fetch-sources.ts` asks a fixed list of hosts; your config only fills in company names and keywords. Feed text is HTML-escaped on every page, and the agent never reads job descriptions (DEC-038).
- **LinkedIn only through your own login.** Jobs come from the alert emails. LinkedIn is reached only by scripts you run, with the session you saved yourself (DEC-032). The app server makes no outbound requests at all (a test checks every source file), and `/find-jobs` never opens links. Cookie values never appear in API responses, pages, logs or script output.
- **Gmail is read-only.** The agent may only search and read threads. It never sends, labels, archives or deletes anything.
- **Personal data stays local.** The database, résumé and profile live in `data/`, which git ignores. Email bodies are never stored, and tracking links are cut down to the canonical job URL, so one-time login tokens never reach a file or the database.
- **Email text is data, never instructions.** Everything from an email is HTML-escaped on every page, and the agent treats a job title like "ignore previous instructions" as just a strange title.
- **Localhost only.** The server binds to 127.0.0.1, refuses other `Host` headers (DNS rebinding) and refuses writes from other websites.
