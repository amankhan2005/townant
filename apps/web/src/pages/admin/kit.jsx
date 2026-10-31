// Super Admin design kit: the page frame, panels, list states, status vocabulary, KPI cards, charts
// and export control every console screen is built from. Visual rules live here so pages only
// describe content. Everything renders data passed in; nothing here invents values.
import { animate, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, FileSpreadsheet } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatIsoDate } from '@townant/shared';
import { Badge, Breadcrumbs, Button, cx, EmptyState, ErrorState, InlineError, Pagination, Skeleton, TableSkeleton, useToast } from '../../components/ui.jsx';
import { downloadFile } from '../../lib/api.js';

// Categorical chart palette, assigned in this fixed order (validated for colour-vision
// deficiency separation on the light surface; amber is below 3:1, so charts always label values).
export const CHART = { teal: '#0d9488', blue: '#2a78d6', orange: '#eb6834', violet: '#6250d6', amber: '#d18f00', magenta: '#d55181' };
export const CHART_ORDER = [CHART.teal, CHART.blue, CHART.orange, CHART.violet, CHART.amber, CHART.magenta];
const EASE = [0.22, 1, 0.36, 1];

// ---------------------------------------------------------------------------------------------
// URL-backed list filters (shareable, survive refresh). Changing a filter resets to page 1.
// ---------------------------------------------------------------------------------------------

export function useAdminFilters() {
  const [params, setParams] = useSearchParams();
  const get = (k) => params.get(k) ?? '';
  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  return { get, set, page: Number(params.get('page') ?? 1), params };
}

// ---------------------------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------------------------

// One content width for every admin route, so headers and grids start at the same edge everywhere.
// Pages may still pass `width`; it is ignored. Forms constrain their own line length.
const CONTAINER = 'max-w-[1320px]';

export function AdminPage({ title, description, actions, breadcrumbs, eyebrow, children }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }} className={cx('mx-auto flex w-full flex-col gap-6', CONTAINER)}>
      <header className="flex flex-col gap-2">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 max-w-2xl">
            {eyebrow && <p className="mb-1 text-caption font-semibold uppercase tracking-[0.12em] text-slate-500">{eyebrow}</p>}
            <h1 className="text-[1.5rem] font-bold leading-8 tracking-[-0.015em] text-slate-900">{title}</h1>
            {description && <p className="mt-1 text-[0.9375rem] leading-6 text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      {children}
    </motion.div>
  );
}

// A titled surface. `flush` lets tables run edge to edge under the header.
export function Panel({ title, description, actions, children, className, flush, as: As = 'section', id }) {
  const headingId = useId();
  return (
    <As aria-labelledby={title ? headingId : undefined} id={id} className={cx('flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]', className)}>
      {(title || actions) && (
        <div className={cx('flex min-h-[4.25rem] flex-wrap items-center justify-between gap-3 px-5 py-3.5', children != null && 'border-b border-slate-100')}>
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="font-heading text-[0.9375rem] font-bold leading-6 text-slate-900">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-[0.8125rem] leading-5 text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children != null && <div className={cx('min-w-0 flex-1', !flush && 'p-5')}>{children}</div>}
    </As>
  );
}

// Filters above a list. Children are labelled controls (Select, SearchInput, …).
export function FilterBar({ children, summary }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 max-sm:[&>*]:w-full">
      {children}
      {summary && <p className="ml-auto self-center text-secondary text-slate-500 tabular">{summary}</p>}
    </div>
  );
}

// A list surface: filters, then the right state for a useApi() result, then pagination.
// `children(data)` renders the rows; empty data shows `empty`.
export function DataPanel({ state, filters, empty, columns = 5, skeleton, children, onPage, title, description, actions, toolbar, isEmpty = (d) => Array.isArray(d) && d.length === 0 }) {
  const { data, error, reload, meta } = state;
  const total = meta?.total;
  let body;
  if (data == null) body = error ? <ErrorState flush error={error} onRetry={reload} /> : (skeleton ?? <TableSkeleton bare columns={columns} />);
  else if (isEmpty(data)) body = empty;
  else body = children(data);
  return (
    <Panel flush title={title} description={description} actions={actions}>
      {toolbar && <div className="border-b border-slate-100 px-5 py-3">{toolbar}</div>}
      {filters && <FilterBar summary={total != null && data ? `${total.toLocaleString('en-US')} ${total === 1 ? 'result' : 'results'}` : null}>{filters}</FilterBar>}
      {error && data != null && (
        <div className="border-b border-slate-100 px-5 py-3">
          <InlineError error={error} onRetry={reload} />
        </div>
      )}
      {body}
      {onPage && meta?.pages > 1 && (
        <div className="border-t border-slate-100 px-5 py-3">
          <Pagination meta={meta} onPage={onPage} className="" />
        </div>
      )}
    </Panel>
  );
}

export const PanelEmpty = (props) => <EmptyState flush compact {...props} />;

// Two or three views of one list (e.g. Active / Recently deleted). Real links-free tabs with arrow keys.
export function SegmentedTabs({ tabs, value, onChange, label }) {
  const refs = useRef([]);
  const index = tabs.findIndex((t) => t.value === value);
  const onKey = (e) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (index + dir + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-1" onKeyDown={onKey}>
      {tabs.map((t, i) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cx('inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-[0.8125rem] font-semibold transition-colors', on ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgb(15_23_42/0.08)]' : 'text-slate-500 hover:text-slate-800')}
          >
            {t.label}
            {t.count != null && <span className={cx('rounded-full px-1.5 text-[0.6875rem] font-bold tabular', on ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Export to Excel
// ---------------------------------------------------------------------------------------------

// Downloads the server-built .xlsx for `path` with the page's current filters. The server applies
// the same filters as the list and includes every matching row, not just the visible page.
export function ExportButton({ path, query, label = 'Export to Excel', fallbackName = 'townant-export.xlsx', size = 'md', variant = 'secondary' }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const run = async () => {
    setState({ progress: null });
    try {
      const result = await downloadFile(path, { query, fallbackName, onProgress: (p) => setState({ progress: p }) });
      toast(result.truncated ? `Exported the first ${result.rows.toLocaleString('en-US')} of ${result.total.toLocaleString('en-US')} rows. Narrow the filters to export the rest.` : `Exported ${result.rows != null ? `${result.rows.toLocaleString('en-US')} row${result.rows === 1 ? '' : 's'}` : 'the report'} to ${result.name}`);
    } catch (err) {
      toast(err.message || "The export didn't complete. Please try again.", 'error');
    } finally {
      setState(null);
    }
  };
  const pending = Boolean(state);
  return (
    <Button size={size} variant={variant} onClick={run} pending={pending} icon={<FileSpreadsheet size={16} aria-hidden="true" />} aria-label={pending ? 'Preparing export' : undefined}>
      {pending ? (state.progress != null ? `Downloading ${Math.round(state.progress * 100)}%` : 'Preparing…') : label}
    </Button>
  );
}


// ---------------------------------------------------------------------------------------------
// Status vocabulary — only states that exist in the data model.
// ---------------------------------------------------------------------------------------------

const STATUS = {
  application: { submitted: ['amber', 'New'], under_review: ['amber', 'Under review'], info_requested: ['slate', 'Info requested'], approved: ['green', 'Approved'], rejected: ['red', 'Rejected'] },
  company: { published: ['green', 'Live'], draft: ['amber', 'Draft'], suspended: ['red', 'Suspended'], deleted: ['slate', 'Deleted'] },
  account: { active: ['green', 'Active'], invited: ['amber', 'Invited'], suspended: ['red', 'Suspended'], pending_deletion: ['amber', 'Pending deletion'], deleted: ['slate', 'Deleted'] },
  review: { published: ['green', 'Published'], hidden: ['slate', 'Hidden'] },
  conversation: { open: ['teal', 'Open'], closed: ['slate', 'Closed'] },
  category: { published: ['green', 'Published'], unpublished: ['amber', 'Unpublished'] },
};

export const statusLabel = (kind, status) => STATUS[kind]?.[status]?.[1] ?? String(status ?? '').replaceAll('_', ' ');

export function StatusPill({ kind, status, className }) {
  const [tone] = STATUS[kind]?.[status] ?? ['slate'];
  return (
    <Badge tone={tone} dot className={className}>
      {statusLabel(kind, status)}
    </Badge>
  );
}

// Label/value pairs for detail views.
export function FactList({ items, columns = 2 }) {
  return (
    <dl className={cx('grid gap-x-8 gap-y-4 text-body', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3')}>
      {items.filter(Boolean).map(([label, value, wide]) => (
        <div key={label} className={cx('min-w-0', wide && 'sm:col-span-full')}>
          <dt className="text-caption font-semibold uppercase tracking-[0.06em] text-slate-400">{label}</dt>
          <dd className="mt-1 break-words text-slate-700">{value || <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------------------------

// Counts up from the previous value when the real value changes; static under reduced motion.
export function AnimatedNumber({ value }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const last = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || value == null) return undefined;
    const from = last.current;
    last.current = value;
    if (reduce || from === value) {
      el.textContent = value.toLocaleString('en-US');
      return undefined;
    }
    const controls = animate(from, value, { duration: 0.7, ease: EASE, onUpdate: (v) => (el.textContent = Math.round(v).toLocaleString('en-US')) });
    return () => controls.stop();
  }, [value, reduce]);
  return <span ref={ref}>{value == null ? '—' : reduce ? value.toLocaleString('en-US') : '0'}</span>;
}

// Accent per card: a soft chip behind the icon and the trend colour. Cards themselves stay white so
// the grid reads as one system; colour marks identity, not decoration.
const TONES = {
  teal: { chip: 'bg-teal-50 text-teal-700 ring-teal-100', bar: CHART.teal },
  blue: { chip: 'bg-sky-50 text-sky-700 ring-sky-100', bar: CHART.blue },
  violet: { chip: 'bg-violet-50 text-violet-700 ring-violet-100', bar: CHART.violet },
  amber: { chip: 'bg-amber-50 text-amber-800 ring-amber-100', bar: CHART.amber },
  rose: { chip: 'bg-rose-50 text-rose-700 ring-rose-100', bar: CHART.magenta },
  slate: { chip: 'bg-slate-100 text-slate-700 ring-slate-200', bar: '#64748b' },
};
// Older call sites use these names.
const TONE_ALIAS = { navy: 'slate', info: 'blue', red: 'rose' };

// `feature` cards are the headline row: value, a fixed-height trend (or `footer`) area and context.
// `compact` cards are the queue row. Every card in a row has the same height.
export function KpiCard({ icon: Icon, label, value, hint, to, linkLabel, tone = 'slate', variant = 'compact', trend, footer, loading, error }) {
  const t = TONES[TONE_ALIAS[tone] ?? tone] ?? TONES.slate;
  const feature = variant === 'feature';
  const body = (
    <div className={cx('group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-[border-color,box-shadow] duration-150', to && 'group-hover:border-slate-300 group-hover:shadow-[0_4px_14px_-6px_rgb(15_23_42/0.14)]')}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[0.8125rem] font-medium leading-5 text-slate-600">{label}</span>
        {Icon && (
          <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', t.chip)} aria-hidden="true">
            <Icon size={18} strokeWidth={1.8} />
          </span>
        )}
      </div>
      <div className={cx('flex items-end', feature ? 'mt-2 h-10' : 'mt-1 h-9')}>
        {loading ? <Skeleton className="h-8 w-20" /> : <span className={cx('font-heading font-bold leading-none tracking-[-0.02em] text-slate-900 tabular', feature ? 'text-[2rem]' : 'text-[1.625rem]')}>{error ? '—' : <AnimatedNumber value={value} />}</span>}
      </div>
      {feature && <div className="mt-3 h-10">{!loading && !error && (trend ? <Sparkline values={trend.values} color={t.bar} label={trend.label} /> : footer)}</div>}
      <div className={cx('flex items-center justify-between gap-2 text-caption', feature ? 'mt-3' : 'mt-auto pt-3')}>
        <span className="min-w-0 truncate text-slate-500">{error ? "Couldn't load" : hint}</span>
        {to && (
          <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-slate-700 transition-colors group-hover:text-teal-700">
            {linkLabel ?? 'View'} <ArrowUpRight size={13} aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="group block h-full rounded-xl focus-visible:outline-offset-2" aria-label={`${label}${value != null ? `: ${value}` : ''}. ${linkLabel ?? 'View'}`}>
      {body}
    </Link>
  ) : (
    body
  );
}

// Tiny daily trend inside a feature KPI card. Decorative summary: the full chart sits below it.
function Sparkline({ values, color, label }) {
  const reduce = useReducedMotion();
  if (!values?.length || values.every((v) => v === 0)) return <p className="flex h-full items-center text-caption text-slate-400">No activity in this period yet.</p>;
  const W = 200;
  const H = 40;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * W},${H - 3 - (v / max) * (H - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label={label}>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity="0.08" />
      <motion.polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: EASE }} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Charts (real series only; empty data shows an explicit state, never a placeholder shape)
// ---------------------------------------------------------------------------------------------

// Horizontal proportion bars for a handful of labelled counts (one measure, one colour unless the
// items carry their own identity colours).
export function BarList({ items, emptyLabel = 'Nothing recorded yet.', valueLabel, color = CHART.teal }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.some((i) => i.value > 0)) return <p className="py-6 text-center text-secondary text-slate-500">{emptyLabel}</p>;
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((i, idx) => (
        <li key={i.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-secondary">
            <span className="flex min-w-0 items-center gap-2 text-slate-700">
              {i.color && <span className="size-2 shrink-0 rounded-full" style={{ background: i.color }} aria-hidden="true" />}
              {i.to ? (
                <Link to={i.to} className="truncate hover:text-teal-700 hover:underline">
                  {i.label}
                </Link>
              ) : (
                <span className="truncate">{i.label}</span>
              )}
            </span>
            <span className="font-semibold text-slate-900 tabular" aria-label={valueLabel ? `${i.value} ${valueLabel}` : undefined}>
              {i.value.toLocaleString('en-US')}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <motion.div className="h-full rounded-full" style={{ background: i.color ?? color }} initial={reduce ? false : { width: 0 }} animate={{ width: `${(i.value / max) * 100}%` }} transition={{ duration: 0.6, delay: reduce ? 0 : idx * 0.04, ease: EASE }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// One segmented bar for parts of a whole (e.g. businesses by status).
export function SegmentBar({ items }) {
  const total = items.reduce((n, i) => n + i.value, 0);
  if (!total) return <p className="py-2 text-secondary text-slate-500">None yet.</p>;
  return (
    <div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-slate-100" role="img" aria-label={items.map((i) => `${i.label} ${i.value}`).join(', ')}>
        {items.filter((i) => i.value > 0).map((i) => (
          <span key={i.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(i.value / total) * 100}%`, background: i.color }} />
        ))}
      </div>
      <Legend items={items} className="mt-3" />
    </div>
  );
}

function Legend({ items, className, total }) {
  return (
    <ul className={cx('flex flex-wrap gap-x-5 gap-y-1.5 text-secondary', className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden="true" />
          {i.to ? (
            <Link to={i.to} className="text-slate-600 hover:text-teal-700 hover:underline">
              {i.label}
            </Link>
          ) : (
            <span className="text-slate-600">{i.label}</span>
          )}
          <span className="font-semibold text-slate-900 tabular">{i.value.toLocaleString('en-US')}</span>
          {total ? <span className="text-slate-400 tabular">({Math.round((i.value / total) * 100)}%)</span> : null}
        </li>
      ))}
    </ul>
  );
}

// Parts of a whole as a ring, total in the middle, values always printed in the legend.
export function DonutChart({ items, label, centerLabel = 'Total', size = 168, emptyLabel = 'Nothing recorded yet.' }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(null);
  const total = items.reduce((n, i) => n + i.value, 0);
  const shown = items.filter((i) => i.value > 0);
  if (!total) return <p className="py-8 text-center text-secondary text-slate-500">{emptyLabel}</p>;
  const R = 70;
  const C = 2 * Math.PI * R;
  const GAP = shown.length > 1 ? 2.5 : 0;
  const lengths = shown.map((i) => (i.value / total) * C);
  const arcs = shown.map((i, idx) => ({ ...i, dash: Math.max(0.5, lengths[idx] - GAP), offset: lengths.slice(0, idx).reduce((a, b) => a + b, 0) }));
  const focus = active != null ? arcs[active] : null;
  return (
    // Laid out by the panel's width (container query), so the legend never truncates in a narrow column.
    <figure className="@container">
      <div className="flex flex-col items-center gap-4 @md:flex-row @md:gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 180 180" className="size-full -rotate-90" role="img" aria-label={`${label}: ${shown.map((a) => `${a.label} ${a.value}`).join(', ')}`}>
          <circle cx="90" cy="90" r={R} fill="none" stroke="#f1f5f9" strokeWidth="18" />
          {arcs.map((a, idx) => (
            <motion.circle
              key={a.label}
              cx="90"
              cy="90"
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={active === idx ? 22 : 18}
              strokeDasharray={`${a.dash} ${C}`}
              strokeDashoffset={-a.offset}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: active == null || active === idx ? 1 : 0.35 }}
              transition={{ duration: 0.4, delay: reduce ? 0 : idx * 0.06 }}
              onPointerEnter={() => setActive(idx)}
              onPointerLeave={() => setActive(null)}
              className="cursor-default transition-[stroke-width] duration-150"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">
          <span className="font-heading text-[1.625rem] font-extrabold leading-none text-slate-900 tabular">{(focus?.value ?? total).toLocaleString('en-US')}</span>
          <span className="mt-1 max-w-[6.5rem] truncate text-caption text-slate-500">{focus?.label ?? centerLabel}</span>
        </div>
      </div>
      <figcaption className="w-full min-w-0">
        <ul className="flex flex-col gap-2 text-secondary">
          {items.map((i) => {
            const idx = arcs.findIndex((a) => a.label === i.label);
            const content = (
              <>
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-slate-600">{i.label}</span>
                <span className="font-semibold text-slate-900 tabular">{i.value.toLocaleString('en-US')}</span>
                <span className="w-10 text-right text-slate-400 tabular">{Math.round((i.value / total) * 100)}%</span>
              </>
            );
            const cls = 'flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-slate-50 focus-visible:bg-slate-50';
            return (
              <li key={i.label} onPointerEnter={() => idx >= 0 && setActive(idx)} onPointerLeave={() => setActive(null)}>
                {i.to ? (
                  <Link to={i.to} className={cls} onFocus={() => idx >= 0 && setActive(idx)} onBlur={() => setActive(null)}>
                    {content}
                  </Link>
                ) : (
                  <span className={cls}>{content}</span>
                )}
              </li>
            );
          })}
        </ul>
      </figcaption>
      </div>
    </figure>
  );
}

// Daily columns for one measure (new customers, new businesses, bookings…). Hover or arrow-key
// across the plot to read each day.
export function ColumnChart({ days, values, color = CHART.teal, label, valueLabel = 'count', height = 200 }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(null);
  const boxRef = useRef(null);
  const width = useWidth(boxRef);
  const W = Math.max(280, width || 640);
  const H = height;
  const PAD = { l: 30, r: 8, t: 10, b: 24 };
  const max = niceMax(Math.max(1, ...values));
  const band = (W - PAD.l - PAD.r) / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(28, band - Math.max(2, band * 0.28)));
  const y = (v) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(3, Math.floor(W / 90))));
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return <p className="rounded-xl bg-slate-50 py-14 text-center text-secondary text-slate-500">Nothing recorded in this period yet.</p>;
  return (
    <figure className="flex flex-col gap-2">
      <div ref={boxRef} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          role="img"
          aria-label={`${label}. ${total} in total.`}
          tabIndex={0}
          onPointerLeave={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setActive((a) => Math.min(days.length - 1, (a ?? -1) + 1));
            else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? days.length) - 1));
            else if (e.key === 'Escape') setActive(null);
          }}
          onBlur={() => setActive(null)}
        >
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={t ? '3 4' : undefined} />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {values.map((v, i) => {
            const x = PAD.l + band * i + (band - barW) / 2;
            const h = Math.max(v ? 2 : 0, y(0) - y(v));
            return (
              <g key={days[i]} onPointerEnter={() => setActive(i)}>
                <rect x={PAD.l + band * i} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="transparent" />
                <motion.rect
                  x={x}
                  width={barW}
                  rx={Math.min(4, barW / 2)}
                  fill={color}
                  opacity={active == null || active === i ? 1 : 0.45}
                  initial={reduce ? false : { height: 0, y: y(0) }}
                  animate={{ height: h, y: y(0) - h }}
                  transition={{ duration: 0.5, delay: reduce ? 0 : Math.min(0.4, i * 0.012), ease: EASE }}
                />
              </g>
            );
          })}
          {days.map((d, i) =>
            i % labelEvery === 0 || i === days.length - 1 ? (
              <text key={d} x={PAD.l + band * i + band / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#94a3b8">
                {formatIsoDate(d).slice(0, 5)}
              </text>
            ) : null,
          )}
        </svg>
        {active != null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-caption shadow-lg"
            style={{ left: `${((PAD.l + band * active + band / 2) / W) * 100}%`, transform: `translateX(${(PAD.l + band * active) / W > 0.6 ? 'calc(-100% - 10px)' : '10px'})` }}
          >
            <p className="font-semibold text-slate-900 tabular">{formatIsoDate(days[active])}</p>
            <p className="flex items-center gap-1.5 text-slate-600">
              <span className="size-2 rounded-[2px]" style={{ background: color }} aria-hidden="true" />
              <span className="font-semibold text-slate-900 tabular">{values[active].toLocaleString('en-US')}</span> {valueLabel}
            </p>
          </div>
        )}
      </div>
      <figcaption className="sr-only">{label}. Use the left and right arrow keys on the chart to read each day.</figcaption>
    </figure>
  );
}

// Daily line chart for several series over the same days. Series can be toggled; hovering or
// arrow-keying across the plot shows that day's values.
export function TrendChart({ days, series, height = 240, label }) {
  const reduce = useReducedMotion();
  const [hidden, setHidden] = useState(() => new Set());
  const [active, setActive] = useState(null);
  const plotRef = useRef(null);
  const boxRef = useRef(null);
  const width = useWidth(boxRef);
  const visible = series.filter((s) => !hidden.has(s.key));
  const max = useMemo(() => niceMax(Math.max(1, ...visible.flatMap((s) => s.values))), [visible]);
  // Drawn at the container's real width so labels keep their size on narrow screens.
  const W = Math.max(280, width || 720);
  const H = height;
  const PAD = { l: 34, r: 12, t: 12, b: 26 };
  const x = (i) => PAD.l + (days.length > 1 ? (i / (days.length - 1)) * (W - PAD.l - PAD.r) : (W - PAD.l - PAD.r) / 2);
  const y = (v) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(3, Math.floor(W / 110))));
  const empty = series.every((s) => s.values.every((v) => v === 0));

  const pick = (clientX) => {
    const r = plotRef.current.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (days.length - 1));
    setActive(Math.min(days.length - 1, Math.max(0, i)));
  };

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Series">
        {series.map((s) => {
          const on = !hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setHidden((h) => {
                  const n = new Set(h);
                  if (n.has(s.key)) n.delete(s.key);
                  else n.add(s.key);
                  return n;
                })
              }
              className={cx('inline-flex h-8 items-center gap-2 rounded-full border px-3 text-secondary font-medium transition', on ? 'border-slate-200 bg-white text-slate-800 hover:border-slate-300' : 'border-transparent bg-slate-100 text-slate-400 line-through')}
            >
              <span className="size-2 rounded-full" style={{ background: on ? s.color : '#cbd5e1' }} aria-hidden="true" />
              {s.label}
              <span className="tabular text-slate-500">{s.values.reduce((a, b) => a + b, 0).toLocaleString('en-US')}</span>
            </button>
          );
        })}
      </div>
      {empty ? (
        <p className="rounded-xl bg-slate-50 py-14 text-center text-secondary text-slate-500">No events recorded in this period yet.</p>
      ) : (
        <div ref={boxRef} className="relative">
          <svg
            ref={plotRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            role="img"
            aria-label={label}
            tabIndex={0}
            onPointerMove={(e) => pick(e.clientX)}
            onPointerLeave={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') setActive((a) => Math.min(days.length - 1, (a ?? -1) + 1));
              else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? days.length) - 1));
              else if (e.key === 'Escape') setActive(null);
            }}
            onBlur={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={t ? '3 4' : undefined} />
                <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
                  {Math.round(t)}
                </text>
              </g>
            ))}
            {days.map((d, i) =>
              i % labelEvery === 0 || i === days.length - 1 ? (
                <text key={d} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#94a3b8">
                  {formatIsoDate(d).slice(0, 5)}
                </text>
              ) : null,
            )}
            {visible.map((s) => {
              const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
              return (
                <g key={s.key}>
                  <polygon points={`${x(0)},${y(0)} ${pts} ${x(days.length - 1)},${y(0)}`} fill={s.color} opacity={visible.length === 1 ? 0.1 : 0.04} />
                  <motion.polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts} initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.8, ease: EASE }} />
                </g>
              );
            })}
            {active != null && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={H - PAD.b} stroke="#0f172a" strokeOpacity="0.2" />
                {visible.map((s) => (
                  <circle key={s.key} cx={x(active)} cy={y(s.values[active])} r="4" fill="white" stroke={s.color} strokeWidth="2" />
                ))}
              </g>
            )}
          </svg>
          {active != null && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-caption shadow-lg"
              style={{ left: `${(x(active) / W) * 100}%`, transform: `translateX(${x(active) / W > 0.6 ? 'calc(-100% - 10px)' : '10px'})` }}
            >
              <p className="mb-1 font-semibold text-slate-900 tabular">{formatIsoDate(days[active])}</p>
              {visible.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                    {s.label}
                  </span>
                  <span className="font-semibold text-slate-900 tabular">{s.values[active]}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <figcaption className="sr-only">{label}. Use the left and right arrow keys on the chart to read each day.</figcaption>
    </figure>
  );
}

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
