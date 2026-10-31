import { ArrowLeft, ChevronRight, LifeBuoy, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../lib/api.js';
import { formatDateTime, relativeTime } from '../../lib/format.js';
import { useApi } from '../../lib/hooks.js';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, FormError, Input, InlineError, ListSkeleton, Pagination, Select, Tabs, Textarea, ThreadSkeleton, useToast } from '../ui.jsx';

// Support requests to TownAnt, shared by the customer site (`/support`, API `/support`) and the
// vendor portal (`/business/support`, API `/vendor/support`). The API scopes every request to
// the caller and never returns staff-only notes.

export const SUPPORT_CATEGORY_LABELS = {
  account: 'Account and sign-in',
  booking: 'A booking or appointment',
  business_concern: 'A concern about a business',
  technical: 'Something isn’t working',
  privacy: 'Privacy and my data',
  feedback: 'Feedback or ideas',
  listing: 'My listing and profile',
  bookings: 'Appointments and calendar',
  team: 'Team members and access',
  other: 'Something else',
};

export const SUPPORT_STATUS = {
  open: { label: 'Open', tone: 'teal' },
  in_progress: { label: 'In progress', tone: 'navy' },
  waiting_on_requester: { label: 'Waiting for your reply', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'green' },
  closed: { label: 'Closed', tone: 'slate' },
};

export function SupportStatusBadge({ status, admin }) {
  const s = SUPPORT_STATUS[status] ?? { label: status, tone: 'slate' };
  return <Badge tone={s.tone}>{admin && status === 'waiting_on_requester' ? 'Waiting on requester' : s.label}</Badge>;
}

export function TicketList({ apiBase, linkBase }) {
  const [tab, setTab] = useState('active');
  const [page, setPage] = useState(1);
  const list = useApi(`${apiBase}/tickets`, { query: { status: tab === 'all' ? undefined : tab, page, limit: 20 } });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Filter requests"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
          }}
          tabs={[
            { value: 'active', label: 'Active' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Link to={`${linkBase}/new`} className="inline-flex h-11 items-center gap-2 rounded-md bg-teal px-4 font-semibold text-white shadow-card transition hover:bg-teal-700">
          <Plus size={18} aria-hidden="true" /> New request
        </Link>
      </div>
      {list.error && !list.data ? (
        <ErrorState compact error={list.error} onRetry={list.reload} title="Your requests didn't load" />
      ) : !list.data ? (
        <ListSkeleton rows={3} avatar={false} label="Loading support requests" />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title={tab === 'active' ? 'No open requests' : 'No requests here'}
          body="If something isn’t right, tell us and we’ll get back to you here."
          action={
            <Link to={`${linkBase}/new`} className="font-semibold text-teal-700 hover:underline">
              Start a support request
            </Link>
          }
        />
      ) : (
        <>
          {list.error && <InlineError error={list.error} onRetry={list.reload} />}
          <ul className="overflow-hidden rounded-card border border-line bg-white shadow-card">
            {list.data.map((t) => (
              <li key={t.id} className="border-b border-line last:border-b-0">
                <Link to={`${linkBase}/${t.id}`} className="flex items-center gap-4 px-4 py-4 transition hover:bg-cloud/70 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {t.unread && <span className="size-2 shrink-0 rounded-full bg-teal" aria-label="New reply" />}
                      <span className="truncate text-card font-semibold text-navy">{t.subject}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-secondary text-muted">
                      <span className="tabular">{t.reference}</span> · {SUPPORT_CATEGORY_LABELS[t.category] ?? t.category} · updated {relativeTime(t.lastMessageAt)}
                    </span>
                  </span>
                  <SupportStatusBadge status={t.status} />
                  <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-subtle" />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination meta={list.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function NewTicketForm({ apiBase, linkBase, intro }) {
  const navigate = useNavigate();
  const toast = useToast();
  const categories = useApi(`${apiBase}/categories`);
  const [form, setForm] = useState({ category: '', subject: '', body: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Mirrors the API's rules so mistakes show next to the field; the API re-validates.
  const problems = {
    category: !form.category ? 'Choose what your request is about.' : null,
    subject: form.subject.trim().length < 4 ? 'Add a short subject (at least 4 characters).' : null,
    body: form.body.trim().length < 10 ? 'Describe the issue in a little more detail (at least 10 characters).' : null,
  };
  const show = (k) => (touched ? problems[k] : null);

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(problems).some(Boolean) || pending) return;
    setPending(true);
    setError(null);
    try {
      const { data } = await api(`${apiBase}/tickets`, { method: 'POST', body: { category: form.category, subject: form.subject.trim(), body: form.body.trim() } });
      toast(`Request ${data.reference} sent`);
      navigate(`${linkBase}/${data.id}`, { replace: true });
    } catch (err) {
      // Everything typed stays in place so the request can be retried.
      setError(err);
      setPending(false);
    }
  };

  const options = (categories.data ?? []).map((c) => ({ value: c, label: SUPPORT_CATEGORY_LABELS[c] ?? c }));
  return (
    <Card className="p-5 sm:p-7">
      {intro}
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {categories.error && !categories.data ? (
          <ErrorState compact error={categories.error} onRetry={categories.reload} title="Request types didn't load" />
        ) : (
          <Select label="What is this about?" required value={form.category} onChange={set('category')} options={options} placeholder={categories.data ? 'Choose a topic' : 'Loading…'} disabled={!categories.data} error={show('category')} />
        )}
        <Input label="Subject" required maxLength={120} value={form.subject} onChange={set('subject')} error={show('subject')} hint="A few words, e.g. “Booking shows the wrong time”." />
        <Textarea label="Describe the issue" required rows={7} maxLength={4000} value={form.body} onChange={set('body')} error={show('body')} hint="Include booking references (TA-…) and what you expected to happen. Please don’t share passwords or card numbers." />
        <FormError error={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link to={linkBase} className="inline-flex h-11 items-center justify-center rounded-md px-4 font-semibold text-teal-700 hover:bg-teal-50">
            Cancel
          </Link>
          <Button type="submit" pending={pending}>
            Send request
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function TicketDetail({ apiBase, linkBase, id }) {
  const ticket = useApi(`${apiBase}/tickets/${id}`);
  const toast = useToast();
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const end = useRef(null);
  const { reload } = ticket;

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 30000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [ticket.data?.messages?.length]);

  if (ticket.error && !ticket.data) {
    return ticket.error.status === 404 ? (
      <EmptyState title="Request not found" body="It may have been opened from another account." action={<Link to={linkBase} className="font-semibold text-teal-700">Back to support</Link>} />
    ) : (
      <ErrorState error={ticket.error} onRetry={ticket.reload} />
    );
  }
  if (!ticket.data) return <ThreadSkeleton />;
  const t = ticket.data;
  const closed = t.status === 'closed';

  const run = async (key, fn, message) => {
    setPending(key);
    setError(null);
    try {
      await fn();
      if (message) toast(message);
      await ticket.reload();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setPending(null);
    }
  };

  const reply = async (e) => {
    e.preventDefault();
    if (body.trim().length < 2) return;
    const ok = await run('reply', () => api(`${apiBase}/tickets/${id}/messages`, { method: 'POST', body: { body: body.trim() } }), 'Reply sent');
    if (ok) setBody('');
  };

  return (
    <div className="flex flex-col gap-5">
      <Link to={linkBase} className="inline-flex w-fit items-center gap-1.5 text-secondary font-semibold text-teal-700 hover:underline">
        <ArrowLeft size={16} aria-hidden="true" /> All requests
      </Link>
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption font-semibold uppercase tracking-wide text-subtle">
              <span className="tabular">{t.reference}</span> · {SUPPORT_CATEGORY_LABELS[t.category] ?? t.category}
            </p>
            <h1 className="mt-1 text-[1.375rem] font-bold leading-tight text-navy">{t.subject}</h1>
            <p className="mt-1 text-secondary text-muted">Opened {formatDateTime(t.createdAt)}</p>
          </div>
          <SupportStatusBadge status={t.status} />
        </div>
        {t.status === 'waiting_on_requester' && (
          <Alert tone="warn" className="mt-4">
            TownAnt support is waiting for your reply.
          </Alert>
        )}
        {t.status === 'resolved' && (
          <Alert tone="success" className="mt-4" action={<Button size="sm" variant="secondary" pending={pending === 'reopen'} onClick={() => run('reopen', () => api(`${apiBase}/tickets/${id}/status`, { method: 'POST', body: { action: 'reopen' } }), 'Request reopened')}>Reopen</Button>}>
            Marked as resolved. Reply or reopen if you still need help.
          </Alert>
        )}
      </Card>

      <ol className="flex flex-col gap-3" aria-label="Messages">
        {t.messages.map((m) => (
          <li key={m.id} className={m.authorType === 'requester' ? 'ml-8 sm:ml-16' : m.authorType === 'system' ? '' : 'mr-8 sm:mr-16'}>
            {m.authorType === 'system' ? (
              <p className="text-center text-caption text-muted">{m.body}</p>
            ) : (
              <div className={m.authorType === 'requester' ? 'rounded-card bg-navy p-4 text-white' : 'rounded-card border border-line bg-white p-4 shadow-card'}>
                <p className={m.authorType === 'requester' ? 'text-caption font-semibold text-white/70' : 'text-caption font-semibold text-teal-700'}>
                  {m.authorType === 'requester' ? 'You' : 'TownAnt support'} · <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                </p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-body">{m.body}</p>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div ref={end} />

      {closed ? (
        <Alert tone="info" title="This request is closed">
          If you still need help,{' '}
          <Link to={`${linkBase}/new`} className="font-semibold underline">
            start a new request
          </Link>
          .
        </Alert>
      ) : (
        <Card className="p-4 sm:p-5">
          <form onSubmit={reply} className="flex flex-col gap-3">
            <Textarea label="Your reply" rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
            <FormError error={error} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              {t.status !== 'resolved' ? (
                <Button variant="ghost" pending={pending === 'resolve'} onClick={() => run('resolve', () => api(`${apiBase}/tickets/${id}/status`, { method: 'POST', body: { action: 'resolve' } }), 'Marked as resolved')}>
                  My issue is resolved
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" pending={pending === 'reply'} disabled={body.trim().length < 2}>
                Send reply
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
