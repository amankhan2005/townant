import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { connectDb, disconnectDb } from './db.js';
import { startJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';
import { envOverrideWarning } from './lib/mongoUri.js';

async function main() {
  const env = getEnv();
  const envFile = new URL('../.env', import.meta.url);
  const override = existsSync(envFile) ? envOverrideWarning(env.MONGODB_URI, parseEnv(readFileSync(envFile, 'utf8')).MONGODB_URI) : null;
  if (override) logger.warn(override);
  await connectDb(env.MONGODB_URI);
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV, features: env.features }, 'api listening'));
  server.requestTimeout = 30 * 1000;
  server.headersTimeout = 20 * 1000;
  const stopJobs = env.RUN_WORKER ? startJobs() : () => {};

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    stopJobs();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'startup failed');
  process.exit(1);
});
