// The one place TownAnt turns dates into text. Every user-visible date is MM/DD/YYYY.
//
// Two kinds of input:
//  - Date-only values ("2026-10-29"): calendar days with no time zone. They are formatted by
//    string manipulation and never parsed as Date, so they can't shift by a day.
//  - Instants (ISO timestamps / Date): formatted in an explicit IANA time zone, normally the
//    business's zone, so a 9:00 AM appointment reads 9:00 AM wherever the viewer is.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const pad = (n) => String(n).padStart(2, '0');

export function isValidIsoDate(value) {
  const m = ISO_DATE.exec(String(value ?? ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// "2026-10-29" -> "10/29/2026"
export function formatIsoDate(isoDate) {
  const m = ISO_DATE.exec(String(isoDate ?? ''));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

// "10/29/2026" or "1/5/2027" -> "2026-10-29" / "2027-01-05"; null if not a real date.
export function parseUsDate(text) {
  const m = US_DATE.exec(String(text ?? '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return isValidIsoDate(iso) ? iso : null;
}

const partsCache = new Map();
function parts(instant, timeZone, options) {
  const key = `${timeZone ?? ''}|${JSON.stringify(options)}`;
  let fmt = partsCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    partsCache.set(key, fmt);
  }
  return Object.fromEntries(fmt.formatToParts(toDate(instant)).map((p) => [p.type, p.value]));
}

function toDate(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${instant}`);
  return d;
}

// The calendar day an instant falls on in a zone, as "YYYY-MM-DD".
export function isoDateInZone(instant, timeZone) {
  const p = parts(instant, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

export const todayIso = (timeZone) => isoDateInZone(new Date(), timeZone);

// The viewer's IANA time zone (e.g. for interpreting "this Saturday").
export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Adds whole days to a date-only value without touching time zones.
export function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Day of week for a date-only value: 0 = Sunday.
export function weekdayOfIso(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekdayShortOfIso = (isoDate) => WEEKDAY_SHORT[weekdayOfIso(isoDate)];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Date-only value -> { month: 'Oct', day: 30 }, for calendar-style date badges.
export function monthDayOfIso(isoDate) {
  const [, m, d] = isoDate.split('-').map(Number);
  return { month: MONTH_SHORT[m - 1], day: d };
}

// Instant -> "10/29/2026" in the given zone.
export function formatDate(instant, timeZone) {
  return formatIsoDate(isoDateInZone(instant, timeZone));
}

// Instant -> "9:00 AM"
export function formatTime(instant, timeZone) {
  const p = parts(instant, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

// Short zone label such as "EDT" or "GMT+5:30".
export function timeZoneLabel(instant, timeZone) {
  return parts(instant, timeZone, { timeZoneName: 'short', hour: 'numeric' }).timeZoneName ?? '';
}

// Instant -> "Thu, 10/29/2026 at 9:00 AM EDT". Options drop the weekday or zone.
export function formatDateTime(instant, timeZone, { weekday = true, zone = true } = {}) {
  const iso = isoDateInZone(instant, timeZone);
  const head = `${weekday ? `${weekdayShortOfIso(iso)}, ` : ''}${formatIsoDate(iso)}`;
  return `${head} at ${formatTime(instant, timeZone)}${zone ? ` ${timeZoneLabel(instant, timeZone)}` : ''}`;
}

// "HH:MM" (24h, from schedules) -> "9:00 AM". "24:00" reads as midnight.
export function formatClock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const hour = h % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(m)} ${hour < 12 ? 'AM' : 'PM'}`;
}

// Recent activity reads "5 min ago"; anything older than a week shows MM/DD/YYYY.
export function formatRelative(instant, { now = Date.now(), timeZone } = {}) {
  const diff = (now - toDate(instant).getTime()) / 1000;
  if (diff < 0 || diff >= 7 * 86400) return formatDate(instant, timeZone);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hr${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(diff / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
