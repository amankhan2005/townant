import { DateTime, IANAZone } from 'luxon';

export const isValidZone = (zone) => IANAZone.isValidZone(zone);

export const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Resolves a vendor-local wall-clock time to an instant. Returns null for times that do not
// exist in that zone (spring-forward gap), so no slot is offered there. For repeated times
// (fall-back) Luxon picks the earlier offset, which is the conventional choice.
export function localToUtc(dateISO, minutes, zone) {
  const base = DateTime.fromISO(dateISO, { zone });
  if (!base.isValid) return null;
  const dt = base.set({ hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, millisecond: 0 });
  if (minutes === 24 * 60) return base.plus({ days: 1 }).startOf('day');
  if (dt.hour !== Math.floor(minutes / 60) || dt.minute !== minutes % 60) return null;
  return dt;
}

export const todayIn = (zone, now = new Date()) => DateTime.fromJSDate(now, { zone }).toISODate();
