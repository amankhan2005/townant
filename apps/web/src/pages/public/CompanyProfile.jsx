import { formatClock, formatIsoDate, todayIso, weekdayOfIso, WEEKDAYS } from '@townant/shared';
import { BadgeCheck, ChevronRight, Clock, Globe, Heart, Mail, MapPin, MessageSquare, Phone, ShieldCheck, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { OtpSignIn } from '../../components/OtpSignIn.jsx';
import { PolishButton } from '../../components/PolishButton.jsx';
import { Badge, Breadcrumbs, Button, Card, cx, EmptyState, ErrorState, FormError, ListSkeleton, Modal, ProfileSkeleton, RatingInline, ReviewSkeleton, Select, Stars, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useFavorites } from '../../lib/favorites.js';
import { formatPrice, imageUrl, minutesLabel, relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle, usePageMeta } from '../../lib/hooks.js';

export default function CompanyProfile() {
  const { slug } = useParams();
  const profile = useApi(`/catalog/companies/${slug}`);
  const services = useApi(`/catalog/companies/${slug}/services`);
  const favorites = useFavorites();
  const [inquiry, setInquiry] = useState(false);
  const c = profile.data;
  useDocumentTitle(c?.name ?? 'Business');
  usePageMeta({ title: c?.name, description: c ? c.summary || `${c.name}${c.category ? ` · ${c.category.name}` : ''} on TownAnt.` : undefined });

  useEffect(() => {
    // Counted server-side at most once per visitor per 30 minutes.
    api(`/catalog/companies/${slug}/view`, { method: 'POST' }).catch(() => {});
  }, [slug]);

  if (profile.error && !c) {
    return (
      <div className="mx-auto max-w-3xl gutter py-12">
        {profile.error.status === 404 ? (
          <EmptyState icon={Store} title="Business not found" body="This business may have moved or is no longer listed on TownAnt." action={<Link to="/search" className="font-semibold text-teal-700">Browse businesses</Link>} />
        ) : (
          <ErrorState error={profile.error} onRetry={profile.reload} title="This business didn't load" />
        )}
      </div>
    );
  }
  if (!c) return <ProfileSkeleton />;

  const place = [c.address?.area, c.address?.city, c.address?.region].filter(Boolean).join(', ');
  const saved = favorites.ids.has(c.id);

  return (
    <div className="mx-auto max-w-7xl gutter py-6">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, ...(c.category ? [{ label: c.category.name, to: `/search?category=${c.category.slug}` }] : []), { label: c.name }]} />

      {c.banner && (
        <div className="overflow-hidden rounded-xl bg-teal-50">
          <img src={imageUrl(c.banner.url, { w: 1600, h: 420 })} alt="" className="aspect-[4/1] w-full object-cover max-sm:aspect-[2/1]" />
        </div>
      )}

      <header className={cx('flex flex-col gap-5 md:flex-row md:items-start md:justify-between', c.banner ? 'mt-6' : 'mt-2')}>
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white text-teal-700 shadow-card md:size-20">
            {c.logo ? <img src={imageUrl(c.logo.url, { w: 200, h: 200 })} alt={`${c.name} logo`} className="size-full object-cover" /> : <Store size={30} strokeWidth={1.5} aria-hidden="true" />}
          </div>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] text-navy md:text-[2.125rem]">
              {c.name}
              {c.verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-caption font-semibold text-teal-700">
                  <BadgeCheck size={15} aria-hidden="true" /> Verified by TownAnt
                </span>
              )}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-secondary text-muted">
              {c.category && <span>{c.category.name}</span>}
              {place && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={14} aria-hidden="true" /> {place}
                </span>
              )}
              {c.rating && (
                <a href="#reviews" className="hover:underline">
                  <RatingInline rating={c.rating} />
                </a>
              )}
              {c.isNew && <Badge tone="navy">New on TownAnt</Badge>}
            </div>
            {c.summary && <p className="mt-3 max-w-2xl text-body text-slate">{c.summary}</p>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => favorites.toggle(c)} aria-pressed={saved} icon={<Heart size={17} aria-hidden="true" className={saved ? 'fill-danger text-danger' : ''} />}>
            {saved ? 'Saved' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={() => setInquiry(true)} icon={<MessageSquare size={17} aria-hidden="true" />}>
            Ask a question
          </Button>
        </div>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-10">
          <section aria-labelledby="services-h">
            <h2 id="services-h" className="mb-4 text-heading font-bold text-navy">
              Services
            </h2>
            {services.error && !services.data && <ErrorState compact error={services.error} onRetry={services.reload} title="Services didn't load" />}
            {!services.data && !services.error && <ListSkeleton rows={3} avatar={false} label="Loading services" />}
            {services.data?.length === 0 && <EmptyState compact title="No bookable services yet" body="This business hasn't listed services for online booking. You can still ask them a question." />}
            <ul className="flex flex-col gap-3">
              {services.data?.map((s) => (
                <li key={s.id}>
                  <Card className="flex flex-col gap-3 p-4 transition hover:border-teal/40 hover:shadow-raised sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div className="min-w-0">
                      <h3 className="text-card font-semibold text-navy">
                        <Link to={`/b/${c.slug}/s/${s.id}`} className="hover:text-teal-700">
                          {s.title}
                        </Link>
                      </h3>
                      {s.description && <p className="mt-1 line-clamp-2 text-secondary text-muted">{s.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone="slate">
                          <Clock size={12} aria-hidden="true" /> {minutesLabel(s.durationMinutes)}
                        </Badge>
                        {s.price && <Badge tone="navy">{formatPrice(s.price)}</Badge>}
                        {s.bookingMode === 'request' && <Badge tone="amber">Business confirms</Badge>}
                      </div>
                    </div>
                    <Link to={`/b/${c.slug}/s/${s.id}`} aria-label={`${s.bookingMode === 'request' ? 'Request' : 'Book'} ${s.title}`} className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md bg-teal px-5 text-[0.9375rem] font-semibold text-white shadow-card transition hover:bg-teal-700">
                      {s.bookingMode === 'request' ? 'Request' : 'Book'} <ChevronRight size={17} aria-hidden="true" />
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
            {services.data?.some((s) => s.price) && <p className="mt-3 text-caption text-muted">Prices are set by the business and shown for information. Payment is arranged directly with them.</p>}
          </section>

          {c.description && c.description !== c.summary && (
            <section aria-labelledby="about-h">
              <h2 id="about-h" className="mb-3 text-heading font-bold text-navy">
                About
              </h2>
              <p className="max-w-3xl whitespace-pre-line text-body leading-relaxed text-slate">{c.description}</p>
            </section>
          )}

          {c.gallery?.length > 0 && (
            <section aria-labelledby="photos-h">
              <h2 id="photos-h" className="mb-4 text-heading font-bold text-navy">
                Photos
              </h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {c.gallery.map((g) => (
                  <img key={g.url} src={imageUrl(g.url, { w: 600, h: 450 })} alt={`${c.name} photo`} loading="lazy" className="aspect-[4/3] w-full rounded-card object-cover" />
                ))}
              </div>
            </section>
          )}

          {c.rating && <Reviews slug={c.slug} rating={c.rating} />}
        </div>

        <aside className="flex flex-col gap-4">
          {c.hours && <Hours hours={c.hours} />}
          {c.contact && (c.contact.phone || c.contact.email || c.contact.website || c.address?.line1) && (
            <Card className="p-5">
              <h2 className="mb-3 text-card font-semibold text-navy">Contact</h2>
              <ul className="flex flex-col gap-2.5 text-secondary">
                {c.contact.phone && (
                  <li className="flex items-center gap-2.5">
                    <Phone size={16} aria-hidden="true" className="text-muted" />
                    <a href={`tel:${c.contact.phone}`} className="text-teal-700 hover:underline">
                      {c.contact.phone}
                    </a>
                  </li>
                )}
                {c.contact.email && (
                  <li className="flex items-center gap-2.5">
                    <Mail size={16} aria-hidden="true" className="text-muted" />
                    <a href={`mailto:${c.contact.email}`} className="truncate text-teal-700 hover:underline">
                      {c.contact.email}
                    </a>
                  </li>
                )}
                {c.contact.website && /^https?:\/\//.test(c.contact.website) && (
                  <li className="flex items-center gap-2.5">
                    <Globe size={16} aria-hidden="true" className="text-muted" />
                    <a href={c.contact.website} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-teal-700 hover:underline">
                      {c.contact.website.replace(/^https?:\/\//, '')}
                    </a>
                  </li>
                )}
                {c.address?.line1 && (
                  <li className="flex items-start gap-2.5 text-slate">
                    <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
                    {[c.address.line1, c.address.city, c.address.region, c.address.postalCode].filter(Boolean).join(', ')}
                  </li>
                )}
              </ul>
            </Card>
          )}
          {c.serviceArea && (c.serviceArea.radiusKm || c.serviceArea.postalCodes?.length > 0) && (
            <Card className="p-5">
              <h2 className="mb-1.5 text-card font-semibold text-navy">Service area</h2>
              <p className="text-secondary text-muted">
                {c.serviceArea.radiusKm ? `Travels up to ${c.serviceArea.radiusKm} km. ` : ''}
                {c.serviceArea.postalCodes?.length ? `Covers ${c.serviceArea.postalCodes.slice(0, 8).join(', ')}${c.serviceArea.postalCodes.length > 8 ? '…' : ''}` : ''}
              </p>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="mb-1.5 flex items-center gap-2 text-card font-semibold text-navy">
              <ShieldCheck size={17} aria-hidden="true" className="text-teal" /> Booking policy
            </h2>
            <p className="text-secondary text-muted">
              Cancel online up to {c.bookingPolicy.cancellationCutoffHours} hours before, and reschedule up to {c.bookingPolicy.rescheduleCutoffHours} hours before.
            </p>
            {c.policies?.cancellation && <p className="mt-2 whitespace-pre-line text-secondary text-slate">{c.policies.cancellation}</p>}
          </Card>
        </aside>
      </div>

      <InquiryModal company={c} open={inquiry} onClose={() => setInquiry(false)} services={services.data ?? []} />
    </div>
  );
}

function Hours({ hours }) {
  const today = WEEKDAYS[weekdayOfIso(todayIso(hours.timezone))];
  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 text-card font-semibold text-navy">
        <Clock size={17} aria-hidden="true" className="text-teal" /> Opening hours
      </h2>
      <dl className="flex flex-col gap-1.5 text-secondary">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <div key={d} className={cx('flex justify-between gap-3', WEEKDAYS[d] === today ? 'font-semibold text-navy' : 'text-slate')}>
            <dt>{WEEKDAYS[d]}</dt>
            <dd className="text-right tabular">{hours.weekly[d]?.length ? hours.weekly[d].map((iv) => `${formatClock(iv.start)}–${formatClock(iv.end)}`).join(', ') : <span className="text-muted">Closed</span>}</dd>
          </div>
        ))}
      </dl>
      {hours.exceptions?.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-subtle">Special hours</p>
          <ul className="flex flex-col gap-1 text-secondary">
            {hours.exceptions.slice(0, 4).map((e) => (
              <li key={e.date} className="flex justify-between gap-2 tabular">
                <span className="text-slate">{formatIsoDate(e.date)}</span>
                <span className="text-muted">{e.closed ? 'Closed' : e.intervals.map((iv) => `${formatClock(iv.start)}–${formatClock(iv.end)}`).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-caption text-muted">Times shown in {hours.timezone.replaceAll('_', ' ')}.</p>
    </Card>
  );
}

function Reviews({ slug, rating }) {
  const [page, setPage] = useState(1);
  const reviews = useApi(`/catalog/companies/${slug}/reviews`, { query: { page, limit: 5 } });
  return (
    <section id="reviews" aria-labelledby="reviews-h" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 id="reviews-h" className="text-heading font-bold text-navy">
          Reviews
        </h2>
        {rating.count > 0 && (
          <div className="flex items-center gap-2">
            <Stars value={rating.average} size="md" />
            <span className="text-secondary text-muted tabular">
              {rating.average.toFixed(1)} · {rating.count.toLocaleString('en-US')} review{rating.count === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
      <p className="mb-4 text-caption text-muted">Reviews come only from customers with a completed TownAnt booking.</p>
      {reviews.error && !reviews.data && <ErrorState compact error={reviews.error} onRetry={reviews.reload} title="Reviews didn't load" />}
      {!reviews.data && !reviews.error && <ReviewSkeleton count={2} />}
      {reviews.data?.length === 0 && <p className="text-secondary text-muted">No reviews yet.</p>}
      <div className="flex flex-col gap-3">
        {reviews.data?.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-navy">{r.authorName}</span>
              <span className="text-caption text-muted tabular">{relativeTime(r.createdAt)}</span>
            </div>
            <div className="mt-1">
              <Stars value={r.rating} />
            </div>
            {r.text && <p className="mt-2 whitespace-pre-line text-secondary leading-relaxed text-slate">{r.text}</p>}
            {r.vendorReply && (
              <div className="mt-3 rounded-md border-l-2 border-teal bg-cloud p-3 text-secondary">
                <span className="text-caption font-semibold text-muted">Response from the business</span>
                <p className="mt-1 text-slate">{r.vendorReply.text}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
      {reviews.meta?.pages > 1 && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <Button size="sm" variant="secondary" disabled={page >= reviews.meta.pages} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      )}
    </section>
  );
}

function InquiryModal({ company, open, onClose, services }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const send = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/conversations', { method: 'POST', body: { companyId: company.id, serviceId: serviceId || undefined, body: body.trim() } });
      onClose();
      navigate(`/messages/${data.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Message ${company.name}`}>
      {user?.role !== 'customer' ? (
        <OtpSignIn intro="Verify your email or phone to message this business. You can write your question next." />
      ) : (
        <div className="flex flex-col gap-4">
          {services.length > 0 && (
            <Select label="About a service" optional value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">General question</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          )}
          <Textarea label="Your message" rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
          <PolishButton text={body} onAccept={setBody} />
          <FormError error={error} />
          <div className="flex justify-end">
            <Button pending={pending} disabled={body.trim().length < 1} onClick={send}>
              Send message
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
