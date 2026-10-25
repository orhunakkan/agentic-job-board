// LinkedIn job links → job ID + canonical URL (PLAN.md §5.3). Alert emails link to /comm/jobs/view/<id>/, search
// cards to /jobs/view/<id>/, and search pages name the open job in currentJobId=<id> (Phase 11).
// Query strings carry tracking and one-time login tokens (otpToken, midToken, …), so they are always dropped.

export interface LinkedInJobLink {
  jobId: string;
  url: string;
}

const HOSTS = new Set(['www.linkedin.com', 'linkedin.com']);
const JOB_PATH = /^\/(?:comm\/)?jobs\/view\/(\d{1,20})\/?$/;
const JOBS_PAGE = /^\/(?:comm\/)?jobs(?:\/|$)/;
const JOB_ID = /^\d{1,20}$/;

export function canonicalizeJobUrl(link: string): LinkedInJobLink | null {
  const parsed = URL.parse(link.trim());
  if (parsed?.protocol !== 'https:' || !HOSTS.has(parsed.hostname)) return null;
  if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return null;

  const jobId = JOB_PATH.exec(parsed.pathname)?.[1] ?? currentJobId(parsed);
  if (jobId === undefined) return null;

  return { jobId, url: canonicalJobUrl(jobId) };
}

/** The job a search or collection page has open, e.g. /jobs/search/?currentJobId=4473592349&keywords=qa. */
function currentJobId(url: URL): string | undefined {
  const jobId = url.searchParams.get('currentJobId');
  return JOBS_PAGE.test(url.pathname) && jobId !== null && JOB_ID.test(jobId) ? jobId : undefined;
}

export function canonicalJobUrl(jobId: string): string {
  return `https://www.linkedin.com/jobs/view/${jobId}/`;
}
