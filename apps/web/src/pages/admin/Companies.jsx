import { BadgeCheck, CalendarDays, CalendarClock, ExternalLink, Layers, MailPlus, Plus, RotateCcw, Store, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { countryOptions } from '@townant/shared';
import { Alert, Badge, Button, ConfirmDialog, DetailSkeleton, ErrorState, FormError, Input, Modal, ReasonDialog, SearchInput, Select, Table, Textarea, Toggle, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDate, imageUrl, relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { AdminPage, DataPanel, ExportButton, FactList, Panel, PanelEmpty, SegmentedTabs, statusLabel, StatusPill, useAdminFilters } from './kit.jsx';

const COUNTRIES = countryOptions();


export default function Companies() {
  useDocumentTitle('Companies');
  const { id } = useParams();
  return id ? <CompanyDetail id={id} /> : <CompanyList />;
}

function CompanyList() {
  const navigate = useNavigate();
  const f = useAdminFilters();
  const [q, setQ] = useState(f.get('q'));
  const [creating, setCreating] = useState(false);
  const deletedView = f.get('view') === 'deleted';
  const query = deletedView ? { view: 'deleted', q: f.get('q'), page: f.page } : { status: f.get('status'), q: f.get('q'), page: f.page };
  const list = useApi('/admin/companies', { query });
  const deletedCount = useApi('/admin/companies', { query: { view: 'deleted', limit: 1 } }, [list.data]);
  const filtered = Boolean(f.get('status') || f.get('q'));
  const exportQuery = deletedView ? { view: 'deleted', q: f.get('q') } : { status: f.get('status'), q: f.get('q') };
  return (
    <AdminPage
      title="Companies"
      description="Every business on TownAnt. Open one to verify, suspend, feature, delete it or resend the owner's setup link."
      actions={
        <>
          <ExportButton path="/admin/companies/export" query={exportQuery} fallbackName="townant-companies.xlsx" />
          <Button onClick={() => setCreating(true)} icon={<Plus size={17} aria-hidden="true" />}>
            Create company
          </Button>
        </>
      }
    >
      <DataPanel
        state={list}
        onPage={(p) => f.set({ page: String(p) })}
        toolbar={
          <SegmentedTabs
            label="Company list"
            value={deletedView ? 'deleted' : 'active'}
            onChange={(v) => {
              setQ('');
              f.set({ view: v === 'deleted' ? 'deleted' : '', status: '', q: '' });
            }}
            tabs={[
              { value: 'active', label: 'All companies' },
              { value: 'deleted', label: 'Recently deleted', count: deletedCount.meta?.total ?? null },
            ]}
          />
        }
        filters={
          <>
            {!deletedView && (
              <Select label="Status" value={f.get('status')} onChange={(e) => f.set({ status: e.target.value })} className="w-44" options={[{ value: '', label: 'All statuses' }, ...['published', 'draft', 'suspended'].map((v) => ({ value: v, label: statusLabel('company', v) }))]} />
            )}
            <SearchInput label="Search" labelHidden={false} placeholder="Name, slug or city" value={q} onChange={setQ} onDebouncedChange={(v) => f.set({ q: v.trim() })} className="w-full sm:w-72" />
          </>
        }
        empty={
          deletedView ? (
            <PanelEmpty icon={Trash2} title={f.get('q') ? 'No deleted companies match' : 'Nothing recently deleted'} body="Deleted businesses stay here, restorable, for 15 days." />
          ) : (
            <PanelEmpty icon={Store} title={filtered ? 'No companies match' : 'No companies yet'} body={filtered ? 'Try another status or search.' : 'Approve a vendor application or create a company to get started.'} />
          )
        }
      >
        {(rows) => (deletedView ? <DeletedTable rows={rows} onChanged={list.reload} /> : (
          <Table
            bare
            rows={rows}
            caption="Companies"
            onRowClick={(r) => navigate(`/admin/companies/${r.id}`)}
            columns={[
              {
                key: 'name',
                label: 'Company',
                render: (r) => (
                  <span className="flex items-center gap-3">
                    <CompanyAvatar company={r} />
                    <span className="min-w-0">
                      <Link to={`/admin/companies/${r.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 font-semibold text-slate-900 hover:text-teal-700">
                        {r.name}
                        {r.verified && <BadgeCheck size={15} className="shrink-0 text-teal-600" aria-label="Verified" />}
                      </Link>
                      <span className="block text-caption text-slate-500">/{r.slug}</span>
                    </span>
                  </span>
                ),
              },
              { key: 'city', label: 'Location', render: (r) => [r.address?.city, r.address?.country].filter(Boolean).join(', ') || '—' },
              { key: 'status', label: 'Status', render: (r) => <StatusPill kind="company" status={r.status} /> },
              { key: 'rating', label: 'Rating', align: 'right', render: (r) => <span className="tabular">{r.rating.count ? `${r.rating.average} (${r.rating.count})` : <span className="text-slate-400">No reviews</span>}</span> },
              { key: 'createdAt', label: 'Created', align: 'right', render: (r) => <span className="whitespace-nowrap text-slate-500 tabular">{formatDate(r.createdAt)}</span> },
            ]}
          />
        ))}
      </DataPanel>
      {creating && <CreateCompany onClose={() => setCreating(false)} onCreated={(c) => navigate(`/admin/companies/${c.id}`)} />}
    </AdminPage>
  );
}

const CompanyAvatar = ({ company }) =>
  company.media?.logo?.url ? (
    <img src={imageUrl(company.media.logo.url, { w: 72, h: 72 })} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
  ) : (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 font-heading text-secondary font-bold text-slate-700 ring-1 ring-slate-200" aria-hidden="true">
      {company.name.slice(0, 1).toUpperCase()}
    </span>
  );

// Recently deleted: restorable for 15 days, then finalized by a background job. Once the period
// has ended the record can be finalized here too (if the job hasn't run yet).
function DeletedTable({ rows, onChanged }) {
  const toast = useToast();
  const [target, setTarget] = useState(null);
  return (
    <>
      <Table
        bare
        rows={rows}
        caption="Recently deleted companies"
        columns={[
          {
            key: 'name',
            label: 'Company',
            render: (r) => (
              <span className="flex items-center gap-3">
                <CompanyAvatar company={r} />
                <span className="min-w-0">
                  <Link to={`/admin/companies/${r.id}`} className="font-semibold text-slate-900 hover:text-teal-700">
                    {r.name}
                  </Link>
                  <span className="block text-caption text-slate-500">Was {statusLabel('company', r.deletion?.statusBefore).toLowerCase()}</span>
                </span>
              </span>
            ),
          },
          { key: 'deletedAt', label: 'Deleted', render: (r) => <span className="whitespace-nowrap tabular">{r.deletion?.deletedAt ? formatDate(r.deletion.deletedAt) : '—'}</span> },
          { key: 'reason', label: 'Reason', className: 'max-w-[16rem]', render: (r) => <span className="line-clamp-2 text-slate-600">{r.deletion?.reason ?? '—'}</span> },
          { key: 'recovery', label: 'Recovery', render: (r) => <RecoveryBadge deletion={r.deletion} /> },
          {
            key: 'actions',
            label: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (r) =>
              r.deletion?.restorable ? (
                <Button size="sm" variant="secondary" icon={<RotateCcw size={15} aria-hidden="true" />} onClick={() => setTarget({ company: r, action: 'restore' })}>
                  Restore
                </Button>
              ) : r.deletion?.purgedAt ? (
                <span className="text-caption text-slate-400">Finalized</span>
              ) : (
                <Button size="sm" variant="danger-ghost" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setTarget({ company: r, action: 'purge' })}>
                  Delete permanently
                </Button>
              ),
          },
        ]}
      />
      <ConfirmDialog
        open={target?.action === 'restore'}
        onClose={() => setTarget(null)}
        title={target ? `Restore ${target.company.name}?` : ''}
        description={target ? `It returns as ${statusLabel('company', target.company.deletion?.statusBefore).toLowerCase()}, with its services, team, bookings, reviews and spotlight placement as they were.` : ''}
        confirmLabel="Restore company"
        onConfirm={async () => {
          await api(`/admin/companies/${target.company.id}/restore`, { method: 'POST', body: {} });
          toast(`${target.company.name} restored`);
          onChanged();
        }}
      />
      <ConfirmDialog
        open={target?.action === 'purge'}
        onClose={() => setTarget(null)}
        danger
        title={target ? `Permanently delete ${target.company.name}?` : ''}
        description="The recovery period has ended. Upcoming bookings are cancelled (customers are told), services are archived, the team loses access and images are removed. Past bookings, reviews and the audit trail are kept. This can't be undone."
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          await api(`/admin/companies/${target.company.id}/purge`, { method: 'POST' });
          toast(`${target.company.name} permanently deleted`);
          onChanged();
        }}
      />
    </>
  );
}

function RecoveryBadge({ deletion }) {
  if (!deletion) return null;
  if (deletion.purgedAt) return <Badge>Finalized {formatDate(deletion.purgedAt)}</Badge>;
  if (!deletion.restorable) return <Badge tone="red">Recovery period ended</Badge>;
  return (
    <span className="flex flex-col gap-0.5">
      <Badge tone={deletion.daysLeft <= 3 ? 'amber' : 'teal'}>
        <CalendarClock size={12} aria-hidden="true" /> {deletion.daysLeft} day{deletion.daysLeft === 1 ? '' : 's'} left
      </Badge>
      <span className="text-caption text-slate-500 tabular">Until {formatDate(deletion.restoreUntil)}</span>
    </span>
  );
}

function CreateCompany({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', ownerEmail: '', city: '', region: '', postalCode: '', country: 'US', serviceMode: 'fixed', description: '' });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/admin/companies', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          ownerEmail: form.ownerEmail.trim(),
          description: form.description.trim(),
          serviceMode: form.serviceMode,
          address: { city: form.city.trim(), region: form.region.trim() || undefined, postalCode: form.postalCode.trim() || undefined, country: form.country.trim().toUpperCase() },
        },
      });
      toast(data.inviteEmailSent ? 'Company created and setup link sent' : 'Company created; setup email failed — resend from the company page');
      onCreated(data.company);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Create company" size="lg">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Company name" required value={form.name} onChange={set('name')} />
        <Input className="sm:col-span-2" label="Owner email" type="email" required value={form.ownerEmail} onChange={set('ownerEmail')} hint="They receive a single-use setup link. No password is sent." />
        <Input label="City" required value={form.city} onChange={set('city')} />
        <Input label="State / region" optional value={form.region} onChange={set('region')} />
        <Input label="ZIP / postal code" optional value={form.postalCode} onChange={set('postalCode')} />
        <Select label="Country" required value={form.country} onChange={set('country')} options={COUNTRIES} />
        <Select label="Service mode" value={form.serviceMode} onChange={set('serviceMode')}>
          <option value="fixed">Fixed location</option>
          <option value="mobile">Mobile</option>
          <option value="both">Both</option>
        </Select>
        <Textarea className="sm:col-span-2" label="Description" optional rows={3} value={form.description} onChange={set('description')} />
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" pending={pending}>Create & invite owner</Button>
        </div>
      </form>
    </Modal>
  );
}

function CompanyDetail({ id }) {
  const toast = useToast();
  const company = useApi(`/admin/companies/${id}`);
  const [dialog, setDialog] = useState(null);
  const c = company.data;
  const crumbs = [{ label: 'Companies', to: '/admin/companies' }, { label: c?.name ?? 'Company' }];
  if (company.error && !c)
    return (
      <AdminPage title="Company" breadcrumbs={crumbs} width="wide">
        <ErrorState error={company.error} onRetry={company.reload} />
      </AdminPage>
    );
  if (!c) return <DetailSkeleton label="Loading company" />;

  const post = async (path, body) => {
    const { data } = await api(`/admin/companies/${id}/${path}`, { method: 'POST', body });
    return data;
  };
  const toggleVerified = async () => {
    try {
      await api(`/admin/companies/${id}`, { method: 'PATCH', body: { verified: !c.verified } });
      toast(c.verified ? 'Verified badge removed' : 'Marked as verified');
      company.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const resend = async () => {
    try {
      const data = await post('resend-invite', {});
      toast(data.inviteEmailSent ? 'Setup link sent' : 'Email could not be sent');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <AdminPage
      width="wide"
      breadcrumbs={crumbs}
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {c.name}
          <StatusPill kind="company" status={c.status} />
          {c.verified && (
            <Badge tone="teal">
              <BadgeCheck size={13} aria-hidden="true" /> Verified
            </Badge>
          )}
        </span>
      }
      description={`/${c.slug} · created ${relativeTime(c.createdAt)}`}
      actions={
        c.status === 'deleted' ? (
          c.deletion?.restorable && (
            <Button onClick={() => setDialog('restore')} icon={<RotateCcw size={16} aria-hidden="true" />}>
              Restore company
            </Button>
          )
        ) : (
        <>
          {c.status === 'published' && (
            <a href={`/b/${c.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-body font-semibold text-teal-700 transition hover:bg-teal-50">
              Public page <ExternalLink size={15} aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          <Button variant="secondary" onClick={toggleVerified} icon={<BadgeCheck size={16} aria-hidden="true" />}>
            {c.verified ? 'Remove verified badge' : 'Mark as verified'}
          </Button>
          {c.status === 'suspended' ? (
            <Button onClick={() => setDialog('reactivate')}>Reactivate</Button>
          ) : (
            <Button variant="secondary" onClick={() => setDialog('suspend')}>
              Suspend
            </Button>
          )}
          <Button variant="danger" onClick={() => setDialog('delete')} icon={<Trash2 size={16} aria-hidden="true" />}>
            Delete
          </Button>
        </>
        )
      }
    >
      {company.error && <Alert tone="warn">Couldn't refresh — showing the last loaded details.</Alert>}
      {c.status === 'suspended' && <Alert tone="error" title="Suspended">{c.suspensionReason}</Alert>}
      {c.status === 'deleted' && c.deletion && (
        <Alert tone={c.deletion.restorable ? 'warn' : 'error'} title={c.deletion.restorable ? `Deleted — restorable for ${c.deletion.daysLeft} more day${c.deletion.daysLeft === 1 ? '' : 's'}` : 'Deleted — recovery period ended'}>
          {c.deletion.reason ? `“${c.deletion.reason}” · ` : ''}Deleted {formatDate(c.deletion.deletedAt)}. {c.deletion.restorable ? `Restore before ${formatDate(c.deletion.restoreUntil)} to bring it back as ${statusLabel('company', c.deletion.statusBefore).toLowerCase()}.` : c.deletion.purgedAt ? `Finalized ${formatDate(c.deletion.purgedAt)}.` : 'It will be finalized shortly.'}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [Layers, 'Services', c.stats.services, 'bg-teal-50 text-teal-700'],
          [CalendarDays, 'Bookings', c.stats.bookings, 'bg-sky-50 text-sky-700'],
          [CalendarClock, 'Upcoming bookings', c.stats.upcomingBookings ?? 0, 'bg-violet-50 text-violet-700'],
        ].map(([Icon, label, value, tone]) => (
          <div key={label} className="flex items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-4">
            <span className={`flex size-10 items-center justify-center rounded-xl ${tone}`} aria-hidden="true">
              <Icon size={19} strokeWidth={1.8} />
            </span>
            <span>
              <span className="block text-secondary text-slate-500">{label}</span>
              <span className="font-heading text-[1.375rem] font-extrabold text-slate-900 tabular">{value.toLocaleString('en-US')}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Profile">
          <FactList
            columns={1}
            items={[
              ['Summary', c.summary],
              ['Address', [c.address.line1, c.address.city, c.address.region, c.address.postalCode, c.address.country].filter(Boolean).join(', ')],
              ['Time zone', c.availability.timezone],
            ]}
          />
        </Panel>
        <Panel
          flush
          title="Team"
          description="People who can manage this business."
          actions={
            c.members.some((m) => m.accountStatus === 'invited') && (
              <Button size="sm" variant="secondary" onClick={resend} icon={<MailPlus size={15} aria-hidden="true" />}>
                Resend setup invite
              </Button>
            )
          }
        >
          <ul className="divide-y divide-slate-100">
            {c.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 px-5 py-3.5 text-secondary">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900">{m.name ?? m.email}</span>
                  <span className="block text-caption capitalize text-slate-500">{m.role}{m.lastLoginAt ? ` · last signed in ${relativeTime(m.lastLoginAt)}` : ''}</span>
                </span>
                <StatusPill kind="account" status={m.accountStatus} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {c.status !== 'deleted' && <SpotlightPanel company={c} onSaved={company.reload} />}
      <ReasonDialog open={dialog === 'suspend'} onClose={() => setDialog(null)} title={`Suspend ${c.name}?`} description="The business disappears from search, can't take bookings, and its team can't make changes. Existing bookings are kept — review them under Bookings." confirmLabel="Suspend" danger onConfirm={async (reason) => { await post('suspend', { reason }); company.reload(); toast('Company suspended'); }} />
      <ReasonDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={`Delete ${c.name}?`}
        description={`It disappears from TownAnt and its team loses access, but it can be restored from Recently deleted for 15 days. Nothing else is removed now${c.stats.upcomingBookings ? ` — ${c.stats.upcomingBookings} upcoming booking${c.stats.upcomingBookings === 1 ? ' is' : 's are'} kept for you to review` : ''}. After 15 days it is permanently deleted.`}
        confirmLabel="Delete company"
        danger
        onConfirm={async (reason) => {
          await api(`/admin/companies/${id}`, { method: 'DELETE', body: { reason } });
          toast(`${c.name} deleted. Restore it from Recently deleted within 15 days.`);
          company.reload();
        }}
      />
      <ConfirmDialog
        open={dialog === 'restore'}
        onClose={() => setDialog(null)}
        title={`Restore ${c.name}?`}
        description={`It returns as ${statusLabel('company', c.deletion?.statusBefore).toLowerCase()}, with its services, team, bookings, reviews and spotlight placement as they were.`}
        confirmLabel="Restore company"
        onConfirm={async () => {
          await api(`/admin/companies/${id}/restore`, { method: 'POST', body: {} });
          toast(`${c.name} restored`);
          company.reload();
        }}
      />
      <ReasonDialog open={dialog === 'reactivate'} onClose={() => setDialog(null)} title={`Reactivate ${c.name}?`} confirmLabel="Reactivate" onConfirm={async (reason) => { await post('reactivate', { reason }); company.reload(); toast('Company reactivated'); }} />
    </AdminPage>
  );
}

// Homepage "In the spotlight" placement. Only published businesses are shown publicly; the
// optional copy is written by TownAnt staff and must be factual.
function SpotlightPanel({ company, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ active: company.spotlight?.active ?? false, headline: company.spotlight?.headline ?? '', blurb: company.spotlight?.blurb ?? '' });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await api(`/admin/companies/${company.id}/spotlight`, { method: 'PUT', body: { active: form.active, headline: form.headline.trim() || undefined, blurb: form.blurb.trim() || undefined } });
      toast(form.active ? 'Spotlight saved' : 'Removed from spotlight');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Panel title="Homepage spotlight" description="Feature this business in “In the spotlight” on the public homepage.">
      <div className="flex flex-col gap-4">
        <Toggle label="Feature in homepage spotlight" description={company.status === 'suspended' ? 'Suspended businesses cannot be featured.' : company.status === 'published' ? 'Shown in “In the spotlight” on the public homepage. Set the order under Homepage.' : 'Saved now, but only shown once the business is published.'} checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} />
        {form.active && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Headline" optional maxLength={80} value={form.headline} onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))} hint="Factual; no prices or discounts. Defaults to the business name." />
            <Input label="Short description" optional maxLength={160} value={form.blurb} onChange={(e) => setForm((f) => ({ ...f, blurb: e.target.value }))} hint="Defaults to the business summary." />
          </div>
        )}
        <FormError error={error} />
        <div>
          <Button size="sm" pending={pending} onClick={save}>
            Save spotlight
          </Button>
        </div>
      </div>
    </Panel>
  );
}
