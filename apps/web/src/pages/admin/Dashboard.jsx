import { addDaysIso, formatDate, todayIso } from '@townant/shared';
import { ArrowRight, CalendarCheck2, CheckCircle2, ClipboardCheck, Flag, LifeBuoy, Store, Tags, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { DateRangePicker, ErrorState, Skeleton, TextSkeleton } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { ADMIN_BOOKING_LABELS, describeAudit } from './labels.js';
import { AdminPage, BarList, CHART, ColumnChart, DonutChart, ExportButton, KpiCard, Panel, PanelEmpty, SegmentedTabs, StatusPill, TrendChart } from './kit.jsx';

// Recorded platform events (AnalyticsEvent) on the activity chart, in fixed palette order.
const EVENTS = [
  ['profile_view', 'Profile views', CHART.teal],
  ['favorite_added', 'Favorites', CHART.blue],
  ['inquiry_started', 'Inquiries', CHART.orange],
  ['booking_created', 'Bookings created', CHART.violet],
  ['booking_confirmed', 'Bookings confirmed', CHART.amber],
];
const GROWTH = [
  { value: 'customers', label: 'New customers', color: CHART.blue, unit: 'new customers' },
  { value: 'companies', label: 'New businesses', color: CHART.violet, unit: 'new businesses' },
  { value: 'bookings', label: 'Bookings', color: CHART.teal, unit: 'bookings created' },
];
const APPLICATION_STATUS = [
  ['submitted', 'New', CHART.amber],
  ['under_review', 'Under review', CHART.orange],
  ['info_requested', 'Info requested', CHART.blue],
  ['approved', 'Approved', CHART.teal],
  ['rejected', 'Rejected', CHART.magenta],
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard() {
  useDocumentTitle('Admin dashboard');
  const { user } = useAuth();
  const [range, setRange] = useState({ from: '', to: '' });
  const [growth, setGrowth] = useState('customers');
  const dash = useApi('/admin/dashboard', { query: range });
  const support = useApi('/admin/support/meta');
  const categories = useApi('/admin/categories');
  const applications = useApi('/admin/applications', { query: { limit: 5 } });
  const companiesRecent = useApi('/admin/companies', { query: { limit: 5 } });
  const audit = useApi('/admin/audit', { query: { limit: 8 } });
  const d = dash.data;
  const companies = d?.totals.companies ?? {};
  const topCategories = categories.data?.filter((c) => !c.parentId) ?? [];
  const firstName = user?.displayName?.split(/\s+/)[0];
  const days = d ? daysBetween(d.range.from, d.range.to) : [];
  const daily = (key) => days.map((day) => d.growth[key][day] ?? 0);
  const sum = (key) => (d ? daily(key).reduce((a, b) => a + b, 0) : null);
  const loading = !d && !dash.error;
  const failed = Boolean(dash.error && !d);
  const period = d ? `${formatDate(`${d.range.from}T12:00:00Z`, 'UTC')} – ${formatDate(`${d.range.to}T12:00:00Z`, 'UTC')}` : '';
  const g = GROWTH.find((x) => x.value === growth);
  const apps = d?.totals.applicationsByStatus ?? {};

  return (
    <AdminPage
      eyebrow={formatDate(new Date().toISOString())}
      title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
      description={d ? `Live marketplace data. Period figures cover ${period} (UTC).` : 'Live marketplace data.'}
      actions={
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker label="Reporting period" from={range.from} to={range.to} onChange={setRange} max={todayIso('UTC')} timeZone="UTC" presets />
          <ExportButton path="/admin/dashboard/export" query={range} label="Export report" fallbackName="townant-dashboard-report.xlsx" />
        </div>
      }
    >
      {failed && <ErrorState error={dash.error} onRetry={dash.reload} title="The dashboard didn't load" />}

      <section aria-label="Headline figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard variant="feature" icon={CalendarCheck2} tone="teal" label="Bookings created" value={sum('bookings')} loading={loading} error={failed} hint="In the reporting period" trend={d && { values: daily('bookings'), label: 'Bookings created per day' }} to="/admin/bookings" />
        <KpiCard variant="feature" icon={UserPlus} tone="blue" label="New customers" value={sum('customers')} loading={loading} error={failed} hint={d ? `${d.totals.customers.toLocaleString('en-US')} active customer account${d.totals.customers === 1 ? '' : 's'}` : ''} trend={d && { values: daily('customers'), label: 'New customers per day' }} to="/admin/users?role=customer" />
        <KpiCard variant="feature" icon={Store} tone="violet" label="Live businesses" value={companies.published ?? (d ? 0 : null)} loading={loading} error={failed} hint={d ? `${sum('companies')} added in the period` : ''} trend={d && { values: daily('companies'), label: 'New businesses per day' }} to="/admin/companies?status=published" />
        <KpiCard
          variant="feature"
          icon={ClipboardCheck}
          tone="amber"
          label="Applications to review"
          value={d?.totals.pendingApplications}
          loading={loading}
          error={failed}
          hint={d ? `${(apps.info_requested ?? 0).toLocaleString('en-US')} waiting on the applicant` : ''}
          footer={d && <ApplicationMix apps={apps} />}
          to="/admin/applications?status=submitted"
          linkLabel="Review"
        />
      </section>

      <section aria-label="Queues" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={LifeBuoy} tone="blue" label="Support awaiting reply" value={support.data?.counts.awaitingSupport} loading={!support.data && !support.error} error={support.error && !support.data} hint={support.data ? `${support.data.counts.unassigned} unassigned` : ''} to="/admin/support?status=active&awaiting=support" linkLabel="Open" />
        <KpiCard icon={Flag} tone="rose" label="Open review reports" value={d?.totals.openReviewReports} loading={loading} error={failed} hint="Awaiting moderation" to="/admin/reviews?reported=true" linkLabel="Moderate" />
        <KpiCard icon={Tags} tone="violet" label="Published categories" value={categories.data ? topCategories.filter((c) => c.isActive).length : null} loading={!categories.data && !categories.error} error={categories.error && !categories.data} hint={categories.data ? `${categories.data.length - topCategories.length} sub-categories` : ''} to="/admin/categories" linkLabel="Manage" />
        <KpiCard icon={UserMinus} tone="amber" label="Pending account deletion" value={d?.totals.customersPendingDeletion} loading={loading} error={failed} hint="Restorable for 15 days" to="/admin/users?status=pending_deletion" />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Marketplace activity" description="Recorded events per day (UTC).">
          {d ? <TrendChart label="Marketplace events per day" days={days} series={EVENTS.map(([key, label, color]) => ({ key, label, color, values: days.map((day) => d.series.find((s) => s.day === day && s.type === key)?.count ?? 0) }))} /> : !failed && <ChartSkeleton />}
        </Panel>
        <Panel title="Businesses by status" description="Every business on TownAnt, right now.">
          {d ? (
            <DonutChart
              label="Businesses by status"
              centerLabel="Businesses"
              items={[
                { label: 'Live', value: companies.published ?? 0, color: CHART.teal, to: '/admin/companies?status=published' },
                { label: 'Draft', value: companies.draft ?? 0, color: CHART.blue, to: '/admin/companies?status=draft' },
                { label: 'Suspended', value: companies.suspended ?? 0, color: CHART.orange, to: '/admin/companies?status=suspended' },
                { label: 'Deleted', value: companies.deleted ?? 0, color: CHART.violet, to: '/admin/companies?view=deleted' },
              ]}
            />
          ) : (
            !failed && <ChartSkeleton />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Growth" description="New records per day (UTC)." actions={<SegmentedTabs label="Growth measure" tabs={GROWTH.map(({ value, label }) => ({ value, label }))} value={growth} onChange={setGrowth} />}>
          {d ? <ColumnChart key={growth} label={`${g.label} per day`} days={days} values={daily(growth)} color={g.color} valueLabel={g.unit} height={240} /> : !failed && <ChartSkeleton />}
        </Panel>
        <Panel title="Vendor applications" description="All applications by current status.">
          {d ? <DonutChart label="Applications by status" centerLabel="Applications" emptyLabel="No applications yet." items={APPLICATION_STATUS.map(([key, label, color]) => ({ label, value: apps[key] ?? 0, color, to: `/admin/applications?status=${key}` }))} /> : !failed && <ChartSkeleton />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Bookings in period" description="Bookings created in the period, by current status.">
          {d ? (
            <BarList
              valueLabel="bookings"
              emptyLabel="No bookings were created in this period."
              items={Object.entries(d.totals.bookingsByStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, value]) => ({ label: ADMIN_BOOKING_LABELS[status] ?? status, value, to: `/admin/bookings?status=${status}` }))}
            />
          ) : (
            <TextSkeleton lines={4} />
          )}
        </Panel>
        <Panel title="Live businesses by category" description="By primary category; sub-categories count towards their parent.">
          {d ? <BarList valueLabel="businesses" color={CHART.blue} emptyLabel="No live businesses have a category yet." items={topWithOther(d.categoryMix)} /> : <TextSkeleton lines={4} />}
        </Panel>
      </div>

      <h2 className="-mb-2 mt-2 font-heading text-[1rem] font-bold text-slate-900">Operations</h2>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <ListPanel
          title="Recent applications"
          more={{ to: '/admin/applications', label: 'All applications' }}
          state={applications}
          empty={<PanelEmpty icon={ClipboardCheck} title="No applications yet" body="New vendor applications will appear here." />}
          row={(a) => (
            <Link to={`/admin/applications/${a.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50">
              <Initial text={a.businessName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem] font-semibold text-slate-900">{a.businessName}</span>
                <span className="block truncate text-caption text-slate-500">
                  {[a.address?.city, a.address?.country].filter(Boolean).join(', ') || a.email} · {relativeTime(a.createdAt)}
                </span>
              </span>
              <StatusPill kind="application" status={a.status} />
            </Link>
          )}
        />
        <ListPanel
          title="Recently added businesses"
          more={{ to: '/admin/companies', label: 'All companies' }}
          state={companiesRecent}
          empty={<PanelEmpty icon={Store} title="No businesses yet" body="Approve an application or create a company." />}
          row={(c) => (
            <Link to={`/admin/companies/${c.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50">
              <Initial text={c.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem] font-semibold text-slate-900">{c.name}</span>
                <span className="block truncate text-caption text-slate-500">
                  {[c.address?.city, c.address?.country].filter(Boolean).join(', ') || `/${c.slug}`} · {relativeTime(c.createdAt)}
                </span>
              </span>
              <StatusPill kind="company" status={c.status} />
            </Link>
          )}
        />
        <NeedsAttention d={d} support={support.data} loading={!d || !support.data} />
      </div>

      <Panel
        flush
        title="Recent activity"
        description="Latest audited actions on the platform."
        actions={
          <Link to="/admin/audit" className="inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-teal-700 hover:underline">
            Audit log <ArrowRight size={14} aria-hidden="true" />
          </Link>
        }
      >
        {audit.error && !audit.data ? (
          <ErrorState flush compact error={audit.error} onRetry={audit.reload} />
        ) : !audit.data ? (
          <div className="p-5">
            <TextSkeleton lines={6} />
          </div>
        ) : audit.data.length === 0 ? (
          <PanelEmpty title="Nothing recorded yet" body="Consequential actions are recorded here as they happen." />
        ) : (
          <ol className="divide-y divide-slate-100">
            {audit.data.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                <span className="size-1.5 shrink-0 rounded-full bg-teal" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                  <span className="font-medium text-slate-900">{describeAudit(e.action)}</span>
                  <span className="text-slate-500"> · {e.actor?.label ?? e.actorType}</span>
                  {e.reason && <span className="text-slate-400"> · “{e.reason}”</span>}
                </span>
                <time dateTime={e.at} className="shrink-0 text-caption text-slate-400 tabular">
                  {relativeTime(e.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </AdminPage>
  );
}

const ChartSkeleton = () => <Skeleton className="h-[240px] w-full rounded-lg" />;

const Initial = ({ text }) => (
  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-heading text-[0.8125rem] font-bold text-slate-700" aria-hidden="true">
    {text.slice(0, 1).toUpperCase()}
  </span>
);

// Applications by status as one thin stacked bar (fills the headline card's trend slot with real data).
function ApplicationMix({ apps }) {
  const parts = APPLICATION_STATUS.map(([key, label, color]) => ({ key, label, color, value: apps[key] ?? 0 }));
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return <p className="flex h-full items-center text-caption text-slate-400">No applications yet.</p>;
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`All applications: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        {parts.filter((p) => p.value).map((p) => (
          <span key={p.key} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <p className="truncate text-caption text-slate-500 tabular">{total.toLocaleString('en-US')} in total · {(apps.approved ?? 0).toLocaleString('en-US')} approved</p>
    </div>
  );
}

function ListPanel({ title, more, state, empty, row }) {
  return (
    <Panel
      flush
      title={title}
      actions={
        <Link to={more.to} className="inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-teal-700 hover:underline">
          {more.label} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      }
    >
      {state.error && !state.data ? (
        <ErrorState flush compact error={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <div className="p-5">
          <TextSkeleton lines={5} />
        </div>
      ) : state.data.length === 0 ? (
        empty
      ) : (
        <ul className="divide-y divide-slate-100">
          {state.data.map((r) => (
            <li key={r.id}>{row(r)}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function daysBetween(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDaysIso(day, 1)) days.push(day);
  return days;
}

// Up to seven categories by name, the rest folded into "Other".
function topWithOther(mix) {
  const rows = mix.map((c) => ({ label: c.name, value: c.companies, to: `/admin/categories/${c.id}` }));
  const top = rows.slice(0, 7);
  const rest = rows.slice(7).reduce((n, r) => n + r.value, 0);
  return rest ? [...top, { label: 'Other categories', value: rest }] : top;
}

// Queues with work waiting, from real counts only. Empty queues are shown as clear, not hidden.
function NeedsAttention({ d, support, loading }) {
  const items = [
    ['Applications awaiting review', d?.totals.pendingApplications, '/admin/applications?status=submitted'],
    ['Support waiting on TownAnt', support?.counts.awaitingSupport, '/admin/support?status=active&awaiting=support'],
    ['Unassigned support requests', support?.counts.unassigned, '/admin/support?status=active&assignee=none'],
    ['Open review reports', d?.totals.openReviewReports, '/admin/reviews?reported=true'],
    ['Draft businesses', d?.totals.companies.draft ?? (d ? 0 : undefined), '/admin/companies?status=draft'],
  ];
  return (
    <Panel flush title="Pending actions">
      {loading ? (
        <div className="p-5">
          <TextSkeleton lines={5} />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map(([label, count, to]) => (
            <li key={label}>
              <Link to={to} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                {count ? (
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-100 px-1.5 text-caption font-bold text-amber-900 tabular">{count}</span>
                ) : (
                  <CheckCircle2 size={18} aria-hidden="true" className="mx-0.5 shrink-0 text-emerald-600" />
                )}
                <span className={count ? 'flex-1 text-[0.875rem] font-medium text-slate-900' : 'flex-1 text-[0.875rem] text-slate-500'}>
                  {label}
                  {!count && <span className="sr-only">: none</span>}
                </span>
                <ArrowRight size={15} aria-hidden="true" className="shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700 motion-reduce:transition-none" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
