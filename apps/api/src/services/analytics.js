import { DateTime } from 'luxon';
import { logger } from '../lib/logger.js';
import { AnalyticsEvent } from '../models/index.js';

// Records an explicitly defined interest event. Failures are logged and never block the
// user action that triggered them.
export async function track(type, { companyId, categoryId }, session) {
  try {
    await AnalyticsEvent.create([{ type, companyId, categoryId, day: DateTime.utc().toISODate() }], session ? { session } : undefined);
  } catch (err) {
    if (session) throw err;
    logger.warn({ err: err.message, type }, 'analytics event not recorded');
  }
}

export async function countEvents(match) {
  const rows = await AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: '$type', count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
}

export async function dailySeries(match) {
  const rows = await AnalyticsEvent.aggregate([
    { $match: match },
    { $group: { _id: { day: '$day', type: '$type' }, count: { $sum: 1 } } },
    { $sort: { '_id.day': 1 } },
  ]);
  return rows.map((r) => ({ day: r._id.day, type: r._id.type, count: r.count }));
}
