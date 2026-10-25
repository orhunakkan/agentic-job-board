-- LinkedIn searches (PLAN.md Phase 11, FR-18, FR-19, DEC-041). Jobs get the workplace LinkedIn's job page shows, and
-- a listing sighting remembers which search found the job. The emails and sightings tables stay as they are, read
-- only, so jobs from the alert-email years keep their history.

ALTER TABLE jobs ADD COLUMN workplace TEXT CHECK (workplace IN ('remote', 'hybrid', 'on-site'));

ALTER TABLE listing_sightings ADD COLUMN search_name TEXT;

-- The scoring queue (GET /api/scoring/queue) looks for unscored jobs and for jobs scored without their description.
CREATE INDEX idx_jobs_rubric ON jobs(rubric_version, status);
