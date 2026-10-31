import { CheckCircle2, ImageUp, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, cx } from '../../components/ui.jsx';
import { formatBytes, prepareImage, uploadForm } from '../../lib/upload.js';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// What the API accepts after any in-browser resizing.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Originals can be larger: they are downscaled in the browser before upload.
const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;

// File chooser for admin image uploads. Checks type and size up front for a clear message, then
// downscales large photos (longest edge 2560 px) so uploads are small and fast. The API
// independently verifies the bytes, so this is convenience, not a security boundary.
export function ImagePicker({ onPick, onError, label = 'Choose an image', maxEdge, disabled }) {
  const ref = useRef(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    ref.current.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) return onError?.({ message: 'Choose a JPEG, PNG or WebP image.' });
    if (file.size > MAX_ORIGINAL_BYTES) return onError?.({ message: 'That image is larger than 30 MB. Choose a smaller file.' });
    setBusy(true);
    try {
      const prepared = await prepareImage(file, maxEdge ? { maxEdge } : undefined);
      if (prepared.bytes > MAX_IMAGE_BYTES) return onError?.({ message: `Even after resizing this image is ${formatBytes(prepared.bytes)}. Choose an image under 5 MB.` });
      onError?.(null);
      onPick(prepared.file, prepared);
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  return (
    <div>
      <input ref={ref} id={id} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      <Button size="sm" variant="secondary" pending={busy} disabled={disabled} icon={<ImageUp size={16} aria-hidden="true" />} onClick={() => ref.current?.click()}>
        {busy ? 'Preparing image…' : label}
      </Button>
    </div>
  );
}

// Object URL for a local preview, revoked when the file changes or the component unmounts.
export function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

// Multipart upload with progress and cancel. `run` resolves with the API's `data` or throws the
// API error; nothing changes in the page state until the server has saved the image.
export function useImageUpload() {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const controller = useRef(null);
  const run = useCallback(async (path, file, fields = {}) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setError(null);
    setProgress(0);
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, String(v));
    form.append('file', file);
    try {
      const { data } = await uploadForm(path, form, { onProgress: setProgress, signal: ctrl.signal });
      return data;
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
      throw err;
    } finally {
      if (controller.current === ctrl) controller.current = null;
      setProgress(null);
    }
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  return { run, progress, pending: progress !== null, error, setError, cancel: () => controller.current?.abort() };
}

// Upload status line: progress while sending, then "saving" until the server answers.
export function UploadProgress({ progress, onCancel, prepared }) {
  if (progress === null) {
    return prepared?.resized ? (
      <p className="flex items-center gap-1.5 text-caption text-slate-500">
        <CheckCircle2 size={13} className="text-emerald-600" aria-hidden="true" /> Optimized for the web: {formatBytes(prepared.originalBytes)} → {formatBytes(prepared.bytes)}
        {prepared.width ? `, ${prepared.width}×${prepared.height}px` : ''}
      </p>
    ) : null;
  }
  const pct = Math.round(progress * 100);
  const saving = pct >= 100;
  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Upload progress">
        <div className={cx('h-full rounded-full bg-teal-600 transition-[width] duration-200', saving && 'animate-pulse')} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-36 shrink-0 text-caption text-slate-600 tabular">{saving ? 'Saving…' : `Uploading ${pct}%`}</span>
      {onCancel && !saving && (
        <button type="button" onClick={onCancel} className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cancel upload">
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
