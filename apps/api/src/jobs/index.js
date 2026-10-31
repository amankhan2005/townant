import { logger } from '../lib/logger.js';
import { SlotClaim } from '../models/index.js';
import { finalizeDueCustomerDeletions } from '../services/accountDeletion.js';
import { expireStaleRequests, sendReminders } from '../services/booking.js';
import { purgeDueCompanies } from '../services/companyLifecycle.js';
import { processDeliveries } from '../services/notifications.js';

// Each job is idempotent and uses conditional updates, so several worker processes can run
// these concurrently without duplicating effects.
export const JOBS = [
  { name: 'deliver-notifications', everyMs: 5 * 1000, run: () => processDeliveries({ batch: 50 }) },
  { name: 'expire-requests', everyMs: 60 * 1000, run: () => expireStaleRequests() },
  { name: 'reminders', everyMs: 5 * 60 * 1000, run: () => sendReminders() },
  // 15-day recovery windows: customer accounts pending deletion and Super Admin-deleted companies are
  // finalized once their deadline passes. Both are conditional writes, safe on several workers.
  { name: 'finalize-account-deletions', everyMs: 15 * 60 * 1000, run: () => finalizeDueCustomerDeletions() },
  { name: 'finalize-deleted-companies', everyMs: 15 * 60 * 1000, run: () => purgeDueCompanies() },
  // Claims in the past no longer protect anything; keep a week for investigation.
  { name: 'prune-claims', everyMs: 6 * 3600 * 1000, run: () => SlotClaim.deleteMany({ unitStart: { $lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }) },
];

export function startJobs() {
  const timers = JOBS.map((job) => {
    let running = false;
    return setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'job failed');
      } finally {
        running = false;
      }
    }, job.everyMs);
  });
  logger.info({ jobs: JOBS.map((j) => j.name) }, 'background jobs started');
  return () => timers.forEach(clearInterval);
}
