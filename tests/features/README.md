# The board's requirements as Cucumber scenarios

This folder describes what the job board does, in plain English, and runs every sentence as a test. If you are new to
the repository, start here: each `.feature` file covers one area of the board and reads without any code.

## What BDD means here

Behaviour-driven development writes each requirement as examples of behaviour. Every example is a **scenario**
in Gherkin:

```gherkin
@FR-21
Feature: Clear All on the board
  As the owner,
  I want one button that dismisses every New job of a view,
  so that I can start afresh once I've looked through them.

  Scenario: Clear All says how many jobs it dismissed
    When I press Clear All on the LinkedIn view
    Then the board says "Dismissed 2 new LinkedIn jobs. Each one can be restored from Dismissed."
```

- **Given** sets up the starting state, **When** is what the owner does, **Then** is what should happen.
- A **Background** runs before every scenario of its file; a **Scenario Outline** runs once per row of its
  **Examples** table.
- Feature files use the board's own words (New, Saved, Clear All, Find Now, the LinkedIn view). URLs, JSON, SQL and
  selectors live only in the step definitions.

The scenarios sit on top of the Vitest and Playwright tests in `tests/`, which stay as they are and keep the edge
cases. The scenarios state each requirement's acceptance criteria the way a reader would say them (PLAN.md §8.5).

## How a scenario maps to a requirement

Every feature or scenario carries the tag of the requirement it covers (`@FR-08`, `@NFR-01`; the IDs are in PLAN.md
§3). A scenario counts for every requirement tag it has, its feature's tags included. The test type comes from the
folder:

| Folder         | Test type        | What a step does                                                                     | Runs on                            |
| -------------- | ---------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| `integration/` | 3 Integration    | Calls the services on a temporary database and checks the stored rows with SQL       | Node                               |
| `api/`         | 4 API            | Sends real HTTP requests to the app: the JSON API and the board's form posts         | Node                               |
| `e2e/`         | 7 E2E            | Uses the board in a real browser through Playwright                                  | Chromium, Firefox, WebKit, Pixel 7 |
| `e2e/`         | 8 Smoke (tagged) | `smoke.feature`, tagged `@smoke`: the app starts, the board, a job and the runs page | Chromium                           |

`docs/traceability.md` lists the scenarios under each requirement, next to the Vitest and Playwright tests.

## How it is put together

```
cucumber.json              one profile per suite: integration, api, e2e-chromium, e2e-firefox, e2e-webkit, e2e-mobile,
                           and smoke (the @smoke scenarios on Chromium)
tests/features/
├─ support/                shared by every profile: the World (one scenario's state), parameter types such as
│                          {status} and {view}, the jobs a table describes, and the clean-up after each scenario
├─ integration/            *.feature + steps/
├─ api/                    *.feature + steps/
└─ e2e/                    *.feature + steps/ + hooks.ts (one browser per run, a new context per scenario)
```

- Each profile loads only its own folder's steps plus `support/`, so the same sentence can mean "call the service" in
  `integration/` and "post the form" in `api/`.
- Step definitions are short and call the existing helpers: `tests/helpers/test-app.ts`, `tests/helpers/fake-claude.ts`
  and `tests/integration/helpers/test-database.ts`.
- **Every scenario starts from a clean app**: its own temporary database and, for API and E2E, its own app on a free
  port. Find Now runs the stand-in for Claude Code (`tests/helpers/fake-claude.ts`), never the real one. No scenario
  depends on another.
- `strict` is on: an undefined, pending or ambiguous step fails the run. There are no `@skip`, `@wip` or `@only` tags,
  and `tests/contract/feature-files.test.ts` checks that.

## Running the scenarios

The `test:bdd` scripts go through `scripts/bdd.ts`, which runs every profile of the suites asked for, one after
another, and keeps going when one fails, so a run always reports on every suite; it fails at the end if any did.

```bash
npm run test:bdd                 # integration, API, then E2E on the four browsers
npm run test:bdd:integration     # one suite
npm run test:bdd:api
npm run test:bdd:e2e             # Chromium, Firefox, WebKit and Pixel 7, one after another
npm run test:bdd:smoke           # only the @smoke scenarios, on Chromium

# One requirement's scenarios, or a tag expression, in one profile
npx cucumber-js --profile api --tags @FR-21
npx cucumber-js --profile e2e-firefox --tags "@FR-08 and not @FR-10"

# Scenarios by name (a regular expression)
npx cucumber-js --profile api --name "Clear All says"

# One feature file, or one scenario by its line number: name the folder's steps instead of a profile
npx cucumber-js tests/features/api/notes.feature --import "tests/features/support/**/*.ts" --import "tests/features/api/steps/**/*.ts"
npx cucumber-js tests/features/api/notes.feature:7 --import "tests/features/support/**/*.ts" --import "tests/features/api/steps/**/*.ts"
```

Cucumber adds the feature files named on the command line to its profile's, so with `--profile` a file name doesn't
narrow the run; tags and names do. Without a profile no report is written. The E2E steps need the browser named in
their profile, so run E2E scenarios through a profile with `--tags` or `--name`. The E2E profiles need the Playwright
browsers (`npx playwright install`), like `npm run test:e2e`.

A run with `--profile` and `--tags` or `--name` rewrites that profile's report with only the scenarios it ran, so
run `npm run test:bdd` again before `node scripts/traceability.ts`.

## Reports

Every profile writes a JSON and an HTML report to `reports/cucumber/<profile>.json` and `.html` (git-ignored). Open the
HTML report in a browser to see every feature, scenario, step and tag; a failed E2E scenario keeps a screenshot of the
page. `scripts/bdd.ts` removes a profile's old reports before running it, so a report on disk is always from that
profile's latest run. `node scripts/traceability.ts` reads the JSON reports for `docs/traceability.md`, and refuses a
missing, empty or unreadable report, or E2E reports that list different scenarios (what a filtered run leaves). In CI, the `bdd` job uploads
the folder as the `cucumber-report` artifact.

## Writing a scenario

1. Find the feature file of its requirement area, or start a new one with the requirement's tag and an "As the owner,
   I want …, so that …" description.
2. Write 3 to 8 steps in the board's words. Use a `Scenario Outline` instead of copying a scenario.
3. Run the profile. Cucumber prints a snippet for each step it doesn't know yet; add it to the folder's `steps/`,
   reusing the helpers in `support/`.
