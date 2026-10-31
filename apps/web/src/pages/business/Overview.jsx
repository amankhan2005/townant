import { CheckCircle2, Circle } from 'lucide-react';
import { Link } from 'react-router';
import { Card, EmptyState, ErrorState, ListSkeleton, MetricCard, PageHeader, Stars, StatusBadge, TextSkeleton } from '../../components/ui.jsx';
import { formatDateTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useVendor } from './BusinessApp.jsx';

const CHECKLIST = [
  ['logo', 'Add a logo', 'profile'],
  ['description', 'Write a description', 'profile'],
  ['gallery', 'Upload photos', 'profile'],
  ['services', 'Add a service', 'services'],
  ['hours', 'Set opening hours', 'availability'],
  ['published', 'Publish your profile', 'profile'],
];

export default function Overview() {
  useDocumentTitle('Overview');
  const { user, company } = useVendor();
  const dash = useApi('/vendor/dashboard');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (dash.error && !dash.data) return <ErrorState error={dash.error} onRetry={dash.reload} title="Your dashboard didn't load" />;
  const d = dash.data;
  const done = d ? CHECKLIST.filter(([k]) => d.checklist[k]).length : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`${greeting}${user.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}`} subtitle="Here is your business at a glance." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard loading={!d} label="Upcoming confirmed" value={d?.counts.upcoming} to="/business/appointments" tone="teal" />
        <MetricCard loading={!d} label="Requests to review" value={d?.counts.requests} to="/business/appointments?status=requested" hint={d?.counts.requests ? 'Respond before they expire' : undefined} />
        <MetricCard loading={!d} label="Rating" value={d ? (d.counts.rating.count ? d.counts.rating.average.toFixed(1) : '—') : null} hint={d ? `${d.counts.rating.count} review${d.counts.rating.count === 1 ? '' : 's'}` : undefined} to="/business/reviews" />
        <MetricCard loading={!d} label="Profile views" value={d?.last30Days.profileViews} hint="Last 30 days" />
      </div>

      {d && done < CHECKLIST.length && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy">Finish your profile</h2>
            <span className="text-sm text-muted">
              {done} of {CHECKLIST.length} done
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-cloud">
            <div className="h-full bg-teal transition-all" style={{ width: `${(done / CHECKLIST.length) * 100}%` }} />
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {CHECKLIST.map(([k, label, to]) => (
              <li key={k} className="flex items-center gap-2 text-sm">
                <span className={d.checklist[k] ? 'text-teal' : 'text-muted'}>{d.checklist[k] ? <CheckCircle2 size={16} aria-label="Done" /> : <Circle size={16} aria-label="Not done" />}</span>
                {d.checklist[k] ? <span className="text-muted line-through">{label}</span> : <Link to={`/business/${to}`} className="text-navy hover:text-teal">{label}</Link>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-navy">Next appointments</h2>
            <Link to="/business/appointments" className="text-sm font-semibold text-teal">
              View all
            </Link>
          </div>
          {!d ? (
            <ListSkeleton rows={3} avatar={false} label="Loading appointments" />
          ) : d.nextBookings.length === 0 ? (
            <EmptyState title="No upcoming appointments" body={company.status === 'published' ? 'New bookings will appear here.' : 'Publish your profile so customers can book.'} />
          ) : (
            <ul className="divide-y divide-line">
              {d.nextBookings.map((b) => (
                <li key={b.id}>
                  <Link to={`/business/appointments/${b.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-cloud/50">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-navy">
                        {b.customer?.name} · {b.service.title}
                      </p>
                      <p className="text-sm text-muted tabular">{formatDateTime(b.startAt, b.timezone)}</p>
                    </div>
                    <StatusBadge status={b.status} audience="vendor" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-navy">Last 30 days</h2>
          {d ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Profile views', d.last30Days.profileViews],
                ['Saved by customers', d.last30Days.favorites],
                ['New inquiries', d.last30Days.inquiries],
                ['Bookings', d.last30Days.bookings],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-xl font-bold text-navy tabular">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <TextSkeleton lines={4} />
          )}
          <p className="mt-4 text-xs text-muted">Counts come from recorded TownAnt activity on your profile.</p>
          {d?.latestReviews.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 font-semibold text-navy">Latest reviews</h3>
              <ul className="flex flex-col gap-3">
                {d.latestReviews.map((r) => (
                  <li key={r.id} className="text-sm">
                    <Stars value={r.rating} /> <span className="font-medium text-navy">{r.authorName}</span>
                    {r.text && <p className="line-clamp-2 text-muted">{r.text}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
