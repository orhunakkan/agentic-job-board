# API reference

The JSON API of the Agentic Job Board (PLAN.md §6.1). It serves `http://127.0.0.1:3000` only (NFR-01). Every request and response shape is defined with Zod in [`src/schemas/api.ts`](../src/schemas/api.ts), and the contract tests check every response against it.

The examples use `curl` in Git Bash. In PowerShell, type `curl.exe` instead of `curl`.

## Conventions

| Rule                                                                                                     | Otherwise                    |
| -------------------------------------------------------------------------------------------------------- | ---------------------------- |
| The `Host` header is `127.0.0.1:<port>` or `localhost:<port>`                                            | `421 misdirected_request`    |
| A browser write (POST/PUT/PATCH) comes from the app's own origin                                         | `403 cross_site_request`     |
| Every write sends `Content-Type: application/json`, also for `{}` bodies                                 | `415 unsupported_media_type` |
| The body is at most 1 MB                                                                                 | `413 payload_too_large`      |
| The body is valid JSON                                                                                   | `400 invalid_json`           |
| The body, path IDs and query string match the schema; unknown fields and repeated query keys are refused | `400 validation_failed`      |
| The path exists                                                                                          | `404 not_found`              |
| The method is right for the path (`Allow` lists the right ones)                                          | `405 method_not_allowed`     |

Errors always look like this:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request is invalid",
    "details": [{ "path": "listings.0.postedAt", "message": "Invalid ISO datetime" }]
  }
}
```

| Code                     | Status | Meaning                                                                        |
| ------------------------ | ------ | ------------------------------------------------------------------------------ |
| `validation_failed`      | 400    | `details` lists each problem as `{ path, message }`                            |
| `invalid_json`           | 400    | The body is not JSON                                                           |
| `unknown_jobs`           | 400    | Scores name jobs that don't exist; `details.jobIds` lists them; nothing stored |
| `cross_site_request`     | 403    | A write from another website                                                   |
| `not_found`              | 404    | No such path, job or run                                                       |
| `method_not_allowed`     | 405    | See the `Allow` header                                                         |
| `invalid_transition`     | 409    | Not allowed by PLAN.md §5.4; `details` is `{ from, to }`                       |
| `setup_required`         | 409    | `POST /api/runs` before setup is done; `details` has the setup statuses        |
| `run_finished`           | 409    | Listings, scores or finish sent to a run that is already finished              |
| `payload_too_large`      | 413    | Body over 1 MB                                                                 |
| `unsupported_media_type` | 415    | Missing or wrong `Content-Type`                                                |
| `misdirected_request`    | 421    | Wrong `Host` header (DNS-rebinding guard)                                      |
| `internal_error`         | 500    | A bug; the message has the request ID to find in the server log                |
| `db_unavailable`         | 503    | Health check: the database does not answer                                     |

Every response has the security headers (CSP `default-src 'self'` with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`), `Cache-Control: no-store`, and an `X-Request-Id` that matches the server's log line for that request.

Timestamps are ISO-8601 in UTC, for example `2026-10-23T12:00:00.000Z`.

### Shared shapes

**JobSummary**: `id`, `source` (`linkedin`, or the feed: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `workable`, `remoteok`, `himalayas`, `jobicy`, `hackernews`, `adzuna`), `sourceJobId` (unique within its source, DEC-037), `title`, `company`, `location` (`""` if the source had none), `url` (for LinkedIn always `https://www.linkedin.com/jobs/view/<id>/`, never with tracking parameters; for a feed its own https link), `activelyHiring` (only on jobs from the alert-email years), `easyApply`, `postedAt`, `salary` and `workplace` (`remote`, `hybrid`, `on-site`; each `null` unless the source gives it), `status`, `statusChangedAt`, `score` (0–100 or `null`), `scoreLabel` (`strong` / `possible` / `weak` or `null`), `scoreReason`, `firstSeenAt`, `lastSeenAt`, `seenCount`.

**JobDetail**: a JobSummary plus `notes`, `description` (plain text from the job page or feed, or `null`), `rubricVersion`, `scoredAt`, `sightings` (`[{ gmailMessageId, savedSearch, receivedAt }]`, oldest first: the alert emails of the email years), `listingSightings` (`[{ runId, seenAt, searchName }]`, one per run a LinkedIn search or a feed listed the job in; `searchName` is the LinkedIn search, `null` for a feed or a backfill) and `history` (`[{ fromStatus, toStatus, changedAt }]`, oldest first; the first entry is `null → new`).

**RunSummary**: `id`, `startedAt`, `finishedAt`, the counters `emailsSeen`, `emailsNew`, `emailsDuplicate`, `emailsUnrecognized` (non-zero only for runs of the email years), `listingsSeen`, `jobsNew`, `jobsSeenAgain`, `jobsScored`, and `topNewJobs`: up to 5 JobSummaries first found in this run, best score first.

## Health and profile

### `GET /api/health`

```bash
curl -s http://127.0.0.1:3000/api/health
# 200 {"status":"ok","db":"ok","version":"0.1.0"}
```

### `GET /api/profile`

```bash
curl -s http://127.0.0.1:3000/api/profile
# 200 Profile, or 404 not_found while the profile is missing or saved in an older shape (outdated)
```

### `PUT /api/profile`

Replaces the whole profile (PLAN.md §5.2, DEC-065), for scripts. The board's own form is `POST /profile` (below), which stores it the same way.

```bash
curl -s -X PUT http://127.0.0.1:3000/api/profile \
  -H "Content-Type: application/json" --data-binary @profile.json
# 200 Profile; 400 validation_failed names every bad field
```

### `GET /api/setup`

Whether the board is set up (FR-24, DEC-066): the profile is saved, and each source's file (`data/linkedin-searches.json`, `data/sources.json`) is there and valid. Only the statuses, never the files' contents. `ready` is true when the profile is `saved` and at least one source is `ready`. `/find-jobs` reads it first and stops when it isn't.

```bash
curl -s http://127.0.0.1:3000/api/setup
# 200 {"profile":"saved","linkedinSearches":"ready","sources":"missing","ready":true}
```

| Field              | Values                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `profile`          | `missing`, `outdated` (saved in an older shape: fill it in again) or `saved`                                |
| `linkedinSearches` | `missing`, `invalid` (not a valid searches file) or `ready`                                                 |
| `sources`          | `missing`, `invalid` (not a valid feeds file, or one that turns on no feed and no company board) or `ready` |
| `ready`            | `true` once the profile is saved and at least one source is ready                                           |

## LinkedIn login

### `GET /api/linkedin/session`

The status of the owner's saved LinkedIn login (FR-14, DEC-032), written by `node scripts/linkedin-login.ts`. The app only reads the file, so the status is judged by the sign-in cookie's expiry and never by contacting LinkedIn. Cookie values are never returned (NFR-12).

```bash
curl -s http://127.0.0.1:3000/api/linkedin/session
# 200 {"status":"active","savedAt":"2026-10-24T09:00:00.000Z","expiresAt":"2027-04-23T12:00:00.000Z"}
```

| `status`  | Meaning                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `missing` | Nothing saved yet (`savedAt` and `expiresAt` are null)                    |
| `invalid` | The file can't be used (not JSON, unknown format, no sign-in cookie)      |
| `expired` | The sign-in cookie has expired: run the login script again                |
| `active`  | Usable; `expiresAt` is null when the cookie lasts for the browser session |

## The `/find-jobs` run

### `GET /api/ingest/state`

When a run last stored a job one of the LinkedIn searches found: where `postedWithin: since-last-run` starts (FR-18, DEC-042). A `--backfill` run names no search and doesn't count.

```bash
curl -s http://127.0.0.1:3000/api/ingest/state
# 200 {"lastLinkedInSearchAt":"2026-10-25T14:31:02.000Z"}   (null before the first search)
```

### `POST /api/runs`

```bash
curl -s -X POST http://127.0.0.1:3000/api/runs -H "Content-Type: application/json" -d '{}'
# 201 {"runId":1}
# 409 {"error":{"code":"setup_required","message":"The board is not set up yet: …","details":{"profile":"missing","linkedinSearches":"missing","sources":"missing"}}}
```

### `POST /api/runs/:id/emails` (retired)

The alert-email endpoint was removed in Phase 11 with the Gmail track (DEC-041): it answers `404 not_found`. Emails stored before then stay in the database; their sightings show on the job page and their counts on `/runs`.

### `POST /api/runs/:id/listings`

Jobs from the owner's LinkedIn searches (FR-18, sent by `scripts/search-linkedin.ts`) and from the free public feeds (FR-15, DEC-035, sent by `scripts/fetch-sources.ts`); the app itself never reads LinkedIn or a feed (NFR-03). Up to 25 listings per call. A LinkedIn job the board has from an alert email is the same job. Each is stored in its own transaction: a new `source` + `sourceJobId` is a new job, one stored by an earlier run is `seenAgain` and refreshes its details, and one this run already received is `repeated` and changes nothing (FR-16).

| Field         | Rules                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`      | `linkedin` or one of the feeds above                                                                                                                |
| `sourceJobId` | 1–200 characters, one line                                                                                                                          |
| `title`       | 1–300 characters, one line                                                                                                                          |
| `company`     | 1–200 characters, one line                                                                                                                          |
| `location`    | Up to 300 characters, one line; `""` when the feed has none                                                                                         |
| `url`         | An absolute `https` link without a user name or password, ≤ 2,000 chars; for `linkedin` exactly `https://www.linkedin.com/jobs/view/<sourceJobId>/` |
| `postedAt`    | ISO-8601 or `null`                                                                                                                                  |
| `salary`      | 1–200 characters, one line, or `null`                                                                                                               |
| `description` | Plain text, 1–10,000 characters, or `null`                                                                                                          |
| `workplace`   | Optional: `remote`, `hybrid`, `on-site` or `null`                                                                                                   |
| `easyApply`   | Optional boolean (LinkedIn), `false` when left out                                                                                                  |
| `searchName`  | Optional: the LinkedIn search that found the job, 1–100 characters                                                                                  |

```bash
curl -s -X POST http://127.0.0.1:3000/api/runs/1/listings -H "Content-Type: application/json" \
  -d '{"listings":[{"source":"greenhouse","sourceJobId":"5550001","title":"Senior Dispatcher","company":"Example Labs","location":"Remote, United States","url":"https://job-boards.greenhouse.io/examplelabs/jobs/5550001","postedAt":"2026-10-20T13:00:00Z","salary":"$60K – $72K","description":"Run the night dispatch desk."}]}'
# 200 {"received":1,"new":1,"seenAgain":0,"repeated":0,"newJobs":[JobSummary]}
# 400 validation_failed, 404 for an unknown run, 409 run_finished for a finished one
```

### `POST /api/listings/known`

Which of up to 100 job IDs of one source the board already has (FR-19). `scripts/search-linkedin.ts` asks before it reads job pages, so it opens a page only for a job new to the board. Read-only.

```bash
curl -s -X POST http://127.0.0.1:3000/api/listings/known -H "Content-Type: application/json" \
  -d '{"source":"linkedin","sourceJobIds":["4480000001","4480000002"]}'
# 200 {"known":["4480000001"]}   (each ID once, in request order)
```

### `GET /api/scoring/queue?limit=10`

The jobs `/find-jobs` still has to score (FR-20, DEC-043, DEC-044): every unscored job, then every job in New or Saved that has a description but was scored with another rubric than `match-v2` (for example before `--backfill` added the description). Newest first; `limit` is 1–25 (default 10); `total` counts the whole queue. Each item carries what the rubric reads: `id`, `source`, `title`, `company`, `location`, `workplace`, `salary`, `postedAt`, `description`, `rubric` (`match-v2` when there is a description, `triage-v2` when there isn't) and `currentRubric` (the rubric of its current score, or `null`). Posting the scores takes the jobs out of the queue.

```bash
curl -s "http://127.0.0.1:3000/api/scoring/queue?limit=10"
# 200 {"items":[{"id":41,"source":"linkedin","title":"ICU Registered Nurse","rubric":"match-v2",…}],"total":23}
```

### `POST /api/runs/:id/scores`

Up to 50 scores per call, each job at most once. The label must match the score band (`strong` ≥ 75, `possible` 50–74, `weak` < 50) and the reason is 1–200 characters. All or nothing: one unknown job ID and no score is stored.

```bash
curl -s -X POST http://127.0.0.1:3000/api/runs/1/scores -H "Content-Type: application/json" \
  -d '{"rubricVersion":"match-v2","scores":[{"jobId":1,"score":88,"label":"strong","reason":"Day-shift ICU role in your area; asks for the licenses you hold."}]}'
# 200 {"stored":1}; 400 validation_failed (e.g. score 80 with label weak) or unknown_jobs
```

### `POST /api/runs/:id/finish`

```bash
curl -s -X POST http://127.0.0.1:3000/api/runs/1/finish -H "Content-Type: application/json" -d '{}'
# 200 RunSummary; 409 run_finished if it was already finished
```

### `GET /api/runs?limit=20`

Newest first. `limit` is 1–100 (default 20).

```bash
curl -s "http://127.0.0.1:3000/api/runs?limit=5"
# 200 [RunSummary, …]
```

## Jobs

### `GET /api/jobs`

| Query      | Values                                                                | Default                             |
| ---------- | --------------------------------------------------------------------- | ----------------------------------- |
| `origin`   | `linkedin` (searches and alert emails) or `other` (the feeds) (FR-17) | every source                        |
| `tab`      | `new`, `saved`, `in-progress`, `closed`, `dismissed` (§5.5)           | every status                        |
| `minScore` | 0–100; unscored jobs are left out                                     | none                                |
| `q`        | text in the title or company, ignoring case; `%` and `_` are literal  | none                                |
| `sort`     | `score` (best first, unscored last) or `recent` (newest first seen)   | the tab's sort; `score` with no tab |
| `unscored` | `true` lists only unscored jobs; can't be combined with `minScore`    | `false`                             |
| `limit`    | 1–100                                                                 | 50                                  |
| `offset`   | 0 or more                                                             | 0                                   |

`total` counts every match, not just the page.

```bash
curl -s "http://127.0.0.1:3000/api/jobs?tab=new&minScore=50&q=dispatcher&limit=10"
# 200 {"items":[JobSummary, …],"total":3}
curl -s "http://127.0.0.1:3000/api/jobs?unscored=true&limit=100"   # unscored jobs (the agent uses /api/scoring/queue)
```

### `GET /api/jobs/:id`

```bash
curl -s http://127.0.0.1:3000/api/jobs/1
# 200 JobDetail; 404 not_found; 400 for an ID that is not a positive whole number
```

### `PATCH /api/jobs/:id`

Send `status`, `notes` (up to 5,000 characters) or both. They change together or not at all.

```bash
curl -s -X PATCH http://127.0.0.1:3000/api/jobs/1 -H "Content-Type: application/json" \
  -d '{"status":"applied","notes":"Applied through the careers page."}'
# 200 JobDetail
curl -s -X PATCH http://127.0.0.1:3000/api/jobs/1 -H "Content-Type: application/json" -d '{"status":"offer"}'
# 409 {"error":{"code":"invalid_transition","message":"a job can't move from applied to offer","details":{"from":"applied","to":"offer"}}}
```

## HTML pages

The board is server-rendered HTML with no client-side JavaScript (PLAN.md §6.2, DEC-006). The same Host, cross-site and size rules apply. Page forms post `application/x-www-form-urlencoded` (anything else is a 415), then redirect with `303 See Other`. Errors outside `/api/` are HTML pages with the same status codes, never JSON.

| Route                   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                 | The board; 303 to `/setup` while no valid profile is saved (FR-24), and a notice that links to it while no source is ready. Query: `origin` (`linkedin` default, or `other` for the public feeds; each has its own tab counts, and the switch between them shows each view's New count, DEC-054), `tab` (`new` default, `saved`, `in-progress`, `closed`, `dismissed`), `minScore` (0–100), `q` (title or company), `sort` (`score`, `recent`, `changed`), `page` (50 jobs per page). Empty values mean "not set"; unknown keys are ignored |
| `GET /jobs/:id`         | Job detail: score and reason, status form (only allowed next statuses), notes, history, sightings (with the LinkedIn search that found the job), the link to the job on its source, and its description, salary, workplace, posted date and scoring rubric when known                                                                                                                                                                                                                                                                       |
| `POST /jobs/:id/status` | Form fields `status` and optional `return` (a path on this site; anything else falls back to the job page). 303 back with `changed=<id>`, which shows a notice. 409 page for a transition §5.4 doesn't allow                                                                                                                                                                                                                                                                                                                                |
| `POST /board/clear`     | Clear All (FR-21, DEC-051): form field `origin` (`linkedin` or `other`). Every New job of that view goes to Dismissed, with a history row each. 303 to the view's New tab with `cleared=<count>`, which shows a notice                                                                                                                                                                                                                                                                                                                      |
| `POST /board/find`      | Find Now (FR-22, DEC-052): form field `origin`. Starts `/find-jobs <origin>` in Claude Code's headless mode in the background, unless a run is going (then nothing starts) or the view's own source isn't ready yet (FR-24; the button is disabled, with its reason, and a post starts nothing and lands at `#find-now-reason`). 303 to the view's New tab at `#find-now`, the line that says what is running or how the last run ended                                                                                                     |
| `POST /jobs/:id/notes`  | Form field `notes` (up to 5,000 characters; CRLF is stored as LF). 303 to `/jobs/:id?notes=saved`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET /runs`             | Every run with its counters; the email columns keep the counts of runs from the alert-email years (FR-11)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /theme`           | The header's light/dark toggle (FR-23, DEC-061): form fields `theme` (`light` or `dark`; anything else is a 400) and optional `return` (a path on this site, the page without its notice parameters; anything else falls back to `/`). 303 back to `return`, with `Set-Cookie: theme=<light\|dark>; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`. Every page, error pages included, puts `data-theme` on `<html>` when the cookie is `light` or `dark`, and otherwise follows the system. It is the app's only cookie                  |
| `GET /setup`            | Setup (FR-24, DEC-066): a checklist of the profile, the LinkedIn searches and the feeds, each with its status and how to fix it; never a file's contents                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /profile`          | The profile with an **Edit** button (FR-01); `saved=yes` shows the one-time notice after the form saved it                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GET /profile/edit`     | The profile form: empty on a first run, the saved profile to change, or what still fits of a profile saved in an older shape                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /profile`         | The profile form (FR-01, DEC-065): one text field or textarea per profile field (lists one item per line, trimmed, blank lines dropped), `seniority` from a select, `yearsExperience` a number, `relocate=yes` when the checkbox is ticked. Valid: stored like `PUT /api/profile`, then 303 to `/profile?saved=yes#notice`. Invalid: 400, the form again with each error next to its field, an error summary that takes the focus (the form posts to `/profile#errors`), and everything typed kept                                          |
| `GET /static/<file>`    | `app.css` and `favicon.svg` only; every other name is a 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
