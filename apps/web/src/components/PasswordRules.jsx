import { Check, Circle } from 'lucide-react';

// Mirrors the server's policy (12–128 characters, not a common or repetitive password). The server
// is the authority; this only gives immediate feedback.
export function passwordChecks(password, confirm) {
  return [
    ['At least 12 characters', password.length >= 12],
    ['Not just one or two repeated characters', new Set(password).size >= 5],
    ['Both entries match', password.length > 0 && password === confirm],
  ];
}

export function PasswordRules({ password, confirm }) {
  return (
    <ul className="flex flex-col gap-1 text-caption" aria-live="polite">
      {passwordChecks(password, confirm).map(([label, ok]) => (
        <li key={label} className={ok ? 'flex items-center gap-1.5 text-emerald-700' : 'flex items-center gap-1.5 text-slate-500'}>
          {ok ? <Check size={13} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
          {label}
          <span className="sr-only">{ok ? ' — done' : ' — not yet'}</span>
        </li>
      ))}
    </ul>
  );
}
