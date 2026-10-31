import { Menu, X } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { Logo } from '../../components/Logo.jsx';
import { Alert, Badge, Button, ErrorBoundary, MetricsSkeleton, Skeleton, TableSkeleton } from '../../components/ui.jsx';
import { setCompanyId } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useApi } from '../../lib/hooks.js';
import { NotificationList } from '../public/Notifications.jsx';
import Appointments from './Appointments.jsx';
import Availability from './Availability.jsx';
import { ForgotPassword, ResetPassword, Setup, StaffLogin } from './Auth.jsx';
import { ForcedPasswordChange } from './PasswordForms.jsx';
import Messages from './Messages.jsx';
import Overview from './Overview.jsx';
import Profile from './Profile.jsx';
import Reviews from './Reviews.jsx';
import Services from './Services.jsx';
import Settings from './Settings.jsx';
import Support from './Support.jsx';

const VendorContext = createContext(null);
export const useVendor = () => useContext(VendorContext);

export default function BusinessApp() {
  return (
    <Routes>
      <Route path="login" element={<StaffLogin area="business" />} />
      <Route path="setup" element={<Setup area="business" />} />
      <Route path="forgot-password" element={<ForgotPassword area="business" />} />
      <Route path="reset-password" element={<ResetPassword area="business" />} />
      <Route element={<Portal />}>
        <Route index element={<Overview />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="appointments/:id" element={<Appointments />} />
        <Route path="services" element={<Services />} />
        <Route path="availability" element={<Availability />} />
        <Route path="messages" element={<Messages />} />
        <Route path="messages/:id" element={<Messages />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Settings />} />
        <Route path="support" element={<Support />} />
        <Route path="support/new" element={<Support mode="new" />} />
        <Route path="support/:id" element={<Support mode="detail" />} />
        <Route path="notifications" element={<NotificationList />} />
        <Route path="*" element={<Navigate to="/business" replace />} />
      </Route>
    </Routes>
  );
}

const NAV = [
  ['', 'Overview', 'dashboard'],
  ['appointments', 'Appointments', 'bookings:read'],
  ['services', 'Services', 'services:write'],
  ['availability', 'Availability', 'availability:write'],
  ['messages', 'Messages', 'messages'],
  ['reviews', 'Reviews', 'dashboard'],
  ['profile', 'Profile', 'company:write'],
  ['settings', 'Settings', 'dashboard'],
  ['support', 'Support', 'dashboard'],
];

function Portal() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState(() => sessionStorage.getItem('townant.company') || null);
  const isVendor = user?.role === 'vendor';
  // A temporary password must be replaced first; the API refuses portal requests until then.
  const mustChangePassword = isVendor && user.passwordChangeRequired;
  setCompanyId(selected);
  const ctx = useApi('/vendor/context', { enabled: isVendor && !mustChangePassword }, [selected, mustChangePassword]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (loading) return <FullPageSpinner />;
  if (!isVendor) return <Navigate to={`/business/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (mustChangePassword) return <ForcedPasswordChange />;
  if (ctx.error?.code === 'COMPANY_SELECTION_REQUIRED' || (ctx.error && selected)) {
    return <CompanyPicker onPick={(id) => { sessionStorage.setItem('townant.company', id); setSelected(id); }} />;
  }
  if (ctx.error) return <div className="p-8"><Alert tone="error">{ctx.error.message}</Alert></div>;
  if (!ctx.data) return <FullPageSpinner />;
  const { company, permissions, companies } = ctx.data;

  return (
    <VendorContext.Provider value={{ ...ctx.data, reload: ctx.reload, setCompany: (c) => ctx.setData((d) => ({ ...d, company: c })) }}>
      <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
        <aside className={`${menuOpen ? 'block' : 'hidden'} fixed inset-0 z-40 bg-navy p-4 text-white lg:static lg:block`}>
          <div className="flex items-center justify-between">
            <Link to="/business">
              <Logo inverted suffix="Business" />
            </Link>
            <button className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <nav className="mt-8 flex flex-col gap-1" aria-label="Business">
            {NAV.filter(([, , perm]) => permissions.includes(perm)).map(([to, label]) => (
              <NavLink key={to} to={`/business${to ? `/${to}` : ''}`} end={!to} className={({ isActive }) => `rounded-md px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-teal text-white shadow-card' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          {companies.length > 1 && (
            <button className="mt-6 text-xs text-white/70 underline" onClick={() => { sessionStorage.removeItem('townant.company'); setSelected(null); }}>
              Switch business
            </button>
          )}
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-white/90 px-4 backdrop-blur-md lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button className="rounded-md p-2 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
                <Menu size={22} aria-hidden="true" />
              </button>
              <span className="truncate font-semibold text-navy">{company.name}</span>
              <Badge tone={company.status === 'published' ? 'teal' : company.status === 'suspended' ? 'red' : 'amber'}>{company.status === 'published' ? 'Live' : company.status === 'suspended' ? 'Suspended' : 'Draft'}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/business/notifications" className="rounded-lg px-3 py-2 text-sm text-slate hover:bg-cloud">
                Notifications
              </Link>
              {company.status === 'published' && (
                <Link to={`/b/${company.slug}`} target="_blank" className="hidden rounded-lg px-3 py-2 text-sm text-teal hover:bg-cloud sm:block">
                  View public profile ↗
                </Link>
              )}
              <Button size="sm" variant="secondary" onClick={logout}>
                Sign out
              </Button>
            </div>
          </header>
          {company.status === 'suspended' && (
            <Alert tone="error" className="m-4 lg:mx-8">
              This business is suspended{company.suspensionReason ? `: ${company.suspensionReason}` : ''}. It is hidden from customers and changes are disabled.{' '}
              <Link to="/business/support/new" className="font-semibold underline">
                Contact TownAnt support
              </Link>
              .
            </Alert>
          )}
          <main className="flex-1 p-4 lg:p-8">
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </VendorContext.Provider>
  );
}

function CompanyPicker({ onPick }) {
  const list = useApi('/vendor/companies');
  return (
    <div className="mx-auto max-w-md p-8">
      <Logo />
      <h1 className="mt-8 text-xl font-bold text-navy">Choose a business</h1>
      <p className="subtitle mt-1 text-sm">Your account manages more than one business.</p>
      {list.error && <Alert tone="error" className="mt-4">{list.error.message}</Alert>}
      <ul className="mt-4 flex flex-col gap-2">
        {list.data?.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPick(c.id)} className="flex w-full items-center justify-between rounded-xl border border-line bg-white p-4 text-left hover:border-teal">
              <span className="font-semibold text-navy">{c.name}</span>
              <span className="text-xs capitalize text-muted">{c.role} · {c.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Shown while the session and business context load: the portal's real layout, in outline.
// `light` matches the Super Admin console's white sidebar.
export function FullPageSpinner({ light = false }) {
  return (
    <div className={`min-h-screen lg:grid lg:grid-cols-[248px_1fr] ${light ? 'bg-[#f6f7f9]' : ''}`} role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className={`hidden flex-col gap-3 p-5 lg:flex ${light ? 'border-r border-slate-200/80 bg-white' : 'bg-navy'}`} aria-hidden="true">
        <Skeleton className={`mb-6 h-8 w-36 ${light ? '' : 'opacity-20'}`} />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className={`h-9 ${light ? 'opacity-60' : 'opacity-10'}`} />
        ))}
      </div>
      <div className="flex flex-col">
        <div className="h-16 border-b border-line bg-white" aria-hidden="true" />
        <div className="flex flex-col gap-6 p-4 lg:p-8">
          <Skeleton className="h-8 w-64" />
          <MetricsSkeleton />
          <TableSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}

export function Gate({ permission, children }) {
  const vendor = useVendor();
  if (!vendor.permissions.includes(permission)) return <Alert tone="warn">Your role doesn't include access to this section. Ask the business owner.</Alert>;
  return children;
}

export { Outlet };
