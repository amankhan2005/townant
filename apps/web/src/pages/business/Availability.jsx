import { X } from 'lucide-react';
import { formatClock, formatIsoDate, todayIso, WEEKDAYS } from '@townant/shared';
import { useState } from 'react';
import { Alert, Button, Card, Checkbox, DatePicker, FormError, Input, PageHeader, Select, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Gate, useVendor } from './BusinessApp.jsx';

// Quarter-hour steps; values stay 24-hour "HH:MM" for the API, labels read 9:00 AM.
const TIMES = Array.from({ length: 97 }, (_, i) => {
  const v = i === 96 ? '24:00' : `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;
  return { value: v, label: i === 96 ? 'Midnight (end of day)' : formatClock(v) };
});

function TimeSelect({ label, value, onChange }) {
  const options = TIMES.some((t) => t.value === value) ? TIMES : [{ value, label: formatClock(value) }, ...TIMES];
  return <Select label={label} labelHidden value={value} onChange={(e) => onChange(e.target.value)} options={options} searchable={false} className="w-36" />;
}

const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC'];

export default function Availability() {
  useDocumentTitle('Availability');
  return (
    <Gate permission="availability:write">
      <Editor />
    </Gate>
  );
}

function Editor() {
  const { company, setCompany } = useVendor();
  const toast = useToast();
  const a = company.availability;
  const [form, setForm] = useState({
    timezone: a.timezone,
    weekly: a.weekly.map((d) => d.map((iv) => ({ ...iv }))),
    exceptions: a.exceptions.map((e) => ({ ...e })),
    slotIntervalMinutes: a.slotIntervalMinutes,
    bufferMinutes: a.bufferMinutes,
    minNoticeMinutes: a.minNoticeMinutes,
    maxAdvanceDays: a.maxAdvanceDays,
  });
  const [newException, setNewException] = useState({ date: '', closed: true, start: '09:00', end: '13:00', note: '' });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const setDay = (day, intervals) => setForm((f) => ({ ...f, weekly: f.weekly.map((d, i) => (i === day ? intervals : d)) }));

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/vendor/company/availability', {
        method: 'PUT',
        body: {
          ...form,
          slotIntervalMinutes: Number(form.slotIntervalMinutes),
          bufferMinutes: Number(form.bufferMinutes),
          minNoticeMinutes: Number(form.minNoticeMinutes),
          maxAdvanceDays: Number(form.maxAdvanceDays),
          exceptions: form.exceptions.map(({ date, closed, intervals, note }) => ({ date, closed, intervals: closed ? [] : intervals, ...(note ? { note } : {}) })),
        },
      });
      setCompany(data);
      toast('Availability saved');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const addException = () => {
    if (!newException.date) return;
    setForm((f) => ({
      ...f,
      exceptions: [...f.exceptions.filter((e) => e.date !== newException.date), { date: newException.date, closed: newException.closed, intervals: newException.closed ? [] : [{ start: newException.start, end: newException.end }], note: newException.note.trim() || undefined }].sort((x, y) => x.date.localeCompare(y.date)),
    }));
    setNewException({ date: '', closed: true, start: '09:00', end: '13:00', note: '' });
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Availability" subtitle="Customers can only book times inside these hours. Changes don't affect existing bookings." actions={<Button pending={pending} onClick={save}>Save changes</Button>} />
      <FormError error={error} />
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Time zone" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </Select>
        <Select label="Start times every" value={form.slotIntervalMinutes} onChange={(e) => setForm((f) => ({ ...f, slotIntervalMinutes: e.target.value }))}>
          {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </Select>
        <Select label="Break after each appointment" value={form.bufferMinutes} onChange={(e) => setForm((f) => ({ ...f, bufferMinutes: e.target.value }))}>
          {[0, 5, 10, 15, 30, 45, 60].map((m) => (
            <option key={m} value={m}>
              {m ? `${m} minutes` : 'None'}
            </option>
          ))}
        </Select>
        <Select label="Minimum notice" value={form.minNoticeMinutes} onChange={(e) => setForm((f) => ({ ...f, minNoticeMinutes: e.target.value }))}>
          {[[0, 'None'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days']].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Input label="Book up to (days ahead)" type="number" min={1} max={365} value={form.maxAdvanceDays} onChange={(e) => setForm((f) => ({ ...f, maxAdvanceDays: e.target.value }))} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-semibold text-navy">Weekly hours</h2>
        <div className="flex flex-col divide-y divide-line">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const intervals = form.weekly[day];
            return (
              <div key={day} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                <div className="w-32 pt-2">
                  <Checkbox label={WEEKDAYS[day]} checked={intervals.length > 0} onChange={(e) => setDay(day, e.target.checked ? [{ start: '09:00', end: '17:00' }] : [])} />
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {intervals.length === 0 && <p className="pt-2 text-sm text-muted">Closed</p>}
                  {intervals.map((iv, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <TimeSelect label={`${WEEKDAYS[day]} opens`} value={iv.start} onChange={(v) => setDay(day, intervals.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
                      <span className="text-muted">to</span>
                      <TimeSelect label={`${WEEKDAYS[day]} closes`} value={iv.end} onChange={(v) => setDay(day, intervals.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
                      <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => setDay(day, intervals.filter((_, j) => j !== i))} aria-label="Remove hours">
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {intervals.length > 0 && intervals.length < 4 && (
                    <button type="button" className="self-start text-sm text-teal" onClick={() => setDay(day, [...intervals, { start: '13:00', end: '17:00' }])}>
                      + Add hours (e.g. after a break)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 font-semibold text-navy">Holidays & special hours</h2>
        <p className="subtitle mb-4 text-sm">Close for a day or set different hours. These override your weekly hours.</p>
        <div className="flex flex-wrap items-end gap-3">
          <DatePicker label="Date" value={newException.date} min={todayIso(company.availability.timezone)} timeZone={company.availability.timezone} onChange={(v) => setNewException((x) => ({ ...x, date: v }))} className="w-48" />
          <Select label="Type" value={newException.closed ? 'closed' : 'open'} onChange={(e) => setNewException((x) => ({ ...x, closed: e.target.value === 'closed' }))}>
            <option value="closed">Closed all day</option>
            <option value="open">Special hours</option>
          </Select>
          {!newException.closed && (
            <>
              <Select label="From" value={newException.start} onChange={(e) => setNewException((x) => ({ ...x, start: e.target.value }))} options={TIMES} searchable={false} className="w-40" />
              <Select label="To" value={newException.end} onChange={(e) => setNewException((x) => ({ ...x, end: e.target.value }))} options={TIMES} searchable={false} className="w-40" />
            </>
          )}
          <Input label="Note" optional maxLength={120} value={newException.note} onChange={(e) => setNewException((x) => ({ ...x, note: e.target.value }))} />
          <Button variant="secondary" onClick={addException} disabled={!newException.date}>
            Add
          </Button>
        </div>
        {form.exceptions.length > 0 ? (
          <ul className="mt-4 divide-y divide-line text-sm">
            {form.exceptions.map((e) => (
              <li key={e.date} className="flex items-center justify-between py-2">
                <span>
                  <strong className="text-navy tabular">{formatIsoDate(e.date)}</strong> — {e.closed ? 'Closed' : e.intervals.map((iv) => `${formatClock(iv.start)}–${formatClock(iv.end)}`).join(', ')}
                  {e.note && <span className="text-muted"> · {e.note}</span>}
                </span>
                <button type="button" className="text-muted hover:text-danger" onClick={() => setForm((f) => ({ ...f, exceptions: f.exceptions.filter((x) => x.date !== e.date) }))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Alert className="mt-4" tone="info">No special dates yet.</Alert>
        )}
      </Card>
    </div>
  );
}
