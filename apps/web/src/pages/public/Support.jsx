import { useParams } from 'react-router';
import { RequireCustomer } from '../../components/RequireCustomer.jsx';
import { NewTicketForm, TicketDetail, TicketList } from '../../components/support/Support.jsx';
import { PageHeader } from '../../components/ui.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';

// Customer support: requests to the TownAnt team (separate from messages with businesses).
export default function Support({ mode = 'list' }) {
  const { id } = useParams();
  useDocumentTitle(mode === 'new' ? 'New support request' : 'Help & support');
  return (
    <RequireCustomer>
      <div className="mx-auto max-w-3xl gutter py-10">
        {mode === 'list' && (
          <>
            <PageHeader title="Help & support" subtitle="Questions about your account, a booking or a business? Send us a request and follow the replies here." />
            <TicketList apiBase="/support" linkBase="/support" />
          </>
        )}
        {mode === 'new' && (
          <>
            <PageHeader title="New support request" subtitle="We reply in your request and notify you. For questions about a specific appointment, you can also message the business directly from the booking." breadcrumbs={[{ to: '/support', label: 'Help & support' }, { label: 'New request' }]} />
            <NewTicketForm apiBase="/support" linkBase="/support" />
          </>
        )}
        {mode === 'detail' && <TicketDetail apiBase="/support" linkBase="/support" id={id} />}
      </div>
    </RequireCustomer>
  );
}
