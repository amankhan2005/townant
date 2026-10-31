import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { RequireCustomer } from '../../components/RequireCustomer.jsx';
import { Async, EmptyState, ListSkeleton, PageHeader, Pagination, StatusBadge, Tabs } from '../../components/ui.jsx';
import { formatDateTime, imageUrl } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';

export default function Bookings() {
  useDocumentTitle('My bookings');
  return (
    <RequireCustomer>
      <BookingList />
    </RequireCustomer>
  );
}

function BookingList() {
  const [when, setWhen] = useState('upcoming');
  const [page, setPage] = useState(1);
  const list = useApi('/bookings', { query: { when, page, limit: 10 } });
  return (
    <div className="mx-auto max-w-3xl gutter py-8">
      <PageHeader title="My bookings" />
      <div className="mb-5">
        <Tabs
          label="Bookings"
          value={when}
          onChange={(w) => {
            setWhen(w);
            setPage(1);
          }}
          tabs={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past' },
          ]}
        />
      </div>
      <Async
        state={list}
        loading={<ListSkeleton rows={3} label="Loading bookings" />}
        empty={<EmptyState icon={CalendarDays} title={when === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'} body="When you book a service it will appear here." action={<Link to="/search" className="font-semibold text-teal-700">Find a service</Link>} />}
      >
        {(data) => (
      <ul className="flex flex-col gap-3">
        {data.map((b) => (
          <li key={b.id}>
            <Link to={`/bookings/${b.id}`} className="flex items-center gap-4 rounded-card border border-line bg-white p-4 shadow-card transition hover:border-teal/40 hover:shadow-raised">
              <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-teal-50 font-bold text-teal">
                {b.company?.logoUrl ? <img src={imageUrl(b.company.logoUrl, { w: 96, h: 96 })} alt="" className="size-full object-cover" /> : b.company?.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-navy">{b.service.title}</p>
                <p className="truncate text-sm text-muted">{b.company?.name}</p>
                <p className="text-sm text-navy tabular">{formatDateTime(b.startAt, b.timezone)}</p>
              </div>
              <StatusBadge status={b.status} />
            </Link>
          </li>
        ))}
      </ul>
        )}
      </Async>
      <Pagination meta={list.meta} onPage={setPage} />
    </div>
  );
}
