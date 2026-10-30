import { z } from 'zod';
import { readJobs, segment, type FeedRequest } from './feed.ts';
import { formatSalary, remoteLocation } from './listing.ts';

// Company job boards (PLAN.md Phase 10, DEC-035): every open job of one company, from the public JSON its job
// board publishes. Free and without a key; the field names were checked against live answers on 2026-10-24.

const Text = z.string();
const MaybeText = z.string().nullish();
// The answer most of these boards send: { "jobs": [...] }.
const JobsEnvelope = z.object({ jobs: z.array(z.unknown()) }).transform((answer) => answer.jobs);

// --- Greenhouse: boards-api.greenhouse.io/v1/boards/<slug>/jobs ------------------------------------------------

const GreenhouseJob = z.object({
  id: z.number(),
  title: Text,
  absolute_url: Text,
  company_name: MaybeText,
  location: z.object({ name: MaybeText }).nullish(),
  first_published: MaybeText,
  updated_at: MaybeText,
  content: MaybeText, // HTML, escaped once more
});

export function greenhouseBoard(slug: string): FeedRequest {
  const name = `Greenhouse ${slug}`;
  return {
    source: 'greenhouse',
    name,
    url: `https://boards-api.greenhouse.io/v1/boards/${segment(slug)}/jobs?content=true`,
    read: (body) => ({
      ...readJobs(name, body, JobsEnvelope, GreenhouseJob, (job) => ({
        source: 'greenhouse',
        sourceJobId: job.id,
        title: job.title,
        company: job.company_name ?? slug,
        location: job.location?.name ?? '',
        url: job.absolute_url,
        postedAt: job.first_published ?? job.updated_at ?? null,
        salary: null,
        description: job.content ?? null,
      })),
      followUps: [],
    }),
  };
}

// --- Lever: api.lever.co/v0/postings/<slug> ---------------------------------------------------------------------

const LeverJob = z.object({
  id: Text,
  text: Text,
  hostedUrl: Text,
  createdAt: z.number().nullish(), // milliseconds
  workplaceType: MaybeText, // 'remote' | 'hybrid' | 'on-site' | 'unspecified'
  categories: z.object({ location: MaybeText, allLocations: z.array(Text).nullish() }).nullish(),
  salaryRange: z
    .object({ min: z.number().nullish(), max: z.number().nullish(), currency: MaybeText, interval: MaybeText })
    .nullish(),
  descriptionPlain: MaybeText,
  additionalPlain: MaybeText,
});

export function leverBoard(slug: string): FeedRequest {
  const name = `Lever ${slug}`;
  return {
    source: 'lever',
    name,
    url: `https://api.lever.co/v0/postings/${segment(slug)}?mode=json`,
    read: (body) => ({
      ...readJobs(name, body, z.array(z.unknown()), LeverJob, (job) => {
        const place = job.categories?.allLocations?.join(', ') ?? job.categories?.location ?? '';
        return {
          source: 'lever',
          sourceJobId: job.id,
          title: job.text,
          company: slug,
          location: workplace(place, job.workplaceType),
          url: job.hostedUrl,
          postedAt: job.createdAt === null || job.createdAt === undefined ? null : job.createdAt / 1000,
          salary: formatSalary(
            job.salaryRange?.min,
            job.salaryRange?.max,
            job.salaryRange?.currency,
            job.salaryRange?.interval,
          ),
          description: [job.descriptionPlain, job.additionalPlain].filter(Boolean).join('\n\n') || null,
        };
      }),
      followUps: [],
    }),
  };
}

// --- Ashby: api.ashbyhq.com/posting-api/job-board/<slug> --------------------------------------------------------

const AshbyJob = z.object({
  id: Text,
  title: Text,
  jobUrl: Text,
  location: MaybeText,
  secondaryLocations: z.array(z.object({ location: MaybeText })).nullish(),
  workplaceType: MaybeText, // 'Remote' | 'Hybrid' | 'OnSite'
  isListed: z.boolean().nullish(),
  publishedAt: MaybeText,
  descriptionPlain: MaybeText,
  compensation: z
    .object({ scrapeableCompensationSalarySummary: MaybeText, compensationTierSummary: MaybeText })
    .nullish(),
});

export function ashbyBoard(slug: string): FeedRequest {
  const name = `Ashby ${slug}`;
  return {
    source: 'ashby',
    name,
    url: `https://api.ashbyhq.com/posting-api/job-board/${segment(slug)}?includeCompensation=true`,
    read: (body) => ({
      ...readJobs(name, body, JobsEnvelope, AshbyJob, (job) => {
        if (job.isListed === false) return null;
        const places = [job.location, ...(job.secondaryLocations ?? []).map((place) => place.location)];
        return {
          source: 'ashby',
          sourceJobId: job.id,
          title: job.title,
          company: slug,
          location: workplace(places.filter(Boolean).join(' / '), job.workplaceType),
          url: job.jobUrl,
          postedAt: job.publishedAt ?? null,
          salary:
            job.compensation?.scrapeableCompensationSalarySummary ?? job.compensation?.compensationTierSummary ?? null,
          description: job.descriptionPlain ?? null,
        };
      }),
      followUps: [],
    }),
  };
}

// --- SmartRecruiters: api.smartrecruiters.com/v1/companies/<slug>/postings --------------------------------------

const SMARTRECRUITERS_PAGE = 100;
const SMARTRECRUITERS_PAGES = 10; // a company with more than 1,000 open jobs is read only in part

const SmartRecruitersJob = z.object({
  id: Text,
  name: Text,
  releasedDate: MaybeText,
  company: z.object({ identifier: Text, name: MaybeText }),
  location: z.object({ fullLocation: MaybeText, city: MaybeText, remote: z.boolean().nullish() }).nullish(),
});

const SmartRecruitersPage = z.object({
  offset: z.number(),
  totalFound: z.number(),
  content: z.array(z.unknown()),
});

export function smartRecruitersBoard(slug: string, offset = 0): FeedRequest {
  const page = offset / SMARTRECRUITERS_PAGE + 1;
  const name = page === 1 ? `SmartRecruiters ${slug}` : `SmartRecruiters ${slug} (page ${String(page)})`;
  return {
    source: 'smartrecruiters',
    name,
    url: `https://api.smartrecruiters.com/v1/companies/${segment(slug)}/postings?limit=${String(SMARTRECRUITERS_PAGE)}&offset=${String(offset)}`,
    read: (body) => {
      const answer = SmartRecruitersPage.safeParse(body);
      const next = offset + SMARTRECRUITERS_PAGE;
      const more =
        answer.success && next < answer.data.totalFound && next < SMARTRECRUITERS_PAGE * SMARTRECRUITERS_PAGES;
      return {
        ...readJobs(
          name,
          body,
          SmartRecruitersPage.transform((answer) => answer.content),
          SmartRecruitersJob,
          (job) => {
            const place = job.location?.fullLocation ?? job.location?.city ?? '';
            return {
              source: 'smartrecruiters',
              sourceJobId: job.id,
              title: job.name,
              company: job.company.name ?? slug,
              location: job.location?.remote === true ? remoteLocation(place) : place,
              url: `https://jobs.smartrecruiters.com/${segment(job.company.identifier)}/${segment(job.id)}`,
              postedAt: job.releasedDate ?? null,
              salary: null,
              description: null, // only in a second request per job, which isn't worth it for triage
            };
          },
        ),
        followUps: more ? [smartRecruitersBoard(slug, next)] : [],
      };
    },
  };
}

// --- Workable: apply.workable.com/api/v1/widget/accounts/<slug> -------------------------------------------------

const WorkableJob = z.object({
  shortcode: Text,
  title: Text,
  url: Text,
  telecommuting: z.boolean().nullish(),
  published_on: MaybeText, // "2026-05-29"
  city: MaybeText,
  state: MaybeText,
  country: MaybeText,
  description: MaybeText,
});

export function workableBoard(slug: string): FeedRequest {
  const name = `Workable ${slug}`;
  return {
    source: 'workable',
    name,
    url: `https://apply.workable.com/api/v1/widget/accounts/${segment(slug)}?details=true`,
    read: (body) => {
      const company = z.object({ name: MaybeText }).safeParse(body);
      return {
        ...readJobs(name, body, JobsEnvelope, WorkableJob, (job) => {
          const place = [job.city, job.state, job.country].filter(Boolean).join(', ');
          return {
            source: 'workable',
            sourceJobId: job.shortcode,
            title: job.title,
            company: (company.success ? company.data.name : null) ?? slug,
            location: job.telecommuting === true ? remoteLocation(place) : place,
            url: job.url,
            postedAt: job.published_on ?? null,
            salary: null,
            description: job.description ?? null,
          };
        }),
        followUps: [],
      };
    },
  };
}

/** "Remote (New York, NY)", "Austin, TX (hybrid)" or the place as it is, from a board's workplace type. */
function workplace(place: string, type: string | null | undefined): string {
  const kind = (type ?? '').toLowerCase();
  if (kind === 'remote') return /remote/i.test(place) ? place : remoteLocation(place);
  if (kind === 'hybrid' && place !== '' && !/hybrid/i.test(place)) return `${place} (hybrid)`;
  return place;
}
