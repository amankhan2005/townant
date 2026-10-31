import { getEnv } from './config/env.js';
import { connectDb } from './db.js';
import { startJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';

// Standalone worker for deployments that run jobs separately from the API (RUN_WORKER=false on API nodes).
getEnv();
connectDb(getEnv().MONGODB_URI)
  .then(() => startJobs())
  .catch((err) => {
    logger.fatal({ err: err.message }, 'worker startup failed');
    process.exit(1);
  });
