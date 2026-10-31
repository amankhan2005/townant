import { useParams } from 'react-router';
import { NewTicketForm, TicketDetail, TicketList } from '../../components/support/Support.jsx';
import { PageHeader } from '../../components/ui.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';

// Vendor support requests for the selected business. Available even while the business is
// suspended, so the team can resolve it with TownAnt.
export default function Support({ mode = 'list' }) {
  const { id } = useParams();
  useDocumentTitle('Support');
  return (
    <div className="max-w-3xl">
      {mode === 'list' && (
        <>
          <PageHeader title="Support" subtitle="Ask the TownAnt team about your listing, appointments, team access or anything else. Owners and managers see every request for this business." />
          <TicketList apiBase="/vendor/support" linkBase="/business/support" />
        </>
      )}
      {mode === 'new' && (
        <>
          <PageHeader title="New support request" breadcrumbs={[{ to: '/business/support', label: 'Support' }, { label: 'New request' }]} />
          <NewTicketForm apiBase="/vendor/support" linkBase="/business/support" />
        </>
      )}
      {mode === 'detail' && <TicketDetail apiBase="/vendor/support" linkBase="/business/support" id={id} />}
    </div>
  );
}
