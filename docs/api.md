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
    "details": [{ "path": "emails.0.receivedAt", "message": "Invalid ISO datetime" }]
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
| `run_finished`           | 409    | Emails, listings, scores or finish sent to a run that is already finished      |
| `payload_too_large`      | 413    | Body over 1 MB                                                                 |
| `unsupported_media_type` | 415    | Missing or wrong `Content-Type`                                                |
| `misdirected_request`    | 421    | Wrong `Host` header (DNS-rebinding guard)                                      |
| `internal_error`         | 500    | A bug; the message has the request ID to find in the server log                |
| `db_unavailable`         | 503    | Health check: the database does not answer                                     |

Every response has the security headers (CSP `default-src 'self'` with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`), `Cache-Control: no-store`, and an `X-Request-Id` that matches the server's log line for that request.

Timestamps are ISO-8601 in UTC, for example `2026-10-23T12:00:00.000Z`.

### Shared shapes

**JobSummary**: `id`, `source` (`linkedin`, or the feed: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `workable`, `remoteok`, `himalayas`, `jobicy`, `hackernews`, `adzuna`), `sourceJobId` (unique within its source, DEC-037), `title`, `company`, `location` (`""` if the source had none), `url` (for LinkedIn always `https://www.linkedin.com/jobs/view/<id>/`, never with tracking parameters; for a feed its own https link), `activelyHiring`, `easyApply`, `postedAt` and `salary` (`null` unless a feed gives them), `status`, `statusChangedAt`, `score` (0–100 or `null`), `scoreLabel` (`strong` / `possible` / `weak` or `null`), `scoreReason`, `firstSeenAt`, `lastSeenAt`, `seenCount`.

**JobDetail**: a JobSummary plus `notes`, `description` (plain text from a feed, or `null`), `rubricVersion`, `scoredAt`, `sightings` (`[{ gmailMessageId, savedSearch, receivedAt }]`, oldest first), `listingSightings` (`[{ runId, seenAt }]`, one per run a feed listed the job in) and `history` (`[{ fromStatus, toStatus, changedAt }]`, oldest first; the first entry is `null → new`).

**RunSummary**: `id`, `startedAt`, `finishedAt`, the counters `emailsSeen`, `emailsNew`, `emailsDuplicate`, `emailsUnrecognized`, `listingsSeen`, `jobsNew`, `jobsSeenAgain`, `jobsScored`, and `topNewJobs`: up to 5 JobSummaries first found in this run, best score first.

## Health and profile

### `GET /api/health`

```bash
curl -s http://127.0.0.1:3000/api/health
# 200 {"status":"ok","db":"ok","version":"0.1.0"}
```

### `GET /api/profile`

```bash
curl -s http://127.0.0.1:3000/api/profile
# 200 Profile, or 404 not_found until a profile is loaded
```

### `PUT /api/profile`

Replaces the whole profile (PLAN.md §5.2). Load the approved profile once after the first start:

```bash
curl -s -X PUT http://127.0.0.1:3000/api/profile \
  -H "Content-Type: application/json" --data-binary @data/profile.json
# 200 Profile; 400 validation_failed names every bad field
```

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

Where the next run resumes: the newest `receivedAt` of any stored email.

```bash
curl -s http://127.0.0.1:3000/api/ingest/state
# 200 {"lastEmailReceivedAt":"2026-10-23T18:52:51.000Z"}   (null before the first run)
```

### `POST /api/runs`

```bash
curl -s -X POST http://127.0.0.1:3000/api/runs -H "Content-Type: application/json" -d '{}'
# 201 {"runId":1}
```

### `POST /api/runs/:id/emails`

Up to 50 emails per call. `gmailMessageId` is letters, digits, `-` and `_` (Gmail IDs are hex). Each email is stored in its own transaction; sending one again is a `duplicate` and changes nothing (FR-05). An email the parser can't read is stored as `unrecognized` (FR-12).

```bash
cat > /tmp/batch.json <<'JSON'
{ "emails": [ {
  "gmailMessageId": "19f0a1b2c3d4e5f6",
  "receivedAt": "2026-10-22T14:10:48Z",
  "sender": "jobalerts-noreply@linkedin.com",
  "subject": "You may be a fit for Example Co's SDET role",
  "plainText": "Your job alert for sdet in United States\nNew jobs match your preferences.\n\nSDET\nExample Co\nRemote\nView job: https://www.linkedin.com/comm/jobs/view/4473592349/?trackingId=abc\n"
} ] }
JSON
curl -s -X POST http://127.0.0.1:3000/api/runs/1/emails \
  -H "Content-Type: application/json" --data-binary @/tmp/batch.json
# 200 {"results":[{"gmailMessageId":"19f0a1b2c3d4e5f6","outcome":"new","jobsFound":1}],"newJobs":[JobSummary]}
# 404 for an unknown run, 409 run_finished for a finished one
```

### `POST /api/runs/:id/listings`

Jobs from the free public feeds (FR-15, DEC-035), sent by `scripts/fetch-sources.ts`; the app itself never reads a feed (NFR-03). Up to 25 listings per call. Each is stored in its own transaction: a new `source` + `sourceJobId` is a new job, one stored by an earlier run is `seenAgain` and refreshes its details, and one this run already received is `repeated` and changes nothing (FR-16).

| Field         | Rules                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| `source`      | One of the feeds above; never `linkedin`                                |
| `sourceJobId` | 1–200 characters, one line                                              |
| `title`       | 1–300 characters, one line                                              |
| `company`     | 1–200 characters, one line                                              |
| `location`    | Up to 300 characters, one line; `""` when the feed has none             |
| `url`         | An absolute `https` link without a user name or password, ≤ 2,000 chars |
| `postedAt`    | ISO-8601 or `null`                                                      |
| `salary`      | 1–200 characters, one line, or `null`                                   |
| `description` | Plain text, 1–10,000 characters, or `null`                              |

```bash
curl -s -X POST http://127.0.0.1:3000/api/runs/1/listings -H "Content-Type: application/json" \
  -d '{"listings":[{"source":"greenhouse","sourceJobId":"5550001","title":"Senior SDET","company":"Example Labs","location":"Remote, United States","url":"https://job-boards.greenhouse.io/examplelabs/jobs/5550001","postedAt":"2026-10-20T13:00:00Z","salary":"$150K – $180K","description":"Own the test platform."}]}'
# 200 {"received":1,"new":1,"seenAgain":0,"repeated":0,"newJobs":[JobSummary]}
# 400 validation_failed, 404 for an unknown run, 409 run_finished for a finished one
```

### `POST /api/runs/:id/scores`

Up to 50 scores per call, each job at most once. The label must match the score band (`strong` ≥ 75, `possible` 50–74, `weak` < 50) and the reason is 1–200 characters. All or nothing: one unknown job ID and no score is stored.

```bash
curl -s -X POST http://127.0.0.1:3000/api/runs/1/scores -H "Content-Type: application/json" \
  -d '{"rubricVersion":"v1","scores":[{"jobId":1,"score":88,"label":"strong","reason":"Senior automation role, remote US."}]}'
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

| Query      | Values                                                               | Default                             |
| ---------- | -------------------------------------------------------------------- | ----------------------------------- |
| `origin`   | `linkedin` (alert emails) or `other` (the public feeds) (FR-17)      | every source                        |
| `tab`      | `new`, `saved`, `in-progress`, `closed`, `dismissed` (§5.5)          | every status                        |
| `minScore` | 0–100; unscored jobs are left out                                    | none                                |
| `q`        | text in the title or company, ignoring case; `%` and `_` are literal | none                                |
| `sort`     | `score` (best first, unscored last) or `recent` (newest first seen)  | the tab's sort; `score` with no tab |
| `unscored` | `true` lists only unscored jobs; can't be combined with `minScore`   | `false`                             |
| `limit`    | 1–100                                                                | 50                                  |
| `offset`   | 0 or more                                                            | 0                                   |

`total` counts every match, not just the page.

```bash
curl -s "http://127.0.0.1:3000/api/jobs?tab=new&minScore=50&q=playwright&limit=10"
# 200 {"items":[JobSummary, …],"total":3}
curl -s "http://127.0.0.1:3000/api/jobs?unscored=true&limit=100"   # the scoring backlog
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

| Route                   | What it does                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                 | The board. Query: `origin` (`linkedin` default, or `other` for the public feeds; each has its own tab counts), `tab` (`new` default, `saved`, `in-progress`, `closed`, `dismissed`), `minScore` (0–100), `q` (title or company), `sort` (`score`, `recent`, `changed`), `page` (50 jobs per page). Empty values mean "not set"; unknown keys are ignored |
| `GET /jobs/:id`         | Job detail: score and reason, status form (only allowed next statuses), notes, history, sightings, the link to the job on its source; for a feed's job also its description, salary and posted date                                                                                                                                                      |
| `POST /jobs/:id/status` | Form fields `status` and optional `return` (a path on this site; anything else falls back to the job page). 303 back with `changed=<id>`, which shows a notice. 409 page for a transition §5.4 doesn't allow                                                                                                                                             |
| `POST /jobs/:id/notes`  | Form field `notes` (up to 5,000 characters; CRLF is stored as LF). 303 to `/jobs/:id?notes=saved`                                                                                                                                                                                                                                                        |
| `GET /runs`             | Every run with its counters, and the unrecognized emails with the parser's reason (FR-11, FR-12)                                                                                                                                                                                                                                                         |
| `GET /profile`          | The profile, read-only (FR-01)                                                                                                                                                                                                                                                                                                                           |
| `GET /static/<file>`    | `app.css` and `favicon.svg` only; every other name is a 404                                                                                                                                                                                                                                                                                              |
