// npm run report: opens the latest board-report in the default browser (PLAN.md Phase 14 task 10). The report never
// opens by itself; this is the one way to open it from the command line.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INDEX = fileURLToPath(new URL('../../reports/board-report/index.html', import.meta.url));

/** The program that opens a file in the default browser on this system. */
export function opener(platform: NodeJS.Platform, file: string): { program: string; args: string[] } {
  if (platform === 'win32') return { program: 'explorer.exe', args: [file] };
  if (platform === 'darwin') return { program: 'open', args: [file] };
  return { program: 'xdg-open', args: [file] };
}

if (import.meta.main) {
  if (existsSync(INDEX)) {
    const { program, args } = opener(process.platform, INDEX);
    spawn(program, args, { detached: true, stdio: 'ignore' }).unref();
    console.log(`Opened ${INDEX}`);
  } else {
    console.error('No board-report yet: run a test command first, for example `npm run test:unit`.');
    process.exitCode = 1;
  }
}
