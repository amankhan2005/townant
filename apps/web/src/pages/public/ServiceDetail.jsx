import { CalendarCheck, Clock, ShieldCheck, Store } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { OtpSignIn } from '../../components/OtpSignIn.jsx';
import { SlotPicker } from '../../components/SlotPicker.jsx';
import { Alert, Badge, Breadcrumbs, Button, Card, DetailSkeleton, EmptyState, ErrorState, FormError, Modal, RatingInline, Textarea, useToast } from '../../components/ui.jsx';
import { api, newIdempotencyKey } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDateTime, formatPrice, imageUrl, minutesLabel } from '../../lib/format.js';
import { useApi, useDocumentTitle, usePageMeta } from '../../lib/hooks.js';

const PENDING_KEY = 'townant.pendingBooking';

// The visitor's in-progress choice, kept for this tab only so it survives OTP sign-in or a
// reload. It is a convenience: the server re-checks the slot when the booking is submitted.
function readPending(slug, serviceId) {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_KEY));
    if (p?.slug === slug && p?.serviceId === serviceId && new Date(p.slot?.startAt) > new Date()) return p;
  } catch {
    /* storage unavailable */
  }
  return null;
}
const writePending = (value) => {
  try {
    if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
};

export default function ServiceDetail() {
  const { slug, serviceId } = useParams();
  const profile = useApi(`/catalog/companies/${slug}`);
  const services = useApi(`/catalog/companies/${slug}/services`);
  const service = services.data?.find((s) => s.id === serviceId);
  const c = profile.data;
  useDocumentTitle(service ? `${service.title} · ${c?.name ?? ''}` : 'Service');
  usePageMeta({ title: service ? `${service.title} · ${c?.name ?? ''}` : undefined, description: service ? service.description || `Book ${service.title} with ${c?.name ?? 'a local business'} on TownAnt.` : undefined });

  const failed = (profile.error && !c) || (services.error && !services.data);
  if (failed) {
    const notFound = profile.error?.status === 404 || services.error?.status === 404;
    return (
      <div className="mx-auto max-w-3xl gutter py-12">
        {notFound ? <EmptyState icon={Store} title="Business not found" body="This business may have moved or is no longer listed." action={<Link to="/search" className="font-semibold text-teal-700">Browse businesses</Link>} /> : <ErrorState error={profile.error ?? services.error} onRetry={() => (profile.reload(), services.reload())} />}
      </div>
    );
  }
  if (!c || !services.data) {
    return (
      <div className="mx-auto max-w-7xl gutter py-8">
        <DetailSkeleton label="Loading service" />
      </div>
    );
  }
  if (!service) {
    return (
      <div className="mx-auto max-w-3xl gutter py-12">
        <EmptyState title="This service isn't available" body="It may have been removed. See what else this business offers." action={<Link to={`/b/${slug}`} className="font-semibold text-teal-700">View {c.name}</Link>} />
      </div>
    );
  }
  return <ServiceView company={c} service={service} />;
}

function ServiceView({ company: c, service }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const restored = readPending(c.slug, service.id);
  const [slot, setSlot] = useState(restored?.slot ?? null);
  const [note, setNote] = useState(restored?.note ?? '');
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // One key per booking attempt: a retried click after a timeout can't create a duplicate.
  const key = useRef(newIdempotencyKey());
  const isCustomer = user?.role === 'customer';

  useEffect(() => {
    writePending(slot ? { slug: c.slug, serviceId: service.id, slot, note } : null);
  }, [slot, note, c.slug, service.id]);

  const submit = async () => {
    if (!isCustomer) {
      setAuthOpen(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/bookings', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: { serviceId: service.id, startAt: slot.startAt, note: note.trim() || undefined } });
      writePending(null);
      toast(data.status === 'confirmed' ? 'Booking confirmed' : 'Request sent to the business');
      navigate(`/bookings/${data.id}`);
    } catch (err) {
      setError(err);
      if (err.code === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        setRefreshKey((k) => k + 1);
        key.current = newIdempotencyKey();
      }
    } finally {
      setPending(false);
    }
  };

  const price = formatPrice(service.price);
  const request = service.bookingMode === 'request';

  return (
    <div className={`mx-auto max-w-7xl px-4 py-8 ${slot ? 'pb-28 lg:pb-8' : ''}`}>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: c.name, to: `/b/${c.slug}` }, { label: service.title }]} />

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <header className="flex flex-col gap-3">
            <h1 className="text-[1.75rem] font-extrabold tracking-[-0.02em] text-navy md:text-[2.125rem]">{service.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="slate">
                <Clock size={13} aria-hidden="true" /> {minutesLabel(service.durationMinutes)}
              </Badge>
              {price && <Badge tone="navy">{price}</Badge>}
              <Badge tone={request ? 'amber' : 'teal'}>{request ? 'Business confirms each booking' : 'Instant confirmation'}</Badge>
            </div>
            {service.description && <p className="max-w-2xl whitespace-pre-line text-body text-slate">{service.description}</p>}
            {price && <p className="text-caption text-muted">Prices are set by the business and shown for information. Payment is arranged directly with them — TownAnt never takes payment.</p>}
          </header>

          <section aria-labelledby="choose-time" className="mt-8">
            <h2 id="choose-time" className="mb-4 text-heading font-bold text-navy">
              Choose a time
            </h2>
            {error?.code === 'SLOT_UNAVAILABLE' && (
              <Alert tone="warn" className="mb-4">
                That time was just taken. The available times below have been refreshed — please choose another.
              </Alert>
            )}
            <SlotPicker slug={c.slug} serviceId={service.id} timezone={c.timezone} value={slot} onChange={setSlot} refreshKey={refreshKey} />
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden">
            <Link to={`/b/${c.slug}`} className="flex items-center gap-3 border-b border-line p-4 transition hover:bg-cloud/60">
              <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-teal-50 text-teal-700">
                {c.logo ? <img src={imageUrl(c.logo.url, { w: 96, h: 96 })} alt="" className="size-full object-cover" /> : <Store size={22} aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-navy">{c.name}</span>
                <RatingInline rating={c.rating} />
              </span>
            </Link>
            <div className="flex flex-col gap-4 p-4">
              <div>
                <p className="text-caption font-semibold uppercase tracking-wide text-subtle">Your appointment</p>
                {slot ? (
                  <p className="mt-1 text-card font-semibold text-navy tabular">{formatDateTime(slot.startAt, c.timezone)}</p>
                ) : (
                  <p className="mt-1 text-secondary text-muted">Choose a day and time to continue.</p>
                )}
                <p className="text-secondary text-muted">{service.title} · {minutesLabel(service.durationMinutes)}</p>
              </div>
              {slot && <Textarea label="Note for the business" optional rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Access details, what you need done…" />}
              {request && slot && <Alert tone="info">The business will confirm or decline. The time is held for you while they respond.</Alert>}
              <FormError error={error?.code === 'SLOT_UNAVAILABLE' ? null : error} />
              {user && !isCustomer && <Alert tone="warn">You're signed in with a business or admin account. Sign out and use a customer account to book.</Alert>}
              <Button size="lg" disabled={!slot || (user && !isCustomer)} pending={pending} onClick={submit} icon={<CalendarCheck size={18} aria-hidden="true" />}>
                {request ? 'Send booking request' : 'Confirm booking'}
              </Button>
              {!isCustomer && !user && slot && <p className="-mt-2 text-caption text-muted">You'll verify with a one-time code before we book. Your chosen time is kept.</p>}
              <p className="flex items-start gap-2 text-caption text-muted">
                <ShieldCheck size={15} aria-hidden="true" className="mt-px shrink-0 text-teal" />
                Online cancellation up to {c.bookingPolicy.cancellationCutoffHours} hours before. No payment through TownAnt.
              </p>
            </div>
          </Card>
        </aside>
      </div>

      {slot && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-white/95 px-4 py-3 shadow-pop backdrop-blur-md md:bottom-0 lg:hidden">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-caption font-semibold uppercase tracking-wide text-subtle">Selected time</p>
              <p className="truncate text-secondary font-semibold text-navy tabular">{formatDateTime(slot.startAt, c.timezone, { weekday: false, zone: false })}</p>
            </div>
            <Button pending={pending} disabled={Boolean(user && !isCustomer)} onClick={submit}>
              {request ? 'Send request' : 'Confirm'}
            </Button>
          </div>
        </div>
      )}

      <Modal open={authOpen} onClose={() => setAuthOpen(false)} title="Verify to book" description={slot ? `${service.title} · ${formatDateTime(slot.startAt, c.timezone)}` : undefined} size="sm">
        <OtpSignIn
          intro="Use your email or phone — you only need one. Your selected time is kept while you verify."
          onDone={() => {
            setAuthOpen(false);
            toast("You're signed in. Review and confirm your booking.");
          }}
        />
      </Modal>
    </div>
  );
}
