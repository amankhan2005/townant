import { useState } from 'react';
import { Card, PageHeader, Table, TableSkeleton, Toggle, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useVendor } from './BusinessApp.jsx';
import { PasswordChangeForm } from './PasswordForms.jsx';

export default function Settings() {
  useDocumentTitle('Settings');
  const { user, refresh } = useAuth();
  const { permissions, role } = useVendor();
  const toast = useToast();
  const [prefs, setPrefs] = useState(user.notificationPrefs);
  const team = useApi('/vendor/team', { enabled: permissions.includes('company:write') });

  const savePrefs = async (next) => {
    setPrefs(next);
    await api('/me', { method: 'PATCH', body: { notificationPrefs: next } });
    await refresh();
    toast('Notification settings saved');
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" subtitle={`Signed in as ${user.email} · ${role}`} />
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold text-navy">Notifications</h2>
        <Toggle label="Email updates" description="New bookings, changes and customer messages." checked={prefs.email} onChange={(v) => savePrefs({ ...prefs, email: v })} />
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold text-navy">Change password</h2>
        <p className="subtitle mb-4 mt-0.5 text-sm">You stay signed in here; other sessions are signed out. Forgot it? Sign out and use “Forgot password”.</p>
        <PasswordChangeForm email={user.email} onChanged={(data) => toast(data.message)} />
      </Card>
      {permissions.includes('company:write') && !team.data && !team.error && <TableSkeleton columns={4} rows={2} label="Loading team" />}
      {team.data && (
        <div>
          <h2 className="mb-3 font-semibold text-navy">Team</h2>
          <Table
            rowKey="userId"
            rows={team.data}
            columns={[
              { key: 'name', label: 'Name', render: (m) => m.name ?? '—' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role', render: (m) => <span className="capitalize">{m.role}</span> },
              { key: 'status', label: 'Account', render: (m) => <span className="capitalize">{m.status}</span> },
            ]}
          />
          <p className="mt-2 text-xs text-muted">To add or remove team members, contact TownAnt support.</p>
        </div>
      )}
    </div>
  );
}
