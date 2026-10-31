import { addDaysIso, formatIsoDate, parseUsDate, todayIso } from '@townant/shared';
import { CalendarDays, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Calendar } from './calendar.jsx';
import { Button, cx } from './core.jsx';
import { controlClass, Field } from './field.jsx';
import { Popover } from './popover.jsx';

// Inserts slashes as the user types digits: "1029" -> "10/29", "10292026" -> "10/29/2026".
export function maskUsDate(raw, previous = '') {
  const deleting = raw.length < previous.length;
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (deleting) return raw.replace(/[^\d/]/g, '').slice(0, 10);
  let out = digits.slice(0, 2);
  if (digits.length >= 2) out += `/${digits.slice(2, 4)}`;
  if (digits.length >= 4) out += `/${digits.slice(4)}`;
  return out;
}

const CalendarIcon = () => <CalendarDays size={18} aria-hidden="true" />;

/**
 * Date field that shows and accepts MM/DD/YYYY and emits ISO "YYYY-MM-DD" (or "") so API
 * contracts are unchanged. Typing and the calendar popover are both supported; `min`, `max`
 * and `isDisabled` constrain choices and are re-checked when typed dates are committed.
 */
export function DatePicker({ label, value, onChange, min, max, isDisabled, hint, error: externalError, optional, required, clearable = true, className, timeZone, placeholder = 'MM/DD/YYYY' }) {
  const [text, setText] = useState(formatIsoDate(value));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setText(formatIsoDate(value));
    setError(null);
  }, [value]);

  const check = (iso) => {
    if (min && iso < min) return `Choose a date on or after ${formatIsoDate(min)}.`;
    if (max && iso > max) return `Choose a date on or before ${formatIsoDate(max)}.`;
    if (isDisabled?.(iso)) return `${formatIsoDate(iso)} isn't available.`;
    return null;
  };

  const commit = () => {
    if (!text.trim()) {
      setError(required ? 'Enter a date.' : null);
      if (value) onChange('');
      return;
    }
    const iso = parseUsDate(text);
    if (!iso) return setError('Enter the date as MM/DD/YYYY.');
    const problem = check(iso);
    if (problem) return setError(problem);
    setError(null);
    setText(formatIsoDate(iso));
    if (iso !== value) onChange(iso);
  };

  const pick = (iso) => {
    setError(null);
    onChange(iso);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <Field label={label} hint={hint ?? 'MM/DD/YYYY'} error={externalError ?? error} optional={optional} required={required} className={className}>
      {(id, a11y) => (
        <>
          <div ref={anchorRef} className="relative">
            <input
              ref={inputRef}
              id={id}
              inputMode="numeric"
              autoComplete="off"
              placeholder={placeholder}
              value={text}
              onChange={(e) => setText(maskUsDate(e.target.value, text))}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'ArrowDown' && e.altKey) {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
              className={cx(controlClass, 'pr-20 tabular')}
              {...a11y}
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              {clearable && value && (
                <button type="button" onClick={() => onChange('')} className="flex size-8 items-center justify-center rounded-sm text-muted hover:bg-cloud hover:text-navy" aria-label={`Clear ${label ?? 'date'}`}>
                  <X size={16} aria-hidden="true" />
                </button>
              )}
              <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} className="flex size-8 items-center justify-center rounded-sm text-teal-700 hover:bg-teal-50" aria-label={`Open calendar for ${label ?? 'date'}`}>
                <CalendarIcon />
              </button>
            </div>
          </div>
          <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} panelRef={panelRef} width={320} label={label ?? 'Choose a date'}>
            <div
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setOpen(false);
                  inputRef.current?.focus();
                }
              }}
            >
              <CalendarAutoFocus>
                <Calendar value={value} onSelect={pick} min={min} max={max} isDisabled={isDisabled} timeZone={timeZone} label={label} />
              </CalendarAutoFocus>
              <div className="flex items-center justify-between border-t border-line px-3 py-2">
                <Button size="sm" variant="ghost" onClick={() => pick(clampToday(timeZone, min, max))}>
                  Today
                </Button>
                <div className="flex gap-1">
                  {clearable && value && (
                    <Button size="sm" variant="ghost" onClick={() => pick('')}>
                      Clear
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </Popover>
        </>
      )}
    </Field>
  );
}

function clampToday(timeZone, min, max) {
  const t = todayIso(timeZone);
  if (min && t < min) return min;
  if (max && t > max) return max;
  return t;
}

// Moves keyboard focus into the calendar grid when the popover opens.
function CalendarAutoFocus({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.querySelector('[role=grid] button[tabindex="0"]')?.focus(), 30);
    return () => clearTimeout(t);
  }, []);
  return <div ref={ref}>{children}</div>;
}

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

/**
 * Start/end date pair. Both ends are inclusive calendar days and the end can't precede the
 * start. Emits { from, to } as ISO strings ("" when open-ended).
 */
export function DateRangePicker({ label = 'Date range', from, to, onChange, min, max, presets = false, timeZone, className }) {
  const today = todayIso(timeZone);
  return (
    <fieldset className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <legend className="mb-1.5 text-[0.875rem] font-medium text-navy">{label}</legend>
      <div className="flex flex-wrap items-start gap-2">
        <DatePicker label="From" value={from} onChange={(v) => onChange({ from: v, to: to && v && to < v ? v : to })} min={min} max={to || max} className="w-full sm:w-48" hint="" timeZone={timeZone} />
        <DatePicker label="To" value={to} onChange={(v) => onChange({ from, to: v })} min={from || min} max={max} className="w-full sm:w-48" hint="" timeZone={timeZone} />
      </div>
      {presets && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const start = addDaysIso(today, -(p.days - 1));
            const on = from === start && to === today;
            return (
              <button key={p.days} type="button" aria-pressed={on} onClick={() => onChange({ from: start, to: today })} className={cx('rounded-full px-3 py-1 text-caption font-semibold ring-1 ring-inset', on ? 'bg-teal text-white ring-teal' : 'bg-white text-muted ring-line hover:text-navy')}>
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
