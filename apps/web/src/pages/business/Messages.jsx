import { Link, useParams } from 'react-router';
import { ConversationThread } from '../../components/Conversation.jsx';
import { Badge, EmptyState, ErrorState, ListSkeleton, PageHeader } from '../../components/ui.jsx';
import { relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Gate } from './BusinessApp.jsx';

export default function Messages() {
  useDocumentTitle('Messages');
  const { id } = useParams();
  const list = useApi('/vendor/conversations');
  return (
    <Gate permission="messages">
      <PageHeader title="Messages" subtitle="Customer inquiries and booking conversations." />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className={id ? 'hidden lg:block' : ''}>
          {list.error && !list.data && <ErrorState compact error={list.error} onRetry={list.reload} />}
          {!list.data && !list.error && <ListSkeleton rows={3} avatar={false} label="Loading conversations" />}
          {list.data?.length === 0 && <EmptyState title="No messages yet" body="Questions from customers will appear here." />}
          <ul className="flex flex-col gap-2">
            {list.data?.map((c) => (
              <li key={c.id}>
                <Link to={`/business/messages/${c.id}`} className={`block rounded-xl border p-3 ${c.id === id ? 'border-teal bg-teal-50' : 'border-line bg-white hover:border-teal'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-navy">{c.customer?.name}</span>
                    {c.unread > 0 && <Badge tone="teal">{c.unread} new</Badge>}
                  </div>
                  {c.subject && <p className="truncate text-xs text-muted">{c.subject}</p>}
                  <p className="truncate text-sm text-slate">{c.lastMessagePreview}</p>
                  <p className="text-xs text-muted tabular">
                    {relativeTime(c.lastMessageAt)}
                    {c.bookingId && ' · booking'}
                    {c.status === 'closed' && ' · closed'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-h-[60vh] rounded-card border border-line bg-white">
          {id ? <ConversationThread key={id} basePath="/vendor/conversations" id={id} side="vendor" onChanged={list.reload} /> : <div className="flex h-full items-center justify-center p-8 text-sm text-muted">Select a conversation</div>}
        </div>
      </div>
    </Gate>
  );
}
