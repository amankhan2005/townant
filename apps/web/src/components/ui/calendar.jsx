import { addDaysIso, daysInMonth, formatIsoDate, todayIso, weekdayOfIso } from '@townant/shared';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from './core.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
function addMonths(firstOfMonth, n) {
  let [y, m] = firstOfMonth.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}-01`;
}
function clampDay(iso, monthFirst) {
  const [y, m] = monthFirst.split('-').map(Number);
  const d = Math.min(Number(iso.slice(8)), daysInMonth(y, m));
  return `${monthFirst.slice(0, 8)}${String(d).padStart(2, '0')}`;
}

/**
 * Month calendar over date-only ISO strings (no Date parsing, so no time-zone drift).
 * Keyboard: arrows move by day/week, PageUp/PageDown by month (+Shift: year), Home/End
 * to week start/end, Enter/Space selects.
 */
export function Calendar({ value, onSelect, min, max, isDisabled, timeZone, renderMeta, onViewChange, initialView, label = 'Choose a date' }) {
  const today = todayIso(timeZone);
  const [focused, setFocused] = useState(value || initialView || (min && min > today ? min : today));
  const [view, setView] = useState(monthStart(focused));
  const gridRef = useRef(null);
  const moved = useRef(false);

  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

  useEffect(() => {
    if (!moved.current) return;
    gridRef.current?.querySelector(`[data-date="${focused}"]`)?.focus();
  }, [focused, view]);

  const disabled = (iso) => (min && iso < min) || (max && iso > max) || Boolean(isDisabled?.(iso));
  const go = (iso) => {
    moved.current = true;
    setFocused(iso);
    if (monthStart(iso) !== view) setView(monthStart(iso));
  };
  const shiftMonth = (n) => {
    const next = addMonths(view, n);
    setView(next);
    setFocused((f) => clampDay(f, next));
  };

  const onKeyDown = (e) => {
    const map = {
      ArrowLeft: () => addDaysIso(focused, -1),
      ArrowRight: () => addDaysIso(focused, 1),
      ArrowUp: () => addDaysIso(focused, -7),
      ArrowDown: () => addDaysIso(focused, 7),
      Home: () => addDaysIso(focused, -weekdayOfIso(focused)),
      End: () => addDaysIso(focused, 6 - weekdayOfIso(focused)),
      PageUp: () => clampDay(focused, addMonths(monthStart(focused), e.shiftKey ? -12 : -1)),
      PageDown: () => clampDay(focused, addMonths(monthStart(focused), e.shiftKey ? 12 : 1)),
    };
    if (map[e.key]) {
      e.preventDefault();
      go(map[e.key]());
    } else if ((e.key === 'Enter' || e.key === ' ') && !disabled(focused)) {
      e.preventDefault();
      onSelect(focused);
    }
  };

  const [y, m] = view.split('-').map(Number);
  const lead = weekdayOfIso(view);
  const count = daysInMonth(y, m);
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${view.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const canPrev = !min || addMonths(view, -1) >= monthStart(min);
  const canNext = !max || addMonths(view, 1) <= monthStart(max);
  const navBtn = 'flex size-9 items-center justify-center rounded-md text-navy hover:bg-cloud disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div className="w-full select-none p-3">
      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="flex">
          <button type="button" className={navBtn} onClick={() => shiftMonth(-12)} disabled={!canPrev} aria-label="Previous year">
            <ChevronsLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className={navBtn} onClick={() => shiftMonth(-1)} disabled={!canPrev} aria-label="Previous month">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
        </div>
        <h2 className="text-[0.9375rem] font-semibold text-navy" aria-live="polite" id={`cal-${view}`}>
          {MONTHS[m - 1]} {y}
        </h2>
        <div className="flex">
          <button type="button" className={navBtn} onClick={() => shiftMonth(1)} disabled={!canNext} aria-label="Next month">
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className={navBtn} onClick={() => shiftMonth(12)} disabled={!canNext} aria-label="Next year">
            <ChevronsRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <table ref={gridRef} role="grid" aria-labelledby={`cal-${view}`} aria-label={label} className="w-full border-collapse" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {DOW.map((d, i) => (
              <th key={d} scope="col" abbr={DOW_LONG[i]} className="pb-1 text-center text-caption font-semibold text-subtle">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((iso, di) => {
                if (!iso) return <td key={di} />;
                const off = disabled(iso);
                const selected = iso === value;
                const isToday = iso === today;
                const meta = renderMeta?.(iso);
                return (
                  <td key={iso} className="p-0.5 text-center">
                    <button
                      type="button"
                      data-date={iso}
                      tabIndex={iso === focused ? 0 : -1}
                      aria-selected={selected}
                      aria-current={isToday ? 'date' : undefined}
                      aria-disabled={off || undefined}
                      aria-label={`${DOW_LONG[di]}, ${formatIsoDate(iso)}${isToday ? ', today' : ''}${meta?.label ? `, ${meta.label}` : ''}${off ? ', unavailable' : ''}`}
                      onClick={() => !off && onSelect(iso)}
                      onFocus={() => setFocused(iso)}
                      className={cx(
                        'relative mx-auto flex w-full flex-col items-center justify-center rounded-md text-[0.875rem] tabular transition',
                        meta ? 'h-12' : 'h-10',
                        selected ? 'bg-teal font-semibold text-white shadow-card' : off ? 'cursor-not-allowed text-line-strong line-through decoration-line-strong/60' : 'text-navy hover:bg-teal-50',
                        isToday && !selected && 'font-bold text-teal-700 ring-1 ring-inset ring-teal/40',
                      )}
                    >
                      <span>{Number(iso.slice(8))}</span>
                      {meta?.short && <span className={cx('text-[10px] leading-tight', selected ? 'text-white/85' : off ? 'text-line-strong' : 'text-teal-700')}>{meta.short}</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
