import { daysInMonth, formatIsoDate, todayIso, weekdayShortOfIso } from '@townant/shared';
import { useMemo, useState } from 'react';
import { useApi } from '../lib/hooks.js';
import { Calendar, cx, ErrorState, SlotSkeleton } from './ui.jsx';

const PERIODS = [
  ['Morning', (h) => h < 12],
  ['Afternoon', (h) => h >= 12 && h < 17],
  ['Evening', (h) => h >= 17],
];
const hourOf = (localTime) => {
  const [, h, , ap] = localTime.match(/^(\d+):(\d+) (AM|PM)$/) ?? [];
  return (Number(h) % 12) + (ap === 'PM' ? 12 : 0);
};

/**
 * Month calendar of open days plus the open times for the chosen day, in the business's time
 * zone. This is the server's current view only; booking re-validates and reserves atomically.
 * `slotsPath` switches to a vendor endpoint (rescheduling), which has no per-day counts.
 */
export function SlotPicker({ slug, serviceId, timezone, value, onChange, slotsPath, refreshKey = 0 }) {
  const today = todayIso(timezone);
  const [view, setView] = useState(`${today.slice(0, 8)}01`);
  const [date, setDate] = useState(null);

  const [y, m] = view.split('-').map(Number);
  const from = view < today ? today : view;
  const days = Math.min(31, daysInMonth(y, m) - Number(from.slice(8)) + 1);
  const summary = useApi(slotsPath ? null : `/catalog/companies/${slug}/availability`, { query: { serviceId, from, days }, enabled: !slotsPath && days > 0 }, [refreshKey]);
  const counts = useMemo(() => new Map((summary.data?.days ?? []).map((d) => [d.date, d.openSlots])), [summary.data]);

  const firstOpen = summary.data?.days.find((d) => d.openSlots > 0)?.date;
  const selected = date ?? (slotsPath ? today : firstOpen);
  const slots = useApi(selected ? (slotsPath ?? `/catalog/companies/${slug}/slots`) : null, { query: slotsPath ? { date: selected } : { serviceId, date: selected }, enabled: Boolean(selected) }, [refreshKey]);

  const isDisabled = (iso) => !slotsPath && summary.data && counts.has(iso) && counts.get(iso) === 0;
  const renderMeta = (iso) => {
    if (slotsPath || !counts.has(iso)) return null;
    const n = counts.get(iso);
    return n > 0 ? { short: `${n} open`, label: `${n} open times` } : { short: 'Full', label: 'no open times' };
  };

  const grouped = PERIODS.map(([label, test]) => [label, (slots.data?.slots ?? []).filter((s) => test(hourOf(s.localTime)))]).filter(([, list]) => list.length);

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
      <div className="rounded-card border border-line bg-white">
        <Calendar
          value={selected}
          onSelect={(iso) => {
            setDate(iso);
            onChange(null);
          }}
          min={today}
          isDisabled={isDisabled}
          timeZone={timezone}
          renderMeta={renderMeta}
          onViewChange={setView}
          label="Choose a day"
        />
        {summary.loading && !summary.data && <p className="px-4 pb-3 text-caption text-muted" role="status">Checking availability…</p>}
        {summary.error && !summary.data && (
          <p className="px-4 pb-3 text-caption text-danger" role="alert">
            Couldn't load availability.{' '}
            <button type="button" className="font-semibold underline" onClick={summary.reload}>
              Retry
            </button>
          </p>
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-card font-semibold text-navy">{selected ? `${weekdayShortOfIso(selected)}, ${formatIsoDate(selected)}` : 'Choose a day'}</h3>
          <span className="text-caption text-muted">Times in {timezone.replaceAll('_', ' ')}</span>
        </div>
        {!selected ? (
          summary.data ? (
            <p className="rounded-md bg-cloud px-4 py-6 text-center text-secondary text-muted">No open days left this month. Use › to see next month.</p>
          ) : (
            <SlotSkeleton />
          )
        ) : slots.error && !slots.data ? (
          <ErrorState compact error={slots.error} onRetry={slots.reload} title="Times didn't load" />
        ) : !slots.data ? (
          <SlotSkeleton />
        ) : slots.data.slots.length === 0 ? (
          <p className="rounded-md bg-cloud px-4 py-6 text-center text-secondary text-muted">No open times on {formatIsoDate(selected)}. Choose another day.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map(([label, list]) => (
              <fieldset key={label}>
                <legend className="mb-2 text-caption font-semibold uppercase tracking-wide text-subtle">{label}</legend>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={`${label} times`}>
                  {list.map((s) => {
                    const on = value?.startAt === s.startAt;
                    return (
                      <button
                        key={s.startAt}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(s)}
                        className={cx('h-11 rounded-md border text-[0.875rem] font-semibold tabular transition', on ? 'border-teal bg-teal text-white shadow-card' : 'border-line-strong bg-white text-navy hover:border-teal hover:bg-teal-50')}
                      >
                        {s.localTime}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
