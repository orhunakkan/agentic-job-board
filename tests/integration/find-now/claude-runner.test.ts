import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFindNow,
  FIND_JOBS_ALLOWED_TOOLS,
  type FindNow,
  type FindNowOptions,
} from '../../../src/find-now/claude-runner.ts';
import { createLogger } from '../../../src/logger.ts';
import { fakeClaudeCommand } from '../../helpers/fake-claude.ts';
import { fakeClock } from '../../helpers/fixtures.ts';

// Find Now (FR-22, DEC-052) with a stand-in for Claude Code: it runs /find-jobs for one view in the background, one run
// at a time, logs what Claude Code prints, and says how the run ended.

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let dir: string;
let findNow: FindNow | undefined;
const logs: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobboard-find-now-'));
  logs.length = 0;
});

afterEach(async () => {
  await findNow?.stop();
  findNow = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function start(command: readonly string[], options: Partial<FindNowOptions> = {}): FindNow {
  findNow = createFindNow({
    command,
    logDir: join(dir, 'find-now'),
    now: fakeClock('2026-10-25T14:00:00.000Z'),
    logger: createLogger('debug', (line) => logs.push(line)),
    ...options,
  });
  return findNow;
}

async function ended(runner: FindNow): Promise<void> {
  await vi.waitFor(
    () => {
      expect(runner.last()?.outcome).not.toBe('running');
    },
    { timeout: 10_000, interval: 25 },
  );
}

function logOf(origin: string): { cwd: string; arguments: string[] } {
  return JSON.parse(readFileSync(join(dir, 'find-now', `${origin}.log`), 'utf8')) as {
    cwd: string;
    arguments: string[];
  };
}

describe('Find Now runner', () => {
  it('FR-22: runs /find-jobs for the view headless, with only its pre-approved tools and no MCP server', async () => {
    const runner = start(fakeClaudeCommand());

    expect(runner.last()).toBeNull();
    expect(runner.start('linkedin')).toBe(true);
    expect(runner.last()).toMatchObject({ origin: 'linkedin', outcome: 'running', finishedAt: null });
    await ended(runner);

    expect(runner.last()).toEqual({
      origin: 'linkedin',
      startedAt: '2026-10-25T14:00:00.000Z',
      finishedAt: '2026-10-25T14:00:01.000Z',
      outcome: 'finished',
      problem: null,
      logPath: join(dir, 'find-now', 'linkedin.log'),
    });
    const { cwd, arguments: claudeArguments } = logOf('linkedin');
    expect(cwd.toLowerCase()).toBe(REPO_ROOT.replace(/[\\/]$/, '').toLowerCase());
    expect(claudeArguments).toEqual([
      '-p',
      '/find-jobs linkedin',
      '--permission-mode',
      'dontAsk',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--allowedTools',
      ...FIND_JOBS_ALLOWED_TOOLS,
    ]);
    expect(logs.join('\n')).toContain('find now started');
  });

  it('FR-22: the Other sources view runs /find-jobs other, with its own log', async () => {
    const runner = start(fakeClaudeCommand());

    runner.start('other');
    await ended(runner);

    expect(runner.last()).toMatchObject({ origin: 'other', outcome: 'finished' });
    expect(logOf('other').arguments.slice(0, 2)).toEqual(['-p', '/find-jobs other']);
  });

  it('FR-22: one run at a time, across both views; a new run may start once it has ended', async () => {
    const runner = start(fakeClaudeCommand(400));

    expect(runner.start('linkedin')).toBe(true);
    expect(runner.start('linkedin')).toBe(false);
    expect(runner.start('other')).toBe(false);
    expect(runner.last()?.origin).toBe('linkedin');
    await ended(runner);

    expect(runner.start('other')).toBe(true);
    expect(runner.last()).toMatchObject({ origin: 'other', outcome: 'running' });
    await ended(runner);
  });

  it('FR-22: a run that exits with an error is failed, with its exit code', async () => {
    const runner = start(fakeClaudeCommand(0, 3));

    runner.start('linkedin');
    await ended(runner);

    expect(runner.last()).toMatchObject({ outcome: 'failed', problem: 'exit code 3' });
    expect(logs.join('\n')).toContain('exit code 3');
  });

  it('FR-22: when Claude Code is not installed, the run fails and says so', async () => {
    const runner = start([join(dir, 'no-such-claude.exe')]);

    expect(runner.start('linkedin')).toBe(true);
    await ended(runner);

    expect(runner.last()).toMatchObject({ outcome: 'failed' });
    expect(runner.last()?.problem).toMatch(/^Claude Code could not be started \(.*ENOENT/);
    expect(runner.start('linkedin')).toBe(true); // a failed run doesn't block the next one
    await ended(runner);
  });

  it('FR-22: a run that takes too long is stopped', async () => {
    const runner = start(fakeClaudeCommand(30_000), { timeoutMs: 300 });

    runner.start('other');
    await ended(runner);

    expect(runner.last()).toMatchObject({ outcome: 'failed', problem: 'took longer than 0 minutes' });
  });

  it('FR-22: stopping the app stops a running run and waits until it has exited', async () => {
    const runner = start(fakeClaudeCommand(30_000));

    runner.start('linkedin');
    await runner.stop();

    expect(runner.last()).toMatchObject({ outcome: 'failed', problem: 'the app stopped' });
    expect(() => {
      rmSync(dir, { recursive: true });
    }).not.toThrow(); // on Windows this fails while the log file is still open
  });

  it('FR-22: each run starts its view log afresh', async () => {
    const runner = start(fakeClaudeCommand());

    runner.start('linkedin');
    await ended(runner);
    runner.start('linkedin');
    await ended(runner);

    expect(
      readFileSync(join(dir, 'find-now', 'linkedin.log'), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });

  it('FR-22: an empty command is refused when the app starts', () => {
    expect(() => start([])).toThrow('the Claude Code command is empty');
  });

  it('FR-22: stop is harmless when nothing runs', async () => {
    await expect(start(fakeClaudeCommand()).stop()).resolves.toBeUndefined();
  });
});
