import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { cx, Skeleton } from './ui.jsx';

// Horizontal row with scroll snapping. Prev/next buttons appear only when there is more to
// scroll; the row itself is focusable so keyboard users can scroll it with arrow keys.
export function Carousel({ label, children, itemClassName = 'w-[78%] sm:w-[280px]' }) {
  const ref = useRef(null);
  const id = useId();
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const page = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  const arrow = 'absolute top-[38%] z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-navy shadow-raised transition hover:scale-105 hover:text-teal-700 md:flex';

  return (
    <div className="relative" role="region" aria-roledescription="carousel" aria-label={label}>
      {!edges.start && (
        <button type="button" onClick={() => page(-1)} aria-controls={id} aria-label={`Previous ${label}`} className={cx(arrow, 'left-2')}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
      )}
      <ul
        id={id}
        ref={ref}
        tabIndex={0}
        onScroll={measure}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-teal/30 md:mx-0 md:scroll-px-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {(Array.isArray(children) ? children : [children]).flat().filter(Boolean).map((child, i) => (
          <li key={child.key ?? i} className={cx('shrink-0 snap-start', itemClassName)}>
            {child}
          </li>
        ))}
      </ul>
      {!edges.end && (
        <button type="button" onClick={() => page(1)} aria-controls={id} aria-label={`Next ${label}`} className={cx(arrow, 'right-2')}>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function CarouselSkeleton({ count = 4, label = 'Loading', tall }) {
  return (
    <div role="status" aria-busy="true" className="-mx-4 flex gap-4 overflow-hidden px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-[78%] shrink-0 sm:w-[280px]" aria-hidden="true">
          <Skeleton className={cx('w-full rounded-card', tall ? 'aspect-[4/3]' : 'aspect-[4/3]')} />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function SectionHeader({ id, title, subtitle, more, moreLabel = 'See all' }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="text-[1.375rem] font-bold leading-tight text-navy md:text-[1.75rem]">
          {title}
        </h2>
        {subtitle && <p className="subtitle mt-1.5 text-body">{subtitle}</p>}
      </div>
      {more && (
        <Link to={more} className="group -mr-2 inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-secondary font-semibold text-teal-700 transition hover:bg-teal-50">
          {moreLabel}
          <ArrowRight size={15} aria-hidden="true" className="transition group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
