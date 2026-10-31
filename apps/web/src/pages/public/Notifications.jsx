import { Bell } from 'lucide-react';
import { Link } from 'react-router';
import { RequireCustomer } from '../../components/RequireCustomer.jsx';
import { Button, EmptyState, ErrorState, ListSkeleton, PageHeader } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';

export default function Notifications() {
  useDocumentTitle('Notifications');
  return (
    <RequireCustomer>
      <NotificationList />
    </RequireCustomer>
  );
}

export function NotificationList({ linkPrefix = '' }) {
  const list = useApi('/notifications', { query: { limit: 30 } });
  const markAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    list.reload();
  };
  // Links are app-relative paths from the server; anything else is not followed.
  const safe = (link) => (link && link.startsWith('/') && !link.startsWith('//') ? link : null);
  return (
    <div className="mx-auto max-w-3xl gutter py-8">
      <PageHeader
        title="Notifications"
        actions={
          list.meta?.unread > 0 && (
            <Button variant="secondary" onClick={markAll}>
              Mark all as read
            </Button>
          )
        }
      />
      {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <ListSkeleton rows={4} avatar={false} label="Loading notifications" />}
      {list.data?.length === 0 && <EmptyState icon={Bell} title="You're all caught up" body="Booking updates and messages will show up here." />}
      <ul className="flex flex-col gap-2">
        {list.data?.map((n) => {
          const to = safe(n.link);
          const content = (
            <div className={`flex gap-3 rounded-xl border p-4 ${n.read ? 'border-line bg-white' : 'border-teal/40 bg-teal-50'}`}>
              {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-teal" aria-label="Unread" />}
              <div className="min-w-0">
                <p className="font-semibold text-navy">{n.title}</p>
                {n.body && <p className="text-sm text-slate">{n.body}</p>}
                <p className="mt-1 text-xs text-muted tabular">{relativeTime(n.createdAt)}</p>
              </div>
            </div>
          );
          return (
            <li key={n.id}>
              {to ? (
                <Link to={linkPrefix + to} onClick={() => !n.read && api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {})}>
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
