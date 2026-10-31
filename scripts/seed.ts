// Fake data for performance tests and screenshots (PLAN.md Phase 7 task 1).
//   node scripts/seed.ts --count 5000 --db data/perf.db [--seed 1]
// Builds pages of LinkedIn search results and loads them through the real listing ingest, as
// scripts/search-linkedin.ts would, then scores jobs and moves some through the status workflow with the real status
// service, so every counter, sighting and history row follows the same rules as real data. The same --seed always gives the same database. Everything is
// made up: no real job, company or person. It refuses to write into a database that already has jobs, so it
// can never mix fake jobs into the owner's board.
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, transaction } from '../src/db/database.ts';
import { migrate } from '../src/db/migrate.ts';
import { createRepositories, type Repositories } from '../src/db/repositories/index.ts';
import type { JobFilter } from '../src/db/repositories/jobs.ts';
import { labelForScore } from '../src/domain/score.ts';
import type { Status } from '../src/domain/status.ts';
import { ingestListings, type IncomingListing } from '../src/ingest/listing-ingest.ts';
import { changeJobStatus } from '../src/jobs/status-service.ts';
import type { Profile } from '../src/schemas/profile.ts';

export interface SeedOptions {
  count: number;
  seed: number;
  /** The newest search page is read at this time; the others are spread over the 30 days before it. */
  until: string;
}

export interface SeedSummary {
  runs: number;
  pages: number;
  jobs: number;
  scored: number;
  byStatus: Record<string, number>;
}

export class SeedError extends Error {
  override name = 'SeedError';
}

/** A fake job: the same details every time a search lists it, and a rubric-like score. */
interface FakeJob {
  linkedinId: string;
  title: string;
  company: string;
  location: string;
  workplace: IncomingListing['workplace'];
  score: number;
  reason: string;
}

/** Something a title can add to its role, and how much it moves the fake score. */
interface Specialty {
  suffix: string;
  bonus: number;
  reason: string;
}

const NO_SPECIALTY: Specialty = { suffix: '', bonus: 0, reason: 'no specialty named' };

// Roles from several lines of work (NFR-14), each with a base score, the words a triage reason would use and the
// specialties its titles name; `cap` marks a deal-breaker of the seeded profile (scores ≤ 30).
const ROLES: readonly { title: string; base: number; reason: string; specialties: Specialty[]; cap?: string }[] = [
  {
    title: 'Registered Nurse',
    base: 60,
    reason: 'Nursing role',
    specialties: [NO_SPECIALTY, NO_SPECIALTY, { suffix: ' (ICU)', bonus: 12, reason: 'ICU named in the title' }],
  },
  {
    title: 'Senior Staff Accountant',
    base: 68,
    reason: 'Senior accounting role',
    specialties: [NO_SPECIALTY, { suffix: ' (NetSuite)', bonus: 9, reason: 'NetSuite named in the title' }],
  },
  {
    title: 'Truck Dispatcher',
    base: 62,
    reason: 'Dispatch role',
    specialties: [NO_SPECIALTY, { suffix: ' (Bilingual Spanish)', bonus: 10, reason: 'Spanish named in the title' }],
  },
  {
    title: 'Senior Logistics Coordinator',
    base: 71,
    reason: 'Senior logistics role',
    specialties: [NO_SPECIALTY, { suffix: ' (CDL-A)', bonus: 6, reason: 'CDL-A named in the title' }],
  },
  {
    title: 'Middle School Teacher',
    base: 61,
    reason: 'Teaching role',
    specialties: [NO_SPECIALTY, { suffix: ' - Science', bonus: 8, reason: 'a subject named in the title' }],
  },
  {
    title: 'Account Executive',
    base: 56,
    reason: 'Sales role',
    specialties: [NO_SPECIALTY, { suffix: ' (Bilingual Spanish)', bonus: 10, reason: 'Spanish named in the title' }],
  },
  { title: 'Senior Account Manager', base: 72, reason: 'Senior sales role', specialties: [NO_SPECIALTY] },
  {
    title: 'Lead Backend Developer',
    base: 71,
    reason: 'Lead software role',
    specialties: [NO_SPECIALTY, { suffix: ' (Go)', bonus: 12, reason: 'Go named in the title' }],
  },
  { title: 'Charge Nurse', base: 66, reason: 'Charge nurse role, a target role', specialties: [NO_SPECIALTY] },
  { title: 'Payroll Specialist II', base: 52, reason: 'Mid-level payroll role', specialties: [NO_SPECIALTY] },
  {
    title: 'Commission-only Sales Associate',
    base: 20,
    reason: '',
    specialties: [],
    cap: 'Capped: commission-only pay (deal-breaker).',
  },
  {
    title: 'Night Shift Warehouse Associate',
    base: 18,
    reason: '',
    specialties: [],
    cap: 'Capped: night shifts only (deal-breaker).',
  },
];
const LOCATIONS: readonly { name: string; workplace: IncomingListing['workplace']; adjust: number; reason: string }[] =
  [
    { name: 'United States', workplace: null, adjust: 0, reason: 'US-wide' },
    { name: 'United States (Remote)', workplace: 'remote', adjust: 8, reason: 'remote US' },
    { name: 'United States (Remote)', workplace: 'remote', adjust: 8, reason: 'remote US' },
    { name: 'Chicago, IL (Hybrid)', workplace: 'hybrid', adjust: -12, reason: 'hybrid in Chicago' },
    { name: 'Austin, TX (On-site)', workplace: 'on-site', adjust: -14, reason: 'on-site in Austin' },
    { name: 'New York, NY (Hybrid)', workplace: 'hybrid', adjust: -12, reason: 'hybrid in New York' },
    { name: 'Seattle, WA', workplace: null, adjust: -12, reason: 'Seattle-based, not marked remote' },
    { name: 'Denver, CO (Remote)', workplace: 'remote', adjust: 8, reason: 'remote US' },
  ];
const COMPANY_A = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Vandelay', 'Stark', 'Wayne', 'Tyrell', 'Soylent'];
const COMPANY_B = ['Labs', 'Systems', 'Health', 'Financial', 'Software', 'Analytics', 'Robotics', 'Media'];
const SEARCHES = ['Nursing jobs', 'Accounting jobs', 'Logistics jobs'];

/** The profile the seeded board is scored against, so it opens instead of the setup page (FR-24). Made up. */
export const SEED_PROFILE: Profile = {
  field: 'Logistics and operations',
  summary: 'Made-up profile for the seeded board.',
  targetRoles: ['Senior Logistics Coordinator', 'Truck Dispatcher'],
  seniority: 'senior',
  yearsExperience: 8,
  coreSkills: ['Load planning', 'Route optimization'],
  secondarySkills: ['Spanish'],
  credentials: ['CDL-A'],
  locations: { remote: ['United States'], hybridAreas: ['Chicago, IL'], onsiteAreas: [], relocate: false },
  workAuthorization: 'US, no sponsorship needed',
  dealBreakers: ['commission-only pay', 'night shifts only'],
  excludedCompanies: [],
};

/** Picks one of the items with the next random number. */
function picker(nextRandom: () => number) {
  return <T>(items: readonly T[]): T => items[Math.floor(nextRandom() * items.length)] as T;
}

function fakeJob(linkedinId: string, nextRandom: () => number): FakeJob {
  const pick = picker(nextRandom);
  const role = pick(ROLES);
  // A capped role names no specialty; its reason is the cap's.
  const specialty = role.cap === undefined ? pick(role.specialties) : NO_SPECIALTY;
  const location = pick(LOCATIONS);
  const noise = Math.round((nextRandom() - 0.5) * 8);
  const raw = Math.min(100, Math.max(0, role.base + specialty.bonus + location.adjust + noise));
  return {
    linkedinId,
    title: `${role.title}${specialty.suffix}`,
    company: `${pick(COMPANY_A)} ${pick(COMPANY_B)}`,
    location: location.name,
    workplace: location.workplace,
    score: role.cap === undefined ? raw : Math.min(raw, 30),
    reason: role.cap ?? `${role.reason}, ${specialty.reason}; ${location.reason}.`,
  };
}

/** Where each target status is reached from `new`, one allowed transition at a time (PLAN.md §5.4). */
const PATHS: readonly (readonly Status[])[] = [
  ...Array<Status[]>(70).fill([]),
  ...Array<Status[]>(8).fill(['saved']),
  ...Array<Status[]>(3).fill(['applied']),
  ...Array<Status[]>(3).fill(['saved', 'applied']),
  ...Array<Status[]>(3).fill(['applied', 'interviewing']),
  ['applied', 'interviewing', 'offer'],
  ...Array<Status[]>(3).fill(['applied', 'rejected']),
  ...Array<Status[]>(9).fill(['dismissed']),
];

const JOBS_PER_PAGE = 6;
const NEW_PER_PAGE = 4; // the other two are jobs an earlier page already listed, as searches repeat
const DAY_MS = 24 * 60 * 60 * 1000;
/** A board filter that leaves every job in. */
const EVERY_JOB: Omit<JobFilter, 'sort' | 'limit' | 'offset'> = {
  sources: null,
  statuses: null,
  minScore: null,
  text: null,
  unscoredOnly: false,
};

/** mulberry32: a small, fast PRNG, so a seed always gives the same data. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = state;
    bits = Math.imul(bits ^ (bits >>> 15), bits | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDatabase(db: DatabaseSync, repos: Repositories, options: SeedOptions): SeedSummary {
  const existing = repos.jobs.count(EVERY_JOB);
  if (existing > 0) {
    throw new SeedError(`the database already has ${String(existing)} jobs; seed only into a new database`);
  }
  // The board opens only once a profile is saved (FR-24).
  if (repos.profile.state().status !== 'saved') repos.profile.put(SEED_PROFILE, options.until);

  const nextRandom = random(options.seed);
  const pick = picker(nextRandom);
  const until = Date.parse(options.until);
  const pageCount = Math.ceil(options.count / NEW_PER_PAGE);
  const runCount = Math.min(30, pageCount);
  const runIds: number[] = [];
  let clock = until - 30 * DAY_MS;
  const tick = () => new Date((clock += 1000)).toISOString();

  // 1. Search pages, through the real listing ingest: about one run per day, each with its share of the pages, in one
  // transaction (each listing's own transaction joins it), so seeding 5,000 jobs makes one commit, not thousands.
  const fakeJobs: FakeJob[] = [];
  transaction(db, () => {
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const run = Math.floor((pageIndex * runCount) / pageCount);
      const runId = (runIds[run] ??= repos.runs.create(tick()));
      clock = Math.max(clock, until - ((pageCount - 1 - pageIndex) * 30 * DAY_MS) / pageCount);
      const searchName = pick(SEARCHES);

      const listed: FakeJob[] = [];
      for (let slot = 0; slot < NEW_PER_PAGE && fakeJobs.length < options.count; slot += 1) {
        const job = fakeJob(String(4_400_000_000 + fakeJobs.length), nextRandom);
        fakeJobs.push(job);
        listed.push(job);
      }
      const earlier = fakeJobs.slice(0, fakeJobs.length - listed.length);
      for (let slot = listed.length; slot < JOBS_PER_PAGE && earlier.length > 0; slot += 1) listed.push(pick(earlier));
      const searchedAt = new Date(clock).toISOString();
      ingestListings(
        db,
        repos,
        runId,
        listed.map((job) => listing(job, searchName, searchedAt, nextRandom)),
        tick,
      );
    }
  });

  // 2. Scores, statuses and notes, in one transaction. About 1 job in 10 stays unscored.
  const byLinkedinId = new Map(fakeJobs.map((job) => [job.linkedinId, job]));
  const byStatus: Record<string, number> = {};
  let scored = 0;
  transaction(db, () => {
    const jobs = repos.jobs.list({ ...EVERY_JOB, sort: 'recent', limit: options.count, offset: 0 });
    for (const job of jobs) {
      const fake = byLinkedinId.get(job.sourceJobId);
      if (fake !== undefined && nextRandom() < 0.9) {
        repos.jobs.setScore(job.id, {
          score: fake.score,
          label: labelForScore(fake.score),
          reason: fake.reason,
          rubricVersion: 'triage-v2',
          scoredAt: tick(),
        });
        repos.runs.addCounts(job.firstRunId ?? runIds[0] ?? 0, { jobsScored: 1 });
        scored += 1;
      }
      const path = pick(PATHS);
      for (const status of path) changeJobStatus(db, repos, job.id, status, tick);
      if (path.length > 0 && nextRandom() < 0.5) repos.jobs.updateNotes(job.id, 'Seeded note: follow up next week.');
      const status = path.at(-1) ?? 'new';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    for (const runId of runIds) repos.runs.finish(runId, tick());
  });

  return { runs: runIds.length, pages: pageCount, jobs: fakeJobs.length, scored, byStatus };
}

/** One job as a search lists it; about half have a description from their job page, and Easy Apply comes and goes. */
function listing(job: FakeJob, searchName: string, searchedAt: string, nextRandom: () => number): IncomingListing {
  return {
    source: 'linkedin',
    sourceJobId: job.linkedinId,
    title: job.title,
    company: job.company,
    location: job.location,
    url: `https://www.linkedin.com/jobs/view/${job.linkedinId}/`,
    postedAt: new Date(Date.parse(searchedAt) - Math.floor(nextRandom() * DAY_MS)).toISOString(),
    salary: nextRandom() < 0.3 ? '$140K/yr - $170K/yr' : null,
    description:
      nextRandom() < 0.5
        ? `About ${job.company}\n\nWe are hiring a ${job.title}.\n• Join a friendly team\n• Grow with us`
        : null,
    workplace: job.workplace,
    easyApply: nextRandom() < 0.4,
    searchName,
  };
}

const ArgsSchema = z.object({
  count: z.coerce.number().int().min(1).max(100_000),
  db: z.string().trim().min(1),
  seed: z.coerce.number().int().min(0).default(1),
});

function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (key?.startsWith('--') !== true || value === undefined)
      throw new SeedError(`unexpected argument: ${String(key)}`);
    args[key.slice(2)] = value;
  }
  return args;
}

if (import.meta.main) {
  const usage = 'Usage: node scripts/seed.ts --count 5000 --db data/perf.db [--seed 1]';
  try {
    const args = ArgsSchema.safeParse(parseArgs(process.argv.slice(2)));
    if (!args.success) {
      console.error(usage);
      process.exitCode = 2;
    } else {
      const db = openDatabase(args.data.db);
      try {
        migrate(db);
        const started = performance.now();
        const summary = seedDatabase(db, createRepositories(db), {
          count: args.data.count,
          seed: args.data.seed,
          until: new Date().toISOString(),
        });
        console.log(`Seeded ${args.data.db} in ${String(Math.round(performance.now() - started))} ms`);
        console.table({ runs: summary.runs, pages: summary.pages, jobs: summary.jobs, scored: summary.scored });
        console.table(summary.byStatus);
      } finally {
        db.close();
      }
    }
  } catch (error) {
    if (!(error instanceof SeedError)) throw error;
    console.error(`${error.message}\n${usage}`);
    process.exitCode = 1;
  }
}
