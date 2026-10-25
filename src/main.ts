import { startApp } from './app.ts';
import { startupBanner } from './banner.ts';
import { ConfigError, loadConfig, type Config } from './config.ts';
import { linkedInSessionStatus } from './linkedin/session.ts';
import { createLogger } from './logger.ts';
import { formatDateTime } from './ui/format.ts';

// Entry point for `npm start` (PLAN.md Phase 4): config → database → migrations → server on 127.0.0.1.
// Ctrl+C (SIGINT) or SIGTERM stops accepting requests, finishes open ones and closes the database. In a terminal the
// logs are short coloured lines and a banner shows the address (DEC-034); piped, they stay JSON lines.

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

const logFormat = config.logFormat ?? (process.stdout.isTTY ? 'pretty' : 'json');
const logger = createLogger(config.logLevel, undefined, undefined, logFormat);

function crash(msg: string) {
  return (error: unknown) => {
    logger.error(msg, { error });
    process.exit(1);
  };
}
process.on('uncaughtException', crash('uncaught exception'));
process.on('unhandledRejection', crash('unhandled rejection'));

try {
  const app = await startApp({
    port: config.port,
    dbPath: config.dbPath,
    linkedinSessionPath: config.linkedinSessionPath,
    claudeCommand: config.claudeCommand,
    logger,
  });
  if (logFormat === 'pretty') {
    const linkedin = linkedInSessionStatus(config.linkedinSessionPath, new Date().toISOString());
    process.stdout.write(startupBanner({ url: app.url, dbPath: config.dbPath, linkedin, formatTime: formatDateTime }));
  } else {
    logger.info('listening', { url: app.url, dbPath: config.dbPath });
  }

  const stop = (signal: NodeJS.Signals) => {
    logger.info('shutting down', { signal });
    app.close().then(() => {
      logger.info('stopped');
    }, crash('shutdown failed'));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  crash('failed to start')(error);
}
