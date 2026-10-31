import { z } from 'zod';
import { LOG_FORMATS, LOG_LEVELS, type LogFormat, type LogLevel } from './logger.ts';

// App settings from the environment (PLAN.md Phase 4). `npm start` loads them from .env (see .env.example).

export interface Config {
  port: number;
  dbPath: string;
  logLevel: LogLevel;
  /** null: pretty in a terminal, JSON lines otherwise (decided in main.ts). */
  logFormat: LogFormat | null;
  /** The saved LinkedIn login (DEC-032), written by scripts/linkedin-login.ts. */
  linkedinSessionPath: string;
  /** The LinkedIn searches and the free feeds setup checks for (FR-24); the scripts read the same files. */
  linkedinSearchesPath: string;
  sourcesPath: string;
  /** How the board's Find Now starts Claude Code (FR-22, DEC-052): the program, then any leading arguments. */
  claudeCommand: string[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export const DEFAULT_LINKEDIN_SESSION_PATH = 'data/linkedin/session.json';
export const DEFAULT_LINKEDIN_SEARCHES_PATH = 'data/linkedin-searches.json';
export const DEFAULT_SOURCES_PATH = 'data/sources.json';

const COMMAND_SHAPE = 'must be a JSON array of strings, for example ["claude"]';

// A JSON array, so a program path with spaces in it stays one argument.
const CommandSchema = z
  .string()
  .trim()
  .transform((text, context) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: COMMAND_SHAPE });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string().trim().min(1, COMMAND_SHAPE), COMMAND_SHAPE).min(1, COMMAND_SHAPE));

const EnvSchema = z.object({
  PORT: z
    .string()
    .trim()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65_535))
    .default(3000),
  DB_PATH: z
    .string({ error: 'is required, for example data/jobboard.db' })
    .trim()
    .min(1, 'is required, for example data/jobboard.db'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_FORMAT: z.enum(LOG_FORMATS).optional(),
  LINKEDIN_SESSION_PATH: z.string().trim().min(1).default(DEFAULT_LINKEDIN_SESSION_PATH),
  LINKEDIN_SEARCHES_PATH: z.string().trim().min(1).default(DEFAULT_LINKEDIN_SEARCHES_PATH),
  SOURCES_PATH: z.string().trim().min(1).default(DEFAULT_SOURCES_PATH),
  CLAUDE_COMMAND: CommandSchema.optional(),
});

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = EnvSchema.safeParse({
    PORT: env['PORT'],
    DB_PATH: env['DB_PATH'],
    LOG_LEVEL: env['LOG_LEVEL'],
    LOG_FORMAT: env['LOG_FORMAT'],
    LINKEDIN_SESSION_PATH: env['LINKEDIN_SESSION_PATH'],
    LINKEDIN_SEARCHES_PATH: env['LINKEDIN_SEARCHES_PATH'],
    SOURCES_PATH: env['SOURCES_PATH'],
    CLAUDE_COMMAND: env['CLAUDE_COMMAND'],
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration (check .env, see .env.example):\n${problems.join('\n')}`);
  }
  return {
    port: parsed.data.PORT,
    dbPath: parsed.data.DB_PATH,
    logLevel: parsed.data.LOG_LEVEL,
    logFormat: parsed.data.LOG_FORMAT ?? null,
    linkedinSessionPath: parsed.data.LINKEDIN_SESSION_PATH,
    linkedinSearchesPath: parsed.data.LINKEDIN_SEARCHES_PATH,
    sourcesPath: parsed.data.SOURCES_PATH,
    claudeCommand: parsed.data.CLAUDE_COMMAND ?? ['claude'],
  };
}
