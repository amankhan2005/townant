import { MessageSquare } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ConversationThread } from '../../components/Conversation.jsx';
import { RequireCustomer } from '../../components/RequireCustomer.jsx';
import { Badge, EmptyState, ErrorState, ListSkeleton, PageHeader } from '../../components/ui.jsx';
import { relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';

export default function Messages() {
  useDocumentTitle('Messages');
  return (
    <RequireCustomer>
      <Inbox />
    </RequireCustomer>
  );
}

function Inbox() {
  const { id } = useParams();
  const list = useApi('/conversations');
  return (
    <div className="mx-auto max-w-6xl gutter py-8">
      <PageHeader title="Messages" />
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <div className={id ? 'hidden md:block' : ''}>
          {list.error && !list.data && <ErrorState compact error={list.error} onRetry={list.reload} />}
          {!list.data && !list.error && <ListSkeleton rows={3} avatar={false} label="Loading conversations" />}
          {list.data?.length === 0 && <EmptyState icon={MessageSquare} title="No messages yet" body="Ask a business a question from its profile page." />}
          <ul className="flex flex-col gap-2">
            {list.data?.map((c) => (
              <li key={c.id}>
                <Link to={`/messages/${c.id}`} className={`block rounded-xl border p-3 ${c.id === id ? 'border-teal bg-teal-50' : 'border-line bg-white hover:border-teal'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-navy">{c.company?.name}</span>
                    {c.unread > 0 && <Badge tone="teal">{c.unread} new</Badge>}
                  </div>
                  <p className="truncate text-sm text-muted">{c.lastMessagePreview}</p>
                  <p className="text-xs text-muted tabular">
                    {relativeTime(c.lastMessageAt)}
                    {c.status === 'closed' && ' · closed'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-h-[60vh] rounded-card border border-line bg-white">
          {id ? (
            <>
              <Link to="/messages" className="block px-4 pt-3 text-sm font-semibold text-teal md:hidden">
                ← All messages
              </Link>
              <ConversationThread key={id} basePath="/conversations" id={id} side="customer" onChanged={list.reload} />
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted">Select a conversation</div>
          )}
        </div>
      </div>
    </div>
  );
}
