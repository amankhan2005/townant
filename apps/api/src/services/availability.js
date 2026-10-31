import { formatTime } from '@townant/shared';
import { DateTime } from 'luxon';
import { badRequest } from '../lib/errors.js';
import { localToUtc, minutesOf, todayIn } from '../lib/time.js';
import { CLAIM_UNIT_MINUTES, SlotClaim } from '../models/index.js';

const UNIT_MS = CLAIM_UNIT_MINUTES * 60 * 1000;

// MVP schedules a single resource per company. Staff-level resources would use their own key.
export const resourceKeyFor = (companyId) => `company:${companyId}`;

// The 5-minute units an interval occupies; these are what SlotClaim makes exclusive.
export function unitsFor(startAt, blockEndAt) {
  const units = [];
  for (let t = startAt.getTime(); t < blockEndAt.getTime(); t += UNIT_MS) units.push(new Date(t));
  return units;
}

function intervalsFor(availability, date) {
  const exception = availability.exceptions?.find((e) => e.date === date);
  if (exception) return exception.closed ? [] : exception.intervals ?? [];
  const weekday = DateTime.fromISO(date, { zone: availability.timezone }).weekday % 7; // Luxon: Mon=1..Sun=7
  return availability.weekly?.[weekday] ?? [];
}

// Candidate slots from the vendor's schedule for one local date, ignoring existing bookings.
export function scheduleSlots({ availability, durationMinutes, date, now = new Date() }) {
  const zone = availability.timezone;
  const today = todayIn(zone, now);
  const lastDay = DateTime.fromISO(today, { zone }).plus({ days: availability.maxAdvanceDays }).toISODate();
  if (date < today || date > lastDay) return [];

  const earliest = now.getTime() + availability.minNoticeMinutes * 60 * 1000;
  const step = availability.slotIntervalMinutes;
  const slots = [];
  for (const interval of intervalsFor(availability, date)) {
    const open = minutesOf(interval.start);
    const close = minutesOf(interval.end);
    for (let m = open; m + durationMinutes <= close; m += step) {
      const start = localToUtc(date, m, zone);
      const end = localToUtc(date, m + durationMinutes, zone);
      if (!start || !end) continue; // wall-clock time skipped by a DST transition
      const startAt = start.toJSDate();
      const endAt = end.toJSDate();
      // Across a DST change, wall-clock arithmetic and elapsed time differ; require the real duration.
      if (endAt - startAt !== durationMinutes * 60 * 1000) continue;
      if (startAt.getTime() < earliest) continue;
      slots.push({ startAt, endAt, blockEndAt: new Date(endAt.getTime() + availability.bufferMinutes * 60 * 1000) });
    }
  }
  return slots;
}

async function claimedUnits(resourceKey, from, to, session) {
  const claims = await SlotClaim.find({ resourceKey, unitStart: { $gte: from, $lt: to } }, { unitStart: 1 }, session ? { session } : undefined).lean();
  return new Set(claims.map((c) => c.unitStart.getTime()));
}

const isFree = (slot, taken) => unitsFor(slot.startAt, slot.blockEndAt).every((u) => !taken.has(u.getTime()));

export async function availableSlots({ company, service, date, now = new Date(), ignoreBookingId }) {
  const slots = scheduleSlots({ availability: company.availability, durationMinutes: service.durationMinutes, date, now });
  if (!slots.length) return [];
  const resourceKey = resourceKeyFor(company._id);
  const from = slots[0].startAt;
  const to = new Date(Math.max(...slots.map((s) => s.blockEndAt.getTime())));
  let taken = await claimedUnits(resourceKey, from, to);
  if (ignoreBookingId) {
    // When rescheduling, the booking's own current claims do not block its new time.
    const own = await SlotClaim.find({ bookingId: ignoreBookingId }, { unitStart: 1 }).lean();
    taken = new Set([...taken].filter((t) => !own.some((o) => o.unitStart.getTime() === t)));
  }
  return slots.filter((s) => isFree(s, taken));
}

// Number of open slots for each of `days` local dates starting at `from`, for calendars.
export async function availabilitySummary({ company, service, from, days, now = new Date() }) {
  if (days < 1 || days > 31) throw badRequest('Choose between 1 and 31 days.');
  const zone = company.availability.timezone;
  const start = DateTime.fromISO(from, { zone });
  if (!start.isValid) throw badRequest('Invalid start date.');
  const perDay = [];
  for (let i = 0; i < days; i += 1) {
    const date = start.plus({ days: i }).toISODate();
    perDay.push({ date, slots: scheduleSlots({ availability: company.availability, durationMinutes: service.durationMinutes, date, now }) });
  }
  const all = perDay.flatMap((d) => d.slots);
  if (!all.length) return perDay.map((d) => ({ date: d.date, openSlots: 0 }));
  const taken = await claimedUnits(
    resourceKeyFor(company._id),
    all[0].startAt,
    new Date(Math.max(...all.map((s) => s.blockEndAt.getTime()))),
  );
  return perDay.map((d) => ({ date: d.date, openSlots: d.slots.filter((s) => isFree(s, taken)).length }));
}

// Finds the schedule slot that starts exactly at startAt, or null if startAt is not a
// slot the vendor offers. Bookings can only be made for slots this returns.
export function matchScheduleSlot({ company, service, startAt, now = new Date() }) {
  const zone = company.availability.timezone;
  const date = DateTime.fromJSDate(startAt, { zone }).toISODate();
  const slots = scheduleSlots({ availability: company.availability, durationMinutes: service.durationMinutes, date, now });
  return slots.find((s) => s.startAt.getTime() === startAt.getTime()) ?? null;
}

export const serializeSlot = (slot, zone) => ({
  startAt: slot.startAt.toISOString(),
  endAt: slot.endAt.toISOString(),
  localTime: formatTime(slot.startAt, zone),
});
