import { KeyRound, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDate } from '../lib/format.js';
import { passwordChecks, PasswordRules } from './PasswordRules.jsx';
import { Alert, Button, Card, FormError, Input, useToast } from './ui.jsx';

// Customer passwords are optional: one-time codes always work. These pieces add password sign-in,
// code-based password reset, account restoration after a verified code, and password management.

export function ChannelTabs({ channel, onChange, channels }) {
  return (
    <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 rounded-lg bg-cloud p-1">
      {[
        ['email', 'Email'],
        ['whatsapp', 'WhatsApp'],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={channel === value}
          disabled={!channels[value]}
          onClick={() => onChange(value)}
          className={`rounded-md py-2 text-sm font-semibold transition ${channel === value ? 'bg-white text-navy shadow-sm' : 'text-muted'} disabled:opacity-40`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DestinationInput({ channel, value, onChange, autoFocus }) {
  return channel === 'email' ? (
    <Input label="Email address" type="email" autoComplete="email" value={value} onChange={(e) => onChange(e.target.value)} required autoFocus={autoFocus} />
  ) : (
    <Input label="Mobile number" type="tel" autoComplete="tel" placeholder="+1 512 555 0100" hint="Include your country code." value={value} onChange={(e) => onChange(e.target.value)} required autoFocus={autoFocus} />
  );
}

// Shown after a correct sign-in code for an account that is pending deletion. Nothing is restored
// until the customer confirms here; declining leaves the deletion scheduled.
export function RestoreAccount({ pending: info, onRestored, onCancel }) {
  const { signedIn } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api('/auth/account/restore', { method: 'POST', body: { restoreToken: info.restoreToken, confirm: 'RESTORE' } });
      signedIn(data);
      onRestored?.(data.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4" role="region" aria-labelledby="restore-heading">
      <span className="flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-text">
        <RotateCcw size={20} aria-hidden="true" />
      </span>
      <div>
        <h2 id="restore-heading" className="text-lg font-bold text-navy">
          This account is scheduled for deletion
        </h2>
        <p className="mt-1 text-sm text-muted">
          You asked to delete it{info.recoverUntil ? `, and it will be permanently deleted on ${formatDate(info.recoverUntil)}` : ''}. Restore it to keep your saved businesses, reviews and history. Appointments that were cancelled are not rebooked.
        </p>
      </div>
      <FormError error={error} />
      <Button size="lg" pending={busy} onClick={restore} icon={<RotateCcw size={17} aria-hidden="true" />}>
        Restore my account
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Keep it scheduled for deletion
      </Button>
    </div>
  );
}

// Email/phone + password. Accounts pending deletion always need a code instead.
export function PasswordSignIn({ onDone, onUseCode }) {
  const { channels, signedIn } = useAuth();
  const [channel, setChannel] = useState('email');
  const [destination, setDestination] = useState('');
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  if (forgot) return <ForgotCustomerPassword channel={channel} initial={destination} onBack={() => setForgot(false)} />;
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/auth/password/login', { method: 'POST', body: { channel, [channel === 'email' ? 'email' : 'phone']: destination.trim(), password } });
      signedIn(data);
      onDone?.(data.user);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ChannelTabs channel={channel} onChange={setChannel} channels={channels} />
      <DestinationInput channel={channel} value={destination} onChange={setDestination} autoFocus />
      <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <FormError error={error} />
      {error?.code === 'RESTORE_REQUIRES_CODE' && (
        <Button variant="secondary" onClick={onUseCode}>
          Sign in with a code to restore
        </Button>
      )}
      <Button type="submit" size="lg" pending={pending}>
        Sign in
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="text-teal hover:underline" onClick={() => setForgot(true)}>
          Forgot password?
        </button>
        <button type="button" className="text-teal hover:underline" onClick={onUseCode}>
          Use a one-time code instead
        </button>
      </div>
    </form>
  );
}

// Reset by code: works only for an active account that has a password. The first response is the
// same whether or not such an account exists.
function ForgotCustomerPassword({ channel: initialChannel, initial, onBack }) {
  const { channels } = useAuth();
  const toast = useToast();
  const [channel, setChannel] = useState(initialChannel);
  const [destination, setDestination] = useState(initial);
  const [challenge, setChallenge] = useState(null);
  const [form, setForm] = useState({ code: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const field = channel === 'email' ? 'email' : 'phone';
  const send = async (e) => {
    e?.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/auth/password/forgot', { method: 'POST', body: { channel, [field]: destination.trim() } });
      setChallenge(data);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const reset = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { channel, [field]: destination.trim(), challengeId: challenge.challengeId, code: form.code, password: form.password, confirmPassword: form.confirm } });
      setDone(true);
      toast('Password updated');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info">Password updated and other sessions signed out. Sign in with your new password or a one-time code.</Alert>
        <Button onClick={onBack}>Back to sign in</Button>
      </div>
    );
  }
  return challenge ? (
    <form onSubmit={reset} className="flex flex-col gap-4">
      <p className="text-sm text-slate">{challenge.message} It was sent to {challenge.maskedDestination} and expires in 10 minutes.</p>
      <Input label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, '') }))} required autoFocus />
      <Input label="New password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
      <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} required />
      <PasswordRules password={form.password} confirm={form.confirm} />
      <FormError error={error} />
      <Button type="submit" size="lg" pending={pending} disabled={form.code.length !== 6 || !passwordChecks(form.password, form.confirm).every(([, ok]) => ok)}>
        Set new password
      </Button>
      <button type="button" className="text-sm text-teal hover:underline" onClick={onBack}>
        Back to sign in
      </button>
    </form>
  ) : (
    <form onSubmit={send} className="flex flex-col gap-4">
      <p className="text-sm text-muted">We’ll send a code to reset the password on your account. Accounts without a password can simply sign in with a code.</p>
      <ChannelTabs channel={channel} onChange={setChannel} channels={channels} />
      <DestinationInput channel={channel} value={destination} onChange={setDestination} autoFocus />
      <FormError error={error} />
      <Button type="submit" size="lg" pending={pending}>
        Send reset code
      </Button>
      <button type="button" className="text-sm text-teal hover:underline" onClick={onBack}>
        Back to sign in
      </button>
    </form>
  );
}

// Account settings: add (needs a fresh code), change (needs the current password) or remove a password.
export function CustomerPasswordCard() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState(null);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '', code: '' });
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const channel = user.emailVerified && user.email ? 'email' : user.phoneVerified && user.phone ? 'whatsapp' : null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === 'code' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value }));
  const close = () => {
    setMode(null);
    setChallenge(null);
    setError(null);
    setForm({ currentPassword: '', newPassword: '', confirmPassword: '', code: '' });
  };
  const call = async (key, fn) => {
    setPending(key);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setPending(null);
    }
  };
  const sendCode = () =>
    call('code', async () => {
      const { data } = await api('/me/password/challenge', { method: 'POST', body: { channel } });
      setChallenge(data);
    });
  const save = (e) => {
    e.preventDefault();
    call('save', async () => {
      const body = user.hasPassword
        ? { currentPassword: form.currentPassword, newPassword: form.newPassword, confirmPassword: form.confirmPassword }
        : { newPassword: form.newPassword, confirmPassword: form.confirmPassword, channel: challenge.channel, challengeId: challenge.challengeId, code: form.code };
      const { data } = await api('/me/password', { method: 'PUT', body });
      await refresh();
      toast(data.message);
      close();
    });
  };
  const remove = (e) => {
    e.preventDefault();
    call('remove', async () => {
      const { data } = await api('/me/password', { method: 'DELETE', body: { currentPassword: form.currentPassword } });
      await refresh();
      toast(data.message);
      close();
    });
  };
  const ready = passwordChecks(form.newPassword, form.confirmPassword).every(([, ok]) => ok) && (user.hasPassword ? form.currentPassword : challenge && form.code.length === 6);
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start gap-3">
        <KeyRound size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" />
        <div>
          <h2 className="font-semibold text-navy">Password</h2>
          <p className="subtitle text-sm">{user.hasPassword ? 'You can sign in with your password or a one-time code.' : 'Optional. One-time codes always work; a password is an extra way to sign in.'}</p>
        </div>
      </div>
      {!mode && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!channel && !user.hasPassword} onClick={() => setMode('set')}>
            {user.hasPassword ? 'Change password' : 'Add a password'}
          </Button>
          {user.hasPassword && (
            <Button variant="ghost" onClick={() => setMode('remove')}>
              Remove password
            </Button>
          )}
        </div>
      )}
      {mode === 'set' && (
        <form onSubmit={save} className="flex flex-col gap-4">
          {user.hasPassword ? (
            <Input label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required />
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              {challenge && <Input className="w-56" label={`Code sent to ${challenge.maskedDestination}`} inputMode="numeric" autoComplete="one-time-code" value={form.code} onChange={set('code')} required />}
              <Button variant="secondary" pending={pending === 'code'} onClick={sendCode}>
                {challenge ? 'Send a new code' : 'Send a code to confirm it’s you'}
              </Button>
            </div>
          )}
          <input type="text" name="username" autoComplete="username" value={user.email ?? user.phone ?? ''} readOnly hidden />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} required />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set('confirmPassword')} required />
          </div>
          <PasswordRules password={form.newPassword} confirm={form.confirmPassword} />
          <FormError error={error} />
          <div className="flex gap-2">
            <Button type="submit" pending={pending === 'save'} disabled={!ready}>
              Save password
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === 'remove' && (
        <form onSubmit={remove} className="flex flex-col gap-4">
          <p className="text-sm text-slate">After removing it you sign in with one-time codes only.</p>
          <Input label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required />
          <FormError error={error} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" pending={pending === 'remove'} disabled={!form.currentPassword}>
              Remove password
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
