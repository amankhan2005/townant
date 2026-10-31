import { useState } from 'react';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, FormError, Input, ListSkeleton, Modal, PageHeader, Select, Textarea, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatPrice, minutesLabel } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Gate } from './BusinessApp.jsx';

const EMPTY = { title: '', description: '', durationMinutes: 60, bookingMode: 'instant', categoryId: '', isActive: true, price: { display: 'hidden', amount: '', currency: 'USD', note: '' } };

export default function Services() {
  useDocumentTitle('Services');
  return (
    <Gate permission="services:write">
      <ServiceList />
    </Gate>
  );
}

function ServiceList() {
  const toast = useToast();
  const list = useApi('/vendor/services');
  const categories = useApi('/catalog/categories');
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);

  const archive = async () => {
    await api(`/vendor/services/${archiving.id}/archive`, { method: 'POST' });
    list.reload();
    toast('Service archived');
  };

  const active = list.data?.filter((s) => !s.archived) ?? [];
  const archived = list.data?.filter((s) => s.archived) ?? [];

  return (
    <div className="max-w-4xl">
      <PageHeader title="Services" subtitle="What customers can book. Prices are display-only; TownAnt never takes payment." actions={<Button onClick={() => setEditing(EMPTY)}>Add service</Button>} />
      {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <ListSkeleton rows={3} avatar={false} label="Loading services" />}
      {list.data && active.length === 0 && <EmptyState title="No services yet" body="Add at least one service so customers can book you." action={<Button onClick={() => setEditing(EMPTY)}>Add your first service</Button>} />}
      <div className="flex flex-col gap-3">
        {active.map((s) => (
          <Card key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-navy">{s.title}</h3>
                {!s.isActive && <Badge>Hidden</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                <Badge>{minutesLabel(s.durationMinutes)}</Badge>
                <Badge tone={s.bookingMode === 'request' ? 'amber' : 'teal'}>{s.bookingMode === 'request' ? 'You confirm each booking' : 'Instant booking'}</Badge>
                {s.price.display !== 'hidden' && <Badge tone="navy">{formatPrice(s.price)}</Badge>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing({ ...s, categoryId: s.categoryId ?? '', price: { amount: '', currency: 'USD', note: '', ...s.price } })}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setArchiving(s)}>
                Archive
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {archived.length > 0 && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-muted">{archived.length} archived</summary>
          <ul className="mt-2 list-disc pl-6 text-muted">
            {archived.map((s) => (
              <li key={s.id}>{s.title}</li>
            ))}
          </ul>
        </details>
      )}
      <ConfirmDialog open={Boolean(archiving)} onClose={() => setArchiving(null)} title={`Archive “${archiving?.title ?? ''}”?`} description="Existing bookings are kept, but customers can no longer book this service. This can't be undone from the portal." confirmLabel="Archive service" danger onConfirm={archive} />
      {editing && <ServiceForm initial={editing} categories={categories.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); toast('Service saved'); }} />}
    </div>
  );
}

function ServiceForm({ initial, categories, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setPrice = (k) => (e) => setForm((f) => ({ ...f, price: { ...f.price, [k]: e.target.value } }));
  const needsAmount = ['fixed', 'from'].includes(form.price.display);

  const save = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      durationMinutes: Number(form.durationMinutes),
      bookingMode: form.bookingMode,
      isActive: form.isActive,
      categoryId: form.categoryId || undefined,
      price: {
        display: form.price.display,
        ...(needsAmount ? { amount: Number(form.price.amount), currency: form.price.currency.toUpperCase() } : {}),
        ...(form.price.note?.trim() ? { note: form.price.note.trim() } : {}),
      },
    };
    try {
      if (initial.id) await api(`/vendor/services/${initial.id}`, { method: 'PATCH', body });
      else await api('/vendor/services', { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit service' : 'New service'} size="lg">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Service name" required maxLength={120} value={form.title} onChange={set('title')} />
        <Textarea className="sm:col-span-2" label="Description" optional rows={3} maxLength={2000} value={form.description} onChange={set('description')} />
        <Select label="Duration" value={form.durationMinutes} onChange={set('durationMinutes')}>
          {[15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480].map((m) => (
            <option key={m} value={m}>
              {minutesLabel(m)}
            </option>
          ))}
        </Select>
        <Select label="Category" optional value={form.categoryId} onChange={set('categoryId')}>
          <option value="">Same as business</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select className="sm:col-span-2" label="How bookings work" value={form.bookingMode} onChange={set('bookingMode')}>
          <option value="instant">Instant — customers book open times directly</option>
          <option value="request">Request — I confirm or decline each booking</option>
        </Select>
        <Select label="Price display" value={form.price.display} onChange={setPrice('display')}>
          <option value="hidden">Don't show a price</option>
          <option value="fixed">Fixed price</option>
          <option value="from">Starting from</option>
          <option value="quote">Price on quote</option>
        </Select>
        {needsAmount && (
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <Input label="Amount" type="number" min="0" step="0.01" required value={form.price.amount} onChange={setPrice('amount')} />
            <Input label="Currency" maxLength={3} required value={form.price.currency} onChange={setPrice('currency')} />
          </div>
        )}
        <div className="sm:col-span-2">
          <Checkbox label="Visible to customers" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
        </div>
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" pending={pending}>
            Save service
          </Button>
        </div>
      </form>
    </Modal>
  );
}
