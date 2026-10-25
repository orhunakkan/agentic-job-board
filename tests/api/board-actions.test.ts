import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobDetailSchema, JobListResponseSchema, type JobSummary } from '../../src/schemas/api.ts';
import { fakeClaudeCommand, findNowLogPath } from '../helpers/fake-claude.ts';
import { seedBoard, seedListings } from '../helpers/seed-board.ts';
import { startTestApp, type TestApp } from '../helpers/test-app.ts';

// The board's Clear All (FR-21) and Find Now (FR-22) over real HTTP, per view (DEC-051): 18 LinkedIn jobs from the
// email years and 3 made-up listings from the feeds. Find Now runs tests/helpers/fake-claude.ts, never Claude Code.

async function idsIn(testApp: TestApp, query: string): Promise<number[]> {
  const { body } = await testApp.get(`/api/jobs?limit=100&${query}`);
  return JobListResponseSchema.parse(body)
    .items.map((job) => job.id)
    .sort((a, b) => a - b);
}

/** The prompt Find Now gave the stand-in Claude Code, from the view's log. */
function promptIn(logPath: string): string[] {
  const logged = JSON.parse(readFileSync(logPath, 'utf8')) as { arguments: string[] };
  return logged.arguments.slice(0, 2);
}

function sorted(jobs: readonly JobSummary[]): number[] {
  return jobs.map((job) => job.id).sort((a, b) => a - b);
}

describe('Clear All', () => {
  let testApp: TestApp;
  let linkedinJobs: JobSummary[];
  let listedJobs: JobSummary[];

  beforeEach(async () => {
    testApp = await startTestApp();
    const seeded = await seedBoard(testApp);
    linkedinJobs = seeded.jobs;
    listedJobs = await seedListings(testApp, seeded.runId);
  });
  afterEach(async () => {
    await testApp.close();
  });

  it('FR-21: the board offers Clear All for the view, asking first, with the number of New jobs', async () => {
    const linkedin = (await testApp.get('/')).text;
    const other = (await testApp.get('/?origin=other')).text;

    expect(linkedin).toContain('<summary class="button button-quiet">Clear All</summary>');
    expect(linkedin).toMatch(
      /Dismiss all 18 new LinkedIn jobs\? Each one can be restored from\s*<a href="\/\?tab=dismissed">/,
    );
    expect(linkedin).toContain('<input type="hidden" name="origin" value="linkedin" />');
    expect(linkedin).toContain('Dismiss 18 jobs</button>');
    expect(other).toContain('Dismiss all 3 new jobs from other sources?');
    expect(other).toContain('<input type="hidden" name="origin" value="other" />');
  });

  it('FR-21, FR-08: dismisses every New LinkedIn job, records it in each history, and leaves the other view', async () => {
    const [kept] = linkedinJobs;
    expect((await testApp.call('PATCH', `/api/jobs/${String(kept?.id)}`, { status: 'saved' })).status).toBe(200);

    const response = await testApp.form('/board/clear', { origin: 'linkedin' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/?tab=new&cleared=17#notice');
    expect(await idsIn(testApp, 'origin=linkedin&tab=new')).toEqual([]);
    expect(await idsIn(testApp, 'origin=linkedin&tab=dismissed')).toEqual(
      sorted(linkedinJobs.filter((job) => job.id !== kept?.id)),
    );
    expect(await idsIn(testApp, 'origin=linkedin&tab=saved')).toEqual([kept?.id]);
    expect(await idsIn(testApp, 'origin=other&tab=new')).toEqual(sorted(listedJobs));

    const detail = JobDetailSchema.parse((await testApp.get(`/api/jobs/${String(linkedinJobs[1]?.id)}`)).body);
    expect(detail.history.map((change) => [change.fromStatus, change.toStatus])).toEqual([
      [null, 'new'],
      ['new', 'dismissed'],
    ]);
  });

  it('FR-21: on Other sources it dismisses only the jobs from the feeds', async () => {
    const response = await testApp.form('/board/clear', { origin: 'other' });

    expect(response.headers.get('location')).toBe('/?origin=other&tab=new&cleared=3#notice');
    expect(await idsIn(testApp, 'origin=other&tab=dismissed')).toEqual(sorted(listedJobs));
    expect(await idsIn(testApp, 'origin=linkedin&tab=new')).toEqual(sorted(linkedinJobs));
  });

  it('FR-21: after clearing, the board says how many it dismissed and offers no Clear All on an empty New', async () => {
    await testApp.form('/board/clear', { origin: 'other' });
    const board = (await testApp.get('/?origin=other&tab=new&cleared=3')).text;

    expect(board).toMatch(
      /<p class="notice" role="status" id="notice" tabindex="-1">Dismissed 3 new jobs from other sources\. Each one can be restored from\s*<a href="\/\?origin=other&amp;tab=dismissed">Dismissed<\/a>\.<\/p>/,
    );
    expect(board).not.toContain('Clear All');
    expect(board).toContain('No new jobs from other sources. Press Find Now');
    // Restoring one by one still works (§5.4: dismissed → new).
    expect((await testApp.call('PATCH', `/api/jobs/${String(listedJobs[0]?.id)}`, { status: 'new' })).status).toBe(200);
  });

  it('FR-21: clearing an empty New says there was nothing to dismiss', async () => {
    await testApp.form('/board/clear', { origin: 'linkedin' });
    const again = await testApp.form('/board/clear', { origin: 'linkedin' });

    expect(again.headers.get('location')).toBe('/?tab=new&cleared=0#notice');
    expect((await testApp.get('/?tab=new&cleared=0')).text).toContain('There were no new jobs to dismiss.');
  });

  it.each([{}, { origin: 'gmail' }, { origin: 'linkedin', status: 'saved' }])(
    'NFR-09: the form %o is a 400 and dismisses nothing',
    async (fields) => {
      const response = await testApp.form('/board/clear', fields);

      expect(response.status).toBe(400);
      expect(await idsIn(testApp, 'tab=dismissed')).toEqual([]);
    },
  );
});

describe('Find Now', () => {
  let testApp: TestApp | undefined;

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
  });

  async function waitUntilEnded(app: TestApp): Promise<string> {
    let board = '';
    await vi.waitFor(
      async () => {
        board = (await app.get('/')).text;
        expect(board).not.toContain('data-outcome="running"');
      },
      { timeout: 10_000, interval: 50 },
    );
    return board;
  }

  it('FR-22: the board has an enabled Find Now for each view, and no Find Now line before the first run', async () => {
    testApp = await startTestApp();
    const linkedin = (await testApp.get('/')).text;
    const other = (await testApp.get('/?origin=other')).text;

    for (const [board, origin] of [
      [linkedin, 'linkedin'],
      [other, 'other'],
    ] as const) {
      expect(board).toMatch(
        new RegExp(
          `<form class="inline-form" method="post" action="/board/find">\\s*<input type="hidden" name="origin" value="${origin}" />\\s*<button type="submit" class="button" >Find Now</button>`,
        ),
      );
    }
    expect(linkedin).not.toContain('id="find-now"');
  });

  it('FR-22: pressing it runs /find-jobs linkedin; the board shows it running, then finished, with its log', async () => {
    testApp = await startTestApp({ claudeCommand: fakeClaudeCommand(500) });

    const response = await testApp.form('/board/find', { origin: 'linkedin' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/?tab=new#find-now');
    const running = (await testApp.get('/')).text;
    expect(running).toMatch(/<p class="find-now" id="find-now" role="status" tabindex="-1" data-outcome="running">/);
    expect(running).toContain('Find Now is running for LinkedIn since');
    expect(running).toMatch(/<button type="submit" class="button" disabled>Find Now<\/button>/);
    // The other view shows the same run, and can't start a second one.
    expect((await testApp.get('/?origin=other')).text).toContain('disabled>Find Now</button>');

    const finished = await waitUntilEnded(testApp);
    const logPath = findNowLogPath(testApp.dbPath, 'linkedin');
    expect(finished).toContain('Find Now for LinkedIn finished at');
    expect(finished).toContain(`Its summary is in <code>${logPath}</code>`);
    expect(finished).toContain('>Find Now</button>');
    expect(finished).not.toContain('disabled>Find Now');
    expect(promptIn(logPath)).toEqual(['-p', '/find-jobs linkedin']);
  });

  it('FR-22: on Other sources it runs /find-jobs other', async () => {
    testApp = await startTestApp();

    const response = await testApp.form('/board/find', { origin: 'other' });

    expect(response.headers.get('location')).toBe('/?origin=other&tab=new#find-now');
    expect(await waitUntilEnded(testApp)).toContain('Find Now for Other sources finished at');
    expect(promptIn(findNowLogPath(testApp.dbPath, 'other'))).toEqual(['-p', '/find-jobs other']);
  });

  it('FR-22: a second press while a run is going starts nothing', async () => {
    testApp = await startTestApp({ claudeCommand: fakeClaudeCommand(500) });

    await testApp.form('/board/find', { origin: 'linkedin' });
    const second = await testApp.form('/board/find', { origin: 'other' });

    expect(second.status).toBe(303);
    expect((await testApp.get('/')).text).toContain('Find Now is running for LinkedIn');
    await waitUntilEnded(testApp);
    expect(testApp.logs.filter((line) => line.includes('find now started'))).toHaveLength(1);
  });

  it('FR-22: a run that fails says why and where its output is', async () => {
    testApp = await startTestApp({ claudeCommand: fakeClaudeCommand(0, 2) });

    await testApp.form('/board/find', { origin: 'linkedin' });
    const board = await waitUntilEnded(testApp);

    expect(board).toMatch(/Find Now for LinkedIn stopped at .+?: exit code 2\. Its output is in\s*<code>/);
    expect(board).toContain('data-outcome="failed"');
  });

  it.each([{}, { origin: 'all' }, { origin: 'linkedin', command: 'rm -rf /' }])(
    'NFR-09: the form %o is a 400 and starts nothing',
    async (fields) => {
      testApp = await startTestApp();

      expect((await testApp.form('/board/find', fields as Record<string, string>)).status).toBe(400);
      expect(testApp.logs.filter((line) => line.includes('find now started'))).toEqual([]);
    },
  );
});
