import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, cx } from './core.jsx';
import { FormError } from './feedback.jsx';
import { Textarea } from './field.jsx';

// Dialogs render at the document root. A `position: fixed` element is laid out against the
// nearest ancestor with a transform, filter or backdrop-filter, so rendering in place (e.g.
// inside the blurred sticky header or an animated hero) sized the overlay to that ancestor
// and pushed the dialog off-screen.
const portal = (node) => (typeof document === 'undefined' ? node : createPortal(node, document.body));

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Shared dialog behaviour: focus moves in, Tab stays inside, Escape closes, focus returns.
function useDialog(open, onClose, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const t = setTimeout(() => (ref.current?.querySelector('[data-autofocus]') ?? ref.current)?.focus(), 20);
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && ref.current?.contains(document.activeElement)) {
        const items = [...ref.current.querySelectorAll(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0];
        const last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose, ref]);
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  useDialog(open, onClose, ref);
  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };
  return portal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-navy/45 backdrop-blur-[2px] sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduce ? false : { y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={reduce ? undefined : { y: 16, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cx('flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop outline-none sm:max-h-[calc(100dvh-3rem)] sm:rounded-xl', widths[size])}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-heading font-bold text-navy">{title}</h2>
                {description && <p className="mt-0.5 text-secondary text-muted">{description}</p>}
              </div>
              <button type="button" onClick={onClose} className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-cloud hover:text-navy" aria-label="Close">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-cloud/50 px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
  );
}

// Side panel on desktop, bottom sheet on phones (e.g. search filters).
export function Drawer({ open, onClose, title, children, footer }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  useDialog(open, onClose, ref);
  return portal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-end justify-end bg-navy/40 sm:items-stretch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduce ? false : { y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex max-h-[88dvh] w-full flex-col rounded-t-2xl bg-white shadow-pop outline-none sm:max-h-none sm:max-w-sm sm:rounded-none"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-heading font-bold text-navy">{title}</h2>
              <button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-cloud" aria-label="Close">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
  );
}

// Confirmation for consequential actions; states the consequence before the user commits.
export function ConfirmDialog({ open, onClose, title, description, confirmLabel = 'Confirm', danger, onConfirm }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} pending={pending} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {description && <p className="text-body text-slate">{description}</p>}
        <FormError error={error} />
      </div>
    </Modal>
  );
}

// Asks for a reason before a consequential action (cancellations, admin actions).
export function ReasonDialog({ open, onClose, title, description, confirmLabel = 'Confirm', required = true, onConfirm, danger }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim() || undefined);
      setReason('');
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} pending={pending} disabled={required && reason.trim().length < 3} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {description && <p className="text-body text-slate">{description}</p>}
        <Textarea label="Reason" required={required} optional={!required} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint={required ? 'At least 3 characters. Recorded with this action.' : undefined} data-autofocus />
        <FormError error={error} />
      </div>
    </Modal>
  );
}
