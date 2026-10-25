import type { AppContext } from '../api/context.ts';
import type { JobRecord } from '../db/repositories/jobs.ts';
import { defaultSortForTab, statusesForTab, TABS, tabForStatus, type Tab } from '../domain/board-tabs.ts';
import { ORIGINS, originOf, sourcesForOrigin, type Origin } from '../domain/job-source.ts';
import { html as htmlReply, parseInput, queryObject, redirect, type TextReply } from '../http/respond.ts';
import type { ApiRequest, Route } from '../http/router.ts';
import { staticRoutes } from '../http/static.ts';
import { changeJobStatus, dismissNewJobs, JobNotFoundError } from '../jobs/status-service.ts';
import { linkedInSessionStatus } from '../linkedin/session.ts';
import { IdParamSchema } from '../schemas/api.ts';
import {
  BoardActionFormSchema,
  BoardQuerySchema,
  JobPageQuerySchema,
  NotesFormSchema,
  safeReturnPath,
  StatusFormSchema,
  withoutEmpty,
} from '../schemas/pages.ts';
import type { SafeHtml } from './html.ts';
import { layout, type NavItem } from './layout.ts';
import { boardPage } from './pages/board.ts';
import { errorPage, errorTitle } from './pages/error.ts';
import { jobDetailPage } from './pages/job-detail.ts';
import { profilePage } from './pages/profile.ts';
import { runsPage } from './pages/runs.ts';

// The HTML pages of PLAN.md §6.2. Forms post, then redirect back with 303 (post/redirect/get), so reloading a
// page never sends a form twice. No page needs client-side JavaScript (DEC-006).

export const PAGE_SIZE = 50;
const RECENT = 50;

export function pageRoutes(context: AppContext): Route[] {
  const { db, repos } = context;

  function page(title: string, nav: NavItem | null, body: SafeHtml): TextReply {
    return htmlReply(
      layout({
        title,
        nav,
        lastRun: repos.runs.list(1)[0] ?? null,
        linkedin: linkedInSessionStatus(context.linkedinSessionPath, context.now()),
        body,
      }),
    );
  }

  function findJob(request: ApiRequest): JobRecord {
    const jobId = parseInput(IdParamSchema, request.params['id'], 'job ID');
    const job = repos.jobs.get(jobId);
    if (job === null) throw new JobNotFoundError(jobId);
    return job;
  }

  function pageQuery(request: ApiRequest): Record<string, string> {
    return withoutEmpty(queryObject(request.query));
  }

  return [
    {
      method: 'GET',
      path: '/',
      handler: (request) => {
        const query = parseInput(BoardQuerySchema, pageQuery(request), 'query string');
        const sources = sourcesForOrigin(query.origin);
        const filter = {
          sources,
          statuses: statusesForTab(query.tab),
          minScore: query.minScore ?? null,
          text: query.q ?? null,
          unscoredOnly: false,
        };
        const sort = query.sort ?? defaultSortForTab(query.tab);
        const everyJob = { statuses: null, minScore: null, text: null, unscoredOnly: false };
        const counts = Object.fromEntries(
          TABS.map((tab) => [tab, repos.jobs.count({ ...everyJob, sources, statuses: statusesForTab(tab) })]),
        ) as Record<Tab, number>;
        const originCounts = Object.fromEntries(
          ORIGINS.map((origin) => [origin, repos.jobs.count({ ...everyJob, sources: sourcesForOrigin(origin) })]),
        ) as Record<Origin, number>;

        // A page past the end (the last job on it was just moved away, or an old bookmark) shows the last page.
        const total = repos.jobs.count(filter);
        const pageNumber = Math.min(query.page, Math.max(1, Math.ceil(total / PAGE_SIZE)));

        const body = boardPage({
          origin: query.origin,
          originCounts,
          tab: query.tab,
          minScore: query.minScore,
          q: query.q,
          sort,
          page: pageNumber,
          pageSize: PAGE_SIZE,
          items: repos.jobs.list({ ...filter, sort, limit: PAGE_SIZE, offset: (pageNumber - 1) * PAGE_SIZE }),
          total,
          counts,
          changed: query.changed === undefined ? null : repos.jobs.get(query.changed),
          cleared: query.cleared ?? null,
          findNow: context.findNow.last(),
          now: context.now(),
        });
        return page('Board', 'board', body);
      },
    },
    {
      // Clear All (FR-21, DEC-051): every New job of the view goes to Dismissed, from where each can be restored.
      method: 'POST',
      path: '/board/clear',
      accepts: 'form',
      handler: (request) => {
        const { origin } = parseInput(BoardActionFormSchema, request.body, 'form');
        const dismissed = dismissNewJobs(db, repos, sourcesForOrigin(origin), context.now);
        return redirect(`/?${originQuery(origin)}tab=new&cleared=${String(dismissed)}#notice`);
      },
    },
    {
      // Find Now (FR-22, DEC-051): /find-jobs for the view in the background. While a run is going, the button is
      // disabled and another press starts nothing; the board's Find Now line says what is running.
      method: 'POST',
      path: '/board/find',
      accepts: 'form',
      handler: (request) => {
        const { origin } = parseInput(BoardActionFormSchema, request.body, 'form');
        context.findNow.start(origin);
        return redirect(`/?${originQuery(origin)}tab=new#find-now`);
      },
    },
    {
      method: 'GET',
      path: '/jobs/:id',
      handler: (request) => {
        const job = findJob(request);
        const query = parseInput(JobPageQuerySchema, pageQuery(request), 'query string');
        const origin = originOf(job.source);
        const body = jobDetailPage({
          job,
          description: repos.jobs.descriptionOf(job.id),
          sightings: repos.sightings.listForJob(job.id),
          listingSightings: repos.listingSightings.listForJob(job.id),
          history: repos.statusHistory.listForJob(job.id),
          backHref: `/?${originQuery(origin)}tab=${tabForStatus(job.status)}`,
          statusChanged: query.changed === job.id,
          notesSaved: query.notes === 'saved',
        });
        return page(job.title, null, body);
      },
    },
    {
      method: 'POST',
      path: '/jobs/:id/status',
      accepts: 'form',
      handler: (request) => {
        const job = findJob(request);
        const form = parseInput(StatusFormSchema, request.body, 'form');
        changeJobStatus(db, repos, job.id, form.status, context.now);

        const back = new URL(safeReturnPath(form.return, `/jobs/${String(job.id)}`), 'http://app.invalid');
        back.searchParams.delete('notes');
        back.searchParams.set('changed', String(job.id));
        return redirect(`${back.pathname}${back.search}#notice`);
      },
    },
    {
      method: 'POST',
      path: '/jobs/:id/notes',
      accepts: 'form',
      handler: (request) => {
        const job = findJob(request);
        const { notes } = parseInput(NotesFormSchema, request.body, 'form');
        repos.jobs.updateNotes(job.id, notes);
        return redirect(`/jobs/${String(job.id)}?notes=saved#notice`);
      },
    },
    {
      method: 'GET',
      path: '/runs',
      handler: () => page('Runs', 'runs', runsPage({ runs: repos.runs.list(RECENT) })),
    },
    {
      method: 'GET',
      path: '/profile',
      handler: () => page('Profile', 'profile', profilePage(repos.profile.get())),
    },
    ...staticRoutes(),
  ];
}

/** LinkedIn is the board's default view, so its URLs carry no origin (DEC-036). */
function originQuery(origin: Origin): string {
  return origin === 'linkedin' ? '' : `origin=${origin}&`;
}

/** Any error outside /api/ as a full page. It shows no last run: the database may be what failed. */
export function renderErrorPage(status: number, message: string): string {
  const sentence = message.charAt(0).toUpperCase() + message.slice(1);
  return layout({ title: errorTitle(status), nav: null, body: errorPage(status, sentence) });
}
