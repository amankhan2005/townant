import { KeyRound, LogOut, Monitor, ShieldCheck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, FormError, Input, TextSkeleton, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { AdminPage, Panel } from './kit.jsx';
import { PasswordChangeForm } from '../business/PasswordForms.jsx';

// The signed-in Super Admin's own profile, password and sessions. Password changes go through the
// existing staff endpoint (current password required, scrypt hashing, other sessions revoked).
export default function AdminAccount() {
  useDocumentTitle('Profile & security');
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.displayName ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const saveName = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/me', { method: 'PATCH', body: { displayName: name.trim() } });
      await refresh();
      toast('Profile saved');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <AdminPage width="default" title="Profile & security" description="Your Super Admin profile, password and signed-in devices. Changes here are audited.">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Panel title="Profile" description="Shown to other administrators in the audit log and support desk.">
            <form onSubmit={saveName} className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <Input className="flex-1" label="Display name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              <Button type="submit" pending={pending} disabled={!name.trim() || name.trim() === (user.displayName ?? '')}>
                Save
              </Button>
            </form>
            <div className="mt-4">
              <FormError error={error} />
            </div>
          </Panel>
          <Panel title="Change password" description="You stay signed in here; every other session is signed out.">
            <PasswordChangeForm email={user.email} onChanged={() => toast('Password changed. Other sessions were signed out.')} />
          </Panel>
          <Sessions />
        </div>
        <aside className="flex flex-col gap-4">
          <SecurityFact icon={UserRound} tone="bg-sky-50 text-sky-700" title="Signed in as" body={user.email} />
          <SecurityFact icon={ShieldCheck} tone="bg-teal-50 text-teal-700" title="Two-step verification" body="On — every sign-in needs a code sent to your email." badge={<Badge tone="green" dot>Required</Badge>} />
          <SecurityFact icon={KeyRound} tone="bg-violet-50 text-violet-700" title="Forgot your password?" body="Sign out, then choose “Forgot password” on the admin sign-in page. We email a single-use link that expires in 1 hour; the response never reveals whether an address has an account." />
        </aside>
      </div>
    </AdminPage>
  );
}

function SecurityFact({ icon: Icon, tone, title, body, badge }) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-200/80 bg-white p-4">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tone}`} aria-hidden="true">
        <Icon size={17} strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-secondary font-semibold text-slate-900">
          {title} {badge}
        </p>
        <p className="mt-0.5 break-words text-secondary text-slate-600">{body}</p>
      </div>
    </div>
  );
}

function Sessions() {
  const toast = useToast();
  const sessions = useApi('/me/sessions');
  const [confirm, setConfirm] = useState(false);
  const others = (sessions.data ?? []).filter((s) => !s.current);
  return (
    <Panel
      flush
      title="Signed-in devices"
      description="Admin sessions end after 30 minutes of inactivity or 12 hours."
      actions={
        others.length > 0 && (
          <Button size="sm" variant="secondary" icon={<LogOut size={15} aria-hidden="true" />} onClick={() => setConfirm(true)}>
            Sign out other devices
          </Button>
        )
      }
    >
      {!sessions.data ? (
        <div className="p-5">
          <TextSkeleton lines={3} />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sessions.data.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3.5 text-secondary">
              <Monitor size={18} aria-hidden="true" className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-800">{s.userAgent || 'Unknown device'}</span>
                <span className="block text-caption text-slate-500">Active {relativeTime(s.lastSeenAt)}</span>
              </span>
              {s.current && <Badge tone="teal">This device</Badge>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Sign out other devices?"
        description="Every other admin session ends immediately."
        confirmLabel="Sign out others"
        onConfirm={async () => {
          const { data } = await api('/me/sessions/revoke-others', { method: 'POST' });
          toast(`Signed out ${data.revoked} other session${data.revoked === 1 ? '' : 's'}`);
          sessions.reload();
        }}
      />
    </Panel>
  );
}
