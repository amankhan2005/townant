import { BOOKING_STATUS_LABELS, BOOKING_STATUS_TONE, VENDOR_BOOKING_STATUS_LABELS } from '@townant/shared';
import { Star } from 'lucide-react';
import { Link } from 'react-router';
import { MetricSkeleton } from './skeleton.jsx';

export const cx = (...c) => c.filter(Boolean).join(' ');

const BUTTON = {
  primary: 'bg-teal text-white shadow-card hover:bg-teal-700 active:bg-teal-700 disabled:bg-teal/45 disabled:shadow-none',
  secondary: 'bg-white text-navy ring-1 ring-inset ring-line-strong hover:bg-cloud active:bg-line/60 disabled:text-subtle',
  amber: 'bg-amber text-navy shadow-card hover:brightness-[0.96] active:brightness-90 disabled:opacity-60',
  ghost: 'text-teal-700 hover:bg-teal-50 active:bg-teal-100 disabled:text-subtle',
  danger: 'bg-danger text-white shadow-card hover:brightness-95 active:brightness-90 disabled:opacity-60',
  'danger-ghost': 'text-danger hover:bg-danger-50 disabled:opacity-50',
  dark: 'bg-navy text-white shadow-card hover:bg-navy-800 disabled:opacity-60',
};
const SIZE = { sm: 'h-9 px-3 text-secondary', md: 'h-11 px-4 text-body', lg: 'h-12 px-6 text-body' };

export function Button({ variant = 'primary', size = 'md', pending, className, children, icon, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || pending}
      aria-busy={pending || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md font-semibold transition duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        BUTTON[variant],
        SIZE[size],
        className,
      )}
    >
      {pending ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className = 'size-5', label }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className, children, as: As = 'div', ...props }) {
  return (
    <As className={cx('rounded-card border border-line bg-white shadow-card', className)} {...props}>
      {children}
    </As>
  );
}

export function SectionCard({ title, description, actions, children, className }) {
  return (
    <Card className={cx('p-5 sm:p-6', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-card font-semibold text-navy">{title}</h2>}
            {description && <p className="subtitle mt-0.5 text-secondary">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Card>
  );
}

const TONES = {
  teal: 'bg-teal-50 text-teal-700 ring-teal/15',
  amber: 'bg-amber-50 text-amber-text ring-amber/30',
  navy: 'bg-navy text-white ring-navy',
  slate: 'bg-cloud text-muted ring-line',
  red: 'bg-danger-50 text-danger ring-danger/15',
  green: 'bg-teal-50 text-success ring-success/15',
};

export function Badge({ tone = 'slate', children, className, dot }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-caption font-semibold ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

// Status is conveyed by text, not colour alone.
export function StatusBadge({ status, audience = 'customer' }) {
  const labels = audience === 'vendor' ? VENDOR_BOOKING_STATUS_LABELS : BOOKING_STATUS_LABELS;
  return (
    <Badge tone={BOOKING_STATUS_TONE[status] ?? 'slate'} dot>
      {labels[status] ?? status}
    </Badge>
  );
}

export function Stars({ value, size = 'sm' }) {
  const full = Math.round(value);
  const px = { sm: 14, md: 16, lg: 18, 'text-sm': 14, 'text-lg': 18 }[size] ?? 14;
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={px} strokeWidth={1.5} aria-hidden="true" className={i < full ? 'fill-amber text-amber' : 'fill-line text-line-strong'} />
      ))}
    </span>
  );
}

// Compact rating: "4.8 (120)". Unrated businesses read "No reviews yet", never zero stars.
export function RatingInline({ rating, className }) {
  if (!rating) return null;
  if (!rating.count) return <span className={cx('text-secondary text-muted', className)}>No reviews yet</span>;
  return (
    <span className={cx('inline-flex items-center gap-1 text-secondary', className)} aria-label={`Rated ${rating.average.toFixed(1)} out of 5 from ${rating.count} reviews`}>
      <Star size={14} aria-hidden="true" className="fill-amber text-amber" />
      <span className="font-semibold text-navy tabular">{rating.average.toFixed(1)}</span>
      <span className="text-muted tabular">({rating.count.toLocaleString('en-US')})</span>
    </span>
  );
}

export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-secondary text-muted">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.to ? (
              <Link to={item.to} className="font-medium text-teal-700 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-slate">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }) {
  return (
    <div className="mb-6">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-extrabold text-navy">{title}</h1>
          {subtitle && <p className="subtitle mt-1.5 text-body">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// Segmented tabs (role=tablist). `value`/`onChange` keep state with the caller.
export function Tabs({ tabs, value, onChange, label }) {
  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.value === value);
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].value);
    e.currentTarget.querySelectorAll('[role=tab]')[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="inline-flex rounded-md bg-line/60 p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          tabIndex={value === t.value ? 0 : -1}
          onClick={() => onChange(t.value)}
          className={cx('rounded-sm px-3.5 py-1.5 text-secondary font-semibold transition', value === t.value ? 'bg-white text-navy shadow-card' : 'text-muted hover:text-navy')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-subtle tabular">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function MetricCard({ label, value, hint, to, loading, tone = 'navy' }) {
  if (loading) return <MetricSkeleton />;
  const body = (
    <Card className={cx('flex h-full flex-col gap-1 p-4 transition', to && 'hover:border-teal/40 hover:shadow-raised')}>
      <span className="text-secondary font-medium text-muted">{label}</span>
      <span className={cx('text-title font-extrabold tabular', tone === 'teal' ? 'text-teal-700' : 'text-navy')}>{value}</span>
      {hint && <span className="text-caption text-subtle">{hint}</span>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-card">
      {body}
    </Link>
  ) : (
    body
  );
}

// `bare` drops the outer card so the table can sit inside a panel that supplies its own frame.
export function Table({ columns, rows, empty, rowKey = 'id', onRowClick, caption, bare }) {
  if (!rows?.length) return empty ?? null;
  return (
    // `relative` keeps absolutely positioned descendants (e.g. sr-only header labels) inside the
    // scroll container; otherwise they escape it and widen the page on phones.
    <div className={cx('relative overflow-x-auto', !bare && 'rounded-card border border-line bg-white shadow-card')}>
      <table className="w-full text-left text-secondary">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-b border-line bg-cloud/70 text-caption uppercase tracking-wide text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('whitespace-nowrap px-4 py-3 font-semibold', c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr
              key={r[rowKey]}
              className={cx('transition-colors', onRowClick && 'cursor-pointer hover:bg-teal-50/40 focus-within:bg-teal-50/40')}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && e.target === e.currentTarget && onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('px-4 py-3 align-top text-slate', c.align === 'right' && 'text-right', c.className)}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ meta, onPage, className = 'pt-4' }) {
  if (!meta || meta.pages <= 1) return null;
  return (
    <nav className={cx('flex flex-wrap items-center justify-between gap-3 text-secondary', className)} aria-label="Pagination">
      <span className="text-muted tabular">
        Page {meta.page} of {meta.pages} · {meta.total.toLocaleString('en-US')} total
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          ← Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>
          Next →
        </Button>
      </div>
    </nav>
  );
}

export function Tooltip({ label, children }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-navy px-2 py-1 text-caption text-white opacity-0 shadow-pop transition group-focus-within:opacity-100 group-hover:opacity-100">
        {label}
      </span>
    </span>
  );
}

// Visible list of active filters, each removable.
export function ActiveFilters({ filters, onClear }) {
  if (!filters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {filters.map((f) => (
        <button key={f.key} type="button" onClick={f.onRemove} className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 py-1 pl-3 pr-2 text-secondary font-medium text-teal-700 ring-1 ring-inset ring-teal/20 hover:bg-teal-100" aria-label={`Remove filter ${f.label}`}>
          {f.label}
          <span aria-hidden="true">×</span>
        </button>
      ))}
      {filters.length > 1 && onClear && (
        <button type="button" onClick={onClear} className="text-secondary font-semibold text-muted hover:text-navy">
          Clear all
        </button>
      )}
    </div>
  );
}
