import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../../components/Logo.jsx';
import { Alert, Button, Card, FormError, Input } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';
import { safeNext } from '../public/Login.jsx';
import { passwordChecks, PasswordRules } from './PasswordForms.jsx';

const AREAS = {
  business: { home: '/business', role: 'vendor', title: 'TownAnt for Business', suffix: 'Business' },
  admin: { home: '/admin', role: 'super_admin', title: 'TownAnt Admin', suffix: 'Admin' },
};

function Shell({ area, children }) {
  return (
    <div className={`flex min-h-screen items-center justify-center px-4 py-12 ${area === 'admin' ? 'bg-console' : 'bg-cloud'}`}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo suffix={AREAS[area].suffix} />
        </div>
        <Card className={area === 'admin' ? 'rounded-xl p-7' : 'p-6'}>{children}</Card>
      </div>
    </div>
  );
}

const waitText = (seconds) => (seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minute${seconds > 60 ? 's' : ''}`);

// Password sign-in for provisioned staff accounts. Super Admins then confirm an emailed code.
export function StaffLogin({ area }) {
  const cfg = AREAS[area];
  useDocumentTitle(`${cfg.title} sign in`);
  const { user, mfaRequired, signedIn, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next') ?? cfg.home);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  if (user?.role === cfg.role && !mfaRequired) return <Navigate to={next.startsWith(cfg.home) ? next : cfg.home} replace />;

  const login = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/staff-auth/login', { method: 'POST', body: { email: email.trim(), password } });
      signedIn(data);
      if (data.user.role !== cfg.role) {
        setError({ message: `This account can't sign in to ${cfg.title}.` });
        return;
      }
      if (data.mfa) setMfa(data.mfa);
      else navigate(next, { replace: true });
    } catch (err) {
      setError(err.status === 429 && err.retryAfter ? { message: `${err.message} You can try again in ${waitText(err.retryAfter)}.` } : err);
    } finally {
      setPending(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/staff-auth/mfa/verify', { method: 'POST', body: { challengeId: mfa.challengeId, code } });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const resend = async () => {
    try {
      const { data } = await api('/staff-auth/mfa/resend', { method: 'POST' });
      setMfa(data);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Shell area={area}>
      {mfa || (mfaRequired && user?.role === cfg.role) ? (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <h1 className="text-xl font-bold text-navy">Two-step verification</h1>
          <p className="text-sm text-muted">{mfa ? `Enter the code we emailed to ${mfa.maskedDestination}.` : 'Request a code to finish signing in.'}</p>
          {mfa && <Input label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />}
          <FormError error={error} />
          {mfa ? (
            <Button type="submit" size="lg" pending={pending} disabled={code.length !== 6}>
              Verify
            </Button>
          ) : null}
          <button type="button" onClick={resend} className="text-sm text-teal hover:underline">
            {mfa ? 'Send a new code' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={login} className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-bold text-navy">Sign in to {cfg.title}</h1>
            {area === 'admin' && <p className="subtitle mt-1 text-sm">After your password, confirm with a six-digit code sent to your email.</p>}
          </div>
          <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <FormError error={error} />
          <Button type="submit" size="lg" pending={pending}>
            Sign in
          </Button>
          <Link to={`/${area}/forgot-password`} className="text-center text-sm text-teal hover:underline">
            Forgot password?
          </Link>
          {area === 'business' && (
            <p className="text-center text-sm text-muted">
              New to TownAnt?{' '}
              <Link to="/join" className="font-semibold text-teal">
                Apply to join
              </Link>
            </p>
          )}
        </form>
      )}
    </Shell>
  );
}

// Reads a single-use token from the URL, then removes it from the address bar and history.
function useUrlToken() {
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => {
    if (token) window.history.replaceState(null, '', window.location.pathname);
  }, [token]);
  return token;
}

export function Setup({ area }) {
  const cfg = AREAS[area];
  useDocumentTitle('Set up your account');
  const token = useUrlToken();
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ displayName: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      setInfo({ valid: false });
      return;
    }
    api('/staff-auth/invite/inspect', { method: 'POST', body: { token } })
      .then((r) => setInfo(r.data))
      .catch(() => setInfo({ valid: false }));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError({ message: 'Passwords do not match.' });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/staff-auth/invite/accept', { method: 'POST', body: { token, password: form.password, displayName: form.displayName.trim() } });
      signedIn(data);
      navigate(data.user.role === 'super_admin' ? '/admin' : '/business', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  if (!info) return <Shell area={area}>Checking your link…</Shell>;
  if (!info.valid) {
    return (
      <Shell area={area}>
        <h1 className="text-xl font-bold text-navy">This link can't be used</h1>
        <p className="mt-2 text-sm text-muted">Setup links expire after 72 hours and work once. If you already set your password, sign in instead. Otherwise ask TownAnt to send a new link.</p>
        <Link to={`${cfg.home}/login`} className="mt-4 inline-block font-semibold text-teal">
          Go to sign in
        </Link>
      </Shell>
    );
  }
  return (
    <Shell area={area}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h1 className="text-xl font-bold text-navy">Set up your account</h1>
        <p className="text-sm text-muted">
          {info.companyName ? `You're setting up ${info.companyName}. ` : ''}Signing in as {info.email}.
        </p>
        <Input label="Your name" required maxLength={80} value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} autoComplete="name" />
        <Input label="Create a password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" hint="At least 12 characters. A short phrase works well." value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <Input label="Confirm password" type="password" required autoComplete="new-password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
        <FormError error={error} />
        <Button type="submit" size="lg" pending={pending}>
          Create account
        </Button>
      </form>
    </Shell>
  );
}

export function ForgotPassword({ area }) {
  useDocumentTitle('Reset password');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/staff-auth/password/forgot', { method: 'POST', body: { email: email.trim() } });
      setMessage(data.message);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Shell area={area}>
      {message ? (
        <Alert tone="info">{message}</Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h1 className="text-xl font-bold text-navy">Reset your password</h1>
          <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <FormError error={error} />
          <Button type="submit" pending={pending}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to={`/${area}/login`} className="mt-4 block text-center text-sm text-teal">
        Back to sign in
      </Link>
    </Shell>
  );
}

export function ResetPassword({ area }) {
  useDocumentTitle('Choose a new password');
  const token = useUrlToken();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/staff-auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Shell area={area}>
      {done ? (
        <>
          <Alert tone="info">Password updated. All previous sessions were signed out.</Alert>
          <Link to={`/${area}/login`} className="mt-4 block font-semibold text-teal">
            Sign in
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h1 className="text-xl font-bold text-navy">Choose a new password</h1>
          <Input label="New password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Confirm new password" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <PasswordRules password={password} confirm={confirm} />
          <FormError error={error} />
          <Button type="submit" pending={pending} disabled={!token || !passwordChecks(password, confirm).every(([, ok]) => ok)}>
            Update password
          </Button>
        </form>
      )}
    </Shell>
  );
}
