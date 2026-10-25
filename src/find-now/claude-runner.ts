import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Origin } from '../domain/job-source.ts';
import type { Logger } from '../logger.ts';

// Find Now (FR-22, DEC-051, DEC-052): the board's button runs `/find-jobs` for one view in Claude Code's headless
// mode, in the background, one run at a time. This is the only process the app starts (NFR-03): the app still makes
// no request itself, and Claude Code reaches LinkedIn and the feeds only through the two scripts, as when the owner
// types /find-jobs. The arguments are fixed per view; nothing from a request reaches the command line.

/** Exactly the tools the /find-jobs command pre-approves (agent/find-jobs.md); a security test keeps them equal. */
export const FIND_JOBS_ALLOWED_TOOLS = [
  'Bash(curl:*)',
  'Bash(node scripts/search-linkedin.ts --run:*)',
  'Bash(node scripts/fetch-sources.ts --run:*)',
  'Read',
  'Edit(/data/find-jobs/**)',
  'Bash(rm -rf data/find-jobs)',
] as const;

/**
 * The arguments after the Claude Code command. Nobody is there to answer a permission prompt, so `dontAsk` refuses
 * every tool the command doesn't pre-approve, and `--strict-mcp-config` loads no MCP server: no Gmail tool exists in
 * the session at all (NFR-04).
 */
export function findJobsArguments(origin: Origin): string[] {
  return [
    '-p',
    `/find-jobs ${origin}`,
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--allowedTools',
    ...FIND_JOBS_ALLOWED_TOOLS,
  ];
}

export interface FindNowRun {
  origin: Origin;
  startedAt: string;
  finishedAt: string | null; // null while running
  outcome: 'running' | 'finished' | 'failed';
  problem: string | null; // why a failed run failed
  /** Everything Claude Code printed, including its summary (FR-13). */
  logPath: string;
}

export interface FindNow {
  /** The current run, or the last one since the app started; null before the first. */
  last(): FindNowRun | null;
  /** Starts a run for `origin`, unless one is still running (then false). */
  start(origin: Origin): boolean;
  /** Stops a running run and waits until it has exited; the app calls it when it stops. */
  stop(): Promise<void>;
}

export interface FindNowOptions {
  /** The Claude Code CLI: the program, then any leading arguments (`CLAUDE_COMMAND`; tests use a stand-in). */
  command: readonly string[];
  /** Where each view's log goes, as `<origin>.log`; the app uses data/find-now/ next to the database. */
  logDir: string;
  now: () => string;
  logger: Logger;
  timeoutMs?: number;
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

export function createFindNow(options: FindNowOptions): FindNow {
  const [first, ...leadingArguments] = options.command;
  if (first === undefined) throw new Error('the Claude Code command is empty');
  const program = first;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let current: FindNowRun | null = null;
  let stopRunning: (() => Promise<void>) | null = null;

  function run(origin: Origin): void {
    mkdirSync(options.logDir, { recursive: true });
    const logPath = join(options.logDir, `${origin}.log`);
    const record: FindNowRun = {
      origin,
      startedAt: options.now(),
      finishedAt: null,
      outcome: 'running',
      problem: null,
      logPath,
    };
    current = record;
    options.logger.info('find now started', { origin, logPath });

    const log = createWriteStream(logPath); // each run starts the view's log afresh
    let settled = false;
    let deadline: NodeJS.Timeout | undefined = undefined; // set once the process runs
    const exited = new Promise<void>((resolve) => {
      // Resolves once the log file is closed, so it can be read (or deleted, on Windows) straight away.
      log.once('close', resolve);
    });
    const settle = (problem: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      record.finishedAt = options.now();
      record.outcome = problem === null ? 'finished' : 'failed';
      record.problem = problem;
      stopRunning = null;
      options.logger.info('find now ended', { origin, outcome: record.outcome, problem });
      log.end();
    };
    const cannotStart = (error: unknown) => {
      settle(`Claude Code could not be started (${error instanceof Error ? error.message : String(error)})`);
    };

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(program, [...leadingArguments, ...findJobsArguments(origin)], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      // Windows refuses some programs at once (a .cmd file needs a shell, which is never used here).
      cannotStart(error);
      return;
    }
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });

    let stopReason: string | null = null;
    const stopChild = (reason: string) => {
      stopReason = reason;
      child.kill();
    };
    deadline = setTimeout(() => {
      stopChild(`took longer than ${String(Math.round(timeoutMs / 60_000))} minutes`);
    }, timeoutMs);

    child.once('error', cannotStart);
    child.once('close', (code, signal) => {
      if (stopReason !== null) settle(stopReason);
      else if (code === 0) settle(null);
      else settle(code === null ? `Claude Code was stopped (${String(signal)})` : `exit code ${String(code)}`);
    });
    stopRunning = () => {
      stopChild('the app stopped');
      return exited;
    };
  }

  return {
    last: () => (current === null ? null : { ...current }),
    start(origin) {
      if (current?.outcome === 'running') return false;
      run(origin);
      return true;
    },
    stop: () => stopRunning?.() ?? Promise.resolve(),
  };
}
