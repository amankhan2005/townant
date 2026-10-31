import { useState } from 'react';
import { Logo } from '../../components/Logo.jsx';
import { passwordChecks, PasswordRules } from '../../components/PasswordRules.jsx';
import { Alert, Button, Card, FormError, Input } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';

export { passwordChecks, PasswordRules };

// Staff (vendor or Super Admin) password change: current password, new password and confirmation.
export function PasswordChangeForm({ email, onChanged, submitLabel = 'Update password', currentLabel = 'Current password' }) {
  const { refresh } = useAuth();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const ready = pw.currentPassword && passwordChecks(pw.newPassword, pw.confirmPassword).every(([, ok]) => ok);
  const set = (k) => (e) => setPw((p) => ({ ...p, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/staff-auth/password/change', { method: 'POST', body: pw });
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      await refresh();
      onChanged?.(data);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {/* Lets password managers attach the new password to the right account. */}
      <input type="email" name="username" autoComplete="username" value={email ?? ''} readOnly hidden />
      <Input label={currentLabel} type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={set('currentPassword')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="New password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={pw.newPassword} onChange={set('newPassword')} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" required value={pw.confirmPassword} onChange={set('confirmPassword')} />
      </div>
      <PasswordRules password={pw.newPassword} confirm={pw.confirmPassword} />
      <FormError error={error} />
      <div>
        <Button type="submit" pending={pending} disabled={!ready}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// Full-screen gate after signing in with a temporary password. The API refuses every other request
// until this succeeds, so this is the only thing the portal shows.
export function ForcedPasswordChange() {
  useDocumentTitle('Choose a new password');
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-cloud px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <Logo suffix="Business" />
        </div>
        <Card className="flex flex-col gap-5 p-6">
          <div>
            <h1 className="text-xl font-bold text-navy">Choose a new password</h1>
            <p className="subtitle mt-1 text-sm">You signed in with a temporary password from TownAnt. Replace it to open your business portal.</p>
          </div>
          <Alert tone="info">Only you will know the new password. TownAnt staff can’t see it.</Alert>
          <PasswordChangeForm email={user?.email} currentLabel="Temporary password" submitLabel="Save and continue" />
          <button type="button" onClick={logout} className="self-start text-sm text-muted hover:text-navy hover:underline">
            Sign out
          </button>
        </Card>
      </div>
    </div>
  );
}
