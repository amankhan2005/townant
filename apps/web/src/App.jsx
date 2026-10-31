import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Spinner } from './components/ui.jsx';
import PublicLayout from './layouts/PublicLayout.jsx';
import Account, { AccountDeleted } from './pages/public/Account.jsx';
import BookingDetail from './pages/public/BookingDetail.jsx';
import Bookings from './pages/public/Bookings.jsx';
import Categories from './pages/public/Categories.jsx';
import CompanyProfile from './pages/public/CompanyProfile.jsx';
import Favorites from './pages/public/Favorites.jsx';
import Home from './pages/public/Home.jsx';
import JoinVendor from './pages/public/JoinVendor.jsx';
import Login from './pages/public/Login.jsx';
import Messages from './pages/public/Messages.jsx';
import NotFound from './pages/public/NotFound.jsx';
import Notifications from './pages/public/Notifications.jsx';
import Search from './pages/public/Search.jsx';
import ServiceDetail from './pages/public/ServiceDetail.jsx';
import Support from './pages/public/Support.jsx';

// Vendor and admin consoles are separate bundles; customers never download them.
const BusinessApp = lazy(() => import('./pages/business/BusinessApp.jsx'));
const AdminApp = lazy(() => import('./pages/admin/AdminApp.jsx'));

const Loading = () => (
  <div className="flex min-h-screen items-center justify-center text-teal">
    <Spinner className="size-8" />
  </div>
);

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/business/*" element={<BusinessApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="categories" element={<Categories />} />
          <Route path="b/:slug" element={<CompanyProfile />} />
          <Route path="b/:slug/s/:serviceId" element={<ServiceDetail />} />
          <Route path="login" element={<Login />} />
          <Route path="bookings" element={<Bookings />} />
          <Route path="bookings/:id" element={<BookingDetail />} />
          <Route path="favorites" element={<Favorites />} />
          <Route path="messages" element={<Messages />} />
          <Route path="messages/:id" element={<Messages />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="account" element={<Account />} />
          <Route path="account/deleted" element={<AccountDeleted />} />
          <Route path="support" element={<Support />} />
          <Route path="support/new" element={<Support mode="new" />} />
          <Route path="support/:id" element={<Support mode="detail" />} />
          <Route path="join" element={<JoinVendor />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
