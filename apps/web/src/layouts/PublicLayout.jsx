import { Bell, Briefcase, CalendarDays, ChevronDown, Compass, Heart, Home, LayoutGrid, LifeBuoy, LogIn, LogOut, Menu, MessageSquare, Search, UserRound, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { AssistantLauncher } from '../components/Assistant.jsx';
import { Logo } from '../components/Logo.jsx';
import { LocationPicker, SearchBar } from '../components/SearchBar.jsx';
import { cx, ErrorBoundary } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { legalLinks, socialLinks } from '../lib/config.js';
import { StoreBadges } from '../components/StoreBadges.jsx';

function useUnread(user) {
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  useEffect(() => {
    if (user?.role !== 'customer') return;
    api('/notifications/unread-count')
      .then((r) => setUnread(r.data.unread))
      .catch(() => {});
  }, [user, location.pathname]);
  return user?.role === 'customer' ? unread : 0;
}

const iconButton = 'relative flex size-10 items-center justify-center rounded-md text-navy transition-colors hover:bg-cloud focus-visible:outline-2 focus-visible:outline-teal';

// Text links with an underline indicator for the active route (no pills or icons).
const navLink = "relative flex h-full items-center px-3 text-[0.875rem] font-medium transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']";

// The third link joins the bar from 1024px; tablets don't have room for it beside the location
// control (it stays in the footer and the phone menu).
const MAIN_NAV = [
  ['/search', 'Explore'],
  ['/categories', 'Categories'],
  ['/join', 'For businesses', 'wide'],
];

const CUSTOMER_LINKS = [
  ['/bookings', 'My bookings', CalendarDays],
  ['/messages', 'Messages', MessageSquare],
  ['/favorites', 'Saved businesses', Heart],
  ['/support', 'Help & support', LifeBuoy],
  ['/account', 'Account settings', UserRound],
];

// True once the page has scrolled past `offset` px (used for the header shadow and, on the
// homepage, to bring the header search in once the hero search has scrolled away).
function useScrolledPast(offset) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const check = () => setPast(window.scrollY > offset);
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [offset]);
  return past;
}

function AccountMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const items = CUSTOMER_LINKS;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex h-10 items-center gap-2 rounded-md border border-line bg-white pl-1 pr-2.5 text-[0.875rem] font-semibold text-navy transition hover:border-line-strong hover:bg-cloud">
        <span className="flex size-8 items-center justify-center rounded-sm bg-teal-50 text-teal-700" aria-hidden="true">
          <UserRound size={16} />
        </span>
        <span className="hidden max-w-[8rem] truncate lg:inline">{user.displayName || 'Account'}</span>
        <ChevronDown size={15} aria-hidden="true" className="text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-56 rounded-card border border-line bg-white p-1.5 shadow-pop">
          {items.map(([to, label, Icon]) => (
            <Link key={to} to={to} role="menuitem" className="flex items-center gap-3 rounded-sm px-3 py-2.5 text-[0.875rem] text-slate hover:bg-cloud hover:text-navy">
              <Icon size={17} aria-hidden="true" className="text-muted" />
              {label}
            </Link>
          ))}
          <div className="my-1 h-px bg-line" />
          <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-[0.875rem] text-slate hover:bg-cloud hover:text-navy">
            <LogOut size={17} aria-hidden="true" className="text-muted" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// The assistant launcher appears on discovery pages only; task pages (booking, sign-in, account)
// keep their own sticky actions clear.
const DISCOVERY = /^\/(?:$|search$|categories$|favorites$|b\/[^/]+\/?$)/;

const TABS = [
  ['/', 'Home', Home],
  ['/categories', 'Categories', LayoutGrid],
  ['/bookings', 'Bookings', CalendarDays],
  ['/favorites', 'Saved', Heart],
  ['/account', 'Account', UserRound],
];

export default function PublicLayout() {
  const { user, logout } = useAuth();
  const unread = useUnread(user);
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const scrolled = useScrolledPast(4);
  const pastHero = useScrolledPast(420);
  const customer = user?.role === 'customer';
  const onHome = location.pathname === '/';
  const onSearchPage = location.pathname === '/search';
  // The homepage hero has its own large search; the header one appears once that has scrolled away.
  const showNavSearch = !onSearchPage && (!onHome || pastHero);
  const loginHref = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  useEffect(() => setMenu(false), [location.pathname, location.search]);

  return (
    <div className="flex min-h-screen flex-col pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Solid (no backdrop filter), so fixed overlays opened from it are laid out against the viewport. */}
      <header className={cx('sticky top-0 z-40 border-b bg-white transition-shadow duration-200', scrolled ? 'border-line shadow-[0_1px_8px_rgb(20_36_58/0.06)]' : 'border-transparent')}>
        <div className="gutter mx-auto flex h-16 max-w-7xl items-center gap-2 lg:gap-6">
          <Link to="/" aria-label="TownAnt home" className="-ml-1 shrink-0 rounded-md p-1">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden h-full shrink-0 items-center md:flex">
            {MAIN_NAV.map(([to, label, wide]) => (
              <NavLink key={to} to={to} className={({ isActive }) => cx(wide ? navLink.replace('relative flex', 'relative hidden lg:flex') : navLink, isActive ? 'text-navy after:bg-teal' : 'text-slate hover:text-navy after:bg-transparent')}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden min-w-0 flex-1 justify-center lg:flex">{showNavSearch && <SearchBar variant="nav" key={location.key} />}</div>
          {/* Tablets: the location control stands on its own; phones reach it from the menu or a search bar. */}
          <div className="ml-auto hidden md:block lg:hidden">
            <LocationPicker className="max-w-[10rem]" />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
            {/* Below 340px (e.g. folded phones) the signed-in header has no room for it; search stays in the
                menu ("Explore services") and the page search bars. */}
            <Link to="/search" className={cx(iconButton, 'max-[339px]:hidden lg:hidden')} aria-label="Search">
              <Search size={20} aria-hidden="true" />
            </Link>
            <Link to="/favorites" className={cx(iconButton, 'hidden md:flex')} aria-label="Saved businesses">
              <Heart size={20} aria-hidden="true" />
            </Link>
            {customer && (
              <Link to="/notifications" className={iconButton} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Bell size={20} aria-hidden="true" />
                {unread > 0 && <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{unread > 9 ? '9+' : unread}</span>}
              </Link>
            )}
            {customer ? (
              <div className="ml-1 hidden md:block">
                <AccountMenu user={user} onLogout={logout} />
              </div>
            ) : (
              <Link to={loginHref} className="ml-1 hidden h-10 items-center whitespace-nowrap rounded-md bg-navy px-4 text-[0.875rem] font-semibold text-white transition-colors hover:bg-navy-800 md:inline-flex">
                Sign in
              </Link>
            )}
            <button type="button" onClick={() => setMenu(true)} className={cx(iconButton, 'md:hidden')} aria-label="Open menu" aria-expanded={menu} aria-controls="site-menu">
              <Menu size={22} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <MobileMenu open={menu} onClose={() => setMenu(false)} user={user} customer={customer} unread={unread} loginHref={loginHref} onLogout={logout} />

      <main id="main" className="flex-1">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <SiteFooter />

      <AssistantLauncher hidden={!DISCOVERY.test(location.pathname)} />

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden" aria-label="Primary">
        {/* Phones have no header Sign in button; signed-out visitors sign in from the last tab. */}
        {TABS.map(([to, label, Icon]) => {
          const signIn = to === '/account' && !user;
          return (
            <NavLink key={to} to={signIn ? loginHref : to} end={to === '/'} className={({ isActive }) => cx('flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-teal-700' : 'text-muted')}>
              {({ isActive }) => (
                <>
                  <Icon size={21} strokeWidth={isActive ? 2.25 : 1.75} aria-hidden="true" />
                  {signIn ? 'Sign in' : label}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

// Phone navigation drawer: browse links, location and account actions. Rendered at the document root;
// Escape, the backdrop and every link close it, and focus stays inside while it is open.
function MobileMenu({ open, onClose, user, customer, unread, loginHref, onLogout }) {
  const reduce = useReducedMotion();
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => panel.current?.querySelector('button, a')?.focus(), 30);
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll('a[href], button:not([disabled])')];
        const first = items[0];
        const last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);
  const row = 'flex min-h-12 items-center gap-3 rounded-md px-3 text-[0.9375rem] font-medium text-navy transition-colors hover:bg-cloud focus-visible:outline-2 focus-visible:outline-teal';
  const browse = [
    ['/', 'Home', Home],
    ['/search', 'Explore services', Compass],
    ['/categories', 'Categories', LayoutGrid],
    ['/join', 'For businesses', Briefcase],
  ];
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <motion.button type="button" tabIndex={-1} aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-navy/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.nav
            id="site-menu"
            ref={panel}
            aria-label="Menu"
            className="absolute inset-y-0 right-0 flex w-[min(320px,88vw)] flex-col bg-white shadow-pop"
            initial={reduce ? { opacity: 0 } : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
              <Logo />
              <button type="button" onClick={onClose} className={iconButton} aria-label="Close menu">
                <X size={22} aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="mb-3 rounded-md border border-line p-1">
                <LocationPicker className="w-full" />
              </div>
              <ul className="flex flex-col">
                {browse.map(([to, label, Icon]) => (
                  <li key={to}>
                    <NavLink to={to} end={to === '/'} onClick={onClose} className={({ isActive }) => cx(row, isActive && 'bg-teal-50 text-teal-700')}>
                      <Icon size={19} aria-hidden="true" className="text-muted" />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <div className="my-3 h-px bg-line" />
              {customer ? (
                <ul className="flex flex-col">
                  <li>
                    <Link to="/notifications" onClick={onClose} className={row}>
                      <Bell size={19} aria-hidden="true" className="text-muted" />
                      Notifications
                      {unread > 0 && <span className="ml-auto rounded-full bg-danger px-2 text-caption font-bold leading-5 text-white">{unread > 9 ? '9+' : unread}</span>}
                    </Link>
                  </li>
                  {CUSTOMER_LINKS.map(([to, label, Icon]) => (
                    <li key={to}>
                      <Link to={to} onClick={onClose} className={row}>
                        <Icon size={19} aria-hidden="true" className="text-muted" />
                        {label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <button type="button" onClick={() => (onClose(), onLogout())} className={cx(row, 'w-full')}>
                      <LogOut size={19} aria-hidden="true" className="text-muted" />
                      Sign out
                    </button>
                  </li>
                </ul>
              ) : (
                <div className="flex flex-col gap-2 px-1">
                  <Link to={loginHref} onClick={onClose} className="flex h-12 items-center justify-center gap-2 rounded-md bg-navy font-semibold text-white transition-colors hover:bg-navy-800">
                    <LogIn size={18} aria-hidden="true" /> Sign in
                  </Link>
                  {!user && (
                    <Link to="/support" onClick={onClose} className={row}>
                      <LifeBuoy size={19} aria-hidden="true" className="text-muted" />
                      Help & support
                    </Link>
                  )}
                </div>
              )}
            </div>
          </motion.nav>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const footerLink = 'text-[0.875rem] text-slate transition hover:text-teal-700';
const footerHeading = 'text-caption font-semibold uppercase tracking-[0.1em] text-subtle';

function FooterColumn({ title, links }) {
  return (
    <nav aria-label={title} className="flex flex-col gap-3">
      <h2 className={footerHeading}>{title}</h2>
      {links.map(([to, label, external]) =>
        external ? (
          <a key={label} href={to} target="_blank" rel="noopener noreferrer" className={footerLink}>
            {label}
          </a>
        ) : (
          <Link key={label} to={to} className={footerLink}>
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 gutter py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-5 sm:col-span-2 lg:col-span-1">
          <Logo />
          <p className="max-w-xs text-[0.875rem] leading-relaxed text-muted">Find trusted local businesses, see real availability and book in a few taps. You pay each business directly — TownAnt never takes payments.</p>
          <div>
            <p className={cx(footerHeading, 'mb-3')}>Get the app</p>
            <StoreBadges compact />
          </div>
        </div>
        <FooterColumn
          title="For customers"
          links={[
            ['/search', 'Explore services'],
            ['/categories', 'Browse categories'],
            ['/bookings', 'My bookings'],
            ['/favorites', 'Saved businesses'],
            ['/account', 'Account settings'],
          ]}
        />
        <FooterColumn
          title="For businesses"
          links={[
            ['/join', 'Become a vendor'],
            ['/business', 'Vendor sign in'],
            ['/business/support', 'Vendor support'],
          ]}
        />
        <FooterColumn
          title="Support & privacy"
          links={[
            ['/support', 'Help & support'],
            ['/#how-it-works', 'How TownAnt works'],
            ['/account#delete-account', 'Delete your account'],
            ...legalLinks.map(([label, href]) => [href, label, true]),
          ]}
        />
      </div>
      <div className="border-t border-line bg-cloud/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 gutter py-5 text-caption text-subtle md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} TownAnt. All rights reserved.</span>
          {socialLinks.length > 0 && (
            <ul className="flex flex-wrap gap-5" aria-label="TownAnt on social media">
              {socialLinks.map(([name, href]) => (
                <li key={name}>
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-[0.8125rem] text-slate transition hover:text-teal-700">
                    {name}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <span className="md:text-right">Listings, ratings and availability come from businesses and customers with completed bookings.</span>
        </div>
      </div>
    </footer>
  );
}
