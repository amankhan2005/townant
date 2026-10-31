import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const SHEET_QUERY = '(max-width: 639px)';

export function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(SHEET_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(SHEET_QUERY);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

// Floating panel anchored to `anchorRef`, rendered in a portal so it is never clipped by a
// scrolling modal. On phones it becomes a bottom sheet with a backdrop.
export function Popover({ open, onClose, anchorRef, children, width = 'anchor', label, panelRef }) {
  const narrow = useIsNarrow();
  const reduce = useReducedMotion();
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 320 && r.top > below;
    const w = width === 'anchor' ? r.width : width;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    setPos({ left, width: w, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }), maxHeight: Math.max(200, (up ? r.top : below) - 16) });
  }, [anchorRef, width]);

  useLayoutEffect(() => {
    if (!open || narrow) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, narrow, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (anchorRef.current?.contains(e.target) || panelRef?.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open, onClose, anchorRef, panelRef]);

  return createPortal(
    <AnimatePresence>
      {open &&
        (narrow ? (
          <motion.div key="sheet" className="fixed inset-0 z-[70] flex items-end bg-navy/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-label={label}
              initial={reduce ? false : { y: 40 }}
              animate={{ y: 0 }}
              exit={reduce ? undefined : { y: 40 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-pop"
            >
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />
              {children}
            </motion.div>
          </motion.div>
        ) : (
          pos && (
            <motion.div
              key="pop"
              ref={panelRef}
              initial={reduce ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
              transition={{ duration: 0.14 }}
              style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
              className="z-[70] flex flex-col overflow-hidden rounded-card border border-line bg-white shadow-pop"
            >
              {children}
            </motion.div>
          )
        ))}
    </AnimatePresence>,
    document.body,
  );
}
