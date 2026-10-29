// Turns the static checks (test type 1, PLAN.md Phase 14 task 3) into results: one per tsconfig with its errors, one
// per linted file with each rule it breaks, one for formatting naming the files that differ, and one for the audit
// with its advisories by severity. Each keeps the command's raw output as an attachment. A check that could not run
// at all is broken.
import { z } from 'zod';
import { stripAnsi } from '../labels.ts';
import type { ErrorInfo } from '../result-schema.ts';
import { repoPath } from '../target.ts';
import { converted, plainDraft, type Converted, type ConvertedAttachment } from './write.ts';

export interface CommandOutput {
  /** The command as it was run, for the report. */
  command: string;
  /** null when the program couldn't be started. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  start: number;
  stop: number;
}

function raw(output: CommandOutput, type = 'text/plain'): ConvertedAttachment[] {
  const text = stripAnsi([output.stdout, output.stderr].filter((part) => part.trim() !== '').join('\n'));
  return text === '' ? [] : [{ name: `${output.command} output`, type, body: text }];
}

function problem(message: string): ErrorInfo {
  return { message, expected: null, actual: null, stack: null };
}

function couldNotRun(name: string, suites: string[], output: CommandOutput): Converted {
  const reason =
    output.exitCode === null ? 'could not be started' : `stopped with exit code ${String(output.exitCode)}`;
  const detail = (output.stderr.trim() || output.stdout.trim()).split('\n').slice(0, 20).join('\n');
  return converted(
    plainDraft({
      name,
      suites,
      status: 'broken',
      start: output.start,
      stop: output.stop,
      error: problem(`${output.command} ${reason}${detail === '' ? '' : `:\n${detail}`}`),
      testType: 'static',
    }),
    raw(output),
  );
}

const TSC_ERROR = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

export function convertTsc(config: string, output: CommandOutput): Converted[] {
  const name = `tsc --noEmit (${config})`;
  const suites = ['TypeScript'];
  if (output.exitCode === 0) {
    return [
      converted(
        plainDraft({
          name,
          suites,
          status: 'passed',
          start: output.start,
          stop: output.stop,
          error: null,
          testType: 'static',
        }),
      ),
    ];
  }
  const errors = `${output.stdout}\n${output.stderr}`.split('\n').filter((line) => TSC_ERROR.test(line.trim()));
  if (errors.length === 0) return [couldNotRun(name, suites, output)];
  return [
    converted(
      plainDraft({
        name,
        suites,
        status: 'failed',
        start: output.start,
        stop: output.stop,
        error: problem(
          `${String(errors.length)} type error${errors.length === 1 ? '' : 's'}:\n${errors.map((line) => line.trim()).join('\n')}`,
        ),
        parameters: [{ name: 'errors', value: String(errors.length) }],
        testType: 'static',
      }),
      raw(output),
    ),
  ];
}

const EslintReport = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(
      z.object({
        ruleId: z.string().nullable(),
        severity: z.number(),
        message: z.string(),
        line: z.number().optional(),
        column: z.number().optional(),
      }),
    ),
  }),
);

/** One result per linted file, from ESLint's JSON formatter. */
export function convertEslint(output: CommandOutput, root: string): Converted[] {
  const suites = ['ESLint'];
  let files: z.infer<typeof EslintReport>;
  try {
    files = EslintReport.parse(JSON.parse(output.stdout));
  } catch {
    return [couldNotRun('ESLint', suites, output)];
  }
  const each = Math.max(0, output.stop - output.start) / Math.max(1, files.length);
  return files.map((file, index) => {
    const path = repoPath(file.filePath, root);
    const start = output.start + Math.round(index * each);
    const findings = file.messages.map(
      (message) =>
        `${String(message.line ?? 0)}:${String(message.column ?? 0)} ${message.severity === 2 ? 'error' : 'warning'}  ${message.ruleId ?? 'parse'}  ${message.message}`,
    );
    const rules = [...new Set(file.messages.map((message) => message.ruleId ?? 'parse'))];
    return converted(
      plainDraft({
        name: `ESLint: ${path}`,
        suites,
        status: findings.length === 0 ? 'passed' : 'failed',
        start,
        stop: start + Math.round(each),
        error: findings.length === 0 ? null : problem(findings.join('\n')),
        file: path,
        line: file.messages[0]?.line ?? null,
        parameters: rules.length === 0 ? [] : [{ name: 'rules', value: rules.join(', ') }],
        testType: 'static',
      }),
      findings.length === 0
        ? []
        : [{ name: 'eslint findings', type: 'application/json', body: JSON.stringify(file.messages, null, 2) }],
    );
  });
}

/** `prettier --check` exits 1 when files differ and 2 when it could not check. */
export function convertPrettier(output: CommandOutput): Converted[] {
  const name = 'Prettier: every file is formatted';
  const suites = ['Prettier'];
  if (output.exitCode !== 0 && output.exitCode !== 1) return [couldNotRun(name, suites, output)];
  // Prettier colours its [warn] lines even when its output is piped.
  const differing = stripAnsi(`${output.stdout}\n${output.stderr}`)
    .split('\n')
    .map((line) => /^\[warn\] (.+)$/.exec(line.trim())?.[1] ?? '')
    .filter((file) => file !== '' && !file.startsWith('Code style issues'));
  return [
    converted(
      plainDraft({
        name,
        suites,
        status: output.exitCode === 0 ? 'passed' : 'failed',
        start: output.start,
        stop: output.stop,
        error:
          output.exitCode === 0
            ? null
            : problem(
                `${String(differing.length)} file${differing.length === 1 ? '' : 's'} differ from Prettier's format:\n${differing.join('\n')}`,
              ),
        parameters: [{ name: 'files that differ', value: String(differing.length) }],
        testType: 'static',
      }),
      raw(output),
    ),
  ];
}

const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'] as const;

const AuditReport = z.object({
  vulnerabilities: z.record(z.string(), z.object({ severity: z.enum(SEVERITIES), range: z.string().optional() })),
  metadata: z.object({ vulnerabilities: z.record(z.string(), z.number()) }),
});

/** NFR-02: `npm audit --json` finds no high or critical advisory. */
export function convertAudit(output: CommandOutput): Converted[] {
  const name = 'NFR-02: npm audit finds no high or critical advisory';
  const suites = ['npm audit'];
  let report: z.infer<typeof AuditReport>;
  try {
    report = AuditReport.parse(JSON.parse(output.stdout));
  } catch {
    return [couldNotRun(name, suites, output)];
  }
  const counts = report.metadata.vulnerabilities;
  const serious = (counts['high'] ?? 0) + (counts['critical'] ?? 0);
  const advisories = Object.entries(report.vulnerabilities)
    .toSorted(([, left], [, right]) => SEVERITIES.indexOf(left.severity) - SEVERITIES.indexOf(right.severity))
    .map(
      ([pkg, advisory]) => `${advisory.severity}: ${pkg}${advisory.range === undefined ? '' : ` ${advisory.range}`}`,
    );
  return [
    converted(
      plainDraft({
        name,
        suites,
        status: serious === 0 ? 'passed' : 'failed',
        start: output.start,
        stop: output.stop,
        error:
          serious === 0
            ? null
            : problem(
                `${String(serious)} high or critical advisor${serious === 1 ? 'y' : 'ies'}:\n${advisories.join('\n')}`,
              ),
        parameters: SEVERITIES.map((severity) => ({ name: severity, value: String(counts[severity] ?? 0) })),
        testType: 'static',
      }),
      raw(output, 'application/json'),
    ),
  ];
}
