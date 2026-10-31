import { ClipboardCheck, ExternalLink, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Button, ConfirmDialog, DetailSkeleton, ErrorState, ReasonDialog, SearchInput, Select, Table, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { AdminPage, DataPanel, ExportButton, FactList, Panel, PanelEmpty, statusLabel, StatusPill, useAdminFilters } from './kit.jsx';

const STATUSES = ['submitted', 'under_review', 'info_requested', 'approved', 'rejected'];
const OPEN = ['submitted', 'under_review', 'info_requested'];
const WORKS = { fixed: 'At own location', mobile: 'Travels to customers', both: 'Both' };

export default function Applications() {
  useDocumentTitle('Vendor applications');
  const { id } = useParams();
  return id ? <ApplicationDetail id={id} /> : <ApplicationList />;
}

function ApplicationList() {
  const navigate = useNavigate();
  const f = useAdminFilters();
  const [q, setQ] = useState(f.get('q'));
  const status = f.get('status');
  const list = useApi('/admin/applications', { query: { status, q: f.get('q'), page: f.page } });
  const filtered = Boolean(status || f.get('q'));
  return (
    <AdminPage
      title="Vendor applications"
      description="Review “Join as a vendor” submissions. Approving creates a draft business and emails the owner a single-use setup link."
      actions={<ExportButton path="/admin/applications/export" query={{ status, q: f.get('q') }} fallbackName="townant-company-applications.xlsx" />}
    >
      <DataPanel
        state={list}
        onPage={(p) => f.set({ page: String(p) })}
        filters={
          <>
            <Select label="Status" value={status} onChange={(e) => f.set({ status: e.target.value })} className="w-48" options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: statusLabel('application', s) }))]} />
            <SearchInput label="Search" labelHidden={false} placeholder="Business or email" value={q} onChange={setQ} onDebouncedChange={(v) => f.set({ q: v.trim() })} className="w-full sm:w-72" />
          </>
        }
        empty={<PanelEmpty icon={ClipboardCheck} title={filtered ? 'Nothing matches these filters' : 'No applications yet'} body={filtered ? 'Try another status or search.' : 'New vendor applications will appear here.'} />}
      >
        {(rows) => (
          <Table
            bare
            rows={rows}
            caption="Vendor applications"
            onRowClick={(r) => navigate(`/admin/applications/${r.id}`)}
            columns={[
              {
                key: 'businessName',
                label: 'Business',
                render: (r) => (
                  <Link to={`/admin/applications/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-slate-900 hover:text-teal-700">
                    {r.businessName}
                  </Link>
                ),
              },
              { key: 'contact', label: 'Contact', render: (r) => (<><p className="text-slate-700">{r.contactName}</p><p className="text-caption text-slate-500">{r.email}</p></>) },
              { key: 'city', label: 'Location', render: (r) => [r.address?.city, r.address?.region, r.address?.country].filter(Boolean).join(', ') || '—' },
              { key: 'status', label: 'Status', render: (r) => <StatusPill kind="application" status={r.status} /> },
              { key: 'createdAt', label: 'Received', align: 'right', render: (r) => <span className="whitespace-nowrap text-slate-500 tabular">{relativeTime(r.createdAt)}</span> },
            ]}
          />
        )}
      </DataPanel>
    </AdminPage>
  );
}

function ApplicationDetail({ id }) {
  const toast = useToast();
  const app = useApi(`/admin/applications/${id}`);
  const categories = useApi('/catalog/categories');
  const [dialog, setDialog] = useState(null);
  const [result, setResult] = useState(null);
  const a = app.data;
  const crumbs = [{ label: 'Vendor applications', to: '/admin/applications' }, { label: a?.businessName ?? 'Application' }];
  if (app.error && !a)
    return (
      <AdminPage title="Application" breadcrumbs={crumbs} width="wide">
        <ErrorState error={app.error} onRetry={app.reload} />
      </AdminPage>
    );
  if (!a) return <DetailSkeleton label="Loading application" />;
  const open = OPEN.includes(a.status);

  const approve = async () => {
    const { data } = await api(`/admin/applications/${id}/approve`, { method: 'POST', body: {} });
    setResult(data);
    app.setData(data.application);
    toast('Application approved');
  };

  const decide = (action) => async (reason) => {
    const { data } = await api(`/admin/applications/${id}/${action}`, { method: 'POST', body: { reason } });
    app.setData(data);
    toast('Applicant notified');
  };

  return (
    <AdminPage
      width="wide"
      breadcrumbs={crumbs}
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {a.businessName}
          <StatusPill kind="application" status={a.status} />
        </span>
      }
      description={`Received ${relativeTime(a.createdAt)} from ${a.contactName}.`}
    >
      {result && (
        <Alert tone={result.inviteEmailSent ? 'success' : 'warn'}>
          Business “{result.company.name}” was created as a draft. {result.inviteEmailSent ? 'A setup link was emailed to the owner.' : 'The setup email could not be sent — use “Resend setup invite” on the business page.'}{' '}
          <Link to={`/admin/companies/${result.company.id}`} className="font-semibold underline">
            Open business
          </Link>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Application">
          <FactList
            items={[
              ['Contact', a.contactName],
              ['Email', <a key="e" href={`mailto:${a.email}`} className="inline-flex items-center gap-1 text-teal-700 hover:underline"><Mail size={14} aria-hidden="true" />{a.email}</a>],
              ['Phone', a.phone],
              ['Website', a.website && <a key="w" href={a.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-teal-700 hover:underline">{a.website}<ExternalLink size={13} aria-hidden="true" /></a>],
              ['Location', [a.address?.line1, a.address?.city, a.address?.region, a.address?.postalCode, a.address?.country].filter(Boolean).join(', ')],
              ['Works', WORKS[a.serviceMode]],
              ['Categories', a.categoryIds.map((cid) => categories.data?.find((c) => c.id === cid)?.name).filter(Boolean).join(', '), true],
              ['Description', a.description && <span key="d" className="whitespace-pre-line">{a.description}</span>, true],
            ]}
          />
        </Panel>
        <Panel title="Decision" description={open ? 'The applicant is emailed whichever you choose.' : `Decided ${a.decidedAt ? relativeTime(a.decidedAt) : ''}.`}>
          {open ? (
            <div className="flex flex-col gap-2">
              <Button onClick={() => setDialog('approve')}>Approve & create business</Button>
              {a.status !== 'info_requested' && (
                <Button variant="secondary" onClick={() => setDialog('info')}>
                  Request more information
                </Button>
              )}
              <Button variant="danger-ghost" onClick={() => setDialog('reject')}>
                Reject application
              </Button>
              {a.decisionReason && <p className="mt-3 border-t border-slate-200 pt-3 text-secondary text-slate-500">Last note to the applicant: “{a.decisionReason}”</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-body">
              <StatusPill kind="application" status={a.status} className="w-fit" />
              {a.decisionReason && <p className="text-slate-700">“{a.decisionReason}”</p>}
              {a.companyId && !result && (
                <Link to={`/admin/companies/${a.companyId}`} className="font-semibold text-teal-700 hover:underline">
                  View business →
                </Link>
              )}
            </div>
          )}
        </Panel>
      </div>
      <ConfirmDialog open={dialog === 'approve'} onClose={() => setDialog(null)} title={`Approve ${a.businessName}?`} description={`This creates a draft business and emails a single-use setup link to ${a.email}. The business stays hidden until the owner publishes it.`} confirmLabel="Approve & create business" onConfirm={approve} />
      <ReasonDialog open={dialog === 'reject'} onClose={() => setDialog(null)} title="Reject application" description="The applicant receives this reason by email." confirmLabel="Reject" danger onConfirm={decide('reject')} />
      <ReasonDialog open={dialog === 'info'} onClose={() => setDialog(null)} title="Request more information" description="Explain what the applicant should send. They receive this by email." confirmLabel="Send request" onConfirm={decide('request-info')} />
    </AdminPage>
  );
}
