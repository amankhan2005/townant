import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CalendarDays, ChevronDown, ClipboardCheck, ExternalLink, KeyRound, LayoutDashboard, LifeBuoy, LogOut, Menu, MessagesSquare, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, ScrollText, ShieldCheck, Star, Store, Tags, UsersRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { Logo, LogoMark } from '../../components/Logo.jsx';
import { cx, ErrorBoundary } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useApi } from '../../lib/hooks.js';
import { ForgotPassword, ResetPassword, Setup, StaffLogin } from '../business/Auth.jsx';
import { FullPageSpinner } from '../business/BusinessApp.jsx';
import AdminAccount from './Account.jsx';
import Applications from './Applications.jsx';
import Categories from './Categories.jsx';
import Companies from './Companies.jsx';
import Dashboard from './Dashboard.jsx';
import Homepage from './Homepage.jsx';
import SupportDesk from './Support.jsx';
import { AuditLog, BookingsOversight, Inquiries, ReviewsModeration, Users } from './Oversight.jsx';

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<StaffLogin area="admin" />} />
      <Route path="setup" element={<Setup area="admin" />} />
      <Route path="forgot-password" element={<ForgotPassword area="admin" />} />
      <Route path="reset-password" element={<ResetPassword area="admin" />} />
      <Route element={<Console />}>
        <Route index element={<Dashboard />} />
        <Route path="applications" element={<Applications />} />
        <Route path="applications/:id" element={<Applications />} />
        <Route path="companies" element={<Companies />} />
        <Route path="companies/:id" element={<Companies />} />
        <Route path="users" element={<Users />} />
        <Route path="bookings" element={<BookingsOversight />} />
        <Route path="inquiries" element={<Inquiries />} />
        <Route path="reviews" element={<ReviewsModeration />} />
        <Route path="categories" element={<Categories />} />
        <Route path="categories/:id" element={<Categories />} />
        <Route path="homepage" element={<Homepage />} />
        <Route path="support" element={<SupportDesk />} />
        <Route path="support/:id" element={<SupportDesk />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="account" element={<AdminAccount />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

// Every console destination, grouped by job. `count` names a live badge from real queue data:
// applications nobody has opened yet, and support requests waiting on TownAnt.
const NAV_GROUPS = [
  { label: 'Overview', items: [{ to: '', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Marketplace',
    items: [
      { to: 'applications', label: 'Vendor applications', icon: ClipboardCheck, count: 'applications', countLabel: 'new' },
      { to: 'companies', label: 'Companies', icon: Store },
      { to: 'categories', label: 'Categories', icon: Tags },
      { to: 'homepage', label: 'Homepage', icon: PanelsTopLeft },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: 'bookings', label: 'Bookings', icon: CalendarDays },
      { to: 'inquiries', label: 'Inquiries', icon: MessagesSquare },
      { to: 'support', label: 'Support', icon: LifeBuoy, count: 'support', countLabel: 'awaiting a reply' },
      { to: 'reviews', label: 'Reviews', icon: Star },
    ],
  },
  {
    label: 'People & security',
    items: [
      { to: 'users', label: 'Accounts', icon: UsersRound },
      { to: 'audit', label: 'Audit log', icon: ScrollText },
      { to: 'account', label: 'Profile & security', icon: KeyRound },
    ],
  },
];
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
const sectionFor = (pathname) => NAV_ITEMS.find((i) => i.to && isActivePath(pathname, i)) ?? NAV_ITEMS[0];

const COLLAPSE_KEY = 'townant.admin.sidebarCollapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

// Queue sizes for the sidebar badges, refreshed on every navigation.
function useQueueCounts(pathname, enabled) {
  const fresh = useApi('/admin/applications', { query: { status: 'submitted', limit: 1 }, enabled }, [pathname]);
  const support = useApi('/admin/support/meta', { enabled }, [pathname]);
  return { applications: fresh.meta?.total ?? null, support: support.data?.counts?.awaitingSupport ?? null };
}

const initials = (user) => (user.displayName || user.email || 'A').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

// UX guard only. Every admin API independently requires a Super Admin with verified MFA.
function Console() {
  const { user, loading, mfaRequired, logout } = useAuth();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const signedIn = user?.role === 'super_admin' && !mfaRequired;
  const counts = useQueueCounts(location.pathname, signedIn);
  useEffect(() => setDrawer(false), [location.pathname]);
  if (loading) return <FullPageSpinner light />;
  if (!signedIn) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname)}`} replace />;

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable: keep it for this visit only */
      }
      return !c;
    });

  return (
    <div className="min-h-screen bg-console lg:flex">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900">
        Skip to content
      </a>
      {/* The column carries the slate background for the full page height; the sidebar inside is sticky. */}
      <div className="hidden shrink-0 bg-admin-side lg:block">
        <aside className={cx('sticky top-0 z-30 flex h-screen bg-admin-side transition-[width] duration-200 ease-out-soft motion-reduce:transition-none', collapsed ? 'w-[72px]' : 'w-[248px]')}>
          <Sidebar user={user} counts={counts} collapsed={collapsed} onToggle={toggleCollapsed} onLogout={logout} />
        </aside>
      </div>
      <MobileDrawer open={drawer} onClose={() => setDrawer(false)}>
        <Sidebar user={user} counts={counts} onLogout={logout} onClose={() => setDrawer(false)} />
      </MobileDrawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} onMenu={() => setDrawer(true)} onLogout={logout} />
        <main id="admin-main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

// Shared by the desktop sidebar and the mobile drawer, so both stay identical.
function Sidebar({ user, counts, collapsed = false, onToggle, onLogout, onClose }) {
  return (
    <div className="flex h-full w-full flex-col text-admin-ink">
      <div className={cx('flex h-16 shrink-0 items-center border-b border-admin-line', collapsed ? 'justify-center px-2' : 'justify-between px-5')}>
        <Link to="/admin" aria-label="TownAnt Admin — dashboard" className="rounded-md">
          {collapsed ? <LogoMark className="size-8" /> : <Logo inverted suffix="Admin" />}
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} className="flex size-10 items-center justify-center rounded-md text-admin-muted transition-colors hover:bg-admin-side-hover hover:text-admin-ink" aria-label="Close menu">
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      <nav aria-label="Admin" className={cx('flex-1 overflow-y-auto py-4 [scrollbar-color:rgb(255_255_255/0.15)_transparent] [scrollbar-width:thin]', collapsed ? 'px-3' : 'px-3')}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={cx(gi > 0 && 'mt-6')}>
            {collapsed ? (
              gi > 0 && <div className="mx-2 mb-4 h-px bg-admin-line" aria-hidden="true" />
            ) : (
              <p className="mb-2 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-admin-faint">{group.label}</p>
            )}
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavItem item={item} collapsed={collapsed} count={item.count ? counts[item.count] : null} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className={cx('shrink-0 border-t border-admin-line py-3', collapsed ? 'px-3' : 'px-3')}>
        <div className={cx('flex items-center gap-3', collapsed ? 'flex-col' : 'px-2')}>
          <Link to="/admin/account" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal text-[0.8125rem] font-bold text-white ring-2 ring-admin-side" aria-label="Profile & security">
            {initials(user)}
          </Link>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] font-semibold text-admin-ink">{user.displayName || 'Super Admin'}</span>
              <span className="flex items-center gap-1 truncate text-[0.75rem] text-admin-muted">
                <ShieldCheck size={12} aria-hidden="true" className="shrink-0" /> Super Admin
              </span>
            </span>
          )}
          <SidebarButton label="Sign out" collapsed={collapsed} onClick={onLogout} icon={LogOut} />
        </div>
        {onToggle && (
          <SidebarButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            collapsed={collapsed}
            onClick={onToggle}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            className={cx('mt-2', collapsed ? 'mx-auto' : 'w-full justify-start gap-3 px-3 text-[0.8125rem]')}
            showLabel={!collapsed}
          />
        )}
      </div>
    </div>
  );
}

// Active state comes from the normalised path (so "/admin/" and "/admin" agree): the dashboard only
// on the admin root, every other item on its own route and its detail pages.
function isActivePath(pathname, item) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const base = `/admin${item.to ? `/${item.to}` : ''}`;
  return item.to ? path === base || path.startsWith(`${base}/`) : path === base;
}

function NavItem({ item, collapsed, count }) {
  const { pathname } = useLocation();
  const Icon = item.icon;
  const badge = count > 0 ? (count > 99 ? '99+' : String(count)) : null;
  const isActive = isActivePath(pathname, item);
  return (
    <Link
      to={`/admin${item.to ? `/${item.to}` : ''}`}
      aria-current={isActive ? 'page' : undefined}
      aria-label={collapsed ? `${item.label}${badge ? `, ${badge} ${item.countLabel}` : ''}` : undefined}
      className={cx(
        'group relative flex h-10 items-center gap-3 rounded-md text-[0.875rem] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300',
        collapsed ? 'justify-center' : 'px-3',
        isActive ? 'bg-teal/25 text-admin-ink' : 'text-admin-muted hover:bg-admin-side-hover hover:text-admin-ink',
      )}
    >
      <span className={cx('absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-teal-300 transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" className={cx('shrink-0', isActive ? 'text-teal-300' : 'text-admin-faint group-hover:text-admin-ink')} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {badge &&
        (collapsed ? (
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-amber ring-2 ring-admin-side" aria-hidden="true" />
        ) : (
          <span className="rounded-full bg-amber px-1.5 text-[0.6875rem] font-bold leading-[1.125rem] text-navy tabular" aria-label={`${badge} ${item.countLabel}`}>
            {badge}
          </span>
        ))}
      {collapsed && <SideTooltip>{item.label}{badge ? ` · ${badge}` : ''}</SideTooltip>}
    </Link>
  );
}

function SidebarButton({ label, collapsed, onClick, icon: Icon, className, showLabel = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={showLabel ? undefined : label}
      className={cx('group relative flex h-9 shrink-0 items-center justify-center rounded-md text-admin-muted transition-colors hover:bg-admin-side-hover hover:text-admin-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300', showLabel ? '' : 'w-9', className)}
    >
      <Icon size={17} aria-hidden="true" />
      {showLabel && <span>{label}</span>}
      {collapsed && <SideTooltip>{label}</SideTooltip>}
    </button>
  );
}

// Shown beside an icon-only control on hover or keyboard focus.
const SideTooltip = ({ children }) => (
  <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-caption font-semibold text-white opacity-0 shadow-pop transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
    {children}
  </span>
);

function MobileDrawer({ open, onClose, children }) {
  const reduce = useReducedMotion();
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector('a, button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const focusable = [...panel.current.querySelectorAll('a[href], button:not([disabled])')];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <motion.button type="button" aria-label="Close menu" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-slate-900/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Admin menu"
            className="absolute inset-y-0 left-0 flex w-[min(280px,86vw)] bg-admin-side shadow-pop"
            initial={reduce ? { opacity: 0 } : { x: '-100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '-100%' }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Topbar({ user, onMenu, onLogout }) {
  const location = useLocation();
  const section = sectionFor(location.pathname);
  const detail = section.to && location.pathname.startsWith(`/admin/${section.to}/`);
  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-admin-line bg-admin-head px-4 text-admin-ink sm:px-6 lg:px-8">
      <button type="button" onClick={onMenu} className="-ml-1 flex size-10 items-center justify-center rounded-md text-admin-ink transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-teal-300 lg:hidden" aria-label="Open menu">
        <Menu size={22} aria-hidden="true" />
      </button>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-[0.875rem]">
          <li className="hidden text-admin-muted sm:block">Admin</li>
          <li className="hidden text-admin-faint sm:block" aria-hidden="true">
            /
          </li>
          {detail ? (
            <>
              <li className="min-w-0 truncate">
                <Link to={`/admin/${section.to}`} className="rounded-sm font-medium text-admin-muted transition-colors hover:text-admin-ink focus-visible:outline-2 focus-visible:outline-teal-300">
                  {section.label}
                </Link>
              </li>
              <li className="text-admin-faint" aria-hidden="true">
                /
              </li>
              <li className="font-semibold text-admin-ink" aria-current="page">
                Details
              </li>
            </>
          ) : (
            <li className="min-w-0 truncate font-semibold text-admin-ink" aria-current="page">
              {section.label}
            </li>
          )}
        </ol>
      </nav>
      <a href="/" target="_blank" rel="noopener noreferrer" className="hidden h-9 items-center gap-1.5 rounded-md px-3 text-[0.8125rem] font-medium text-admin-muted transition-colors hover:bg-white/10 hover:text-admin-ink focus-visible:outline-2 focus-visible:outline-teal-300 sm:inline-flex">
        View site <ExternalLink size={14} aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <AccountMenu user={user} onLogout={onLogout} />
    </header>
  );
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
  const item = 'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[0.875rem] text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:bg-slate-100';
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex h-10 items-center gap-2 rounded-md pl-1 pr-2 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-teal-300">
        <span className="flex size-8 items-center justify-center rounded-full bg-teal text-[0.75rem] font-bold text-white" aria-hidden="true">
          {initials(user)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-[0.875rem] font-medium text-admin-ink md:inline">{user.displayName || user.email}</span>
        <ChevronDown size={15} aria-hidden="true" className={cx('text-admin-muted transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
        <span className="sr-only">Account menu</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-pop"
          >
            <div className="px-3 py-2.5">
              <p className="truncate text-[0.875rem] font-semibold text-slate-900">{user.displayName || 'Super Admin'}</p>
              <p className="truncate text-caption text-slate-500">{user.email}</p>
            </div>
            <div className="my-1 h-px bg-slate-100" />
            <Link role="menuitem" to="/admin/account" className={item}>
              <KeyRound size={16} aria-hidden="true" className="text-slate-400" /> Profile & security
            </Link>
            <a role="menuitem" href="/" target="_blank" rel="noopener noreferrer" className={cx(item, 'sm:hidden')}>
              <ExternalLink size={16} aria-hidden="true" className="text-slate-400" /> View public site
            </a>
            <button type="button" role="menuitem" onClick={onLogout} className={item}>
              <LogOut size={16} aria-hidden="true" className="text-slate-400" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
