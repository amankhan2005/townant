import { formatIsoDate, todayIso } from '@townant/shared';
import { ArrowDownUp, CalendarDays, Check, ChevronDown, LayoutGrid, MapPin, SearchX, SlidersHorizontal, Star, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CompanyCard } from '../../components/CompanyCard.jsx';
import { SearchBar } from '../../components/SearchBar.jsx';
import { ActiveFilters, Async, Button, Calendar, CardGridSkeleton, cx, DatePicker, Drawer, EmptyState, Pagination, Popover, Select } from '../../components/ui.jsx';
import { useFavorites } from '../../lib/favorites.js';
import { useApi, useDocumentTitle, usePageMeta } from '../../lib/hooks.js';

const KEYS = ['q', 'category', 'city', 'region', 'postalCode', 'country', 'lat', 'lng', 'radiusKm', 'minRating', 'availableOn', 'sort', 'page'];
const SORTS = [
  ['', 'Most reviewed'],
  ['rating', 'Highest rated'],
  ['newest', 'Newest'],
];
const RATINGS = [
  ['', 'Any rating'],
  ['4.5', '4.5 and up'],
  ['4', '4.0 and up'],
  ['3', '3.0 and up'],
];
const DISTANCES = ['5', '10', '25', '50', '100'];

// A compact filter chip that opens a small panel (a bottom sheet on phones).
function FilterChip({ icon: Icon, label, value, active, onClear, children, width = 280 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  return (
    <div className={cx('inline-flex h-10 shrink-0 items-center rounded-full border text-[0.875rem] font-medium transition', active ? 'border-teal bg-teal-50 text-teal-700' : 'border-line-strong bg-white text-slate hover:border-navy/30')}>
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} className={cx('flex h-full items-center gap-2 rounded-full pl-3.5', active && onClear ? 'pr-1.5' : 'pr-3')}>
        <Icon size={16} aria-hidden="true" />
        <span>{active ? value : label}</span>
        {!(active && onClear) && <ChevronDown size={15} aria-hidden="true" className="opacity-60" />}
      </button>
      {active && onClear && (
        <button type="button" onClick={onClear} className="mr-1 flex size-7 items-center justify-center rounded-full hover:bg-teal-100" aria-label={`Clear ${label}`}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} panelRef={panelRef} width={width} label={label}>
        <div className="max-h-[70vh] overflow-y-auto" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false), ref.current?.focus())}>
          {children(() => setOpen(false))}
        </div>
      </Popover>
    </div>
  );
}

function OptionList({ options, value, onPick, label }) {
  return (
    <ul role="listbox" aria-label={label} className="p-1.5">
      {options.map(([v, text]) => {
        const on = v === (value ?? '');
        return (
          <li key={v || 'any'}>
            <button type="button" role="option" aria-selected={on} onClick={() => onPick(v)} className={cx('flex min-h-10 w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-[0.875rem]', on ? 'bg-teal-50 font-semibold text-teal-700' : 'text-slate hover:bg-cloud')}>
              {text}
              {on && <Check size={16} aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v));
  const favorites = useFavorites();
  const results = useApi('/catalog/companies', { query: { limit: 18, ...query } });
  const categories = useApi('/catalog/categories');
  const [drawer, setDrawer] = useState(false);

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const cats = categories.data ?? [];
  const categoryName = cats.find((c) => c.slug === query.category)?.name;
  const geo = Boolean(query.lat && query.lng);
  const place = geo ? 'Near me' : [query.postalCode, query.city, query.region].filter(Boolean).join(', ');
  const heading = query.q ? `Results for “${query.q}”` : categoryName ?? 'Explore local businesses';
  useDocumentTitle(query.q ? `“${query.q}”` : categoryName ?? 'Explore');
  usePageMeta({ title: categoryName ?? 'Explore', description: categoryName ? `Find and book ${categoryName.toLowerCase()} businesses on TownAnt.` : 'Search local businesses and services on TownAnt.', keep: ['category'] });
  const invalid = results.error?.code === 'VALIDATION_ERROR';
  const total = results.meta?.total;
  const keepQuery = () => setParams(new URLSearchParams(query.q ? { q: query.q } : {}));

  const categoryOptions = [['', 'All categories'], ...cats.filter((c) => !c.parentId).flatMap((p) => [[p.slug, p.name], ...cats.filter((c) => c.parentId === p.id).map((c) => [c.slug, `  ${c.name}`])])];

  const active = [
    query.category && { key: 'category', label: categoryName ?? query.category, onRemove: () => update({ category: '' }) },
    place && { key: 'place', label: place, onRemove: () => update({ city: '', region: '', postalCode: '', country: '', lat: '', lng: '', radiusKm: '' }) },
    query.minRating && { key: 'rating', label: `Rated ${query.minRating}+`, onRemove: () => update({ minRating: '' }) },
    query.availableOn && { key: 'date', label: `Open ${formatIsoDate(query.availableOn)}`, onRemove: () => update({ availableOn: '' }) },
  ].filter(Boolean);

  const chips = (
    <>
      <FilterChip icon={LayoutGrid} label="Category" value={categoryName} active={Boolean(query.category)} onClear={() => update({ category: '' })} width={300}>
        {(close) => <OptionList label="Category" options={categoryOptions} value={query.category} onPick={(v) => (update({ category: v }), close())} />}
      </FilterChip>
      <FilterChip icon={CalendarDays} label="Available on" value={query.availableOn && formatIsoDate(query.availableOn)} active={Boolean(query.availableOn)} onClear={() => update({ availableOn: '' })} width={320}>
        {(close) => (
          <>
            <Calendar value={query.availableOn} min={todayIso()} onSelect={(iso) => (update({ availableOn: iso }), close())} label="Available on" />
            <p className="px-4 pb-3 text-caption text-muted">Shows businesses with open times that day.</p>
          </>
        )}
      </FilterChip>
      <FilterChip icon={Star} label="Rating" value={`Rated ${query.minRating}+`} active={Boolean(query.minRating)} onClear={() => update({ minRating: '' })}>
        {(close) => <OptionList label="Minimum rating" options={RATINGS} value={query.minRating} onPick={(v) => (update({ minRating: v }), close())} />}
      </FilterChip>
      {geo && (
        <FilterChip icon={MapPin} label="Distance" value={`Within ${query.radiusKm ?? 25} km`} active>
          {(close) => <OptionList label="Distance" options={DISTANCES.map((d) => [d, `Within ${d} km`])} value={query.radiusKm ?? '25'} onPick={(v) => (update({ radiusKm: v }), close())} />}
        </FilterChip>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-7xl gutter py-8">
      <div className="max-w-3xl">
        <SearchBar key={query.q} initialQuery={query.q ?? ''} />
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.5rem] font-bold tracking-[-0.01em] text-navy md:text-[1.75rem]">{heading}</h1>
          <p className="mt-1 text-secondary text-muted" aria-live="polite">
            {results.data ? `${(total ?? 0).toLocaleString('en-US')} ${total === 1 ? 'business' : 'businesses'}${place ? ` · ${place}` : ''}` : 'Searching…'}
          </p>
        </div>
        <FilterChip icon={ArrowDownUp} label="Sort" value={SORTS.find(([v]) => v === (query.sort ?? ''))?.[1]} active={false}>
          {(close) => <OptionList label="Sort by" options={SORTS} value={query.sort} onPick={(v) => (update({ sort: v }), close())} />}
        </FilterChip>
      </div>

      <div className="mt-5 hidden flex-wrap items-center gap-2 md:flex" aria-label="Filters">
        {chips}
        {active.length > 1 && (
          <button type="button" onClick={keepQuery} className="ml-1 text-secondary font-semibold text-muted hover:text-navy">
            Clear all
          </button>
        )}
      </div>
      <div className="mt-5 flex flex-col gap-3 md:hidden">
        <Button variant="secondary" size="sm" className="w-fit rounded-full" icon={<SlidersHorizontal size={16} aria-hidden="true" />} onClick={() => setDrawer(true)}>
          Filters{active.length ? ` · ${active.length}` : ''}
        </Button>
        <ActiveFilters filters={active} onClear={keepQuery} />
      </div>

      <section className="mt-6" aria-busy={results.loading} aria-label="Search results">
        {invalid ? (
          <EmptyState icon={SearchX} title="Some search details look invalid" body="Check the location and filters, then try again." action={<Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>Reset search</Button>} />
        ) : (
          <Async
            state={results}
            loading={<CardGridSkeleton count={8} className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" label="Searching" />}
            errorTitle="We couldn't load these results"
            empty={
              <EmptyState
                icon={SearchX}
                title="No matching businesses found"
                body={active.length ? 'Try a different search or adjust your filters.' : 'Try different words, or browse categories.'}
                action={
                  active.length ? (
                    <Button variant="secondary" onClick={keepQuery}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                      Show all businesses
                    </Button>
                  )
                }
              />
            }
          >
            {(data) => (
              <>
                <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {data.map((c) => (
                    <CompanyCard key={c.id} company={c} favorite={favorites.ids.has(c.id)} onToggleFavorite={favorites.toggle} />
                  ))}
                </div>
                <Pagination meta={results.meta} onPage={(page) => update({ page: String(page) })} />
              </>
            )}
          </Async>
        )}
      </section>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Filters" footer={<Button className="flex-1" onClick={() => setDrawer(false)}>{results.data ? `Show ${(total ?? 0).toLocaleString('en-US')} results` : 'Done'}</Button>}>
        <div className="flex flex-col gap-5">
          <Select label="Category" value={query.category ?? ''} onChange={(e) => update({ category: e.target.value })} searchable options={categoryOptions.map(([value, label]) => ({ value, label: label.trim() }))} />
          <DatePicker label="Available on" hint="Only businesses with open times that day" value={query.availableOn ?? ''} min={todayIso()} onChange={(v) => update({ availableOn: v })} />
          <Select label="Minimum rating" value={query.minRating ?? ''} onChange={(e) => update({ minRating: e.target.value })} options={RATINGS.map(([value, label]) => ({ value, label }))} />
          {geo && <Select label="Distance" value={query.radiusKm ?? '25'} onChange={(e) => update({ radiusKm: e.target.value })} options={DISTANCES.map((d) => ({ value: d, label: `Within ${d} km` }))} />}
          <Select label="Sort by" value={query.sort ?? ''} onChange={(e) => update({ sort: e.target.value })} options={SORTS.map(([value, label]) => ({ value, label }))} />
        </div>
      </Drawer>
    </div>
  );
}
