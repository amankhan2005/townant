import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { PasswordSignIn } from '../../components/CustomerPassword.jsx';
import { OtpSignIn } from '../../components/OtpSignIn.jsx';
import { Card } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';

// Only same-site relative paths are accepted as a post-login destination (no open redirect).
export const safeNext = (value) => (value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/');

export default function Login() {
  useDocumentTitle('Sign in');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState('code');
  const next = safeNext(params.get('next'));
  if (user?.role === 'customer') return <Navigate to={next} replace />;
  return (
    <div className="mx-auto max-w-md gutter py-12">
      <Card className="p-6">
        <h1 className="text-2xl font-bold text-navy">Sign in to TownAnt</h1>
        <p className="subtitle mb-6 mt-1 text-sm">{mode === 'code' ? 'Use your email or your phone — whichever you prefer.' : 'For accounts that have added a password.'}</p>
        {mode === 'code' ? <OtpSignIn onDone={() => navigate(next, { replace: true })} /> : <PasswordSignIn onDone={() => navigate(next, { replace: true })} onUseCode={() => setMode('code')} />}
        {mode === 'code' && (
          <button type="button" onClick={() => setMode('password')} className="mt-4 w-full text-center text-sm text-teal hover:underline">
            Sign in with a password instead
          </button>
        )}
      </Card>
      <p className="mt-6 text-center text-sm text-muted">
        Own a business?{' '}
        <Link to="/business/login" className="font-semibold text-teal">
          Sign in to TownAnt for Business
        </Link>
      </p>
    </div>
  );
}
