// Runs the steps' commands for scripts/board-report.ts: on the console like the old scripts, or captured for a
// converter. Never through a shell, except npm on Windows, where npm is a .cmd file that only a shell can start.
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import type { CommandOutput } from './converters/static.ts';
import type { ProcessCommand, ProcessRunner } from './steps.ts';

export function processRunner(cwd: string): ProcessRunner {
  return {
    run(command: ProcessCommand): Promise<CommandOutput> {
      const start = Date.now();
      const shown = [basename(command.program), ...command.args.map((arg) => basename(arg))].slice(
        command.program === process.execPath ? 1 : 0,
      );
      const label = shown.join(' ');
      return new Promise((resolve) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const done = (exitCode: number | null, error = ''): void => {
          resolve({
            command: label,
            exitCode,
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8') + error,
            start,
            stop: Date.now(),
          });
        };
        const child = spawn(command.program, command.args, {
          cwd,
          env: { ...process.env, ...command.env },
          stdio: command.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
          shell: command.program === 'npm.cmd',
          windowsHide: true,
        });
        child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
        child.on('error', (error) => {
          done(null, String(error));
        });
        child.on('close', (code) => {
          done(code ?? 1);
        });
      });
    },
  };
}
