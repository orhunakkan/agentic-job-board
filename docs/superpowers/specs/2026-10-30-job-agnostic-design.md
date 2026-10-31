# Any line of work: design

**Date:** 2026-10-30 · **Status:** approved by the owner on 2026-10-30 · **Becomes:** Phase 16 in PLAN.md, ending at CP-16

## Why

Right now the board only works for a job hunt in the one field it was first built for (the old target field). That assumption is built into the scoring rubric, the `/find-jobs` instructions, the example configs, the test data and the docs. The owner wants an app that anyone can use for any job or field: a nurse, an accountant, a truck dispatcher, or the owner themselves in their own field. The app should ask the user for whatever it needs before it does anything, and it should assume nothing about their field.

The owner also wants every trace of the old target field removed from the repository and from their own machine, including git-ignored files. **The git history may keep it** (owner, 2026-10-30): we don't rewrite it.

One thing doesn't change: everything that gets built has meaningful tests. Tests for behaviour that is removed are removed with it, and new behaviour gets new tests.

## Goals

1. **Nothing in the code, the agent instructions, the examples, the fixtures or the docs assumes a line of work.** The user's profile is the only place a field, role, skill or location preference comes from.
2. **Setup comes first.** Until the user has given the app what it needs (a profile, plus searches or feeds), the board shows setup instead of jobs, Find Now is off, and `/find-jobs` stops at its first step and says what is missing.
3. **The profile is entered on the board**, in a form that suits any field, and can be edited there at any time.
4. **The scoring rubric works for any field.** It scores a job against the profile's own roles, skills, credentials, seniority and location preferences, and its examples come from several different fields.
5. **No content from the old target field is left** in the repository's files or in the owner's local, git-ignored files. A test keeps it that way.

## Non-goals

- **Editing the LinkedIn searches or the feed list on the board.** They stay in `data/linkedin-searches.json` and `data/sources.json`. The setup page says whether each file is there and valid, and how to create it. Editing them on the board could be a later phase.
- **Writing the profile from a résumé, or having Claude interview the user.** This could be a later phase.
- **Several profiles, or several users.** It is still one user on localhost (§1.2).
- **New job sources.** The feeds stay as they are. The example config only changes which ones it turns on.
- **Rewriting git history.**
- **Changing the app's own testing.** Playwright, Vitest, Cucumber, k6, board-report and the ten test types stay as they are. They test the app; they have nothing to do with the user's line of work.

## Anti-goals (a failure even if it works)

- A non-tech user's jobs score badly because the rubric still assumes software words ("stack", "tech", "engineer").
- The owner's own preferences (remote US, no relocation) stay in the rubric or the code instead of coming from their profile.
- Tests go green because assertions were removed, not because the behaviour was changed (CLAUDE.md, "Never weaken tests").
- Old-field content is "removed" by renaming it to something that still means the same thing.

## Constraints

- Every hard rule in CLAUDE.md still applies. No outbound requests from `src/`, and no Gmail. LinkedIn is reached only through the scripts. Personal data stays under `data/`. No `.skip` or `.only`. Coverage thresholds only go up.
- No client-side JavaScript on the board (DEC-006). The profile form works with a plain form post and a reload, the same way the theme toggle does (DEC-061).
- No new npm package unless a task truly needs one (none is expected).
- Phase process: branch `phase/16-any-line-of-work`, Conventional Commits, CP-16 stops for the owner's approval (PLAN.md §9).

## The design

### 1. The profile: what any user is asked for (FR-01, changed)

`src/schemas/profile.ts` becomes this. It stays a strict Zod object, with the same text limits as today (200 characters, 50 items per list) unless stated otherwise.

| Field                   | Type                                                                 | Asked as                                                                                     | Change                                                                                        |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `field`                 | text, required                                                       | "Your line of work", e.g. "Registered nursing, critical care"                                | **new**                                                                                       |
| `summary`               | text up to 1,000 characters, optional (may be empty)                 | "In a few sentences: what you do now and what you want next"                                 | **new**                                                                                       |
| `targetRoles`           | list, at least 1                                                     | "Job titles you want"                                                                        | same                                                                                          |
| `seniority`             | `entry`, `mid`, `senior`, `lead`, `manager`, `director`, `executive` | "Your level"                                                                                 | **changed**: `junior` → `entry`, `staff` dropped, `manager`, `director` and `executive` added |
| `yearsExperience`       | integer 0–60                                                         | "Years of experience in this line of work"                                                   | same                                                                                          |
| `coreSkills`            | list, at least 1                                                     | "Your main skills, tools or specialties"                                                     | same, worded for any field                                                                    |
| `secondarySkills`       | list                                                                 | "Other skills you have"                                                                      | same                                                                                          |
| `credentials`           | list                                                                 | "Licenses, certifications or clearances you hold", e.g. "RN license (Texas)", "CPA", "CDL-A" | **new**                                                                                       |
| `locations.remote`      | list of regions; empty = not open to remote                          | "Remote work: the countries or regions you can work remotely from"                           | **replaces `remoteUS`**                                                                       |
| `locations.hybridAreas` | list                                                                 | "Cities or areas where you'd work hybrid"                                                    | **renamed** from `hybridMetros`                                                               |
| `locations.onsiteAreas` | list                                                                 | "Cities or areas where you'd work on-site"                                                   | **renamed** from `onsiteMetros`                                                               |
| `locations.relocate`    | boolean                                                              | "Open to relocating"                                                                         | same                                                                                          |
| `workAuthorization`     | text                                                                 | "Where you can work, and whether you need sponsorship"                                       | same                                                                                          |
| `dealBreakers`          | list                                                                 | "Things that rule a job out for you"                                                         | same                                                                                          |
| `excludedCompanies`     | list                                                                 | "Companies to skip"                                                                          | same                                                                                          |

At least one of `locations.remote`, `hybridAreas` and `onsiteAreas` must be non-empty. Otherwise no job could ever fit, and the form says so.

**A profile saved in the old shape** (it fails the new schema) reads as **outdated**. The profile repository returns it as "needs filling in again" instead of throwing. The setup page asks the user to fill in the form again, prefilled with the old values that still fit. The local database is deleted anyway (§7), so this only protects a database someone kept.

### 2. Setup comes first (FR-24, new)

**What counts as set up:** a valid profile is saved, and at least one source is ready: `data/linkedin-searches.json` with at least one valid search, or `data/sources.json` valid with at least one feed or company board turned on.

- **`GET /api/setup`** answers `{ profile: 'missing' | 'outdated' | 'saved', linkedinSearches: 'missing' | 'invalid' | 'ready', sources: 'missing' | 'invalid' | 'ready', ready: boolean }`. It reads the two files with the parsers that already exist (`src/linkedin/search-config.ts`, `src/sources/source-config.ts`) and never returns their contents. Reading a local file is not an outbound request, so NFR-03 is unchanged.
- **Board pages:** while `profile` is not `saved`, `/` and the other board views redirect (303) to **`/setup`**. Runs, Profile, job pages and error pages still open. `/setup` is a checklist with a status for each item: the profile, with a link to its form; the LinkedIn searches, with how to create the file from `linkedin-searches.example.json` and how to sign in; and the feeds, with how to create the file from `sources.example.json`. When the profile is saved but neither source is ready, the board opens but shows a notice that links to `/setup`.
- **Find Now:** each view's button is disabled, with a reason on screen, until the profile is saved and that view's own source is ready (LinkedIn → searches; Other sources → feeds).
- **API:** `POST /api/runs` answers **409 `setup_required`**, with `details` naming what is missing, while `ready` is false. This stops `/find-jobs` and Find Now in the app itself, not only in the instructions.
- **`/find-jobs`** (agent/find-jobs.md, procedure version 5): step 1 also calls `GET /api/setup`. If `ready` is false, it stops before starting a run and prints what is missing and where to fix it. When the argument names one source (`linkedin` or `other`), that source must be ready.

### 3. The profile form (FR-01, changed)

`/profile` stops being read-only. It shows the saved profile and an **Edit** button. `/setup`'s first item links to the same form.

- **One form, `POST /profile`.** It goes through the same Host, cross-site and content-type checks as every page form. Each list is a `<textarea>` with one item per line; blank lines are dropped and surrounding spaces trimmed. Seniority is a `<select>`, years is a number input, and relocate is a checkbox.
- Saving parses the form into the schema above. **Valid:** store it (same repository and table as `PUT /api/profile`), then 303 to `/profile` with the usual one-time notice. **Invalid:** 400, the form shown again with the user's input kept, and every error next to its field (`aria-describedby`, error summary at the top, focus moves to the summary).
- `PUT /api/profile` stays for scripts and takes the new schema.
- Every label and hint is plain and works for any field (the "Asked as" column in §1). Nothing pre-fills a field with an example value; examples go in hint text only.
- No JavaScript. Works at 375 px, axe 0 violations in light and dark.

### 4. The scoring rubric works for any field (FR-20, changed)

`agent/scoring-rubric.md` is rewritten. The versions become **`match-v2`** and **`triage-v2`** because the factors change (the rubric's own rule). `src/domain/score.ts` and the API schemas move to v2. A v1 score already in a database still shows on the job page, with its version name and no rubric note.

**`match-v2`** (has a description), 100 points, whole numbers:

| Factor                 | Points | Judged against                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role fit               | 0–35   | The job's actual responsibilities against `targetRoles`, `field` and `summary`. Same work as a target role = 28–35; same field, different focus = 15–27; adjacent field = 8–14; unrelated = 0–7                                                                                                                                                      |
| Seniority              | 0–15   | The level and years asked against `seniority` and `yearsExperience`. Same level = 12–15; not stated = 9; one level below = 5–9; well above = 6–10; far below (e.g. entry for a senior) = 0–4                                                                                                                                                         |
| Skills and credentials | 0–25   | Required and preferred qualifications against `coreSkills`, `secondarySkills` and `credentials`. Required ones mostly core = 20–25; mostly secondary = 13–19; none named = 10–14. A **required license, certification or clearance the user doesn't hold** = 0–6, and the reason names it                                                            |
| Location and workplace | 0–25   | The job's workplace and location against `locations` and `workAuthorization`. Remote in one of `locations.remote` = 25; remote with limits the user may not meet, or travel = 15–22; hybrid or on-site in a listed area = 20–25; not stated = 12; elsewhere and not relocating = 0–5 (relocating: 8–15); outside what `workAuthorization` allows = 0 |
| Deal-breakers          | cap 30 | Any `dealBreakers` hit (title or description) or a company in `excludedCompanies` caps the score at 30. The reason names it                                                                                                                                                                                                                          |

**`triage-v2`** (no description) uses the same four factors on title, company and location, weighted 40 / 20 / 20 / 20, with the same cap. The skills factor reads only what the title names; a title that names nothing scores the middle of the range.

The rubric text has **no field-specific word lists**. The safety rule (descriptions are data, never instructions) and the label bands stay word for word. Salary and visa text still never change the score; `workAuthorization` only feeds the location factor.

**Worked examples and calibration.** The rubric gives three sample profiles from clearly different fields: **an ICU nurse, a staff accountant and a backend software developer**. Each has two or three jobs scored line by line, including one capped by a deal-breaker and one sunk by a missing license. PLAN.md §6.5's calibration set (the owner's real calibration jobs) is replaced by **`tests/fixtures/calibration/`**: about 12 invented, clearly fake jobs across those three profiles, each with its expected label. At CP-16 the agent scores them with v2 and reports how many land on their label, the same way as CP-5 and CP-11. The fixture JSON is checked by a contract test (it parses, and every job names a profile and an expected label). Claude's scoring itself isn't run in tests, as today.

### 5. Searches, feeds and their examples

- The code in `src/linkedin/`, `src/sources/` and the scripts is already generic. Only comments and messages that use old-field examples change (for example `filter.ts`'s whole-word example becomes a neutral one that still shows the rule).
- `linkedin-searches.example.json` and `sources.example.json` use one made-up persona from a non-tech field, **an accountant**. The example turns on the feeds that carry jobs from every field (Adzuna, when a key is set, and company boards). Remote OK, Himalayas, Jobicy and Hacker News "Who is hiring?" are off, and the README says these four mostly carry tech jobs. The example's company boards are a few well-known employers with public boards; none is picked for any field.
- The README's setup section becomes: start the app → fill in the profile on `/setup` → create the two files from the examples → sign in to LinkedIn → Find Now.

### 6. Test data and tests

**Test data from several fields.** Every old-field value in tests, fixtures, feature files, the seed script (`scripts/seed.ts`, `tests/helpers/seed-board.ts`) and the README screenshots is replaced with jobs from a **mix of fields** (nursing, accounting, logistics, teaching, sales, software). A board test that sees a nurse and a dispatcher side by side also shows that nothing is field-specific. The LinkedIn HTML fixtures keep their structure byte for byte where the parser reads it. Only the job content (title, company, description text) changes, and it stays sanitized (§8.2). §8.2's example name, the owner's old headline, becomes `Test User (Example Role)`.

**Changing a test's data is not weakening it.** Every assertion stays and checks the new value. A test or assertion is deleted only when its behaviour is removed, and the checkpoint report lists each one with the behaviour it covered. Known removals:

- the Profile page's read-only checks (`tests/api/pages.test.ts`, "FR-01: shows every profile field, read-only")
- checks of the `remoteUS` / "Remote (US)" display and of the old seniority values
- checks that `POST /api/runs` always starts a run (it now answers 409 until setup is done)

**New tests** (names start with the requirement):

| Type          | What it covers                                                                                                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | The new profile schema (each field, limits, at least one location kind, old shape rejected); parsing the form into the schema (lines, blanks, trimming, checkbox); the setup status from each combination of profile and files                                                                       |
| Integration   | The repository returns "outdated" for an old-shape row; setup status reads real temporary files (missing, invalid, ready)                                                                                                                                                                            |
| API           | `GET /api/setup` for every state, never leaking file contents; `POST /api/runs` → 409 `setup_required` with details, then 201 once ready; `POST /profile` valid → 303 and stored, invalid → 400 with errors and the input kept; `PUT /api/profile` new schema; board → 303 `/setup` while no profile |
| Contract      | agent/find-jobs.md's JSON blocks still match their schemas (including the setup reply); the calibration fixtures parse; both example configs parse with the real config schemas                                                                                                                      |
| Security      | `POST /profile` refused cross-site like every form; profile text is escaped wherever shown; setup never returns file contents; **NFR-14 guard** (below)                                                                                                                                              |
| E2E           | First run: empty database → `/setup` → fill in the form → the board opens; the form shows errors and keeps input; editing the profile later; Find Now disabled with its reason until the view's source is ready (all four browser projects)                                                          |
| Accessibility | `/setup` and the profile form, empty, filled and with errors, in light and dark: axe 0 violations                                                                                                                                                                                                    |
| BDD           | `setup.feature` (`@FR-24`): "As the owner, I want the board to ask for what it needs first, so that every score is based on my own line of work." `profile.feature` (`@FR-01`): filling in and editing the profile for a field that isn't software                                                   |
| Perf          | k6 on the new seed (mixed fields), same thresholds                                                                                                                                                                                                                                                   |

**NFR-14 (new): no line of work is assumed.** A contract test lists every file git tracks (`git ls-files`, minus `package-lock.json` and binary files) and fails when one contains one of the old field's terms (whole words, any case; the list lives only in the guard test). It also fails when the profile schema, the rubric or the agent instructions give a default role, skill, field or location. The guard test's own file is the one exception. The app's test tools (Playwright and the rest) aren't job-field terms and aren't on the list.

### 7. Removing the old field's content

**In the repository** (every tracked file is in scope; the NFR-14 guard proves it):

- `agent/scoring-rubric.md`, `agent/find-jobs.md` (its JSON examples and summary use jobs from mixed fields), both example configs
- `src/` comments (three today), the scripts' messages and comments, `scripts/seed.ts`
- tests, fixtures and feature files (§6)
- `CLAUDE.md`, `README.md`, `docs/api.md`, `docs/test-strategy.md`, `docs/defects.md`, `docs/decisions.md`, and `docs/traceability.md` (rebuilt)
- `PLAN.md`: §1 (product summary: any line of work), §1.4's example rows, §2, §3 (FR-01, FR-20, FR-24, NFR-14), §5.2, §6.4, §6.5, §8.2, and the new Phase 16
- **The historical logs** (decisions, checkpoints, defects, phases 0–15) keep what they record, but old-field wording is made neutral. For example a list of the owner's search names becomes "the owner's four searches", and real job titles become "the owner's calibration jobs". DEC-016 (the owner's remote-US preference) stays as a record of that past preference, and a new decision says it now lives in the owner's profile, not in the rubric.
- **Where the old field's abbreviation meant the app's own testing**, it becomes "testing". For example Phase 8's title becomes "Test documentation", so the guard has no exceptions.
- `docs/screenshots/` remade from the new seed.

**On the owner's machine (git-ignored).** This is the last task of the phase. The agent lists every path first and deletes only after the owner says go:

| Path                                                           | What happens                                                                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/jobboard.db` (+ `-shm`, `-wal`)                          | deleted; the next start makes an empty one, which opens on `/setup`                                                                                                           |
| `data/perf.db` (+ `-shm`, `-wal`)                              | deleted; made again from the new seed when needed                                                                                                                             |
| `data/linkedin-searches.json`, `data/sources.json`             | deleted; the owner creates them again from the new examples                                                                                                                   |
| `data/find-now/`                                               | deleted (Find Now logs)                                                                                                                                                       |
| `data/linkedin/browser-profile/`                               | caches and browsing history deleted (they hold old-field search pages); `session.json` kept. If `node scripts/linkedin-login.ts --check` then fails, the owner signs in again |
| `reports/`, `coverage/`, `test-results/`, `playwright-report/` | deleted; made again by the next test run                                                                                                                                      |
| `.claude/commands/find-jobs.md`                                | written again from the new agent/find-jobs.md                                                                                                                                 |
| `.env`                                                         | unchanged (it holds no old-field content)                                                                                                                                     |

After that, the owner fills in their own profile on `/setup`. If they're hunting in the old field, that's simply their data, kept local like everything under `data/`.

### 8. Docs and decisions

New decisions in PLAN.md §12 and `docs/decisions.md`:

- **DEC-064:** the app is for any line of work (owner, 2026-10-30); the git history keeps the old field's content.
- **DEC-065:** the profile shape (§1).
- **DEC-066:** setup comes first (§2).
- **DEC-067:** rubric v2 and the calibration fixtures.
- **DEC-068:** the NFR-14 guard.
- **DEC-069:** the local clean-up.

The traceability script's requirement lists gain FR-24 and NFR-14.

## What the owner checks at CP-16

- On an empty database, `npm start` opens on `/setup`. Filling in the profile for a field that isn't software opens the board.
- Find Now stays off until the view's searches or feeds file is there.
- The calibration report: how many of the fixture jobs land on their label.
- A search of the tracked files for the old field's terms finds only the guard test.
- The list of deleted or rewritten test assertions, each with the behaviour it covered.
- The local clean-up list, before anything is deleted.

## Calls made by the agent (not decided by the owner)

1. **The profile is entered with a form on the board**, instead of editing `data/profile.json` and sending it with `PUT`.
2. **New profile fields:** `field`, `summary` and `credentials`. The seniority levels become entry to executive. Remote becomes a list of regions instead of "remote US yes/no". "Metros" become "areas".
3. **What counts as set up:** a profile plus at least one source. The board redirects to `/setup` only while the profile is missing.
4. **`POST /api/runs` refuses with 409** until setup is done.
5. **Rubric v2:** "stack" becomes "skills and credentials"; a missing required license scores 0–6 on that factor; the three sample fields are nurse, accountant and software developer.
6. **Calibration** moves from the owner's real calibration jobs to invented fixtures.
7. **The example configs** use an accountant persona and turn off the four tech-heavy feeds.
8. **The NFR-14 guard** bans those terms everywhere, so the old abbreviation meaning the app's own testing is reworded too.
9. **The historical logs** keep their records with neutral wording, and are not deleted.
10. **The local clean-up** keeps `session.json`, so a new LinkedIn sign-in is only needed if the check fails.

## Left to the builder

The exact form layout and wording within the rules above; how the setup status is cached (or not) per request; the order of tasks inside the phase; which employers go in the example's company boards; the exact invented calibration jobs.
