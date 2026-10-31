import { describe, expect, it } from 'vitest';
import { addDaysIso, formatClock, formatDate, formatDateTime, formatIsoDate, formatRelative, formatTime, isoDateInZone, isValidIsoDate, monthDayOfIso, parseUsDate, weekdayOfIso } from '../src/dates.js';

describe('MM/DD/YYYY formatting', () => {
  it('formats date-only values with zero padding', () => {
    expect(formatIsoDate('2026-10-29')).toBe('10/29/2026');
    expect(formatIsoDate('2027-01-05')).toBe('01/05/2027');
    expect(formatIsoDate('2027-02-09')).toBe('02/09/2027');
    expect(formatIsoDate('bad')).toBe('');
  });

  it('never shifts a date-only value by a day, whatever the process time zone', () => {
    // Parsing "2026-01-01" with new Date() would be UTC midnight = 12/31 in US zones.
    expect(formatIsoDate('2026-01-01')).toBe('01/01/2026');
    expect(weekdayOfIso('2026-01-01')).toBe(4); // Thursday
  });

  it('formats instants in the business time zone, not the viewer', () => {
    const instant = '2026-10-30T03:30:00Z'; // still Oct 29 in New York
    expect(formatDate(instant, 'America/New_York')).toBe('10/29/2026');
    expect(formatDate(instant, 'Asia/Kolkata')).toBe('10/30/2026');
    expect(formatTime(instant, 'America/New_York')).toBe('11:30 PM');
    expect(formatDateTime(instant, 'America/New_York')).toBe('Thu, 10/29/2026 at 11:30 PM EDT');
    expect(formatDateTime('2027-01-05T14:00:00Z', 'America/Chicago', { weekday: false })).toBe('01/05/2027 at 8:00 AM CST');
  });

  it('is correct across daylight-saving changes', () => {
    expect(formatDateTime('2027-03-14T07:00:00Z', 'America/New_York', { weekday: false })).toBe('03/14/2027 at 3:00 AM EDT');
    expect(formatDateTime('2027-03-14T06:59:00Z', 'America/New_York', { weekday: false })).toBe('03/14/2027 at 1:59 AM EST');
    expect(isoDateInZone('2026-11-01T04:30:00Z', 'America/New_York')).toBe('2026-11-01');
  });

  it('parses user input strictly as MM/DD/YYYY', () => {
    expect(parseUsDate('10/29/2026')).toBe('2026-10-29');
    expect(parseUsDate('1/5/2027')).toBe('2027-01-05');
    expect(parseUsDate('02/30/2027')).toBeNull();
    expect(parseUsDate('29/10/2026')).toBeNull();
    expect(parseUsDate('2026-10-29')).toBeNull();
    expect(parseUsDate('02/29/2028')).toBe('2028-02-29');
  });

  it('validates ISO calendar dates', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2027-03-13', 1)).toBe('2027-03-14');
  });

  it('formats schedule clock times and relative activity', () => {
    expect(formatClock('09:00')).toBe('9:00 AM');
    expect(formatClock('00:30')).toBe('12:30 AM');
    expect(formatClock('12:00')).toBe('12:00 PM');
    expect(formatClock('24:00')).toBe('12:00 AM');
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(formatRelative('2026-10-29T11:55:00Z', { now })).toBe('5 min ago');
    expect(formatRelative('2026-10-15T12:00:00Z', { now, timeZone: 'UTC' })).toBe('10/15/2026');
  });
});

describe('monthDayOfIso', () => {
  it('splits a date-only value for date badges without parsing it as a Date', () => {
    expect(monthDayOfIso('2026-10-30')).toEqual({ month: 'Oct', day: 30 });
    expect(monthDayOfIso('2027-01-05')).toEqual({ month: 'Jan', day: 5 });
  });

  it('gives the day in the business time zone when combined with isoDateInZone', () => {
    // 04:30 UTC on Oct 31 is still Oct 30 in Chicago.
    expect(monthDayOfIso(isoDateInZone('2026-10-31T04:30:00Z', 'America/Chicago'))).toEqual({ month: 'Oct', day: 30 });
  });
});

