import { ImageUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, FormError, Input, Modal, useToast } from '../../components/ui.jsx';
import { imageUrl } from '../../lib/format.js';
import { formatBytes, prepareImage, uploadForm } from '../../lib/upload.js';

// In-place editor for the homepage hero image, shown only to a signed-in Super Admin (the API
// independently requires a Super Admin session with verified two-step sign-in and a CSRF token).
// It publishes through the existing hero endpoint (POST /admin/site/hero/draft with publish=true),
// stored in SiteSettings.hero — the same record the homepage reads. It is unrelated to the
// promotional banner, which keeps its own Super Admin screen, endpoint and record.
// Loaded lazily, so visitors never download it.

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_ORIGINAL = 30 * 1024 * 1024;
const MAX_UPLOAD = 5 * 1024 * 1024;

export default function HeroEditor({ hero, onPublished, onClose }) {
  const toast = useToast();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [info, setInfo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [alt, setAlt] = useState(hero?.alt ?? '');
  const [focal, setFocal] = useState(hero?.focal ?? { x: 50, y: 50 });
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const abort = useRef(null);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => abort.current?.abort(), []);

  const pick = async (f) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    setError(null);
    if (!TYPES.includes(f.type)) return setError({ message: 'Choose a JPEG, PNG or WebP image.' });
    if (f.size > MAX_ORIGINAL) return setError({ message: 'That file is larger than 30 MB. Choose a smaller image.' });
    const prepared = await prepareImage(f);
    if (prepared.bytes > MAX_UPLOAD) return setError({ message: `Even after resizing this image is ${formatBytes(prepared.bytes)}. Choose one under 5 MB.` });
    setFile(prepared.file);
    setInfo(prepared);
    return undefined;
  };

  const publish = async () => {
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    const form = new FormData();
    form.append('alt', alt.trim());
    form.append('focalX', String(focal.x));
    form.append('focalY', String(focal.y));
    form.append('publish', 'true');
    form.append('file', file);
    try {
      // Success is shown only after the API has stored the image and saved the new reference.
      const { data } = await uploadForm('/admin/site/hero/draft', form, { onProgress: setProgress, signal: abort.current.signal });
      toast('Hero image published');
      onPublished(data.hero.published);
      onClose();
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.status === 401 || err.status === 403 ? { message: 'Your Super Admin session has ended. Sign in at /admin, then try again.' } : err);
    } finally {
      setProgress(null);
    }
  };

  const uploading = progress !== null;
  const src = preview ?? (hero ? imageUrl(hero.image.url, { w: 900, h: 720 }) : null);
  return (
    <Modal open onClose={uploading ? undefined : onClose} title="Homepage hero image" description="Replaces the photo in the homepage hero. The current image stays live until the new one is saved." size="lg">
      <div className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-lg bg-cloud ring-1 ring-line">
          {src ? (
            <img src={src} alt="" className="aspect-[5/4] w-full object-cover sm:aspect-[16/10]" style={{ objectPosition: `${focal.x}% ${focal.y}%` }} />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center text-secondary text-muted">No published image — the homepage shows TownAnt’s default photo.</div>
          )}
          {file && <span className="absolute left-3 top-3 rounded-md bg-navy/80 px-2 py-1 text-caption font-semibold text-white">Preview — not live yet</span>}
        </div>
        <input ref={input} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={uploading} icon={<ImageUp size={16} aria-hidden="true" />} onClick={() => input.current?.click()}>
            {file ? 'Choose a different image' : 'Choose an image'}
          </Button>
          <span className="text-caption text-muted">JPEG, PNG or WebP · landscape, at least 1600 px wide · large photos are resized before upload</span>
        </div>
        {info?.resized && <p className="text-caption text-muted">Optimized: {formatBytes(info.originalBytes)} → {formatBytes(info.bytes)}</p>}
        <Input label="Image description" required maxLength={140} value={alt} onChange={(e) => setAlt(e.target.value)} hint="Describes the photo for screen-reader users. Required to publish." />
        <fieldset className="grid grid-cols-2 gap-3 text-sm">
          <legend className="mb-1 text-sm font-medium text-navy">Focus point (keeps the subject in view when cropped)</legend>
          {[
            ['x', 'Horizontal'],
            ['y', 'Vertical'],
          ].map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-muted">
              {label} ({focal[k]}%)
              <input type="range" min={0} max={100} step={5} value={focal[k]} onChange={(e) => setFocal((f) => ({ ...f, [k]: Number(e.target.value) }))} className="accent-teal" />
            </label>
          ))}
        </fieldset>
        {uploading && (
          <div className="flex items-center gap-3" role="status" aria-live="polite">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Upload progress">
              <div className="h-full rounded-full bg-teal transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="w-28 text-caption text-muted tabular">{progress >= 1 ? 'Saving…' : `Uploading ${Math.round(progress * 100)}%`}</span>
          </div>
        )}
        <FormError error={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={uploading} onClick={onClose}>
            Cancel
          </Button>
          <Button pending={uploading} disabled={!file || !alt.trim()} onClick={publish}>
            Publish to homepage
          </Button>
        </div>
      </div>
    </Modal>
  );
}
