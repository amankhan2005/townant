import { Check, ChevronDown } from 'lucide-react';
import { Children, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from './core.jsx';
import { controlClass, Field, SearchIcon } from './field.jsx';
import { Popover, useIsNarrow } from './popover.jsx';

// Reads <option>/<optgroup> children so existing call sites keep working unchanged.
function optionsFromChildren(children, group) {
  const out = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'optgroup') out.push(...optionsFromChildren(child.props.children, child.props.label));
    else if (child.type === 'option') {
      const label = Children.toArray(child.props.children).join('');
      out.push({ value: String(child.props.value ?? label), label, group, disabled: child.props.disabled });
    }
  });
  return out;
}

const Chevron = () => <ChevronDown size={16} className="shrink-0 text-muted" aria-hidden="true" />;

/**
 * Accessible select (listbox pattern) with optional type-to-filter search.
 * API-compatible with a native select: `value`, `onChange(event)` where event.target.value is
 * the chosen value, and <option>/<optgroup> children. Alternatively pass `options`.
 * Lists longer than 10 options become searchable automatically.
 */
export function Select({ label, hint, error, className, children, options: optionsProp, value, onChange, optional, required, disabled, searchable, placeholder = 'Select…', labelHidden, id: idProp }) {
  const options = useMemo(() => optionsProp ?? optionsFromChildren(children), [optionsProp, children]);
  const search = searchable ?? options.length > 10;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const listId = useId();
  const narrow = useIsNarrow();

  const current = options.find((o) => o.value === String(value ?? ''));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.group ?? '').toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setActive(Math.max(0, options.findIndex((o) => o.value === String(value ?? ''))));
  };

  const choose = (opt) => {
    if (!opt || opt.disabled) return;
    onChange?.({ target: { value: opt.value }, currentTarget: { value: opt.value } });
    close();
  };

  useEffect(() => {
    if (!open) return;
    if (search) setTimeout(() => searchRef.current?.focus(), 0);
    else setTimeout(() => listRef.current?.focus(), 0);
  }, [open, search]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const typeahead = useRef({ text: '', at: 0 });
  const onListKey = (e) => {
    const move = (delta) => {
      e.preventDefault();
      setActive((i) => {
        let n = i;
        for (let step = 0; step < filtered.length; step += 1) {
          n = Math.min(filtered.length - 1, Math.max(0, n + delta));
          if (!filtered[n]?.disabled) break;
        }
        return n;
      });
    };
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Home') (e.preventDefault(), setActive(0));
    else if (e.key === 'End') (e.preventDefault(), setActive(filtered.length - 1));
    else if (e.key === 'Enter' || (e.key === ' ' && !search)) (e.preventDefault(), choose(filtered[active]));
    else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close());
    else if (e.key === 'Tab') close(false);
    else if (!search && e.key.length === 1) {
      const now = Date.now();
      typeahead.current = { text: (now - typeahead.current.at < 600 ? typeahead.current.text : '') + e.key.toLowerCase(), at: now };
      const hit = filtered.findIndex((o) => o.label.toLowerCase().startsWith(typeahead.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  const onTriggerKey = (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openList();
    }
  };

  return (
    <Field label={label} hint={hint} error={error} className={className} optional={optional} required={required} id={idProp} labelHidden={labelHidden}>
      {(id, a11y) => (
        <>
          <button
            ref={triggerRef}
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => (open ? close() : openList())}
            onKeyDown={onTriggerKey}
            className={cx(controlClass, 'flex items-center justify-between gap-2 text-left', !current && 'text-subtle')}
            {...a11y}
          >
            <span className="truncate">{current?.label ?? placeholder}</span>
            <Chevron />
          </button>
          <Popover open={open} onClose={() => close(false)} anchorRef={triggerRef} panelRef={panelRef} label={typeof label === 'string' ? label : 'Options'} width={narrow ? undefined : 'anchor'}>
            {narrow && typeof label === 'string' && <p className="px-4 pb-1 pt-3 text-card font-semibold text-navy">{label}</p>}
            {search && (
              <div className="border-b border-line p-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle">
                    <SearchIcon className="size-4" />
                  </span>
                  <input
                    ref={searchRef}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                    aria-autocomplete="list"
                    aria-label={`Search ${typeof label === 'string' ? label.toLowerCase() : 'options'}`}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    onKeyDown={onListKey}
                    placeholder="Type to search"
                    className="h-9 w-full rounded-sm bg-cloud pl-8 pr-2 text-secondary text-navy outline-none placeholder:text-subtle focus:ring-2 focus:ring-teal/25"
                  />
                </div>
              </div>
            )}
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={typeof label === 'string' ? label : undefined}
              tabIndex={search ? -1 : 0}
              aria-activedescendant={!search && active >= 0 ? `${listId}-${active}` : undefined}
              onKeyDown={search ? undefined : onListKey}
              className="max-h-72 flex-1 overflow-y-auto p-1 outline-none sm:max-h-80"
            >
              {filtered.length === 0 && <li className="px-3 py-6 text-center text-secondary text-muted">No matches</li>}
              {filtered.map((o, i) => {
                const header = o.group && o.group !== filtered[i - 1]?.group;
                const selected = o.value === String(value ?? '');
                return (
                  <li key={`${o.group ?? ''}-${o.value}`} role="presentation">
                    {header && <div className="px-3 pb-1 pt-3 text-caption font-semibold uppercase tracking-wide text-subtle">{o.group}</div>}
                    <div
                      id={`${listId}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={o.disabled || undefined}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      className={cx(
                        'flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-[0.875rem] sm:min-h-9',
                        i === active && 'bg-teal-50',
                        selected ? 'font-semibold text-teal-700' : 'text-slate',
                        o.disabled && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <span>{o.label}</span>
                      {selected && <Check size={16} aria-hidden="true" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Popover>
        </>
      )}
    </Field>
  );
}
