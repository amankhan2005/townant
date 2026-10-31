import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { RestoreAccount } from './CustomerPassword.jsx';
import { Button, FormError, Input, useToast } from './ui.jsx';

// Passwordless sign-in: the customer picks ONE channel (email or WhatsApp). Neither is required.
export function OtpSignIn({ onDone, intro }) {
  const { channels, signedIn } = useAuth();
  const [channel, setChannel] = useState('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  // Set when the verified identifier belongs to an account pending deletion (restore offered).
  const [pendingDeletion, setPendingDeletion] = useState(null);
  const toast = useToast();

  const destination = channel === 'email' ? { email } : { phone };

  const send = async (e) => {
    e?.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/auth/otp/request', { method: 'POST', body: { channel, ...destination } });
      setChallenge(data);
      setCode('');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api('/auth/otp/verify', { method: 'POST', body: { channel, ...destination, challengeId: challenge.challengeId, code, displayName: displayName.trim() || undefined } });
      signedIn(data);
      if (data.previousAccountDeleted) toast('Your previous account was permanently deleted after 15 days, so this is a new account.');
      onDone?.(data.user);
    } catch (err) {
      if (err.code === 'ACCOUNT_PENDING_DELETION') setPendingDeletion(err.details);
      else setError(err);
    } finally {
      setPending(false);
    }
  };

  if (pendingDeletion) {
    return (
      <RestoreAccount
        pending={pendingDeletion}
        onRestored={(user) => {
          toast('Welcome back — your account has been restored.');
          onDone?.(user);
        }}
        onCancel={() => {
          setPendingDeletion(null);
          setChallenge(null);
          setCode('');
        }}
      />
    );
  }

  if (challenge) {
    return (
      <form onSubmit={verify} className="flex flex-col gap-4">
        <p className="text-sm text-slate">
          We sent a 6-digit code {channel === 'email' ? 'by email' : 'on WhatsApp'} to <strong>{challenge.maskedDestination}</strong>. It expires in 10 minutes.
        </p>
        <Input
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
          required
        />
        <Input label="Your name" optional hint="Shown to businesses you book with." value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} autoComplete="name" />
        <FormError error={error} />
        <Button type="submit" size="lg" pending={pending} disabled={code.length !== 6}>
          Verify and continue
        </Button>
        <div className="flex justify-between text-sm">
          <button type="button" className="text-teal hover:underline" onClick={() => setChallenge(null)}>
            Use a different {channel === 'email' ? 'email' : 'number'}
          </button>
          <ResendButton challenge={challenge} onResend={send} />
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-4">
      {intro && <p className="text-sm text-muted">{intro}</p>}
      <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 rounded-lg bg-cloud p-1">
        {[
          ['email', 'Email'],
          ['whatsapp', 'WhatsApp'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={channel === value}
            disabled={!channels[value]}
            onClick={() => setChannel(value)}
            className={`rounded-md py-2 text-sm font-semibold transition ${channel === value ? 'bg-white text-navy shadow-sm' : 'text-muted'} disabled:opacity-40`}
          >
            {label}
          </button>
        ))}
      </div>
      {channel === 'email' ? (
        <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      ) : (
        <Input label="Mobile number" type="tel" autoComplete="tel" placeholder="+1 512 555 0100" hint="Include your country code. We'll send the code on WhatsApp." value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus />
      )}
      {!channels.whatsapp && channel === 'email' && <p className="text-xs text-muted">WhatsApp sign-in is currently unavailable.</p>}
      <FormError error={error} />
      <Button type="submit" size="lg" pending={pending}>
        Send code
      </Button>
      <p className="text-xs text-muted">No password needed. By continuing you agree to TownAnt's Terms and acknowledge the Privacy Notice.</p>
    </form>
  );
}

function ResendButton({ challenge, onResend }) {
  const target = new Date(challenge.resendAvailableAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (now >= target) return undefined;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [now, target]);
  const wait = Math.max(0, Math.ceil((target - now) / 1000));
  if (wait > 0) return <span className="text-muted">Resend in {wait}s</span>;
  return (
    <button type="button" className="text-teal hover:underline" onClick={onResend}>
      Resend code
    </button>
  );
}
