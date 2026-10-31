import { CheckCircle2, LifeBuoy, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CustomerPasswordCard } from '../../components/CustomerPassword.jsx';
import { RequireCustomer } from '../../components/RequireCustomer.jsx';
import { Alert, Button, Card, Checkbox, DetailSkeleton, ErrorState, FormError, Input, Modal, PageHeader, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';

export default function Account() {
  useDocumentTitle('Account');
  return (
    <RequireCustomer>
      <AccountSettings />
    </RequireCustomer>
  );
}

function AccountSettings() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.displayName ?? '');
  const [prefs, setPrefs] = useState(user.notificationPrefs);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/me', { method: 'PATCH', body: { displayName: name.trim() || undefined, notificationPrefs: prefs } });
      await refresh();
      toast('Saved');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 gutter py-8">
      <PageHeader title="Your account" actions={<Button variant="secondary" onClick={logout}>Sign out</Button>} />
      <Card className="p-6">
        <form onSubmit={save} className="flex flex-col gap-4">
          <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} hint="Shown to businesses you book with. Reviews show your first name." />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium text-navy">Booking updates</legend>
            <Checkbox label="Email" description={user.email ? `Sent to ${user.email}` : 'Add an email below to receive these.'} checked={prefs.email} onChange={(e) => setPrefs((p) => ({ ...p, email: e.target.checked }))} />
            <Checkbox label="Push notifications" description="On the TownAnt mobile app." checked={prefs.push} onChange={(e) => setPrefs((p) => ({ ...p, push: e.target.checked }))} />
          </fieldset>
          <FormError error={error} />
          <div>
            <Button type="submit" pending={pending}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-semibold text-navy">Sign-in methods</h2>
        <p className="subtitle text-sm">You can sign in with either. Adding one requires a code sent to it.</p>
        <Identifier channel="email" label="Email" value={user.email} onDone={refresh} />
        <Identifier channel="whatsapp" label="Mobile (WhatsApp)" value={user.phone} onDone={refresh} />
      </Card>
      <CustomerPasswordCard />
      <Sessions />
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-start gap-3">
          <LifeBuoy size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" />
          <div>
            <h2 className="font-semibold text-navy">Need help?</h2>
            <p className="subtitle text-sm">Questions about your account, data or a booking go to the TownAnt team.</p>
          </div>
        </div>
        <Link to="/support" className="inline-flex h-10 items-center rounded-md px-3 font-semibold text-teal-700 hover:bg-teal-50">
          Help & support
        </Link>
      </Card>
      <DeleteAccount />
    </div>
  );
}

// ----- Account deletion -----
// Nothing is deleted until the final request succeeds; the confirmation screen only appears
// after the API reports what it actually did.

function DeleteAccount() {
  const { hash } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (hash === '#delete-account') document.getElementById('delete-account')?.scrollIntoView({ block: 'center' });
  }, [hash]);
  return (
    <section id="delete-account" aria-labelledby="delete-heading" className="scroll-mt-24 rounded-card border border-danger/25 bg-white p-6">
      <h2 id="delete-heading" className="font-semibold text-navy">
        Delete account
      </h2>
      <p className="mt-1 text-sm text-muted">Delete your TownAnt account and personal details. You can restore it for 15 days by signing in with a one-time code; after that it is permanently deleted. Upcoming appointments are cancelled. You can review exactly what happens first.</p>
      <Button className="mt-4" variant="danger-ghost" icon={<Trash2 size={17} aria-hidden="true" />} onClick={() => setOpen(true)}>
        Delete my account…
      </Button>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function DeleteAccountDialog({ onClose }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const summary = useApi('/me/deletion');
  const [step, setStep] = useState('review');
  const [understood, setUnderstood] = useState(false);
  const [channel, setChannel] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);

  const channels = summary.data?.channels ?? [];
  const chosen = channel ?? channels[0];

  const sendCode = async () => {
    setPending('code');
    setError(null);
    try {
      const { data } = await api('/me/deletion/challenge', { method: 'POST', body: { channel: chosen } });
      setChallenge(data);
      setCode('');
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  };

  const confirmDelete = async (e) => {
    e.preventDefault();
    if (pending) return;
    setPending('delete');
    setError(null);
    try {
      const { data } = await api('/me/deletion', { method: 'POST', body: { channel: challenge.channel, challengeId: challenge.challengeId, code, confirm: 'DELETE' } });
      navigate('/account/deleted', { replace: true, state: { result: data } });
      refresh();
    } catch (err) {
      setError(err);
      setPending(null);
    }
  };

  const c = summary.data?.counts;
  const policy = summary.data?.policy;
  return (
    <Modal open onClose={pending === 'delete' ? undefined : onClose} title="Delete your account" description="You can restore it within 15 days. After that it is permanent." size="lg">
      {summary.error && !summary.data ? (
        <ErrorState compact error={summary.error} onRetry={summary.reload} />
      ) : !summary.data ? (
        <DetailSkeleton label="Checking your account" />
      ) : step === 'review' ? (
        <div className="flex flex-col gap-5">
          {c.upcomingBookings > 0 && (
            <Alert tone="warn" title={`${plural(c.upcomingBookings, 'upcoming appointment')} will be cancelled`}>
              Each business is told the booking was cancelled because you deleted your account. If you’d rather keep an appointment, don’t delete your account yet.
            </Alert>
          )}
          <Alert tone="info" title={`Recoverable for ${policy.recoveryDays ?? 15} days`}>
            {(policy.recovery ?? []).join('. ')}. To restore, sign in with a code sent to your email or phone and confirm.
          </Alert>
          <PolicyList title={`Deleted after ${policy.recoveryDays ?? 15} days`} tone="danger" items={policy.deleted} />
          <PolicyList title="Cancelled now" tone="amber" items={policy.cancelled} />
          <PolicyList title="Kept without your name or contact details" tone="slate" items={policy.retained} />
          <p className="text-sm text-muted">
            For this account that means {plural(c.reviews, 'review')} and {plural(c.favorites, 'saved business', 'saved businesses')} deleted, {plural(c.pastBookings, 'past appointment')} and {plural(c.conversations, 'conversation')} kept anonymously, and {plural(c.openTickets, 'open support request')} closed.
          </p>
          <Checkbox label="I understand my account is deleted for good after 15 days" description="Until then, signing in with a one-time code lets you restore it. Afterwards, signing in with the same email or phone starts a brand-new, empty account." checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              Keep my account
            </Button>
            <Button variant="danger" disabled={!understood || channels.length === 0} onClick={() => setStep('verify')}>
              Continue
            </Button>
          </div>
          {channels.length === 0 && <p className="text-sm text-danger">Add and verify an email or phone number before deleting your account.</p>}
        </div>
      ) : (
        <form onSubmit={confirmDelete} className="flex flex-col gap-5" noValidate>
          <div>
            <p className="text-sm font-semibold text-navy">1. Confirm it’s you</p>
            <p className="mt-0.5 text-sm text-muted">We’ll send a one-time code to the {chosen === 'whatsapp' ? 'WhatsApp number' : 'email address'} on your account.</p>
            {channels.length > 1 && !challenge && (
              <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Where to send the code">
                {channels.map((ch) => (
                  <button key={ch} type="button" role="radio" aria-checked={chosen === ch} onClick={() => setChannel(ch)} className={`h-10 rounded-md px-4 text-sm font-semibold ring-1 ring-inset ${chosen === ch ? 'bg-teal-50 text-teal-700 ring-teal' : 'bg-white text-slate ring-line-strong'}`}>
                    {ch === 'email' ? 'Email' : 'WhatsApp'}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-3">
              {challenge && (
                <Input
                  label={`Code sent to ${challenge.maskedDestination}`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  className="w-56"
                  data-autofocus
                />
              )}
              <Button variant="secondary" pending={pending === 'code'} onClick={sendCode}>
                {challenge ? 'Send a new code' : 'Send code'}
              </Button>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-navy">2. Final confirmation</p>
            <Input className="mt-2" label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </div>
          <FormError error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={pending === 'delete'} onClick={() => setStep('review')}>
              Back
            </Button>
            <Button type="submit" variant="danger" pending={pending === 'delete'} disabled={!challenge || code.length !== 6 || confirmText.trim() !== 'DELETE'} icon={<Trash2 size={17} aria-hidden="true" />}>
              Delete my account
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function PolicyList({ title, items, tone }) {
  const color = { danger: 'bg-danger', amber: 'bg-amber', slate: 'bg-subtle' }[tone];
  return (
    <div>
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate">
            <span className={`mt-[7px] size-1.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Shown only after the API confirmed the deletion (reached with the result in navigation state).
export function AccountDeleted() {
  useDocumentTitle('Account deleted');
  const { state } = useLocation();
  const result = state?.result;
  if (!result?.deleted) {
    return (
      <div className="mx-auto max-w-lg gutter py-16">
        <Alert tone="info" title="Nothing to show">
          This page confirms an account deletion right after it happens.{' '}
          <Link to="/" className="font-semibold underline">
            Go to the homepage
          </Link>
        </Alert>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-lg gutter py-16 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <CheckCircle2 size={28} aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-[1.75rem] font-bold text-navy">Your account is scheduled for deletion</h1>
      <p className="mt-2 text-body text-muted">You’ve been signed out on every device.{result.recoverUntil ? ` It will be permanently deleted on ${formatDate(result.recoverUntil)}.` : ''}</p>
      <ul className="mx-auto mt-6 flex max-w-sm flex-col gap-1.5 text-left text-sm text-slate">
        {result.cancelledBookings > 0 && <li>{plural(result.cancelledBookings, 'upcoming appointment')} cancelled and the businesses notified</li>}
        {result.reviewsHidden > 0 && <li>{plural(result.reviewsHidden, 'review')} hidden from the public</li>}
        <li>Changed your mind? Sign in with a one-time code before then and choose “Restore my account”.</li>
      </ul>
      <Link to="/" className="mt-8 inline-flex h-11 items-center rounded-md bg-teal px-5 font-semibold text-white hover:bg-teal-700">
        Go to the homepage
      </Link>
    </div>
  );
}


function Identifier({ channel, label, value, onDone }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const field = channel === 'email' ? { email: input.trim() } : { phone: input.trim() };

  const request = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/me/identifiers/request', { method: 'POST', body: { channel, ...field } });
      setChallenge(data);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const verify = async () => {
    setPending(true);
    setError(null);
    try {
      await api('/me/identifiers/verify', { method: 'POST', body: { channel, ...field, challengeId: challenge.challengeId, code } });
      setEditing(false);
      setChallenge(null);
      setInput('');
      setCode('');
      await onDone();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-navy">{label}</p>
          <p className="text-sm text-muted">{value ?? 'Not added'}</p>
        </div>
        {!editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {value ? 'Change' : 'Add'}
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-3 flex flex-col gap-3">
          {!challenge ? (
            <>
              <Input label={channel === 'email' ? 'New email' : 'New mobile number (with country code)'} type={channel === 'email' ? 'email' : 'tel'} value={input} onChange={(e) => setInput(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" pending={pending} disabled={!input.trim()} onClick={request}>
                  Send code
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <Alert tone="info">Enter the code sent to {challenge.maskedDestination}.</Alert>
              <Input label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Button size="sm" pending={pending} disabled={code.length !== 6} onClick={verify}>
                Verify
              </Button>
            </>
          )}
          <FormError error={error} />
        </div>
      )}
    </div>
  );
}

function Sessions() {
  const toast = useToast();
  const signOutOthers = async () => {
    const { data } = await api('/me/sessions/revoke-others', { method: 'POST' });
    toast(`Signed out of ${data.revoked} other session${data.revoked === 1 ? '' : 's'}`);
  };
  return (
    <Card className="flex items-center justify-between gap-4 p-6">
      <div>
        <h2 className="font-semibold text-navy">Other devices</h2>
        <p className="subtitle text-sm">Sign out everywhere except this browser.</p>
      </div>
      <Button variant="secondary" onClick={signOutOthers}>
        Sign out others
      </Button>
    </Card>
  );
}
