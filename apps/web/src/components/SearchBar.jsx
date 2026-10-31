import { countryOptions } from '@townant/shared';
import { ChevronDown, LocateFixed, MapPin, Search, Store, Tag } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { locationLabel, locationQuery, useSearchLocation } from '../lib/location.js';
import { Button, cx, Input, Modal, Select, Spinner } from './ui.jsx';

const PinIcon = () => <MapPin size={18} className="shrink-0" aria-hidden="true" />;

// Suggestions: matching categories (local) and businesses (debounced API search).
function useSuggestions(query) {
  const categories = useApi('/catalog/categories');
  const [businesses, setBusinesses] = useState({ q: '', items: [], loading: false });
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return undefined;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setBusinesses((b) => ({ ...b, loading: true }));
      try {
        const { data } = await api('/catalog/companies', { query: { q, limit: 4 }, signal: controller.signal });
        setBusinesses({ q, items: data, loading: false });
      } catch (err) {
        if (err.name !== 'AbortError') setBusinesses({ q, items: [], loading: false });
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  const cats = useMemo(() => {
    const list = categories.data ?? [];
    if (!q) return list.filter((c) => !c.parentId).slice(0, 6);
    const lower = q.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(lower)).slice(0, 5);
  }, [categories.data, q]);

  return {
    items: [
      ...cats.map((c) => ({ kind: 'category', id: `c-${c.id}`, label: c.name, value: c.slug })),
      ...(q.length >= 2 && businesses.q === q ? businesses.items.map((b) => ({ kind: 'business', id: `b-${b.id}`, label: b.name, detail: [b.category?.name, b.location?.city].filter(Boolean).join(' · '), value: b.slug })) : []),
    ],
    loading: q.length >= 2 && (businesses.loading || businesses.q !== q),
  };
}

/**
 * Primary discovery search: keyword + location + Search. Submits to /search with real query
 * parameters; suggestions jump straight to a category or business.
 */
export function SearchBar({ initialQuery = '', variant = 'default' }) {
  const navigate = useNavigate();
  const { location, setLocation, locateDevice, status } = useSearchLocation();
  const [q, setQ] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [locOpen, setLocOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const listId = useId();
  const wrapRef = useRef(null);
  const { items, loading } = useSuggestions(q);

  useEffect(() => {
    const onDown = (e) => !wrapRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const submit = (e) => {
    e?.preventDefault();
    setOpen(false);
    setSubmitting(true);
    const params = new URLSearchParams(Object.entries({ q: q.trim(), ...locationQuery(location) }).filter(([, v]) => v !== undefined && v !== ''));
    navigate(`/search?${params}`);
    setTimeout(() => setSubmitting(false), 400);
  };

  const pick = (item) => {
    setOpen(false);
    if (item.kind === 'category') {
      const params = new URLSearchParams(Object.entries({ category: item.value, ...locationQuery(location) }).filter(([, v]) => v !== undefined && v !== ''));
      navigate(`/search?${params}`);
    } else navigate(`/b/${item.value}`);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter' && open && active >= 0 && items[active]) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const hero = variant === 'hero';
  const nav = variant === 'nav';
  const showList = open && (items.length > 0 || loading);

  const input = (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Service, category or business
      </label>
      <Search size={nav ? 16 : 18} aria-hidden="true" className={cx('pointer-events-none absolute top-1/2 -translate-y-1/2 text-subtle', nav ? 'left-3' : 'left-3.5')} />
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && items[active] ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        maxLength={100}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Service, category or business"
        className={cx(
          'w-full bg-transparent text-navy placeholder:text-subtle focus:outline-none',
          nav ? 'h-10 rounded-sm pl-9 pr-3 text-[0.875rem]' : cx('rounded-md pl-11 pr-3 focus:bg-cloud/70', hero ? 'h-[52px] text-[1rem]' : 'h-12 text-body'),
        )}
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Suggestions" className={cx('absolute top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-card border border-line bg-white p-1.5 shadow-pop', nav ? 'left-0 w-[min(26rem,90vw)]' : 'inset-x-0 sm:right-auto sm:w-[min(32rem,90vw)]')}>
          {items.map((item, i) => {
            const header = i === 0 || items[i - 1].kind !== item.kind;
            const Icon = item.kind === 'category' ? Tag : Store;
            return (
              <li key={item.id} role="presentation">
                {header && <div className="px-3 pb-1 pt-2.5 text-caption font-semibold uppercase tracking-wide text-subtle">{item.kind === 'category' ? (q.trim() ? 'Categories' : 'Popular categories') : 'Businesses'}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item)}
                  className={cx('flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5', i === active && 'bg-teal-50')}
                >
                  <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-cloud text-teal-700">
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.9375rem] font-medium text-navy">{item.label}</span>
                    {item.detail && <span className="block truncate text-secondary text-muted">{item.detail}</span>}
                  </span>
                </div>
              </li>
            );
          })}
          {loading && (
            <li role="presentation" className="flex items-center gap-2 px-3 py-2.5 text-secondary text-muted">
              <Spinner className="size-4 text-teal" /> Searching businesses…
            </li>
          )}
        </ul>
      )}
    </div>
  );

  const locationButton = (
    <button
      type="button"
      onClick={() => setLocOpen(true)}
      aria-label={`Location: ${locationLabel(location)}. Change location`}
      className={cx(
        'flex min-w-0 items-center gap-2 text-left font-medium text-navy transition hover:bg-cloud',
        nav ? 'h-9 max-w-[11rem] rounded-sm pl-2.5 pr-2 text-[0.875rem]' : cx('rounded-md px-3.5 text-[0.9375rem]', hero ? 'h-[52px]' : 'h-12', 'border border-line sm:max-w-[14rem] sm:border-0'),
      )}
    >
      <span className="text-teal">
        <PinIcon />
      </span>
      <span className="truncate">{locationLabel(location)}</span>
      <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-muted" />
    </button>
  );

  const dialog = <LocationDialog key={String(locOpen)} open={locOpen} onClose={() => setLocOpen(false)} location={location} setLocation={setLocation} locateDevice={locateDevice} status={status} />;

  if (nav) {
    return (
      <>
        <form onSubmit={submit} role="search" aria-label="Search TownAnt" className="flex h-11 w-full max-w-xl items-center gap-0.5 rounded-md border border-line-strong bg-white px-1 transition hover:border-subtle focus-within:border-teal focus-within:ring-[3px] focus-within:ring-teal/15">
          {locationButton}
          <span className="h-6 w-px shrink-0 bg-line" aria-hidden="true" />
          {input}
          <button type="submit" className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-teal text-white transition hover:bg-teal-700" aria-label="Search">
            <Search size={16} aria-hidden="true" />
          </button>
        </form>
        {dialog}
      </>
    );
  }

  return (
    <>
      <form onSubmit={submit} role="search" aria-label="Find a local service" className={cx('relative flex flex-col gap-2 rounded-xl bg-white p-2 sm:flex-row sm:items-center sm:gap-0', hero ? 'border border-line shadow-raised' : 'shadow-card ring-1 ring-line')}>
        {input}
        <span className="hidden h-8 w-px bg-line sm:block" aria-hidden="true" />
        {locationButton}
        <Button type="submit" size="lg" pending={submitting} className={cx('rounded-md px-7', hero && 'h-[52px]')}>
          Search
        </Button>
      </form>
      {dialog}
    </>
  );
}

/**
 * Location control on its own, for the header at widths where the full search bar is hidden.
 * Shares the search location store, so it stays in sync with every search bar and homepage row.
 */
export function LocationPicker({ className }) {
  const { location, setLocation, locateDevice, status } = useSearchLocation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Location: ${locationLabel(location)}. Change location`}
        className={cx('flex h-10 min-w-0 items-center gap-1.5 rounded-md px-2 text-[0.875rem] sm:px-2.5 font-medium text-navy transition hover:bg-cloud', className)}
      >
        <MapPin size={17} aria-hidden="true" className="shrink-0 text-teal" />
        <span className="truncate">{locationLabel(location)}</span>
        <ChevronDown size={15} aria-hidden="true" className="hidden shrink-0 text-muted sm:block" />
      </button>
      <LocationDialog key={String(open)} open={open} onClose={() => setOpen(false)} location={location} setLocation={setLocation} locateDevice={locateDevice} status={status} />
    </>
  );
}

const COUNTRIES = countryOptions();

// Default the country from the browser's locale (e.g. en-GB → GB); customers can change it.
function defaultCountry() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && COUNTRIES.some((c) => c.value === region)) return region;
  } catch {
    /* unsupported locale API */
  }
  return 'US';
}

export function LocationDialog({ open, onClose, location, setLocation, locateDevice, status }) {
  const manual = location?.mode === 'manual' ? location : {};
  const [form, setForm] = useState(() => ({ postalCode: manual.postalCode ?? '', city: manual.city ?? '', region: manual.region ?? '', country: manual.country ?? defaultCountry() }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = (e) => {
    e.preventDefault();
    const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));
    setLocation(clean.city || clean.postalCode ? { mode: 'manual', ...clean, country: clean.country.toUpperCase() } : null);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Where do you need the service?" description="Use your current location, or enter a city or postal code." size="sm">
      <div className="flex flex-col gap-4">
        <Button variant="secondary" size="lg" onClick={() => locateDevice(onClose)} pending={status === 'locating'} icon={<LocateFixed size={18} aria-hidden="true" />}>
          Use my current location
        </Button>
        {status === 'denied' && <p role="alert" className="text-secondary text-muted">Location permission was declined. You can still search by city or postal code below.</p>}
        {(status === 'unavailable' || status === 'unsupported') && <p role="alert" className="text-secondary text-muted">We couldn't get your location. Enter a city or postal code instead.</p>}
        {location?.mode === 'device' && status === 'idle' && <p className="text-secondary text-teal-700">Using your approximate location. It stays on this device.</p>}
        <div className="flex items-center gap-3 text-caption font-semibold uppercase tracking-wide text-subtle">
          <span className="h-px flex-1 bg-line" />
          or enter a place
          <span className="h-px flex-1 bg-line" />
        </div>
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <Input label="ZIP / postal code" value={form.postalCode} onChange={set('postalCode')} maxLength={12} autoComplete="postal-code" data-autofocus />
          <Input label="City" value={form.city} onChange={set('city')} maxLength={80} autoComplete="address-level2" />
          <Input label="State / region" optional value={form.region} onChange={set('region')} maxLength={80} autoComplete="address-level1" />
          <Select label="Country" value={form.country} onChange={set('country')} options={COUNTRIES} />
          <div className="col-span-2 mt-1 flex justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setLocation(null);
                onClose();
              }}
            >
              Search anywhere
            </Button>
            <Button type="submit">Use this location</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
