import { z } from 'zod';
import { readJobs, segment, type FeedRequest } from './feed.ts';
import { formatSalary } from './listing.ts';

// Adzuna (PLAN.md Phase 10, DEC-035): a job search across many US sites. Its API is free but needs a key, so it
// runs only when ADZUNA_APP_ID and ADZUNA_APP_KEY are set. The key travels in the URL, so the request's name,
// which is what the script prints, never contains the URL.

export interface AdzunaKey {
  appId: string;
  appKey: string;
}

const AdzunaJob = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(), // may hold <strong> highlights
  redirect_url: z.string(),
  created: z.string().nullish(),
  description: z.string().nullish(), // a snippet only
  company: z.object({ display_name: z.string().nullish() }).nullish(),
  location: z.object({ display_name: z.string().nullish() }).nullish(),
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  salary_is_predicted: z.union([z.string(), z.number()]).nullish(),
});

export function adzunaSearch(keyword: string, key: AdzunaKey): FeedRequest {
  const name = `Adzuna "${keyword}"`;
  const query = new URLSearchParams({
    app_id: key.appId,
    app_key: key.appKey,
    what: keyword,
    results_per_page: '50',
    max_days_old: '14',
    'content-type': 'application/json',
  });
  return {
    source: 'adzuna',
    name,
    url: `https://api.adzuna.com/v1/api/jobs/us/search/1?${query.toString()}`,
    read: (body) => ({
      ...readJobs(
        name,
        body,
        z.object({ results: z.array(z.unknown()) }).transform((answer) => answer.results),
        AdzunaJob,
        (job) => {
          const company = job.company?.display_name ?? '';
          if (company === '') return null;
          // Adzuna estimates a salary when the ad has none; only a real one is shown.
          const predicted = String(job.salary_is_predicted ?? '0') === '1';
          return {
            source: 'adzuna',
            sourceJobId: job.id,
            title: job.title,
            company,
            location: job.location?.display_name ?? '',
            url: `https://www.adzuna.com/details/${segment(String(job.id))}`,
            postedAt: job.created ?? null,
            salary: predicted ? null : formatSalary(job.salary_min, job.salary_max, 'USD'),
            description: job.description ?? null,
          };
        },
      ),
      followUps: [],
    }),
  };
}
