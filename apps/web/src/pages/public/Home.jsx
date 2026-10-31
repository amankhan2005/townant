import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, CalendarCheck2, ImageUp, MessageSquare, ShieldCheck, Store } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Carousel, CarouselSkeleton, SectionHeader } from '../../components/Carousel.jsx';
import { CompanyCard } from '../../components/CompanyCard.jsx';
import { SearchBar } from '../../components/SearchBar.jsx';
import { PromoBanner } from '../../components/PromoBanner.jsx';
import { SpotlightCard } from '../../components/SpotlightCard.jsx';
import { AppSection, HowItWorks, VendorSection } from './HomeSections.jsx';
import { cx, EmptyState, ErrorState, InlineError, Skeleton } from '../../components/ui.jsx';
import { useFavorites } from '../../lib/favorites.js';
import { imageUrl } from '../../lib/format.js';
import { CategoryIcon } from '../../lib/icons.js';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDocumentTitle, usePageMeta } from '../../lib/hooks.js';
import { cleanQuery, locationLabel, locationQuery, useSearchLocation } from '../../lib/location.js';

// Every section loads independently from the API. A failing section shows its own error (or is
// omitted when it is optional); the hero heading never depends on data.
export default function Home() {
  useDocumentTitle('');
  usePageMeta({ description: 'Find trusted local businesses near you, compare their services and real availability, and book online with TownAnt.' });
  const favorites = useFavorites();
  const { hash } = useLocation();
  const { location } = useSearchLocation();
  const near = cleanQuery(locationQuery(location));
  const site = useApi('/catalog/site');
  const categories = useApi('/catalog/categories');
  const spotlight = useApi('/catalog/spotlight', { query: { limit: 8 } });
  const mostBooked = useApi('/catalog/most-booked', { query: { limit: 10, ...near } });
  const newest = useApi('/catalog/companies', { query: { sort: 'newest', limit: 10, ...near } });
  const where = location ? locationLabel(location) : null;

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  return (
    <>
      <Hero hero={site.data?.hero ?? null} heroLoading={!site.data && !site.error} onHeroPublished={(published) => site.setData((d) => ({ ...d, hero: published }))} />
      <CategoryBand state={categories} />

      <div className="gutter mx-auto flex max-w-7xl flex-col gap-16 pb-4 pt-14 md:gap-20 md:pt-16">
        <Row
          id="new"
          title="New and noteworthy"
          subtitle={where ? `Recently published businesses near ${where}.` : 'Businesses recently published on TownAnt.'}
          more={`/search?${new URLSearchParams({ sort: 'newest', ...near })}`}
          state={newest}
          favorites={favorites}
          emptyTitle={where ? `No businesses near ${where} yet` : 'No businesses here yet'}
          emptyBody="TownAnt is growing. Try another location, or check back soon as new businesses join."
        />

        {/* Super Admin-managed; directly below "New and noteworthy", omitted until one is published. */}
        <PromoBanner banner={site.data?.banner} />

        <Spotlight state={spotlight} />

        <Row
          id="most-booked"
          title={where ? `Most booked near ${where}` : 'Most booked on TownAnt'}
          subtitle="Ranked by confirmed and completed bookings in the last 90 days."
          state={mostBooked}
          favorites={favorites}
          hideWhenEmpty
        />

        <HowItWorks />

        <AppSection />

        <VendorSection />
      </div>
    </>
  );
}

// How many published top-level categories the category band shows before "All categories".
const BAND_CATEGORIES = 8;

// Licensed photo (docs/ASSETS.md) shown until a Super Admin publishes a hero image.
const FALLBACK_HERO = { src: (w) => `/images/hero/sofa-phone-${w}.jpg`, widths: [640, 1000], alt: 'A woman relaxing on her sofa, browsing local services on her phone', focal: { x: 50, y: 40 } };

// Product facts only (how TownAnt works), never metrics or claims about volume.
const HERO_POINTS = [
  [CalendarCheck2, 'Book real openings from each business’s calendar'],
  [MessageSquare, 'Message businesses before you book'],
  [ShieldCheck, 'No payment through TownAnt — you pay the business directly'],
];

// Super Admin-only, loaded on demand (visitors never download it).
const HeroEditor = lazy(() => import('./HeroEditor.jsx'));

// Hero: the copy is part of the frontend; the photo is the hero image a Super Admin publishes from
// here (SiteSettings.hero), else the bundled licensed photo. Never the promotional banner.
function Hero({ hero, heroLoading, onHeroPublished }) {
  const reduce = useReducedMotion();
  const { user, mfaRequired } = useAuth();
  const { search } = useLocation();
  const canEdit = user?.role === 'super_admin' && !mfaRequired;
  const [editing, setEditing] = useState(() => new URLSearchParams(search).get('edit') === 'hero');
  const enter = (delay) => (reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] } });
  return (
    <section aria-labelledby="hero-heading" className="bg-white">
      <div className="gutter mx-auto grid max-w-7xl items-center gap-10 py-10 md:py-14 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-14 lg:py-20">
        <div className="flex min-w-0 flex-col">
          <motion.p {...enter(0)} className="text-caption font-semibold uppercase tracking-[0.12em] text-teal-700">
            Local services, booked directly
          </motion.p>
          <motion.h1 id="hero-heading" {...enter(0.04)} className="mt-5 font-heading text-[2.375rem] font-extrabold leading-[1.06] tracking-[-0.03em] text-navy sm:text-[3rem] xl:text-[3.5rem]">
            Find local. <span className="block text-teal">Book confidently.</span>
          </motion.h1>
          <motion.p {...enter(0.08)} className="mt-4 max-w-lg text-[1.0625rem] leading-relaxed text-muted">
            Discover trusted local businesses, compare their services and real availability, and book the time that suits you.
          </motion.p>
          <motion.div {...enter(0.12)} className="mt-8 max-w-2xl">
            <SearchBar variant="hero" />
          </motion.div>
          <motion.ul {...enter(0.16)} className="mt-7 grid gap-3 sm:grid-cols-3 sm:gap-5">
            {HERO_POINTS.map(([Icon, text]) => (
              <li key={text} className="flex items-start gap-2.5 text-[0.875rem] leading-snug text-slate">
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" className="mt-px shrink-0 text-teal" />
                {text}
              </li>
            ))}
          </motion.ul>
        </div>
        <motion.div {...enter(0.1)} className="relative min-w-0">
          <HeroImage hero={hero} loading={heroLoading} />
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="absolute right-3 top-3 inline-flex h-10 items-center gap-2 rounded-md bg-white px-3.5 text-[0.875rem] font-semibold text-navy shadow-raised ring-1 ring-line transition-colors hover:bg-cloud">
              <ImageUp size={16} aria-hidden="true" /> Edit hero image
            </button>
          )}
        </motion.div>
      </div>
      {canEdit && editing && (
        <Suspense fallback={null}>
          <HeroEditor hero={hero} onPublished={onHeroPublished} onClose={() => setEditing(false)} />
        </Suspense>
      )}
    </section>
  );
}

const heroImageClass = 'aspect-[4/3] w-full rounded-xl sm:aspect-[16/10] lg:aspect-[5/4]';

// The published hero image, else the bundled licensed photo; nothing if both fail.
function HeroImage({ hero, loading }) {
  const [failures, setFailures] = useState(0);
  if (loading) return <Skeleton className={heroImageClass} />;
  const sources = [
    hero && { src: (w) => imageUrl(hero.image.url, { w }), widths: [800, 1200, 1600], alt: hero.alt, focal: hero.focal },
    FALLBACK_HERO,
  ].filter(Boolean);
  const pick = sources[failures];
  if (!pick) return null;
  return (
    <img
      key={failures}
      src={pick.src(pick.widths.at(-1))}
      srcSet={pick.widths.map((w) => `${pick.src(w)} ${w}w`).join(', ')}
      sizes="(min-width: 1280px) 600px, (min-width: 1024px) 46vw, 100vw"
      alt={pick.alt}
      width="1000"
      height="800"
      fetchPriority="high"
      decoding="async"
      onError={() => setFailures((n) => n + 1)}
      style={{ objectPosition: `${pick.focal.x}% ${pick.focal.y}%` }}
      className={cx(heroImageClass, 'bg-cloud object-cover')}
    />
  );
}

// The first published top-level categories (Super Admin order), from the category API. Fewer
// published categories means fewer tiles — never filler.
const BAND_GRID = 'grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8 sm:gap-4';

function CategoryBand({ state }) {
  const parents = state.data?.filter((c) => !c.parentId) ?? [];
  if (state.data && parents.length === 0) return null;
  return (
    <section aria-labelledby="categories-heading" className="border-y border-line bg-cloud/60">
      <div className="gutter mx-auto max-w-7xl py-10 md:py-12">
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 id="categories-heading" className="text-[1.375rem] font-bold text-navy md:text-[1.5rem]">
            Explore services by category
          </h2>
          <Link to="/categories" className="group inline-flex shrink-0 items-center gap-1 text-[0.9375rem] font-semibold text-teal-700 hover:text-teal">
            All categories <ArrowRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        </div>
        {state.error && !state.data ? (
          <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-muted">
            Categories didn’t load.
            <button type="button" onClick={state.reload} className="font-semibold text-teal-700 underline-offset-4 hover:underline">
              Try again
            </button>
          </p>
        ) : !state.data ? (
          <ul className={BAND_GRID} role="status" aria-busy="true" aria-label="Loading categories">
            {Array.from({ length: BAND_CATEGORIES }, (_, i) => (
              <li key={i} aria-hidden="true">
                <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                <Skeleton className="mx-auto mt-2.5 h-4 w-2/3" />
              </li>
            ))}
          </ul>
        ) : (
          <ul className={BAND_GRID}>
            {parents.slice(0, BAND_CATEGORIES).map((c) => (
              <li key={c.id}>
                <CategoryTile category={c} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// The image a Super Admin uploaded for the category; without one, its line icon on a quiet tile.
function CategoryTile({ category }) {
  const image = category.image;
  return (
    <Link to={`/search?category=${encodeURIComponent(category.slug)}`} className="group flex flex-col gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 focus-visible:ring-offset-4 focus-visible:ring-offset-cloud">
      <span className="relative block aspect-[4/3] overflow-hidden rounded-lg bg-white ring-1 ring-inset ring-line transition-shadow group-hover:shadow-raised">
        {image ? (
          <img
            src={imageUrl(image.url, { w: 320, h: 240 })}
            srcSet={`${imageUrl(image.url, { w: 320, h: 240 })} 320w, ${imageUrl(image.url, { w: 560, h: 420 })} 560w`}
            sizes="(min-width: 1024px) 150px, (min-width: 640px) 25vw, 50vw"
            alt={image.alt || ''}
            width="320"
            height="240"
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
          />
        ) : (
          <span className="flex size-full items-center justify-center" aria-hidden="true">
            <CategoryIcon name={category.icon} size={28} strokeWidth={1.5} className="text-teal-700" />
          </span>
        )}
      </span>
      <span className="line-clamp-2 text-center text-[0.875rem] font-semibold leading-snug text-navy transition-colors group-hover:text-teal-700">{category.name}</span>
    </Link>
  );
}

function Spotlight({ state }) {
  if (state.error && !state.data) return null;
  if (!state.data) {
    return (
      <section aria-label="Loading spotlight">
        <Skeleton className="mb-5 h-7 w-48" />
        <div className="-mx-4 flex gap-4 overflow-hidden px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0" role="status" aria-busy="true">
          <span className="sr-only">Loading spotlight…</span>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-[86%] shrink-0 rounded-xl sm:aspect-[16/10] sm:w-[440px]" />
          ))}
        </div>
      </section>
    );
  }
  if (state.data.length === 0) return null;
  return (
    <section aria-labelledby="spotlight-heading">
      <SectionHeader id="spotlight-heading" title="In the spotlight" subtitle="Businesses featured by the TownAnt team." />
      <Carousel label="Spotlight" itemClassName="w-[86%] sm:w-[440px]">
        {state.data.map((c) => (
          <SpotlightCard key={c.id} company={c} />
        ))}
      </Carousel>
    </section>
  );
}

function Row({ id, title, subtitle, more, state, favorites, emptyTitle, emptyBody, hideWhenEmpty }) {
  if (state.error && !state.data) {
    return (
      <section aria-labelledby={id}>
        <SectionHeader id={id} title={title} />
        <ErrorState compact error={state.error} onRetry={state.reload} title={`${title} didn't load`} />
      </section>
    );
  }
  if (state.data && state.data.length === 0 && hideWhenEmpty) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHeader id={id} title={title} subtitle={subtitle} more={state.data?.length ? more : undefined} />
      {state.error && (
        <div className="mb-3">
          <InlineError error={state.error} onRetry={state.reload} />
        </div>
      )}
      {!state.data ? (
        <CarouselSkeleton label={`Loading ${title.toLowerCase()}`} />
      ) : state.data.length === 0 ? (
        <EmptyState compact icon={Store} title={emptyTitle} body={emptyBody} action={<Link to="/search" className="font-semibold text-teal-700">Browse all businesses</Link>} />
      ) : (
        <Carousel label={title}>
          {state.data.map((c) => (
            <CompanyCard key={c.id} company={c} favorite={favorites.ids.has(c.id)} onToggleFavorite={favorites.toggle} />
          ))}
        </Carousel>
      )}
    </section>
  );
}
