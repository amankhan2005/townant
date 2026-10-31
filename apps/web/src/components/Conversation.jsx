import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { useApi } from '../lib/hooks.js';
import { PolishButton } from './PolishButton.jsx';
import { Alert, Button, ErrorState, Textarea, ThreadSkeleton } from './ui.jsx';

// A message thread shared by the customer site and the vendor portal. `basePath` decides
// which side's API is used; the server checks participation on every call.
export function ConversationThread({ basePath, id, side, onChanged }) {
  const thread = useApi(`${basePath}/${id}/messages`);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const end = useRef(null);
  const { reload } = thread;

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 15000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [thread.data?.messages?.length]);

  if (thread.error && !thread.data) return <ErrorState compact error={thread.error} onRetry={thread.reload} />;
  if (!thread.data) return <ThreadSkeleton />;
  const { conversation, messages } = thread.data;
  const closed = conversation.status === 'closed';
  const mine = side === 'customer' ? 'customer' : 'vendor';

  const send = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api(`${basePath}/${id}/messages`, { method: 'POST', body: { body: body.trim() } });
      setBody('');
      await thread.reload();
      onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const close = async () => {
    await api(`${basePath}/${id}/close`, { method: 'POST' });
    await thread.reload();
    onChanged?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="font-semibold text-navy">{side === 'customer' ? conversation.company?.name : conversation.customer?.name}</p>
          {conversation.subject && <p className="text-xs text-muted">{conversation.subject}</p>}
        </div>
        {!closed && (
          <Button size="sm" variant="ghost" onClick={close}>
            Close conversation
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderType === mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.senderType === mine ? 'bg-teal text-white' : 'bg-cloud text-slate'}`}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={`mt-1 text-[11px] ${m.senderType === mine ? 'text-white/70' : 'text-muted'}`}>{relativeTime(m.createdAt)}</p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {closed && side !== 'customer' ? (
        <Alert className="m-4" tone="info">This conversation is closed. The customer can reopen it by replying.</Alert>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-2 border-t border-line p-4">
          {closed && <p className="text-xs text-muted">This conversation was closed. Sending a message reopens it.</p>}
          <Textarea label="Message" rows={2} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
          {error && <p className="text-sm text-danger">{error.message}</p>}
          <div className="flex items-center justify-between">
            <PolishButton text={body} onAccept={setBody} />
            <Button type="submit" pending={pending} disabled={!body.trim()}>
              Send
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
