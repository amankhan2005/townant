// Skeletons mirror the shape of the content they stand in for, so nothing jumps when data
// arrives. Each group announces "Loading" once to assistive technology.
const cx = (...c) => c.filter(Boolean).join(' ');

export function Skeleton({ className, style }) {
  return <div className={cx('skeleton rounded-sm', className)} style={style} aria-hidden="true" />;
}

export function LoadingRegion({ label = 'Loading', className, children }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

export function TextSkeleton({ lines = 3, className }) {
  return (
    <div className={cx('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

// Same proportions as CompanyCard: 4:3 image, then name, category and rating lines.
export function CompanyCardSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="skeleton aspect-[4/3]" />
      <div className="flex flex-col gap-2 px-4 pb-4 pt-3.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function CardGridSkeleton({ count = 6, className = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3', label = 'Loading businesses' }) {
  return (
    <LoadingRegion label={label} className={className}>
      {Array.from({ length: count }, (_, i) => (
        <CompanyCardSkeleton key={i} />
      ))}
    </LoadingRegion>
  );
}

export function CategoryGridSkeleton({ count = 8 }) {
  return (
    <LoadingRegion label="Loading categories" className="grid grid-cols-4 gap-3 md:grid-cols-8">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col items-center gap-2 rounded-card border border-line bg-white p-3" aria-hidden="true">
          <Skeleton className="size-12 rounded-md" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function ListSkeleton({ rows = 4, avatar = true, label = 'Loading' }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-card border border-line bg-white p-4 shadow-card" aria-hidden="true">
          {avatar && <Skeleton className="size-12 rounded-md" />}
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function TableSkeleton({ columns = 4, rows = 6, label = 'Loading table', bare }) {
  return (
    <LoadingRegion label={label} className={cx('overflow-hidden', !bare && 'rounded-card border border-line bg-white shadow-card')}>
      <div className="flex gap-4 border-b border-line bg-cloud/70 px-4 py-3" aria-hidden="true">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-line px-4 py-4 last:border-0" aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cx('h-3.5 flex-1', c === 0 && 'max-w-[40%]')} />
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}

export function MetricSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2.5 rounded-card border border-line bg-white p-4 shadow-card" aria-hidden="true">
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

export function MetricsSkeleton({ count = 4, className = 'grid grid-cols-2 gap-4 lg:grid-cols-4' }) {
  return (
    <LoadingRegion label="Loading metrics" className={className}>
      {Array.from({ length: count }, (_, i) => (
        <MetricSkeleton key={i} />
      ))}
    </LoadingRegion>
  );
}

export function DetailSkeleton({ label = 'Loading details' }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <div className="rounded-card border border-line bg-white p-6 shadow-card" aria-hidden="true">
        <div className="flex justify-between">
          <div className="flex w-2/3 flex-col gap-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-2">
          <Skeleton className="h-11 w-32 rounded-md" />
          <Skeleton className="h-11 w-32 rounded-md" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function ProfileSkeleton() {
  return (
    <LoadingRegion label="Loading business" className="mx-auto max-w-6xl gutter py-6">
      <Skeleton className="h-44 w-full rounded-xl md:h-64" />
      <div className="relative -mt-10 flex items-end gap-4 px-2 md:px-6" aria-hidden="true">
        <Skeleton className="size-20 rounded-xl ring-4 ring-white md:size-24" />
        {/* Flexible column: fixed-width bars here made the page wider than narrow phones while loading,
            which shifted fixed elements (bottom tabs, "Ask TownAnt") past the screen edge. */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 pb-1">
          <Skeleton className="h-7 w-full max-w-64" />
          <Skeleton className="h-4 w-2/3 max-w-40" />
        </div>
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]" aria-hidden="true">
        <div className="flex flex-col gap-3">
          <TextSkeleton lines={3} />
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-card" />
      </div>
    </LoadingRegion>
  );
}

export function ThreadSkeleton() {
  return (
    <LoadingRegion label="Loading conversation" className="flex flex-col gap-3 p-4">
      {[60, 45, 70, 35].map((w, i) => (
        <div key={i} className={cx('flex', i % 2 ? 'justify-end' : 'justify-start')} aria-hidden="true">
          <Skeleton className="h-12 rounded-xl" style={{ width: `${w}%` }} />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function ReviewSkeleton({ count = 3 }) {
  return (
    <LoadingRegion label="Loading reviews" className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-card border border-line bg-white p-4 shadow-card" aria-hidden="true">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="mt-2 h-3 w-20" />
          <TextSkeleton lines={2} className="mt-3" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function SlotSkeleton({ count = 8 }) {
  return (
    <LoadingRegion label="Loading available times" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-11 rounded-md" />
      ))}
    </LoadingRegion>
  );
}

export function FormSkeleton({ fields = 4 }) {
  return (
    <LoadingRegion label="Loading form" className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-11 rounded-md" />
        </div>
      ))}
    </LoadingRegion>
  );
}
