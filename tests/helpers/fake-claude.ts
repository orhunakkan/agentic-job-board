// A stand-in for the Claude Code CLI (FR-22): Find Now's tests and the E2E servers run it in place of `claude`, so no
// test ever starts Claude Code. Its own arguments come first: how long to run (ms) and the exit code. It prints the
// arguments Find Now gave it as one JSON line, which lands in the view's log.
//   node tests/helpers/fake-claude.ts <holdMs> <exitCode> <Claude Code arguments…>
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_CLAUDE = fileURLToPath(import.meta.url);

/** The command for CLAUDE_COMMAND / `claudeCommand`: this script under the current Node. */
export function fakeClaudeCommand(holdMs = 0, exitCode = 0): string[] {
  return [process.execPath, FAKE_CLAUDE, String(holdMs), String(exitCode)];
}

/** Where Find Now writes a view's log for an app whose database is `dbPath`. */
export function findNowLogPath(dbPath: string, origin: string): string {
  return join(dbPath, '..', 'find-now', `${origin}.log`);
}

// Windows may spell the drive letter either way.
if (process.argv[1]?.toLowerCase() === FAKE_CLAUDE.toLowerCase()) {
  const [holdMs = '0', exitCode = '0', ...claudeArguments] = process.argv.slice(2);
  console.log(JSON.stringify({ cwd: process.cwd(), arguments: claudeArguments }));
  await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
  process.exitCode = Number(exitCode);
}
