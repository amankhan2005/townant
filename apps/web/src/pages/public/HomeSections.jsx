import { ArrowRight, CalendarCheck, CalendarClock, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { StoreBadges } from '../../components/StoreBadges.jsx';
import { cx } from '../../components/ui.jsx';

// ---------------------------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------------------------

const STEPS = [
  [Search, 'Discover a service', 'Search by service, category, or business name and explore options that match your needs.'],
  [CalendarClock, 'Choose an available time', 'View the business’s actual availability and select a time that works for you.'],
  [ShieldCheck, 'Confirm your appointment', 'Verify your account using email or WhatsApp, review your booking, and submit it when you’re ready.'],
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="max-w-xl">
          <h2 id="how-heading" className="text-[1.75rem] font-extrabold leading-[1.15] text-navy md:text-[2.25rem]">
            How TownAnt Works
          </h2>
          <p className="subtitle mt-2 text-[1.0625rem] leading-relaxed">Finding and booking trusted local services is simple.</p>
        </div>
        <Link to="/search" className="group inline-flex h-11 items-center gap-2 rounded-md border border-line-strong bg-white px-5 font-semibold text-navy transition hover:border-navy/40 hover:bg-cloud">
          Explore services <ArrowRight size={17} aria-hidden="true" className="transition group-hover:translate-x-0.5" />
        </Link>
      </div>
      <ol className="mt-10 grid gap-x-10 gap-y-9 md:mt-12 md:grid-cols-3 lg:gap-x-14">
        {STEPS.map(([Icon, title, body], i) => (
          <li key={title} className="group relative border-t border-line pt-7">
            <span className="absolute -top-px left-0 h-0.5 w-10 bg-teal transition-[width] duration-300 ease-out-soft group-hover:w-20" aria-hidden="true" />
            <div className="flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-md border border-line bg-white text-teal-700 transition group-hover:border-teal/40 group-hover:bg-teal-50">
                <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className="tabular font-heading text-[0.9375rem] font-bold tracking-[0.04em] text-subtle" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
            <h3 className="mt-5 font-heading text-[1.1875rem] font-bold text-navy">
              <span className="sr-only">Step {i + 1}: </span>
              {title}
            </h3>
            <p className="mt-2 max-w-sm text-body leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Mobile app
// ---------------------------------------------------------------------------------------------

// Only claims what the Expo app does (apps/mobile: discovery, categories, booking, bookings).
const APP_FEATURES = [
  [Search, 'Find businesses by service, category or location'],
  [CalendarClock, 'Book from each business’s real open times'],
  [CalendarCheck, 'Keep track of your upcoming appointments'],
];

// The phones show unedited screenshots of the Android app (Home and Categories tabs), captured
// against a database holding only TownAnt's starter categories — no listings, so no business,
// rating or booking appears that isn't real. Store badges follow lib/config.js.
export function AppSection() {
  return (
    <section aria-labelledby="app-heading" className="grid overflow-hidden rounded-xl border border-line bg-white lg:grid-cols-[1.05fr_1fr]">
      <div className="px-6 py-12 sm:px-10 md:py-14 lg:py-16 lg:pl-14 lg:pr-6">
        <p className="text-caption font-semibold uppercase tracking-[0.12em] text-teal-700">The TownAnt app</p>
        <h2 id="app-heading" className="mt-3 text-[2rem] font-extrabold leading-[1.08] text-navy md:text-[2.25rem]">
          TownAnt, wherever you go.
        </h2>
        <p className="subtitle mt-4 max-w-md text-[1.0625rem] leading-relaxed">Discover local businesses and manage your appointments on the go with the TownAnt mobile app.</p>
        <ul className="mt-8 flex flex-col gap-3.5">
          {APP_FEATURES.map(([Icon, label]) => (
            <li key={label} className="flex items-center gap-3 text-body text-slate">
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-teal" />
              {label}
            </li>
          ))}
        </ul>
        <StoreBadges className="mt-9" />
      </div>

      <figure className="relative h-[420px] overflow-hidden bg-teal-50 sm:h-[480px] lg:h-auto lg:min-h-[540px]">
        <PhoneShot src="/images/app/categories.jpg" alt="The Categories screen of the TownAnt app" className="left-1/2 top-[4.5rem] w-[46%] max-w-[212px] translate-x-[10%] lg:top-24" />
        <PhoneShot src="/images/app/home.jpg" alt="The Home screen of the TownAnt app, with search and categories" className="left-1/2 top-9 w-[52%] max-w-[244px] -translate-x-[90%] lg:top-12" />
        <figcaption className="sr-only">Screens from the TownAnt Android app</figcaption>
      </figure>
    </section>
  );
}

function PhoneShot({ src, alt, className }) {
  return (
    <div className={cx('absolute rounded-[2.4rem] bg-navy p-[7px] shadow-raised ring-1 ring-navy/10', className)}>
      <img src={src} alt={alt} width="540" height="1200" loading="lazy" decoding="async" className="block aspect-[9/20] w-full rounded-[2rem] bg-cloud object-cover" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------------------------

// Photo: "Woman paying at shop counter" by Christiann Koepke, Unsplash License (docs/ASSETS.md).
// Served from our origin; if it fails to load, the navy panel alone keeps the text readable.
const VENDOR_PHOTO = (w) => `/images/vendor/shop-counter-${w}.webp`;

export function VendorSection() {
  const [failed, setFailed] = useState(false);
  return (
    <section aria-labelledby="vendor-heading" className="relative isolate flex min-h-[600px] overflow-hidden rounded-xl bg-navy text-white sm:min-h-[520px] md:min-h-[440px] lg:min-h-[480px]">
      {!failed && (
        <img
          src={VENDOR_PHOTO(1400)}
          srcSet={`${VENDOR_PHOTO(800)} 800w, ${VENDOR_PHOTO(1400)} 1400w, ${VENDOR_PHOTO(2200)} 2200w`}
          sizes="(min-width: 1280px) 1248px, 100vw"
          alt=""
          width="1400"
          height="933"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 -z-20 size-full object-cover object-[66%_30%] md:object-[60%_35%]"
        />
      )}
      {/* Darkens only where the text sits: the bottom on phones, the left side from tablet up. */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(20_36_58/0.1)_0%,rgb(20_36_58/0.35)_32%,rgb(20_36_58/0.88)_52%,rgb(20_36_58/0.95)_100%)] md:bg-[linear-gradient(90deg,rgb(20_36_58/0.95)_0%,rgb(20_36_58/0.88)_45%,rgb(20_36_58/0.45)_70%,rgb(20_36_58/0.08)_100%)] lg:bg-[linear-gradient(90deg,rgb(20_36_58/0.95)_0%,rgb(20_36_58/0.86)_38%,rgb(20_36_58/0.35)_68%,rgb(20_36_58/0.05)_100%)]" aria-hidden="true" />
      <div className="flex max-w-xl flex-col justify-end px-6 py-10 sm:px-10 md:justify-center md:py-14 lg:px-14">
        <p className="text-caption font-semibold uppercase tracking-[0.14em] text-amber">For local businesses</p>
        <h2 id="vendor-heading" className="mt-3 text-[2rem] font-extrabold leading-[1.08] md:text-[2.5rem]">
          Bring your business to TownAnt.
        </h2>
        <p className="mt-4 max-w-md text-[1.0625rem] leading-relaxed text-white/85">Showcase your services, manage your availability, and connect with customers looking for businesses like yours.</p>
        <Link to="/join" className="group mt-8 inline-flex h-12 w-fit items-center gap-2 rounded-md bg-amber px-6 font-semibold text-navy transition hover:brightness-95 focus-visible:outline-white">
          Become a vendor <ArrowRight size={18} aria-hidden="true" className="transition group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}
