import { CalendarDays, Copy, Flag, KeyRound, MessagesSquare, ScrollText, Star, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Modal, ReasonDialog, ReviewSkeleton, SearchInput, Select, Stars, Table, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime, relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { ADMIN_BOOKING_LABELS, describeAudit } from './labels.js';
import { AdminPage, DataPanel, PanelEmpty, statusLabel, StatusPill, useAdminFilters } from './kit.jsx';

const BOOKING_TONE = { requested: 'amber', confirmed: 'teal', completed: 'green', no_show: 'red', cancelled_by_admin: 'red' };
const ROLE_LABEL = { customer: 'Customer', vendor: 'Vendor staff', super_admin: 'Super Admin' };

export function Users() {
  useDocumentTitle('Accounts');
  const toast = useToast();
  const f = useAdminFilters();
  const [q, setQ] = useState(f.get('q'));
  const [target, setTarget] = useState(null);
  const list = useApi('/admin/users', { query: { role: f.get('role'), status: f.get('status'), q: f.get('q'), page: f.page } });
  const [issued, setIssued] = useState(null);
  const act = async (reason) => {
    const { user, action } = target;
    const { data } = await api(`/admin/users/${user.id}/${action}`, { method: 'POST', body: { reason } });
    if (action === 'temporary-password') setIssued({ ...data, email: user.email });
    else toast(action === 'revoke-sessions' ? `Revoked ${data.revoked} session(s)` : 'Account updated');
    list.reload();
  };
  return (
    <AdminPage title="Accounts" description="Customers, vendor staff and administrators. Suspending ends every session immediately.">
      <DataPanel
        state={list}
        onPage={(p) => f.set({ page: String(p) })}
        filters={
          <>
            <Select label="Role" value={f.get('role')} onChange={(e) => f.set({ role: e.target.value })} className="w-44" options={[{ value: '', label: 'All roles' }, ...Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))]} />
            <Select label="Status" value={f.get('status')} onChange={(e) => f.set({ status: e.target.value })} className="w-40" options={[{ value: '', label: 'All statuses' }, ...['active', 'invited', 'suspended', 'pending_deletion', 'deleted'].map((v) => ({ value: v, label: statusLabel('account', v) }))]} />
            <SearchInput label="Search" labelHidden={false} placeholder="Email, name or phone" value={q} onChange={setQ} onDebouncedChange={(v) => f.set({ q: v.trim() })} className="w-full sm:w-72" />
          </>
        }
        empty={<PanelEmpty icon={UsersRound} title="No accounts match" body="Try another role, status or search." />}
      >
        {(rows) => (
          <Table
            bare
            rows={rows}
            caption="Accounts"
            columns={[
              { key: 'name', label: 'Account', render: (u) => (<><p className="font-semibold text-slate-900">{u.displayName ?? '—'}</p><p className="text-caption text-slate-500">{u.email ?? u.phone}</p></>) },
              { key: 'role', label: 'Role', render: (u) => ROLE_LABEL[u.role] ?? u.role },
              {
                key: 'status',
                label: 'Status',
                render: (u) => (
                  <span className="flex flex-col items-start gap-1">
                    <StatusPill kind="account" status={u.status} />
                    {u.status === 'pending_deletion' && u.deletionScheduledFor && <span className="text-caption text-slate-500 tabular">Deletes {formatDate(u.deletionScheduledFor)}</span>}
                    {u.passwordChangeRequired && <span className="text-caption text-amber-800">Temporary password{u.temporaryPasswordExpiresAt ? ` · expires ${formatDate(u.temporaryPasswordExpiresAt)}` : ''}</span>}
                  </span>
                ),
              },
              { key: 'lastLoginAt', label: 'Last sign-in', render: (u) => <span className="whitespace-nowrap text-slate-500 tabular">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</span> },
              {
                key: 'actions',
                label: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (u) => (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {u.role === 'vendor' && ['active', 'invited'].includes(u.status) && (
                      <Button size="sm" variant="ghost" icon={<KeyRound size={14} aria-hidden="true" />} onClick={() => setTarget({ user: u, action: 'temporary-password' })}>
                        Temporary password
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setTarget({ user: u, action: 'revoke-sessions' })}>
                      Sign out everywhere
                    </Button>
                    {u.status === 'suspended' ? (
                      <Button size="sm" variant="secondary" onClick={() => setTarget({ user: u, action: 'reactivate' })}>
                        Reactivate
                      </Button>
                    ) : (
                      <Button size="sm" variant="danger-ghost" onClick={() => setTarget({ user: u, action: 'suspend' })}>
                        Suspend
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </DataPanel>
      <ReasonDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={target ? `${{ suspend: 'Suspend', reactivate: 'Reactivate', 'revoke-sessions': 'Sign out all sessions for', 'temporary-password': 'Issue a temporary password for' }[target.action]} ${target.user.email ?? target.user.phone ?? 'account'}` : ''}
        description={
          target?.action === 'suspend'
            ? 'All sessions end immediately and the account cannot sign in.'
            : target?.action === 'temporary-password'
              ? 'For owners who can’t use the emailed setup or reset link. It is shown to you once, expires in 72 hours, must be changed at first sign-in, and signs the account out everywhere. Share it privately — never by email.'
              : undefined
        }
        confirmLabel={target?.action === 'temporary-password' ? 'Issue password' : undefined}
        danger={target?.action === 'suspend'}
        onConfirm={act}
      />
      {issued && <TemporaryPasswordDialog issued={issued} onClose={() => setIssued(null)} />}
    </AdminPage>
  );
}

// Shown exactly once: the API never returns this password again and never stores it in plaintext.
function TemporaryPasswordDialog({ issued, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Temporary password issued" size="sm" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4">
        <p className="text-body text-slate-700">
          Give this to <strong>{issued.email}</strong> privately. They must choose a new password when they sign in at /business/login.
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <code className="flex-1 select-all break-all font-mono text-[1rem] font-semibold tracking-wide text-slate-900">{issued.temporaryPassword}</code>
          <Button size="sm" variant="secondary" onClick={copy} icon={<Copy size={14} aria-hidden="true" />}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <Alert tone="warn">This password won’t be shown again. It expires {formatDateTime(issued.expiresAt)}.</Alert>
      </div>
    </Modal>
  );
}

export function BookingsOversight() {
  useDocumentTitle('Bookings');
  const toast = useToast();
  const f = useAdminFilters();
  const [ref, setRef] = useState(f.get('q'));
  const [cancel, setCancel] = useState(null);
  const list = useApi('/admin/bookings', { query: { status: f.get('status'), q: f.get('q'), companyId: f.get('companyId'), page: f.page } });
  return (
    <AdminPage title="Bookings" description="Platform-wide appointment oversight. Cancelling requires a reason and notifies the customer and the business.">
      <DataPanel
        state={list}
        columns={6}
        onPage={(p) => f.set({ page: String(p) })}
        filters={
          <>
            <Select label="Status" value={f.get('status')} onChange={(e) => f.set({ status: e.target.value })} className="w-52" options={[{ value: '', label: 'All statuses' }, ...Object.entries(ADMIN_BOOKING_LABELS).map(([value, label]) => ({ value, label }))]} />
            <SearchInput label="Booking reference" labelHidden={false} placeholder="TA-XXXXXXXX" value={ref} onChange={setRef} onDebouncedChange={(v) => (/^TA-[A-Za-z0-9]{1,8}$/.test(v.trim()) || !v.trim() ? f.set({ q: v.trim().toUpperCase() }) : undefined)} className="w-full sm:w-64" />
          </>
        }
        empty={<PanelEmpty icon={CalendarDays} title="No bookings match" body="Bookings appear here as customers make them." />}
      >
        {(rows) => (
          <Table
            bare
            rows={rows}
            caption="Bookings"
            columns={[
              { key: 'ref', label: 'Reference', render: (b) => <span className="whitespace-nowrap font-mono text-caption text-slate-700">{b.reference}</span> },
              { key: 'company', label: 'Business / service', render: (b) => (<><p className="font-semibold text-slate-900">{b.company?.name}</p><p className="text-caption text-slate-500">{b.service.title}</p></>) },
              { key: 'customer', label: 'Customer', render: (b) => b.customer?.name ?? '—' },
              { key: 'when', label: 'When', render: (b) => <span className="whitespace-nowrap tabular">{formatDateTime(b.startAt, b.timezone)}</span> },
              { key: 'status', label: 'Status', render: (b) => <Badge tone={BOOKING_TONE[b.status] ?? 'slate'} dot>{ADMIN_BOOKING_LABELS[b.status] ?? b.status}</Badge> },
              {
                key: 'actions',
                label: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (b) =>
                  b.actions.includes('cancel_admin') && (
                    <Button size="sm" variant="danger-ghost" onClick={() => setCancel(b)}>
                      Cancel
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </DataPanel>
      <ReasonDialog
        open={Boolean(cancel)}
        onClose={() => setCancel(null)}
        title={`Cancel ${cancel?.reference}?`}
        description="The customer and the business are notified with this reason. The slot is released."
        danger
        confirmLabel="Cancel booking"
        onConfirm={async (reason) => {
          await api(`/admin/bookings/${cancel.id}/cancel`, { method: 'POST', body: { reason } });
          toast('Booking cancelled');
          list.reload();
        }}
      />
    </AdminPage>
  );
}

export function Inquiries() {
  useDocumentTitle('Inquiries');
  const toast = useToast();
  const f = useAdminFilters();
  const [readTarget, setReadTarget] = useState(null);
  const [messages, setMessages] = useState(null);
  const [closing, setClosing] = useState(null);
  const list = useApi('/admin/conversations', { query: { status: f.get('status'), page: f.page } });
  return (
    <AdminPage title="Inquiries" description="Conversations between customers and businesses. Only metadata is listed; reading messages requires a reason and is audited.">
      <DataPanel
        state={list}
        columns={6}
        onPage={(p) => f.set({ page: String(p) })}
        filters={<Select label="Status" value={f.get('status')} onChange={(e) => f.set({ status: e.target.value })} className="w-40" options={[{ value: '', label: 'All statuses' }, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />}
        empty={<PanelEmpty icon={MessagesSquare} title="No inquiries" body="Conversations appear here when customers message a business." />}
      >
        {(rows) => (
          <Table
            bare
            rows={rows}
            caption="Inquiries"
            columns={[
              { key: 'company', label: 'Business', render: (c) => <span className="font-semibold text-slate-900">{c.company?.name}</span> },
              { key: 'customer', label: 'Customer', render: (c) => c.customer?.name ?? '—' },
              { key: 'subject', label: 'Subject', render: (c) => c.subject ?? (c.bookingId ? 'Booking conversation' : '—') },
              { key: 'status', label: 'Status', render: (c) => <StatusPill kind="conversation" status={c.status} /> },
              { key: 'last', label: 'Last activity', render: (c) => <span className="whitespace-nowrap text-slate-500 tabular">{relativeTime(c.lastMessageAt)}</span> },
              {
                key: 'actions',
                label: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (c) => (
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setReadTarget(c)}>
                      Read
                    </Button>
                    {c.status === 'open' && (
                      <Button size="sm" variant="secondary" onClick={() => setClosing(c)}>
                        Close
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </DataPanel>
      <ReasonDialog
        open={Boolean(readTarget)}
        onClose={() => setReadTarget(null)}
        title="Why do you need to read this conversation?"
        description="Message content is private. Your reason is stored in the audit log."
        confirmLabel="Open messages"
        onConfirm={async (reason) => {
          const { data } = await api(`/admin/conversations/${readTarget.id}/messages`, { method: 'POST', body: { reason } });
          setMessages(data.messages);
        }}
      />
      <Modal open={Boolean(messages)} onClose={() => setMessages(null)} title="Conversation" description="Access to these messages has been recorded in the audit log." size="lg">
        <ul className="flex flex-col gap-2">
          {messages?.map((m) => (
            <li key={m.id} className={`rounded-xl p-3 text-secondary ${m.senderType === 'customer' ? 'mr-8 bg-slate-50' : 'ml-8 bg-teal-50'}`}>
              <p className="text-caption font-semibold capitalize text-slate-500 tabular">
                {m.senderType} · {formatDateTime(m.createdAt, undefined, { weekday: false })}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{m.body}</p>
            </li>
          ))}
        </ul>
      </Modal>
      <ReasonDialog
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        title="Close conversation"
        onConfirm={async (reason) => {
          await api(`/admin/conversations/${closing.id}/close`, { method: 'POST', body: { reason } });
          toast('Conversation closed');
          list.reload();
        }}
      />
    </AdminPage>
  );
}

export function ReviewsModeration() {
  useDocumentTitle('Reviews');
  const toast = useToast();
  const f = useAdminFilters();
  const [target, setTarget] = useState(null);
  const list = useApi('/admin/reviews', { query: { status: f.get('status'), reported: f.get('reported'), page: f.page } });
  return (
    <AdminPage title="Reviews" description="Hide or restore reviews and resolve reports. Review text is never edited; hidden reviews stop counting toward ratings.">
      <DataPanel
        state={list}
        onPage={(p) => f.set({ page: String(p) })}
        skeleton={
          <div className="p-5">
            <ReviewSkeleton count={3} />
          </div>
        }
        filters={
          <>
            <Select label="Status" value={f.get('status')} onChange={(e) => f.set({ status: e.target.value })} className="w-40" options={[{ value: '', label: 'All statuses' }, { value: 'published', label: 'Published' }, { value: 'hidden', label: 'Hidden' }]} />
            <Select label="Reports" value={f.get('reported')} onChange={(e) => f.set({ reported: e.target.value })} className="w-44" options={[{ value: '', label: 'Any' }, { value: 'true', label: 'Reported only' }]} />
          </>
        }
        empty={<PanelEmpty icon={Star} title="No reviews match" body="Reviews appear after customers complete a booking." />}
      >
        {(rows) => (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars value={r.rating} />
                    <span className="font-semibold text-slate-900">{r.authorName}</span>
                    <StatusPill kind="review" status={r.status} />
                    {r.openReports.length > 0 && (
                      <Badge tone="red">
                        <Flag size={12} aria-hidden="true" /> {r.openReports.length} open report{r.openReports.length === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                  <span className="text-caption text-slate-400 tabular">{relativeTime(r.createdAt)}</span>
                </div>
                {r.text && <p className="mt-2 max-w-3xl whitespace-pre-line text-body text-slate-700">{r.text}</p>}
                {r.openReports.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 rounded-md bg-danger-50/60 px-3 py-2 text-secondary text-slate-700">
                    {r.openReports.map((p, i) => (
                      <li key={i}>
                        <span className="font-semibold capitalize">{p.reason.replaceAll('_', ' ')}</span>
                        {p.details && `: ${p.details}`}
                      </li>
                    ))}
                  </ul>
                )}
                {r.moderation?.length > 0 && <p className="mt-2 text-caption text-slate-500">Last moderation: {r.moderation.at(-1).action} — {r.moderation.at(-1).reason}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.status === 'published' ? (
                    <Button size="sm" variant="danger-ghost" onClick={() => setTarget({ review: r, action: 'hide' })}>
                      Hide review
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setTarget({ review: r, action: 'restore' })}>
                      Restore review
                    </Button>
                  )}
                  {r.openReports.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setTarget({ review: r, action: 'dismiss-reports' })}>
                      Dismiss reports
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
      <ReasonDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={target ? { hide: 'Hide review', restore: 'Restore review', 'dismiss-reports': 'Dismiss reports' }[target.action] : ''}
        description={target?.action === 'hide' ? 'Hidden reviews no longer count toward the rating.' : undefined}
        danger={target?.action === 'hide'}
        onConfirm={async (reason) => {
          await api(`/admin/reviews/${target.review.id}/${target.action}`, { method: 'POST', body: { reason } });
          toast('Review updated');
          list.reload();
        }}
      />
    </AdminPage>
  );
}

export function AuditLog() {
  useDocumentTitle('Audit log');
  const f = useAdminFilters();
  const [action, setAction] = useState(f.get('action'));
  const list = useApi('/admin/audit', { query: { action: f.get('action'), entityType: f.get('entityType'), page: f.page, limit: 30 } });
  return (
    <AdminPage title="Audit log" description="Append-only record of consequential actions by staff, vendors and the system.">
      <DataPanel
        state={list}
        onPage={(p) => f.set({ page: String(p) })}
        filters={
          <>
            <Select label="Entity" value={f.get('entityType')} onChange={(e) => f.set({ entityType: e.target.value })} className="w-48" options={[{ value: '', label: 'All entities' }, ...['booking', 'company', 'service', 'user', 'review', 'vendor_application', 'conversation', 'category'].map((t) => ({ value: t, label: t.replace('_', ' ').replace(/^\w/, (ch) => ch.toUpperCase()) }))]} />
            <SearchInput label="Action code" labelHidden={false} placeholder="e.g. company.suspend" value={action} onChange={setAction} onDebouncedChange={(v) => f.set({ action: v.trim() })} className="w-full sm:w-72" />
          </>
        }
        empty={<PanelEmpty icon={ScrollText} title="No audit events match" body="Try another entity or action code." />}
      >
        {(rows) => (
          <Table
            bare
            rows={rows}
            caption="Audit events"
            columns={[
              { key: 'at', label: 'When', render: (r) => <span className="whitespace-nowrap tabular">{formatDateTime(r.at, undefined, { weekday: false })}</span> },
              { key: 'action', label: 'Action', render: (r) => (<><p className="font-semibold text-slate-900">{describeAudit(r.action)}</p><p className="font-mono text-caption text-slate-500">{r.action}</p></>) },
              { key: 'actor', label: 'Actor', render: (r) => (<><p>{r.actor?.label ?? '—'}</p><p className="text-caption capitalize text-slate-500">{r.actorType.replaceAll('_', ' ')}</p></>) },
              { key: 'entity', label: 'Entity', render: (r) => <span className="font-mono text-caption text-slate-500">{r.entityType}:{r.entityId?.slice(-8)}</span> },
              { key: 'reason', label: 'Reason', render: (r) => r.reason ?? <span className="text-slate-400">—</span> },
            ]}
          />
        )}
      </DataPanel>
    </AdminPage>
  );
}
