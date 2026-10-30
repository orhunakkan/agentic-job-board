import { z } from 'zod';
import { readJobs, segment, type FeedRequest } from './feed.ts';
import { formatSalary, remoteLocation } from './listing.ts';

// Remote job boards (PLAN.md Phase 10, DEC-035): remote jobs across many companies, free and without a key. Their
// terms ask for the board to be named and linked, which the board does (DEC-036). Field names were checked
// against live answers on 2026-10-24.

const Text = z.string();
const MaybeText = z.string().nullish();
const MaybeAmount = z.number().nullish();
// The answer most of these boards send: { "jobs": [...] }.
const JobsEnvelope = z.object({ jobs: z.array(z.unknown()) }).transform((answer) => answer.jobs);

// --- Remote OK: remoteok.com/api, the latest ~100 jobs; the first item is its legal notice ----------------------

const RemoteOkJob = z.object({
  id: z.union([Text, z.number()]),
  position: Text,
  company: Text,
  location: MaybeText,
  url: Text,
  date: MaybeText,
  salary_min: MaybeAmount,
  salary_max: MaybeAmount,
  description: MaybeText,
});

export function remoteOkFeed(): FeedRequest {
  const name = 'Remote OK';
  return {
    source: 'remoteok',
    name,
    url: 'https://remoteok.com/api',
    read: (body) => {
      const jobs = readJobs(
        name,
        body,
        z.array(z.unknown()).transform((items) => items.filter((item) => !isNotice(item))),
        RemoteOkJob,
        (job) => ({
          source: 'remoteok',
          sourceJobId: job.id,
          title: job.position,
          company: job.company,
          location: remoteLocation(job.location),
          url: job.url,
          postedAt: job.date ?? null,
          salary: formatSalary(job.salary_min, job.salary_max, 'USD'),
          description: job.description ?? null,
        }),
      );
      return { ...jobs, followUps: [] };
    },
  };
}

function isNotice(item: unknown): boolean {
  return typeof item === 'object' && item !== null && 'legal' in item && !('position' in item);
}

// --- Himalayas: himalayas.app/jobs/api/search, 20 results per keyword in the US ---------------------------------

const HimalayasJob = z.object({
  guid: Text, // the job's page on himalayas.app
  title: Text,
  companyName: Text,
  locationRestrictions: z.array(Text).nullish(),
  minSalary: MaybeAmount,
  maxSalary: MaybeAmount,
  currency: MaybeText,
  salaryPeriod: MaybeText,
  pubDate: z.number().nullish(), // seconds
  description: MaybeText,
});

export function himalayasSearch(keyword: string): FeedRequest {
  const name = `Himalayas "${keyword}"`;
  return {
    source: 'himalayas',
    name,
    url: `https://himalayas.app/jobs/api/search?q=${segment(keyword)}&country=US`,
    read: (body) => ({
      ...readJobs(name, body, JobsEnvelope, HimalayasJob, (job) => ({
        source: 'himalayas',
        // The page path is the stable ID: https://himalayas.app/companies/<company>/jobs/<job>
        sourceJobId: job.guid.replace(/^https:\/\/himalayas\.app\/companies\//, ''),
        title: job.title,
        company: job.companyName,
        location: remoteLocation(job.locationRestrictions),
        url: job.guid,
        postedAt: job.pubDate ?? null,
        salary: formatSalary(job.minSalary, job.maxSalary, job.currency, job.salaryPeriod),
        description: job.description ?? null,
      })),
      followUps: [],
    }),
  };
}

// --- Jobicy: jobicy.com/api/v2/remote-jobs, the latest 100 jobs open to the US ----------------------------------

const JobicyJob = z.object({
  id: z.union([Text, z.number()]),
  url: Text,
  jobTitle: Text,
  companyName: Text,
  jobGeo: MaybeText,
  pubDate: MaybeText,
  salaryMin: MaybeAmount,
  salaryMax: MaybeAmount,
  salaryCurrency: MaybeText,
  salaryPeriod: MaybeText,
  jobDescription: MaybeText,
});

export function jobicyFeed(): FeedRequest {
  const name = 'Jobicy';
  return {
    source: 'jobicy',
    name,
    url: 'https://jobicy.com/api/v2/remote-jobs?count=100&geo=usa',
    read: (body) => ({
      ...readJobs(name, body, JobsEnvelope, JobicyJob, (job) => ({
        source: 'jobicy',
        sourceJobId: job.id,
        title: job.jobTitle,
        company: job.companyName,
        location: remoteLocation(job.jobGeo?.split(/\s*,\s*/)),
        url: job.url,
        postedAt: job.pubDate ?? null,
        salary: formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod),
        description: job.jobDescription ?? null,
      })),
      followUps: [],
    }),
  };
}
