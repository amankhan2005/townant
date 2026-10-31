import { AlertCircle, CheckCircle2, Info, Inbox, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { Component } from 'react';
import { Button, cx } from './core.jsx';

export function Alert({ tone = 'info', title, children, className, action }) {
  const tones = {
    info: 'bg-teal-50 text-teal-700 border-teal/20',
    warn: 'bg-amber-50 text-amber-text border-amber/40',
    error: 'bg-danger-50 text-danger border-danger/20',
    success: 'bg-teal-50 text-success border-success/20',
  };
  const icons = { info: Info, warn: TriangleAlert, error: AlertCircle, success: CheckCircle2 };
  const Icon = icons[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-md border px-4 py-3 text-secondary', tones[tone], className)}>
      <Icon size={18} aria-hidden="true" className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
      </div>
      {action}
    </div>
  );
}

// Field-level messages from the API, without internal details.
export function FormError({ error }) {
  if (!error) return null;
  const fields = error.details?.fields;
  return (
    <Alert tone="error" title={error.message}>
      {fields?.length > 0 && (
        <ul className="mt-1 list-disc pl-4">
          {fields.slice(0, 5).map((f) => (
            <li key={f.path}>
              {f.path ? <span className="font-medium">{humanizePath(f.path)}: </span> : null}
              {f.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

const humanizePath = (path) =>
  path
    .split('.')
    .at(-1)
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\w/, (c) => c.toUpperCase());

// `icon` is a Lucide component. Legacy string icons are ignored in favour of the default.
// `flush`: no frame of its own, for use inside a panel.
export function EmptyState({ title, body, action, icon, compact, flush }) {
  const Icon = typeof icon === 'function' || (icon && typeof icon === 'object') ? icon : Inbox;
  return (
    <div className={cx('flex flex-col items-center gap-2 text-center', !flush && 'rounded-card border border-dashed border-line-strong bg-white', compact ? 'px-5 py-8' : 'px-6 py-12')}>
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-teal-50 text-teal-700" aria-hidden="true">
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <h3 className="text-card font-semibold text-navy">{title}</h3>
      {body && <p className="max-w-md text-secondary text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// Full error state: used when there is nothing usable to show.
export function ErrorState({ error, onRetry, title, compact, flush }) {
  const offline = error?.code === 'NETWORK_ERROR';
  return (
    <div role="alert" className={cx('flex flex-col items-center gap-2 text-center', !flush && 'rounded-card border border-line bg-white shadow-card', compact ? 'px-5 py-8' : 'px-6 py-12')}>
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-danger-50 text-danger" aria-hidden="true">
        {offline ? <WifiOff size={22} strokeWidth={1.75} /> : <AlertCircle size={22} strokeWidth={1.75} />}
      </div>
      <h3 className="text-card font-semibold text-navy">{title ?? (offline ? "You're offline" : "This section didn't load")}</h3>
      <p className="max-w-md text-secondary text-muted">{offline ? 'Check your connection, then try again.' : (error?.message ?? 'Please try again in a moment.')}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-2" icon={<RefreshCw size={15} aria-hidden="true" />}>
          Try again
        </Button>
      )}
    </div>
  );
}

// Subtle notice when a refresh failed but earlier data is still on screen.
export function InlineError({ error, onRetry }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-md border border-amber/40 bg-amber-50 px-3 py-2 text-secondary text-amber-text">
      <span>{error?.code === 'NETWORK_ERROR' ? "You're offline — showing the last loaded results." : "Couldn't refresh — showing the last loaded results."}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Retry
        </button>
      )}
    </div>
  );
}

// Renders the right state for a useApi() result: loading → skeleton, error with no data →
// error state, empty → empty state, otherwise children(data) (plus a notice if a refresh failed).
export function Async({ state, loading, empty, isEmpty = (d) => Array.isArray(d) && d.length === 0, errorTitle, children }) {
  const { data, error, loading: busy, reload } = state;
  if (data == null) {
    if (error) return <ErrorState error={error} onRetry={reload} title={errorTitle} />;
    if (busy !== false) return loading ?? null;
    return null;
  }
  return (
    <>
      {error && (
        <div className="mb-3">
          <InlineError error={error} onRetry={reload} />
        </div>
      )}
      {isEmpty(data) ? empty : children(data)}
    </>
  );
}

// Catches unexpected rendering errors so one broken widget doesn't blank the page.
export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('UI error', error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      this.props.fallback ?? (
        <div className="mx-auto max-w-lg px-4 py-16">
          <ErrorState
            error={{ message: 'Part of this page hit an unexpected problem. Reloading usually fixes it.' }}
            title="Something went wrong"
            onRetry={() => window.location.reload()}
          />
        </div>
      )
    );
  }
}
