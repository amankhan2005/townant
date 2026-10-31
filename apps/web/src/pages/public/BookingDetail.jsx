import { Star } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PolishButton } from '../../components/PolishButton.jsx';
import { RequireCustomer } from '../../components/RequireCustomer.jsx';
import { SlotPicker } from '../../components/SlotPicker.jsx';
import { Alert, Breadcrumbs, Button, Card, DetailSkeleton, EmptyState, ErrorState, FormError, InlineError, Modal, ReasonDialog, StatusBadge, Textarea, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime, minutesLabel } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';

export default function BookingDetail() {
  useDocumentTitle('Booking');
  return (
    <RequireCustomer>
      <Detail />
    </RequireCustomer>
  );
}

function Detail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const booking = useApi(`/bookings/${id}`);
  const reviews = useApi('/reviews/mine');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const b = booking.data;

  if (booking.error && !b) {
    return (
      <div className="mx-auto max-w-2xl gutter py-10">
        {booking.error.status === 404 ? <EmptyState title="Booking not found" action={<Link to="/bookings" className="font-semibold text-teal">My bookings</Link>} /> : <ErrorState error={booking.error} onRetry={booking.reload} />}
      </div>
    );
  }
  if (!b) return <div className="mx-auto max-w-2xl gutter py-10"><DetailSkeleton label="Loading booking" /></div>;

  const reviewed = reviews.data?.some((r) => r.bookingId === b.id);
  const canCancel = b.actions.includes('cancel_customer');
  const canReschedule = b.actions.includes('reschedule');
  const active = ['requested', 'confirmed'].includes(b.status);

  const message = async () => {
    try {
      const { data } = await api('/conversations', { method: 'POST', body: { companyId: b.company.id, bookingId: b.id, body: `Hi, I have a question about booking ${b.reference}.` } });
      navigate(`/messages/${data.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-2xl gutter py-8">
      <Breadcrumbs items={[{ label: 'My bookings', to: '/bookings' }, { label: b.reference }]} />
      {booking.error && <InlineError error={booking.error} onRetry={booking.reload} />}
      <Card className="mt-3 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Booking {b.reference}</p>
            <h1 className="text-xl font-bold text-navy">{b.service.title}</h1>
            <Link to={`/b/${b.company.slug}`} className="text-teal">
              {b.company.name}
            </Link>
          </div>
          <StatusBadge status={b.status} />
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">When</dt>
            <dd className="font-medium text-navy tabular">{formatDateTime(b.startAt, b.timezone)}</dd>
          </div>
          <div>
            <dt className="text-muted">Duration</dt>
            <dd className="font-medium text-navy">{minutesLabel(b.service.durationMinutes)}</dd>
          </div>
          {b.company.address?.line1 && (
            <div>
              <dt className="text-muted">Where</dt>
              <dd className="font-medium text-navy">{[b.company.address.line1, b.company.address.city, b.company.address.postalCode].filter(Boolean).join(', ')}</dd>
            </div>
          )}
          {b.company.phone && (
            <div>
              <dt className="text-muted">Business phone</dt>
              <dd>
                <a href={`tel:${b.company.phone}`} className="font-medium text-teal">
                  {b.company.phone}
                </a>
              </dd>
            </div>
          )}
          {b.customerNote && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Your note</dt>
              <dd className="whitespace-pre-line text-navy">{b.customerNote}</dd>
            </div>
          )}
        </dl>
        {b.status === 'requested' && <Alert className="mt-5" tone="info">Waiting for the business to confirm. We'll notify you as soon as they respond.</Alert>}
        {active && !canCancel && <Alert className="mt-5" tone="warn">Online cancellation has closed for this booking. Message the business if your plans change.</Alert>}
        <div className="mt-6 flex flex-wrap gap-2">
          {canReschedule && <Button onClick={() => setRescheduleOpen(true)}>Reschedule</Button>}
          {canCancel && (
            <Button variant="secondary" onClick={() => setCancelOpen(true)}>
              Cancel booking
            </Button>
          )}
          <Button variant="secondary" onClick={message}>
            Message business
          </Button>
          {b.status === 'completed' && !reviewed && (
            <Button variant="amber" onClick={() => setReviewOpen(true)}>
              Leave a review
            </Button>
          )}
        </div>
        <p className="mt-4 text-xs text-muted">TownAnt doesn't handle payment. Any payment is arranged directly with the business.</p>
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="mb-3 font-semibold text-navy">History</h2>
        <ol className="flex flex-col gap-2 text-sm">
          {b.history.map((h, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span className="text-slate">
                {h.action === 'create' ? 'Booked' : h.action === 'reschedule' ? 'Rescheduled' : h.action.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())} by {h.actorType === 'customer' ? 'you' : h.actorType === 'vendor' ? 'the business' : h.actorType === 'admin' ? 'TownAnt' : 'TownAnt (automatic)'}
                {h.reason && <span className="text-muted"> — {h.reason}</span>}
              </span>
              <span className="shrink-0 text-muted tabular">{formatDateTime(h.at, b.timezone, { weekday: false })}</span>
            </li>
          ))}
        </ol>
      </Card>

      <ReasonDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this booking?"
        description="The business will be notified and the time will be released."
        confirmLabel="Cancel booking"
        required={false}
        danger
        onConfirm={async (reason) => {
          const { data } = await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: { reason } });
          booking.setData(data);
          toast('Booking cancelled');
        }}
      />
      <RescheduleModal
        open={rescheduleOpen}
        booking={b}
        onClose={() => setRescheduleOpen(false)}
        onDone={(data) => {
          booking.setData(data);
          toast(data.status === 'requested' ? 'New time requested' : 'Booking rescheduled');
        }}
      />
      <ReviewModal
        open={reviewOpen}
        booking={b}
        onClose={() => setReviewOpen(false)}
        onDone={() => {
          reviews.reload();
          toast('Thanks for your review');
        }}
      />
    </div>
  );
}

function RescheduleModal({ open, booking, onClose, onDone }) {
  const [slot, setSlot] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api(`/bookings/${booking.id}/reschedule`, { method: 'POST', body: { startAt: slot.startAt } });
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
    <Modal open={open} onClose={onClose} title="Choose a new time" description={`Currently ${formatDateTime(booking.startAt, booking.timezone)}`} size="xl" footer={<Button pending={pending} disabled={!slot} onClick={submit}>Move booking</Button>}>
      <div className="flex flex-col gap-3">
        <SlotPicker slug={booking.company.slug} serviceId={booking.service.id} timezone={booking.timezone} value={slot} onChange={setSlot} refreshKey={refreshKey} />
        <FormError error={error} />
      </div>
    </Modal>
  );
}

function ReviewModal({ open, booking, onClose, onDone }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await api('/reviews', { method: 'POST', body: { bookingId: booking.id, rating, text: text.trim() } });
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Review ${booking.company.name}`} footer={<Button pending={pending} disabled={!rating} onClick={submit}>Post review</Button>}>
      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-navy">Your rating</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={rating === n} className="rounded-sm p-0.5">
                <Star size={30} strokeWidth={1.5} aria-hidden="true" className={n <= rating ? 'fill-amber text-amber' : 'fill-line text-line-strong'} />
              </button>
            ))}
          </div>
        </fieldset>
        <Textarea label="Tell others about your experience" optional rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        <PolishButton text={text} purpose="review" onAccept={setText} />
        <p className="text-xs text-muted">Your first name is shown with your review. Reviews can't be edited by the business.</p>
        <FormError error={error} />
      </div>
    </Modal>
  );
}
