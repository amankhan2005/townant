import { Check, CheckCircle2 } from 'lucide-react';
import { countryOptions } from '@townant/shared';
import { useState } from 'react';
import { Alert, Button, Card, FormError, Input, Select, Textarea } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';

const COUNTRIES = countryOptions();

const EMPTY = { businessName: '', contactName: '', email: '', phone: '', website: '', description: '', city: '', region: '', postalCode: '', country: 'US', serviceMode: 'fixed', categoryId: '', company_website: '' };

export default function JoinVendor() {
  useDocumentTitle('Join as a vendor');
  const categories = useApi('/catalog/categories');
  const [form, setForm] = useState(EMPTY);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/vendor-applications', {
        method: 'POST',
        body: {
          businessName: form.businessName.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          website: form.website.trim() || undefined,
          description: form.description.trim(),
          categoryIds: form.categoryId ? [form.categoryId] : [],
          address: { city: form.city.trim(), region: form.region.trim() || undefined, postalCode: form.postalCode.trim() || undefined, country: form.country.trim().toUpperCase() },
          serviceMode: form.serviceMode,
          company_website: form.company_website || undefined,
        },
      });
      setDone(data.message);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl gutter py-16">
        <Card className="p-8 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-teal-50 text-teal-700" aria-hidden="true">
            <CheckCircle2 size={30} strokeWidth={1.75} />
          </span>
          <h1 className="mt-3 text-2xl font-bold text-navy">Application received</h1>
          <p className="mt-2 text-muted">{done}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-10 gutter py-10 lg:grid-cols-[1fr_1.4fr]">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-amber">TownAnt for Business</p>
        <h1 className="mt-2 text-3xl font-extrabold text-navy">Get booked by local customers</h1>
        <ul className="mt-6 flex flex-col gap-3 text-slate">
          {['A professional profile with your services, photos and hours', 'Online booking with real-time availability — no double-bookings', 'Messages, reminders and reviews from customers with completed bookings', 'No payments through TownAnt: you keep your own payment process'].map((t) => (
            <li key={t} className="flex gap-3">
              <Check size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" />
              {t}
            </li>
          ))}
        </ul>
        <Alert className="mt-6" tone="info">
          Our team reviews every application. If approved, you'll receive a secure link to set up your account. We never email passwords.
        </Alert>
      </div>
      <Card className="p-6">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Business name" required maxLength={120} value={form.businessName} onChange={set('businessName')} />
          <Input label="Your name" required maxLength={80} value={form.contactName} onChange={set('contactName')} autoComplete="name" />
          <Input label="Business email" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
          <Input label="Phone" optional type="tel" value={form.phone} onChange={set('phone')} placeholder="+1 512 555 0100" />
          <Input label="Website" optional type="url" value={form.website} onChange={set('website')} placeholder="https://" />
          <Select label="Main category" value={form.categoryId} onChange={set('categoryId')}>
            <option value="">Choose…</option>
            {(categories.data ?? [])
              .filter((c) => !c.parentId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
          <Select label="Where do you work?" value={form.serviceMode} onChange={set('serviceMode')}>
            <option value="fixed">Customers come to me</option>
            <option value="mobile">I go to customers</option>
            <option value="both">Both</option>
          </Select>
          <Input label="City" required maxLength={80} value={form.city} onChange={set('city')} />
          <Input label="State / region" optional maxLength={80} value={form.region} onChange={set('region')} />
          <Input label="ZIP / postal code" optional maxLength={12} value={form.postalCode} onChange={set('postalCode')} />
          <Select label="Country" required value={form.country} onChange={set('country')} options={COUNTRIES} />
          <Textarea className="sm:col-span-2" label="Tell us about your business" required rows={4} minLength={20} maxLength={2000} value={form.description} onChange={set('description')} hint="Services you offer, the area you cover, how long you've operated." />
          {/* Honeypot for bots: hidden from people and assistive technology. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Company website
              <input tabIndex={-1} autoComplete="off" value={form.company_website} onChange={set('company_website')} />
            </label>
          </div>
          <div className="sm:col-span-2">
            <FormError error={error} />
          </div>
          <Button type="submit" size="lg" pending={pending} className="sm:col-span-2">
            Submit application
          </Button>
        </form>
      </Card>
    </div>
  );
}
