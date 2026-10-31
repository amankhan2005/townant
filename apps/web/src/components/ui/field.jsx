import { AlertCircle, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cx, Spinner } from './core.jsx';

// One control style for every text input, textarea and select trigger: 44 px tall (touch-friendly),
// a visible hover, a 3 px focus ring and a distinct invalid state.
export const controlClass =
  'h-11 w-full rounded-md border border-line-strong bg-white px-3 text-body text-navy shadow-[inset_0_1px_1px_rgb(20_36_58/0.03)] placeholder:text-subtle transition hover:border-subtle focus:border-teal focus:outline-none focus:ring-[3px] focus:ring-teal/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-cloud disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-50/40 aria-[invalid=true]:focus:ring-danger/15';

// Label, required/optional marker, helper text and error, wired for assistive technology.
export function Field({ label, hint, error, children, className, optional, required, id: idProp, labelHidden }) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className={cx('text-[0.875rem] font-semibold text-navy', labelHidden && 'sr-only')}>
          {label}
          {/* The asterisk is visual; the input's aria-required announces "required". */}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
          {optional && <span className="font-normal text-subtle">{' (optional)'}</span>}
        </label>
      )}
      {children(id, { 'aria-invalid': Boolean(error) || undefined, 'aria-describedby': describedBy, 'aria-required': required || undefined })}
      {hint && (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <AlertCircle size={14} aria-hidden="true" className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ label, hint, error, className, optional, required, inputClassName, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className} optional={optional} required={required}>
      {(id, a11y) => <input id={id} className={cx(controlClass, inputClassName)} required={required} {...a11y} {...props} />}
    </Field>
  );
}

export function Textarea({ label, hint, error, className, optional, required, rows = 4, maxLength, value, ...props }) {
  return (
    <Field label={label} hint={hint ?? (maxLength && typeof value === 'string' && value.length > maxLength * 0.8 ? `${value.length}/${maxLength} characters` : undefined)} error={error} className={className} optional={optional} required={required}>
      {(id, a11y) => <textarea id={id} rows={rows} maxLength={maxLength} value={value} className={cx(controlClass, 'h-auto py-2.5 leading-relaxed')} required={required} {...a11y} {...props} />}
    </Field>
  );
}

export function Checkbox({ label, description, ...props }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-0.5 size-[18px] shrink-0 rounded border-line-strong accent-teal" {...props} />
      <label htmlFor={id} className="text-secondary">
        <span className="text-[0.875rem] font-medium text-navy">{label}</span>
        {description && <span className="block text-muted">{description}</span>}
      </label>
    </div>
  );
}

export function Toggle({ label, description, checked, onChange, disabled }) {
  const id = useId();
  // The switch is named by the label only; the description is linked separately so screen
  // readers announce "Label, switch, on" followed by the extra detail.
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-secondary">
        <label htmlFor={id} className="text-[0.875rem] font-medium text-navy">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal/30', checked ? 'bg-teal' : 'bg-line-strong hover:bg-subtle', disabled && 'cursor-not-allowed opacity-50')}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow-card transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  );
}

const SearchIcon = ({ className = 'size-[18px]' }) => <Search className={className} aria-hidden="true" />;
export { SearchIcon };

// Search field with icon, clear button and loading indicator. `onDebouncedChange` fires after
// the user pauses typing, so live searches don't hit the API on every keystroke.
export function SearchInput({ label = 'Search', value, onChange, onDebouncedChange, delay = 300, loading, placeholder = 'Search…', className, labelHidden = true, ...props }) {
  const timer = useRef();
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const update = (next) => {
    setLocal(next);
    onChange?.(next);
    if (onDebouncedChange) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onDebouncedChange(next), delay);
    }
  };
  return (
    <Field label={label} labelHidden={labelHidden} className={className}>
      {(id, a11y) => (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
            <SearchIcon />
          </span>
          <input id={id} type="search" value={local} onChange={(e) => update(e.target.value)} placeholder={placeholder} className={cx(controlClass, 'pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden')} {...a11y} {...props} />
          <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
            {loading ? (
              <Spinner className="mr-1 size-4 text-teal" />
            ) : (
              local && (
                <button type="button" onClick={() => update('')} className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-cloud hover:text-navy" aria-label="Clear search">
                  <X size={16} aria-hidden="true" />
                </button>
              )
            )}
          </span>
        </div>
      )}
    </Field>
  );
}
