import { Inbox, Lock, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { SUPPORT_CATEGORY_LABELS, SupportStatusBadge } from '../../components/support/Support.jsx';
import { Badge, Button, cx, DateRangePicker, DetailSkeleton, ErrorState, FormError, SearchInput, Select, Table, Tabs, Textarea, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime, relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { AdminPage, DataPanel, Panel, PanelEmpty } from './kit.jsx';

// Super Admin support desk: every customer and vendor request, with replies, internal notes,
// status, priority and assignment. All changes are audited by the API.

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active (not resolved)' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_on_requester', label: 'Waiting on requester' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: '', label: 'Any status' },
];
const SET_STATUS = STATUS_OPTIONS.filter((o) => o.value && o.value !== 'active');
const PRIORITY_TONE = { low: 'slate', normal: 'slate', high: 'amber', urgent: 'red' };
const label = (s) => s.charAt(0).toUpperCase() + s.slice(1).replaceAll('_', ' ');

export default function Support() {
  const { id } = useParams();
  return id ? <TicketDesk id={id} /> : <TicketQueue />;
}

function useFilters() {
  const [params, setParams] = useSearchParams();
  const get = (k, fallback = '') => params.get(k) ?? fallback;
  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v !== undefined && v !== null ? next.set(k, v) : next.delete(k)));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  return { get, set, page: Number(params.get('page') ?? 1) };
}

function TicketQueue() {
  useDocumentTitle('Support');
  const navigate = useNavigate();
  const f = useFilters();
  const meta = useApi('/admin/support/meta');
  const status = f.get('status', 'active');
  const query = {
    status: status || undefined,
    awaiting: f.get('awaiting') || undefined,
    requesterType: f.get('requesterType') || undefined,
    category: f.get('category') || undefined,
    priority: f.get('priority') || undefined,
    assignee: f.get('assignee') || undefined,
    q: f.get('q') || undefined,
    from: f.get('from') || undefined,
    to: f.get('to') || undefined,
    page: f.page,
    limit: 25,
  };
  const list = useApi('/admin/support/tickets', { query });
  const m = meta.data;
  const allCategories = m ? [...new Set([...m.categories.customer, ...m.categories.vendor])] : [];
  const assignees = new Map((m?.assignees ?? []).map((a) => [a.id, a.label]));

  const views = [
    ['awaiting', 'Needs a reply', Inbox, m?.counts.awaitingSupport, { status: 'active', awaiting: 'support', assignee: null }, f.get('awaiting') === 'support'],
    ['unassigned', 'Unassigned', UserRoundX, m?.counts.unassigned, { status: 'active', assignee: 'none', awaiting: null }, f.get('assignee') === 'none' && !f.get('awaiting')],
    ['mine', 'Assigned to me', UserRoundCheck, null, { status: 'active', assignee: 'me', awaiting: null }, f.get('assignee') === 'me' && !f.get('awaiting')],
  ];
  return (
    <AdminPage title="Support" description="Requests from customers and vendors. Replies notify the requester; internal notes never leave this console.">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick views">
        {views.map(([key, text, Icon, count, patch, active]) => (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => f.set(patch)}
            className={cx('inline-flex h-10 items-center gap-2 rounded-md border px-3.5 text-secondary font-semibold transition', active ? 'border-teal bg-teal-50 text-teal-700' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50')}
          >
            <Icon size={16} aria-hidden="true" />
            {text}
            {count != null && <span className={cx('rounded-full px-1.5 text-caption tabular', active ? 'bg-white text-teal-700' : 'bg-slate-50 text-slate-500')}>{count}</span>}
          </button>
        ))}
      </div>
      <DataPanel
        state={list}
        columns={6}
        onPage={(p) => f.set({ page: String(p) })}
        filters={
          <>
            <SearchInput label="Reference or subject" labelHidden={false} value={f.get('q')} onDebouncedChange={(v) => f.set({ q: v.trim() || null })} placeholder="SUP-… or words" className="w-full sm:w-64" />
            <Select label="Status" value={status} onChange={(e) => f.set({ status: e.target.value })} options={STATUS_OPTIONS} className="w-52" />
            <Select label="Waiting on" value={f.get('awaiting')} onChange={(e) => f.set({ awaiting: e.target.value || null })} options={[{ value: '', label: 'Anyone' }, { value: 'support', label: 'Support' }, { value: 'requester', label: 'Requester' }]} className="w-40" />
            <Select label="Requester" value={f.get('requesterType')} onChange={(e) => f.set({ requesterType: e.target.value || null })} options={[{ value: '', label: 'Customers and vendors' }, { value: 'customer', label: 'Customers' }, { value: 'vendor', label: 'Vendors' }]} className="w-60" />
            <Select label="Category" value={f.get('category')} onChange={(e) => f.set({ category: e.target.value || null })} options={[{ value: '', label: 'All categories' }, ...allCategories.map((c) => ({ value: c, label: SUPPORT_CATEGORY_LABELS[c] ?? c }))]} className="w-52" />
            <Select label="Priority" value={f.get('priority')} onChange={(e) => f.set({ priority: e.target.value || null })} options={[{ value: '', label: 'Any priority' }, ...(m?.priorities ?? []).map((p) => ({ value: p, label: label(p) }))]} className="w-40" />
            <Select
              label="Assignee"
              value={f.get('assignee')}
              onChange={(e) => f.set({ assignee: e.target.value || null })}
              options={[{ value: '', label: 'Anyone' }, { value: 'me', label: 'Me' }, { value: 'none', label: 'Unassigned' }, ...(m?.assignees ?? []).map((a) => ({ value: a.id, label: a.label }))]}
              className="w-44"
            />
            <DateRangePicker label="Created" from={f.get('from') || null} to={f.get('to') || null} onChange={({ from, to }) => f.set({ from: from || null, to: to || null })} timeZone="UTC" />
          </>
        }
        empty={<PanelEmpty icon={Inbox} title="No requests match" body="Try another status or clear the filters." />}
      >
        {(rows) => (
          <Table
            bare
            caption="Support requests"
            rows={rows}
            onRowClick={(r) => navigate(`/admin/support/${r.id}`)}
            columns={[
              {
                key: 'subject',
                label: 'Request',
                render: (r) => (
                  <span className="block min-w-[14rem]">
                    <Link to={`/admin/support/${r.id}`} onClick={(e) => e.stopPropagation()} className="block font-semibold text-slate-900 hover:text-teal-700">
                      {r.subject}
                    </Link>
                    <span className="text-caption text-slate-500 tabular">
                      {r.reference} · {SUPPORT_CATEGORY_LABELS[r.category] ?? r.category}
                    </span>
                  </span>
                ),
              },
              {
                key: 'requester',
                label: 'Requester',
                render: (r) => (
                  <span className="block">
                    <Badge tone={r.requesterType === 'vendor' ? 'navy' : 'slate'}>{r.requesterType === 'vendor' ? 'Vendor' : 'Customer'}</Badge>
                    <span className="mt-1 block text-caption text-slate-500">{r.requester.company?.name ?? r.requester.name ?? r.requester.email ?? '—'}</span>
                  </span>
                ),
              },
              { key: 'status', label: 'Status', render: (r) => <SupportStatusBadge status={r.status} admin /> },
              { key: 'priority', label: 'Priority', render: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{label(r.priority)}</Badge> },
              { key: 'assignee', label: 'Assignee', render: (r) => (r.assigneeId ? assignees.get(r.assigneeId) ?? 'Admin' : <span className="text-slate-500">Unassigned</span>) },
              {
                key: 'updated',
                label: 'Last activity',
                render: (r) => (
                  <span className="whitespace-nowrap text-slate-500">
                    {relativeTime(r.lastMessageAt)}
                    {r.awaiting === 'support' && !['resolved', 'closed'].includes(r.status) && <span className="block text-caption font-semibold text-amber-text">Needs a reply</span>}
                  </span>
                ),
              },
            ]}
          />
        )}
      </DataPanel>
    </AdminPage>
  );
}

function TicketDesk({ id }) {
  const ticket = useApi(`/admin/support/tickets/${id}`);
  const meta = useApi('/admin/support/meta');
  const toast = useToast();
  const [mode, setMode] = useState('reply');
  const [body, setBody] = useState('');
  const [replyStatus, setReplyStatus] = useState('waiting_on_requester');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  useDocumentTitle(ticket.data ? `${ticket.data.reference} · Support` : 'Support');

  if (ticket.error && !ticket.data)
    return (
      <AdminPage title="Support request" breadcrumbs={[{ label: 'Support', to: '/admin/support' }, { label: 'Request' }]}>
        <ErrorState error={ticket.error} onRetry={ticket.reload} />
      </AdminPage>
    );
  if (!ticket.data) return <DetailSkeleton />;
  const t = ticket.data;
  const assignees = meta.data?.assignees ?? [];

  const run = async (key, fn, message) => {
    setPending(key);
    setError(null);
    try {
      await fn();
      toast(message);
      await ticket.reload();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setPending(null);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const internal = mode === 'note';
    const ok = await run('send', () => api(`/admin/support/tickets/${id}/messages`, { method: 'POST', body: { body: body.trim(), internal, ...(internal ? {} : { status: replyStatus }) } }), internal ? 'Internal note added' : 'Reply sent');
    if (ok) setBody('');
  };
  const update = (patch, message) => run('update', () => api(`/admin/support/tickets/${id}`, { method: 'PATCH', body: patch }), message);
  const canReply = !t.requesterDeleted;

  return (
    <AdminPage
      width="wide"
      breadcrumbs={[{ label: 'Support', to: '/admin/support' }, { label: t.reference }]}
      eyebrow={`${t.reference} · ${SUPPORT_CATEGORY_LABELS[t.category] ?? t.category}`}
      title={t.subject}
      actions={
        <>
          <SupportStatusBadge status={t.status} admin />
          <Badge tone={PRIORITY_TONE[t.priority]}>{label(t.priority)} priority</Badge>
          {t.awaiting === 'support' && !['resolved', 'closed'].includes(t.status) && <Badge tone="amber">Needs a reply</Badge>}
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <ol className="flex flex-col gap-3" aria-label="Conversation">
            {t.messages.map((m) => (
              <li key={m.id}>
                {m.authorType === 'system' ? (
                  <p className="text-center text-xs text-slate-500">{m.body}</p>
                ) : (
                  <div className={m.internal ? 'rounded-xl border border-dashed border-amber/60 bg-amber-50 p-4' : m.authorType === 'support' ? 'ml-6 rounded-xl border border-teal/20 bg-teal-50/60 p-4' : 'mr-6 rounded-xl border border-slate-200 bg-white p-4 shadow-card'}>
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                      {m.internal && <Lock size={12} aria-hidden="true" />}
                      {m.internal ? `Internal note · ${m.authorLabel}` : m.authorType === 'support' ? `Reply · ${m.authorLabel}` : t.requester.name || t.requester.email || 'Requester'}
                      <span aria-hidden="true">·</span>
                      <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-body text-slate-700">{m.body}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>

          <Panel title={mode === 'note' ? 'Add an internal note' : 'Reply'}>
            <form onSubmit={send} className="flex flex-col gap-3">
              <Tabs
                label="Message type"
                value={mode}
                onChange={setMode}
                tabs={[
                  { value: 'reply', label: 'Reply to requester' },
                  { value: 'note', label: 'Internal note' },
                ]}
              />
              {mode === 'reply' && !canReply ? (
                <p className="text-sm text-slate-500">The requester deleted their account, so replies can&rsquo;t be delivered. You can still add internal notes.</p>
              ) : (
                <>
                  <Textarea
                    label={mode === 'note' ? 'Internal note (visible to Super Admins only)' : 'Reply (the requester is notified)'}
                    rows={5}
                    maxLength={4000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    {mode === 'reply' ? <Select label="Then set status to" value={replyStatus} onChange={(e) => setReplyStatus(e.target.value)} options={SET_STATUS} className="sm:w-64" /> : <span />}
                    <Button type="submit" pending={pending === 'send'} disabled={body.trim().length < 2} variant={mode === 'note' ? 'secondary' : 'primary'}>
                      {mode === 'note' ? 'Add note' : 'Send reply'}
                    </Button>
                  </div>
                </>
              )}
              <FormError error={error} />
            </form>
          </Panel>
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title="Manage">
            <div className="flex flex-col gap-4">
              <Select label="Status" value={t.status} disabled={pending === 'update'} onChange={(e) => update({ status: e.target.value }, 'Status updated')} options={SET_STATUS} />
              <Select label="Priority" value={t.priority} disabled={pending === 'update'} onChange={(e) => update({ priority: e.target.value }, 'Priority updated')} options={(meta.data?.priorities ?? [t.priority]).map((p) => ({ value: p, label: label(p) }))} />
              <Select
                label="Assignee"
                value={t.assigneeId ?? ''}
                disabled={pending === 'update'}
                onChange={(e) => update({ assigneeId: e.target.value || null }, 'Assignment updated')}
                options={[{ value: '', label: 'Unassigned' }, ...assignees.map((a) => ({ value: a.id, label: a.label }))]}
              />
            </div>
          </Panel>
          <Panel title="Requester">
            <dl className="flex flex-col gap-1.5 text-secondary text-slate-700">
              <div>
                <dt className="sr-only">Type</dt>
                <dd>
                  <Badge tone={t.requesterType === 'vendor' ? 'navy' : 'slate'}>{t.requesterType === 'vendor' ? 'Vendor' : 'Customer'}</Badge>
                  {t.requesterDeleted && (
                    <span className="ml-2">
                      <Badge tone="red">Account deleted</Badge>
                    </span>
                  )}
                </dd>
              </div>
              {t.requester.name && <dd>{t.requester.name}</dd>}
              {t.requester.email && <dd className="break-all">{t.requester.email}</dd>}
              {t.requester.phone && <dd>{t.requester.phone}</dd>}
              {t.requester.company && (
                <dd>
                  <Link to={`/admin/companies/${t.requester.company.id}`} className="font-semibold text-teal-700 hover:underline">
                    {t.requester.company.name}
                  </Link>
                </dd>
              )}
            </dl>
          </Panel>
          <Panel title="Timeline">
            <ul className="flex flex-col gap-2.5 text-secondary text-slate-700">
              {[...t.history].reverse().map((h, i) => (
                <li key={i} className="border-l-2 border-slate-200 pl-3">
                  <span className="block font-medium">
                    {label(h.action)}
                    {h.to && h.action !== 'assigned' ? ` → ${label(h.to)}` : ''}
                  </span>
                  <span className="text-xs text-slate-500">
                    {h.actorLabel ?? label(h.actorType)} · {formatDateTime(h.at)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </AdminPage>
  );
}
