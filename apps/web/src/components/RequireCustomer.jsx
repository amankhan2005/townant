import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../lib/auth.jsx';
import { Alert, DetailSkeleton } from './ui.jsx';

// UX guard only; the API enforces access on every request.
export function RequireCustomer({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="mx-auto max-w-3xl gutter py-8">
        <DetailSkeleton label="Checking your session" />
      </div>
    );
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.role !== 'customer')
    return (
      <div className="mx-auto max-w-lg gutter py-12">
        <Alert tone="warn">You're signed in with a business or admin account. Sign out and sign in as a customer to use this page.</Alert>
      </div>
    );
  return children;
}
