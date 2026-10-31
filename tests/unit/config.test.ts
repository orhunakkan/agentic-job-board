import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.ts';

describe('loadConfig', () => {
  it('NFR-09: reads PORT, DB_PATH and LOG_LEVEL', () => {
    expect(loadConfig({ PORT: '3000', DB_PATH: 'data/jobboard.db', LOG_LEVEL: 'warn' })).toEqual({
      port: 3000,
      dbPath: 'data/jobboard.db',
      logLevel: 'warn',
      logFormat: null,
      linkedinSessionPath: 'data/linkedin/session.json',
      linkedinSearchesPath: 'data/linkedin-searches.json',
      sourcesPath: 'data/sources.json',
      claudeCommand: ['claude'],
    });
  });

  it('NFR-09: PORT defaults to 3000 and LOG_LEVEL to info', () => {
    expect(loadConfig({ DB_PATH: 'x.db' })).toEqual({
      port: 3000,
      dbPath: 'x.db',
      logLevel: 'info',
      logFormat: null,
      linkedinSessionPath: 'data/linkedin/session.json',
      linkedinSearchesPath: 'data/linkedin-searches.json',
      sourcesPath: 'data/sources.json',
      claudeCommand: ['claude'],
    });
  });

  it('NFR-10: LOG_FORMAT picks json or pretty logs', () => {
    expect(loadConfig({ DB_PATH: 'x.db', LOG_FORMAT: 'pretty' })).toMatchObject({ logFormat: 'pretty' });
    expect(loadConfig({ DB_PATH: 'x.db', LOG_FORMAT: 'json' })).toMatchObject({ logFormat: 'json' });
  });

  it('FR-14: LINKEDIN_SESSION_PATH sets where the saved LinkedIn login lives', () => {
    expect(loadConfig({ DB_PATH: 'x.db', LINKEDIN_SESSION_PATH: ' tmp/li.json ' })).toMatchObject({
      linkedinSessionPath: 'tmp/li.json',
    });
  });

  it('FR-24: LINKEDIN_SEARCHES_PATH and SOURCES_PATH set where setup looks for the two files', () => {
    expect(
      loadConfig({ DB_PATH: 'x.db', LINKEDIN_SEARCHES_PATH: ' tmp/searches.json ', SOURCES_PATH: ' tmp/feeds.json ' }),
    ).toMatchObject({ linkedinSearchesPath: 'tmp/searches.json', sourcesPath: 'tmp/feeds.json' });
  });

  it('FR-22: CLAUDE_COMMAND sets how Find Now starts Claude Code, as a JSON array (DEC-052)', () => {
    const program = String.raw`C:\Program Files\Claude\claude.exe`;
    const env = { DB_PATH: 'x.db', CLAUDE_COMMAND: ` ${JSON.stringify([program, '--verbose'])} ` };

    expect(env.CLAUDE_COMMAND).toContain(String.raw`"C:\\Program Files\\Claude\\claude.exe"`);
    expect(loadConfig(env)).toMatchObject({ claudeCommand: [program, '--verbose'] });
  });

  it('NFR-09: trims surrounding whitespace', () => {
    expect(loadConfig({ PORT: ' 3100 ', DB_PATH: ' x.db ' })).toMatchObject({ port: 3100, dbPath: 'x.db' });
  });

  it('NFR-09: ignores unrelated environment variables', () => {
    expect(loadConfig({ DB_PATH: 'x.db', PATH: '/usr/bin', HOME: '/home/someone' })).toMatchObject({ dbPath: 'x.db' });
  });

  it.each<[string, Record<string, string>, string]>([
    ['a missing DB_PATH', {}, 'DB_PATH: is required, for example data/jobboard.db'],
    ['an empty DB_PATH', { DB_PATH: '  ' }, 'DB_PATH: is required, for example data/jobboard.db'],
    ['a PORT that is not a number', { DB_PATH: 'x', PORT: '80a' }, 'PORT: must be a whole number'],
    ['a PORT of 0', { DB_PATH: 'x', PORT: '0' }, 'PORT:'],
    ['a PORT above 65535', { DB_PATH: 'x', PORT: '65536' }, 'PORT:'],
    ['a negative PORT', { DB_PATH: 'x', PORT: '-1' }, 'PORT: must be a whole number'],
    ['an unknown LOG_LEVEL', { DB_PATH: 'x', LOG_LEVEL: 'verbose' }, 'LOG_LEVEL:'],
    ['an unknown LOG_FORMAT', { DB_PATH: 'x', LOG_FORMAT: 'xml' }, 'LOG_FORMAT:'],
    ['an empty LINKEDIN_SESSION_PATH', { DB_PATH: 'x', LINKEDIN_SESSION_PATH: ' ' }, 'LINKEDIN_SESSION_PATH:'],
    [
      'a CLAUDE_COMMAND that is not JSON',
      { DB_PATH: 'x', CLAUDE_COMMAND: 'claude -p' },
      'CLAUDE_COMMAND: must be a JSON',
    ],
    ['an empty CLAUDE_COMMAND array', { DB_PATH: 'x', CLAUDE_COMMAND: '[]' }, 'CLAUDE_COMMAND: must be a JSON'],
    [
      'a CLAUDE_COMMAND that is a string',
      { DB_PATH: 'x', CLAUDE_COMMAND: '"claude"' },
      'CLAUDE_COMMAND: must be a JSON',
    ],
    ['a CLAUDE_COMMAND with an empty program', { DB_PATH: 'x', CLAUDE_COMMAND: '[" "]' }, 'CLAUDE_COMMAND.0: must be'],
  ])('NFR-09: %s is a ConfigError that says what to fix', (_case, env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
    expect(() => loadConfig(env)).toThrow('Invalid configuration (check .env, see .env.example)');
  });

  it('NFR-09: lists every problem at once', () => {
    expect(() => loadConfig({ PORT: 'x', LOG_LEVEL: 'y' })).toThrow(/PORT[\s\S]*DB_PATH[\s\S]*LOG_LEVEL/);
  });

  it('NFR-09: ConfigError is a typed Error', () => {
    expect(new ConfigError('x')).toMatchObject({ name: 'ConfigError', message: 'x' });
  });
});
