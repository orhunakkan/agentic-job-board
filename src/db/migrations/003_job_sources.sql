-- Jobs from other sources (PLAN.md Phase 10, DEC-035, DEC-037). A job ID is unique only within its source, so
-- linkedin_job_id becomes source + source_job_id. SQLite can't drop a column-level UNIQUE, so the table is rebuilt
-- the way SQLite documents it; migrate.ts runs this with foreign keys off and checks them before it commits.
-- LinkedIn jobs keep their row IDs and their job IDs, with source 'linkedin'. Sources are checked by the app
-- (src/domain/job-source.ts), so a new feed needs no rebuild.

CREATE TABLE jobs_rebuilt (
  id                INTEGER PRIMARY KEY,
  source            TEXT NOT NULL CHECK (source <> ''),
  source_job_id     TEXT NOT NULL CHECK (source_job_id <> ''),
  title             TEXT NOT NULL,
  company           TEXT NOT NULL,
  location          TEXT NOT NULL,
  url               TEXT NOT NULL,          -- LinkedIn: canonical (§5.3); other sources: the listing's https link
  actively_hiring   INTEGER NOT NULL DEFAULT 0 CHECK (actively_hiring IN (0, 1)),
  easy_apply        INTEGER NOT NULL DEFAULT 0 CHECK (easy_apply IN (0, 1)),
  posted_at         TEXT,                   -- when the source published it, if it says
  salary            TEXT,                   -- as the source writes it, e.g. "$120K – $150K"
  description       TEXT,                   -- plain text; LinkedIn emails have none
  status            TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','saved','applied','interviewing','offer','rejected','dismissed')),
  status_changed_at TEXT NOT NULL,
  notes             TEXT NOT NULL DEFAULT '',
  score             INTEGER CHECK (score BETWEEN 0 AND 100),
  score_label       TEXT CHECK (score_label IN ('strong','possible','weak')),
  score_reason      TEXT,
  rubric_version    TEXT,
  scored_at         TEXT,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  seen_count        INTEGER NOT NULL DEFAULT 1,
  first_run_id      INTEGER REFERENCES runs(id),
  UNIQUE (source, source_job_id)
);

INSERT INTO jobs_rebuilt (id, source, source_job_id, title, company, location, url, actively_hiring, easy_apply,
                          status, status_changed_at, notes, score, score_label, score_reason, rubric_version,
                          scored_at, first_seen_at, last_seen_at, seen_count, first_run_id)
SELECT id, 'linkedin', linkedin_job_id, title, company, location, url, actively_hiring, easy_apply,
       status, status_changed_at, notes, score, score_label, score_reason, rubric_version,
       scored_at, first_seen_at, last_seen_at, seen_count, first_run_id
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_rebuilt RENAME TO jobs;

CREATE INDEX idx_jobs_status_score ON jobs(status, score DESC);
CREATE INDEX idx_jobs_first_seen ON jobs(first_seen_at DESC);
CREATE INDEX idx_jobs_first_run ON jobs(first_run_id);

-- One row per run in which a feed listed the job (FR-16), like sightings for emails.
CREATE TABLE listing_sightings (
  job_id   INTEGER NOT NULL REFERENCES jobs(id),
  run_id   INTEGER NOT NULL REFERENCES runs(id),
  seen_at  TEXT NOT NULL,
  PRIMARY KEY (job_id, run_id)
);

ALTER TABLE runs ADD COLUMN listings_seen INTEGER NOT NULL DEFAULT 0;
