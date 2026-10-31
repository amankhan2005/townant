import { X } from 'lucide-react';
import { countryOptions, PROFILE_SECTIONS } from '@townant/shared';
import { useRef, useState } from 'react';
import { PolishButton } from '../../components/PolishButton.jsx';
import { Alert, Button, Card, Checkbox, FormError, Input, PageHeader, Select, Textarea, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { imageUrl } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Gate, useVendor } from './BusinessApp.jsx';

const COUNTRIES = countryOptions();

const SECTION_LABELS = { gallery: 'Photo gallery', hours: 'Opening hours', reviews: 'Reviews and rating', policies: 'Cancellation policy text', contact: 'Contact details and street address' };

export default function Profile() {
  useDocumentTitle('Profile');
  return (
    <Gate permission="company:write">
      <ProfileEditor />
    </Gate>
  );
}

function toForm(c) {
  return {
    name: c.name,
    summary: c.summary ?? '',
    description: c.description ?? '',
    categoryIds: c.categoryIds,
    primaryCategoryId: c.primaryCategoryId ?? '',
    contact: { email: c.contact.email ?? '', phone: c.contact.phone ?? '', website: c.contact.website ?? '' },
    address: { line1: c.address.line1 ?? '', line2: c.address.line2 ?? '', area: c.address.area ?? '', city: c.address.city ?? '', region: c.address.region ?? '', postalCode: c.address.postalCode ?? '', country: c.address.country ?? 'US' },
    location: c.location ? { lat: String(c.location.lat), lng: String(c.location.lng) } : { lat: '', lng: '' },
    serviceMode: c.serviceMode,
    serviceArea: { radiusKm: c.serviceArea?.radiusKm ? String(c.serviceArea.radiusKm) : '', postalCodes: (c.serviceArea?.postalCodes ?? []).join(', ') },
    sections: { ...c.sections },
    cancellation: c.policies?.cancellation ?? '',
    bookingPolicy: { ...c.bookingPolicy },
  };
}

function ProfileEditor() {
  const { company, setCompany } = useVendor();
  const toast = useToast();
  const categories = useApi('/catalog/categories');
  const [form, setForm] = useState(() => toForm(company));
  const [facts, setFacts] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const set = (path) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => {
      const [a, b] = path.split('.');
      return b ? { ...f, [a]: { ...f[a], [b]: value } } : { ...f, [a]: value };
    });
  };

  const save = async (e) => {
    e?.preventDefault();
    setPending(true);
    setError(null);
    const lat = form.location.lat.trim();
    const lng = form.location.lng.trim();
    try {
      const { data } = await api('/vendor/company', {
        method: 'PATCH',
        body: {
          name: form.name.trim(),
          summary: form.summary.trim(),
          description: form.description.trim(),
          ...(form.categoryIds.length ? { categoryIds: form.categoryIds, primaryCategoryId: form.primaryCategoryId || form.categoryIds[0] } : {}),
          contact: { email: form.contact.email.trim(), phone: form.contact.phone.trim() || undefined, website: form.contact.website.trim() },
          address: Object.fromEntries(Object.entries({ ...form.address, country: form.address.country.toUpperCase() }).map(([k, v]) => [k, v.trim() || undefined])),
          location: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
          serviceMode: form.serviceMode,
          serviceArea: {
            ...(form.serviceArea.radiusKm ? { radiusKm: Number(form.serviceArea.radiusKm) } : {}),
            postalCodes: form.serviceArea.postalCodes.split(',').map((s) => s.trim()).filter(Boolean),
          },
          sections: form.sections,
          policies: { cancellation: form.cancellation.trim() },
          bookingPolicy: Object.fromEntries(Object.entries(form.bookingPolicy).map(([k, v]) => [k, Number(v)])),
        },
      });
      setCompany(data);
      toast('Profile saved');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const togglePublish = async () => {
    setPublishError(null);
    try {
      const { data } = await api(`/vendor/company/${company.status === 'published' ? 'unpublish' : 'publish'}`, { method: 'POST' });
      setCompany(data);
      toast(data.status === 'published' ? 'Your profile is live' : 'Your profile is hidden from customers');
    } catch (err) {
      setPublishError(err);
    }
  };

  const parents = (categories.data ?? []).filter((c) => !c.parentId);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Business profile"
        subtitle="What customers see on your public page."
        actions={
          <>
            {company.status !== 'suspended' && (
              <Button variant={company.status === 'published' ? 'secondary' : 'amber'} onClick={togglePublish}>
                {company.status === 'published' ? 'Unpublish' : 'Publish profile'}
              </Button>
            )}
            <Button pending={pending} onClick={save}>
              Save changes
            </Button>
          </>
        }
      />
      {publishError && <Alert tone="warn">{publishError.message}</Alert>}
      <FormError error={error} />

      <MediaEditor />

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-semibold text-navy sm:col-span-2">About</h2>
        <Input className="sm:col-span-2" label="Business name" maxLength={120} value={form.name} onChange={set('name')} />
        <Input className="sm:col-span-2" label="Short summary" hint="One line shown on search results." maxLength={300} value={form.summary} onChange={set('summary')} />
        <Textarea className="sm:col-span-2" label="Description" rows={6} maxLength={4000} value={form.description} onChange={set('description')} />
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Textarea label="Facts for an AI draft" optional rows={3} maxLength={2000} value={facts} onChange={(e) => setFacts(e.target.value)} hint="List real facts only (services, area, years operating). The draft won't add claims you didn't provide." />
          <PolishButton endpoint="/ai/bio" body={{ facts: facts.trim() }} onAccept={(text) => setForm((f) => ({ ...f, description: text }))} />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-navy">Categories (up to 5)</legend>
          <div className="flex flex-wrap gap-2">
            {parents.map((p) =>
              [p, ...(categories.data ?? []).filter((c) => c.parentId === p.id)].map((c) => {
                const on = form.categoryIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && form.categoryIds.length >= 5}
                    onClick={() => setForm((f) => ({ ...f, categoryIds: on ? f.categoryIds.filter((x) => x !== c.id) : [...f.categoryIds, c.id] }))}
                    className={`rounded-full px-3 py-1 text-sm ${on ? 'bg-teal text-white' : 'bg-cloud text-slate ring-1 ring-line'} ${c.parentId ? '' : 'font-semibold'} disabled:opacity-40`}
                  >
                    {c.name}
                  </button>
                );
              }),
            )}
          </div>
        </fieldset>
        {form.categoryIds.length > 1 && (
          <Select label="Main category" value={form.primaryCategoryId} onChange={set('primaryCategoryId')}>
            {form.categoryIds.map((id) => (
              <option key={id} value={id}>
                {categories.data?.find((c) => c.id === id)?.name ?? id}
              </option>
            ))}
          </Select>
        )}
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-semibold text-navy sm:col-span-2">Location & service area</h2>
        <Select className="sm:col-span-2" label="Where do you work?" value={form.serviceMode} onChange={set('serviceMode')}>
          <option value="fixed">Customers come to my location</option>
          <option value="mobile">I travel to customers (street address hidden)</option>
          <option value="both">Both</option>
        </Select>
        <Input label="Street address" optional value={form.address.line1} onChange={set('address.line1')} maxLength={120} />
        <Input label="Neighborhood / area" optional value={form.address.area} onChange={set('address.area')} maxLength={80} />
        <Input label="City" value={form.address.city} onChange={set('address.city')} maxLength={80} />
        <Input label="State / region" optional value={form.address.region} onChange={set('address.region')} maxLength={80} />
        <Input label="ZIP / postal code" optional value={form.address.postalCode} onChange={set('address.postalCode')} maxLength={12} />
        <Select label="Country" value={form.address.country} onChange={set('address.country')} options={COUNTRIES} />
        <Input label="Latitude" optional inputMode="decimal" value={form.location.lat} onChange={set('location.lat')} hint="Enables distance and 'near me' search." />
        <Input label="Longitude" optional inputMode="decimal" value={form.location.lng} onChange={set('location.lng')} />
        {form.serviceMode !== 'fixed' && (
          <>
            <Input label="Travel radius (km)" optional type="number" min={1} max={500} value={form.serviceArea.radiusKm} onChange={set('serviceArea.radiusKm')} />
            <Input label="ZIP / postal codes covered" optional value={form.serviceArea.postalCodes} onChange={set('serviceArea.postalCodes')} hint="Comma-separated. Customers searching these codes will find you." />
          </>
        )}
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <h2 className="font-semibold text-navy sm:col-span-3">Contact</h2>
        <Input label="Public email" optional type="email" value={form.contact.email} onChange={set('contact.email')} />
        <Input label="Public phone" optional type="tel" value={form.contact.phone} onChange={set('contact.phone')} />
        <Input label="Website" optional type="url" placeholder="https://" value={form.contact.website} onChange={set('contact.website')} />
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <h2 className="font-semibold text-navy sm:col-span-3">Booking rules</h2>
        <Input label="Customers can cancel online until (hours before)" type="number" min={0} max={168} value={form.bookingPolicy.cancellationCutoffHours} onChange={set('bookingPolicy.cancellationCutoffHours')} />
        <Input label="Customers can reschedule until (hours before)" type="number" min={0} max={168} value={form.bookingPolicy.rescheduleCutoffHours} onChange={set('bookingPolicy.rescheduleCutoffHours')} />
        <Input label="Requests expire after (hours)" type="number" min={1} max={168} value={form.bookingPolicy.requestExpiryHours} onChange={set('bookingPolicy.requestExpiryHours')} />
        <Textarea className="sm:col-span-3" label="Cancellation policy (shown to customers)" optional rows={3} maxLength={1500} value={form.cancellation} onChange={set('cancellation')} hint="TownAnt doesn't process payments or fees; describe any policy you handle directly." />
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold text-navy">Profile sections</h2>
        <p className="subtitle text-sm">Turned-off sections are removed from your public page entirely.</p>
        {PROFILE_SECTIONS.map((s) => (
          <Checkbox key={s} label={SECTION_LABELS[s]} checked={form.sections[s] !== false} onChange={(e) => setForm((f) => ({ ...f, sections: { ...f.sections, [s]: e.target.checked } }))} />
        ))}
      </Card>

      <div className="flex justify-end">
        <Button size="lg" pending={pending} onClick={save}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function MediaEditor() {
  const { company, setCompany } = useVendor();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const inputs = { logo: useRef(null), banner: useRef(null), gallery: useRef(null) };

  const upload = async (kind, file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('Images must be 5 MB or smaller', 'error');
      return;
    }
    setBusy(kind);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api(`/vendor/company/media/${kind}`, { method: 'POST', form });
      setCompany(data);
      toast('Image uploaded');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
      if (inputs[kind].current) inputs[kind].current.value = '';
    }
  };

  const remove = async (kind, publicId) => {
    try {
      const { data } = await api('/vendor/company/media/remove', { method: 'POST', body: { kind, publicId } });
      setCompany(data);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const picker = (kind) => (
    <input ref={inputs[kind]} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => upload(kind, e.target.files?.[0])} aria-label={`Upload ${kind}`} />
  );

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div>
        <h2 className="font-semibold text-navy">Photos</h2>
        <p className="text-sm text-muted">JPEG, PNG or WebP up to 5 MB. Upload your own photos only.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-navy">Logo</span>
          <div className="flex size-32 items-center justify-center overflow-hidden rounded-2xl bg-cloud ring-1 ring-line">
            {company.media.logo ? <img src={imageUrl(company.media.logo.url, { w: 256, h: 256 })} alt="Logo" className="size-full object-cover" /> : <span className="text-xs text-muted">No logo</span>}
          </div>
          {picker('logo')}
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" pending={busy === 'logo'} onClick={() => inputs.logo.current?.click()}>
              Upload
            </Button>
            {company.media.logo && <Button size="sm" variant="ghost" onClick={() => remove('logo')}>Remove</Button>}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-navy">Banner</span>
          <div className="flex h-32 items-center justify-center overflow-hidden rounded-2xl bg-cloud ring-1 ring-line">
            {company.media.banner ? <img src={imageUrl(company.media.banner.url, { w: 1000, h: 280 })} alt="Banner" className="size-full object-cover" /> : <span className="text-xs text-muted">No banner</span>}
          </div>
          {picker('banner')}
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" pending={busy === 'banner'} onClick={() => inputs.banner.current?.click()}>
              Upload
            </Button>
            {company.media.banner && <Button size="sm" variant="ghost" onClick={() => remove('banner')}>Remove</Button>}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-navy">Gallery ({company.media.gallery.length}/12)</span>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {company.media.gallery.map((g) => (
            <div key={g.publicId} className="group relative aspect-square overflow-hidden rounded-lg">
              <img src={imageUrl(g.url, { w: 240, h: 240 })} alt="" className="size-full object-cover" />
              <button type="button" onClick={() => remove('gallery', g.publicId)} className="absolute right-1 top-1 rounded-full bg-white/90 px-2 text-xs font-bold text-danger" aria-label="Remove photo">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          {company.media.gallery.length < 12 && (
            <button type="button" onClick={() => inputs.gallery.current?.click()} className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-line text-sm text-muted hover:border-teal hover:text-teal">
              {busy === 'gallery' ? 'Uploading…' : '+ Add'}
            </button>
          )}
        </div>
        {picker('gallery')}
      </div>
    </Card>
  );
}
