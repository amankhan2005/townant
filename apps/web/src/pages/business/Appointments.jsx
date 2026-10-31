import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { SlotPicker } from '../../components/SlotPicker.jsx';
import { Alert, Async, Breadcrumbs, Button, Card, DateRangePicker, DetailSkeleton, EmptyState, ErrorState, FormError, InlineError, Modal, PageHeader, Pagination, ReasonDialog, Select, StatusBadge, Table, TableSkeleton, Tabs, Textarea, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime, minutesLabel } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Gate, useVendor } from './BusinessApp.jsx';

export default function Appointments() {
  useDocumentTitle('Appointments');
  const { id } = useParams();
  return <Gate permission="bookings:read">{id ? <AppointmentDetail id={id} /> : <AppointmentList />}</Gate>;
}

function AppointmentList() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { company } = useVendor();
  const view = params.get('view') ?? 'upcoming';
  const status = params.get('status') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1);
  const list = useApi('/vendor/bookings', { query: { view, status, page, from, to, limit: 20 } });
  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  return (
    <div>
      <PageHeader title="Appointments" subtitle={`Times shown in ${company.availability.timezone.replaceAll('_', ' ')}.`} />
      <div className="mb-5 flex flex-col gap-4 rounded-card border border-line bg-white p-4 shadow-card lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3">
          <Tabs
            label="Appointment period"
            value={view}
            onChange={(v) => set({ view: v })}
            tabs={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'past', label: 'Past' },
              { value: 'all', label: 'All' },
            ]}
          />
          <DateRangePicker label="Dates" from={from} to={to} onChange={(r) => set({ from: r.from, to: r.to })} timeZone={company.availability.timezone} />
        </div>
        <Select label="Status" className="lg:w-60" value={status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          <option value="requested">Needs review</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled_by_customer">Cancelled by customer</option>
          <option value="cancelled_by_vendor">Cancelled by you</option>
          <option value="cancelled_by_admin">Cancelled by TownAnt</option>
          <option value="no_show">No-show</option>
          <option value="declined">Declined</option>
          <option value="expired">Expired</option>
        </Select>
      </div>
      <Async state={list} loading={<TableSkeleton columns={4} rows={6} label="Loading appointments" />} empty={<EmptyState title="No appointments match" body={from || to || status ? 'Try a wider date range or another status.' : 'New bookings will appear here.'} />}>
        {(rows) => (
          <Table
            caption="Appointments"
            rows={rows}
            onRowClick={(r) => navigate(`/business/appointments/${r.id}`)}
            columns={[
              { key: 'customer', label: 'Customer / service', render: (r) => (<><p className="font-medium text-navy">{r.customer?.name}</p><p className="text-muted">{r.service.title}</p></>) },
              { key: 'when', label: 'Date & time', render: (r) => <span className="tabular">{formatDateTime(r.startAt, r.timezone)}</span> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} audience="vendor" /> },
              { key: 'ref', label: 'Reference', render: (r) => <span className="font-mono text-xs text-muted">{r.reference}</span> },
            ]}
          />
        )}
      </Async>
      <Pagination meta={list.meta} onPage={(p) => set({ page: String(p) })} />
    </div>
  );
}

function AppointmentDetail({ id }) {
  const toast = useToast();
  const { permissions, company } = useVendor();
  const booking = useApi(`/vendor/bookings/${id}`);
  const [dialog, setDialog] = useState(null);
  const [actionError, setActionError] = useState(null);
  const b = booking.data;
  const canWrite = permissions.includes('bookings:write');

  if (booking.error && !b) return booking.error.status === 404 ? <EmptyState title="Appointment not found" /> : <ErrorState error={booking.error} onRetry={booking.reload} />;
  if (!b) return <DetailSkeleton label="Loading appointment" />;

  const act = async (action, reason) => {
    setActionError(null);
    try {
      const { data } = await api(`/vendor/bookings/${b.id}/${action}`, { method: 'POST', body: reason ? { reason } : {} });
      booking.setData(data);
      toast('Appointment updated');
    } catch (err) {
      setActionError(err);
      throw err;
    }
  };

  const has = (a) => canWrite && b.actions.includes(a);

  return (
    <div className="max-w-3xl">
      <Breadcrumbs items={[{ label: 'Appointments', to: '/business/appointments' }, { label: b.reference }]} />
      {booking.error && <InlineError error={booking.error} onRetry={booking.reload} />}
      <Card className="mt-3 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted">{b.reference}</p>
            <h1 className="text-xl font-bold text-navy">{b.service.title}</h1>
            <p className="text-navy tabular">{formatDateTime(b.startAt, b.timezone)}</p>
            <p className="text-sm text-muted">{minutesLabel(b.service.durationMinutes)}</p>
          </div>
          <StatusBadge status={b.status} audience="vendor" />
        </div>
        <div className="mt-5 grid gap-4 rounded-lg bg-cloud p-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted">Customer</p>
            <p className="font-medium text-navy">{b.customer?.name}</p>
          </div>
          {b.customer?.email && (
            <div className="min-w-0">
              <p className="text-muted">Email</p>
              {/* Long addresses wrap instead of running into the next column. */}
              <a className="font-medium text-teal break-all" href={`mailto:${b.customer.email}`}>
                {b.customer.email}
              </a>
            </div>
          )}
          {b.customer?.phone && (
            <div>
              <p className="text-muted">Phone</p>
              <a className="font-medium text-teal" href={`tel:${b.customer.phone}`}>
                {b.customer.phone}
              </a>
            </div>
          )}
        </div>
        {b.customerNote && (
          <div className="mt-4 text-sm">
            <p className="text-muted">Customer note</p>
            <p className="whitespace-pre-line text-navy">{b.customerNote}</p>
          </div>
        )}
        {b.status === 'requested' && b.requestExpiresAt && <Alert className="mt-4" tone="warn">Respond before {formatDateTime(b.requestExpiresAt, company.availability.timezone)} or the request expires and the time is released.</Alert>}
        <FormError error={actionError} />
        <div className="mt-6 flex flex-wrap gap-2">
          {has('confirm') && <Button onClick={() => act('confirm').catch(() => {})}>Confirm</Button>}
          {has('decline') && <Button variant="secondary" onClick={() => setDialog('decline')}>Decline</Button>}
          {has('reschedule') && <Button variant="secondary" onClick={() => setDialog('reschedule')}>Reschedule</Button>}
          {has('complete') && <Button onClick={() => act('complete').catch(() => {})}>Mark completed</Button>}
          {has('no_show') && <Button variant="secondary" onClick={() => act('no-show').catch(() => {})}>Mark no-show</Button>}
          {has('cancel_vendor') && <Button variant="danger" onClick={() => setDialog('cancel')}>Cancel appointment</Button>}
        </div>
      </Card>
      <Card className="mt-4 p-6">
        <h2 className="mb-3 font-semibold text-navy">History</h2>
        <ol className="flex flex-col gap-2 text-sm">
          {b.history.map((h, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span>
                {h.action.replaceAll('_', ' ')} · {h.actorType}
                {h.reason && <span className="text-muted"> — {h.reason}</span>}
              </span>
              <span className="shrink-0 text-muted tabular">{formatDateTime(h.at, b.timezone, { weekday: false })}</span>
            </li>
          ))}
        </ol>
      </Card>
      <ReasonDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title="Cancel appointment" description="The customer will be notified with your reason and the time will be released." confirmLabel="Cancel appointment" danger onConfirm={(r) => act('cancel', r)} />
      <ReasonDialog open={dialog === 'decline'} onClose={() => setDialog(null)} title="Decline request" description="Optionally tell the customer why." confirmLabel="Decline" required={false} onConfirm={(r) => act('decline', r)} />
      <VendorReschedule open={dialog === 'reschedule'} booking={b} onClose={() => setDialog(null)} onDone={(data) => { booking.setData(data); toast('Appointment moved; the customer was notified'); }} />
    </div>
  );
}

function VendorReschedule({ open, booking, onClose, onDone }) {
  const [slot, setSlot] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api(`/vendor/bookings/${booking.id}/reschedule`, { method: 'POST', body: { startAt: slot.startAt, reason: reason.trim() || undefined } });
      onDone(data);
      onClose();
    } catch (err) {
      setError(err);
      if (err.code === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        setRefreshKey((k) => k + 1);
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Move appointment" description={`Currently ${formatDateTime(booking.startAt, booking.timezone)}`} size="xl" footer={<Button pending={pending} disabled={!slot} onClick={submit}>Move</Button>}>
      <div className="flex flex-col gap-3">
        <SlotPicker slotsPath={`/vendor/bookings/${booking.id}/slots`} timezone={booking.timezone} value={slot} onChange={setSlot} refreshKey={refreshKey} />
        <Textarea label="Message to customer" optional rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <FormError error={error} />
      </div>
    </Modal>
  );
}
