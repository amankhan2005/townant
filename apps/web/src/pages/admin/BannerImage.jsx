import { Crop, ImageUp, Info, Move, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, cx } from '../../components/ui.jsx';
import { formatBytes, prepareImage } from '../../lib/upload.js';
import { useObjectUrl } from './ImagePicker.jsx';

// Promotional banner image rules. They mirror the API (services/media.js BANNER_RULES), which checks
// the uploaded bytes again; this side only saves a wasted upload and explains the problem sooner.
export const BANNER = { ratio: 3, tolerance: 0.01, min: { width: 600, height: 200 }, recommended: { width: 1200, height: 400 }, types: ['image/jpeg', 'image/png', 'image/webp'] };
const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;
// Largest width the browser keeps when it resizes or crops; 2400 × 800 is sharp on large screens.
const MAX_OUTPUT_WIDTH = 2400;

// Real pixel size as displayed (EXIF rotation applied), read from the decoded image — never from the
// file name or declared type.
export async function readImageSize(file) {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// null when the size is acceptable, otherwise a message for the administrator.
export function bannerSizeProblem({ width, height }) {
  const ratio = width / height;
  const need = `Banners must be 3:1 — for example ${BANNER.recommended.width} × ${BANNER.recommended.height} px.`;
  if (Math.abs(ratio - BANNER.ratio) / BANNER.ratio > BANNER.tolerance) return `This image is ${width} × ${height} px (${ratio.toFixed(2)}:1). ${need} Crop it to 3:1 below, or choose another image.`;
  if (width < BANNER.min.width || height < BANNER.min.height) return `This image is only ${width} × ${height} px. ${need} The minimum is ${BANNER.min.width} × ${BANNER.min.height} px.`;
  return null;
}

export function BannerRequirements({ maxBytes }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-slate-900">
        <Info size={15} aria-hidden="true" className="text-teal-700" /> Promotional banner requirements
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[0.8125rem] sm:grid-cols-2">
        {[
          ['Recommended size', `${BANNER.recommended.width} × ${BANNER.recommended.height} px`],
          ['Required aspect ratio', '3:1 (e.g. 1800 × 600 is also fine)'],
          ['Accepted formats', 'JPEG, PNG or WebP'],
          ['Maximum file size', `${formatBytes(maxBytes)} after optimisation`],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-x-2">
            <dt className="text-slate-500">{k}:</dt>
            <dd className="font-medium text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-caption text-slate-500">It is shown full width below “New and noteworthy”, always at 3:1. Other shapes are refused unless you crop them to 3:1 here.</p>
    </div>
  );
}

// Choose (click or drop) → validate the real size → resize if large → hand back an accepted 3:1 file.
// Wrong shapes are never sent; the administrator can crop them to 3:1 or pick another image.
export function BannerDropZone({ onAccept, disabled }) {
  const input = useRef(null);
  const id = useId();
  const [over, setOver] = useState(false);
  const [error, setError] = useState(null);
  const [cropping, setCropping] = useState(null);
  const [busy, setBusy] = useState(false);

  const accept = useCallback(
    async (file) => {
      const size = await readImageSize(file);
      const problem = bannerSizeProblem(size);
      if (problem) return { problem, size };
      const prepared = await prepareImage(file, { maxEdge: MAX_OUTPUT_WIDTH });
      // Resizing keeps the ratio; re-check the final file so what we send is what we validated.
      const finalSize = prepared.width ? { width: prepared.width, height: prepared.height } : size;
      const finalProblem = bannerSizeProblem(finalSize);
      if (finalProblem) return { problem: finalProblem, size: finalSize };
      onAccept(prepared.file, { ...prepared, width: finalSize.width, height: finalSize.height });
      return null;
    },
    [onAccept],
  );

  const pick = async (file) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setError(null);
    if (!BANNER.types.includes(file.type)) return setError({ message: 'Choose a JPEG, PNG or WebP image.' });
    if (file.size > MAX_ORIGINAL_BYTES) return setError({ message: 'That file is larger than 30 MB. Choose a smaller image.' });
    setBusy(true);
    try {
      const result = await accept(file);
      if (result) {
        // A crop keeps the largest 3:1 region (min(width, 3 × height) wide); offer it if that is big enough.
        const croppable = Math.min(result.size.width, result.size.height * 3) >= BANNER.min.width;
        setError({ message: result.problem, canCrop: croppable ? file : null });
      }
    } catch {
      setError({ message: 'This file could not be read as an image. Choose a JPEG, PNG or WebP image.' });
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="flex flex-col gap-3">
      <input ref={input} id={id} type="file" accept={BANNER.types.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        className={cx(
          'flex aspect-[3/1] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          over ? 'border-teal bg-teal-50' : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50',
        )}
      >
        <ImageUp size={22} aria-hidden="true" className="text-slate-400" />
        <span className="text-[0.875rem] font-semibold text-slate-800">{busy ? 'Checking the image…' : 'Choose a 3:1 image or drop it here'}</span>
        <span className="text-caption text-slate-500">This frame shows the 3:1 banner shape · {BANNER.recommended.width} × {BANNER.recommended.height} px recommended</span>
      </button>
      {error && (
        <Alert tone="error" title="This image can’t be used as it is">
          <span className="block">{error.message}</span>
          {error.canCrop && (
            <Button className="mt-3" size="sm" variant="secondary" icon={<Crop size={15} aria-hidden="true" />} onClick={() => setCropping(error.canCrop)}>
              Crop to 3:1
            </Button>
          )}
        </Alert>
      )}
      {cropping && (
        <BannerCropper
          file={cropping}
          onCancel={() => setCropping(null)}
          onAccept={async (cropped) => {
            setCropping(null);
            setError(null);
            const result = await accept(cropped);
            if (result) setError({ message: result.problem });
          }}
        />
      )}
    </div>
  );
}

// Pan-and-zoom crop to exactly 3:1. Nothing is stretched: the output is a 3:1 region of the original,
// scaled down only if it is wider than MAX_OUTPUT_WIDTH. The administrator must accept the result.
export function BannerCropper({ file, onAccept, onCancel }) {
  const url = useObjectUrl(file);
  const frame = useRef(null);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const drag = useRef(null);
  const [saving, setSaving] = useState(false);
  const [frameWidth, setFrameWidth] = useState(0);

  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    const image = new Image();
    image.onload = () => live && setImg(image);
    image.src = url;
    return () => {
      live = false;
    };
  }, [url]);

  // Largest 3:1 rectangle that fits the image, divided by the zoom factor.
  const region = (() => {
    if (!img) return null;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const baseW = Math.min(W, H * 3);
    const w = baseW / zoom;
    const h = w / 3;
    return { w, h, x: (W - w) * pos.x, y: (H - h) * pos.y, W, H };
  })();

  const move = (dx, dy) => {
    if (!region || !frameWidth) return;
    const scale = region.w / frameWidth;
    setPos((p) => ({
      x: region.W > region.w ? Math.min(1, Math.max(0, p.x - (dx * scale) / (region.W - region.w))) : 0.5,
      y: region.H > region.h ? Math.min(1, Math.max(0, p.y - (dy * scale) / (region.H - region.h))) : 0.5,
    }));
  };

  const apply = async () => {
    if (!region) return;
    setSaving(true);
    try {
      const outW = Math.round(Math.min(MAX_OUTPUT_WIDTH, region.w));
      const outH = Math.round(outW / 3);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext('2d').drawImage(img, region.x, region.y, region.w, region.h, 0, 0, outW, outH);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
      onAccept(new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'banner'}-3x1.jpg`, { type: 'image/jpeg' }));
    } finally {
      setSaving(false);
    }
  };

  const scale = region && frameWidth ? frameWidth / region.w : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" role="group" aria-label="Crop the banner to 3:1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8125rem] font-semibold text-slate-900">Crop to 3:1</p>
        <button type="button" onClick={onCancel} className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cancel crop">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={frame}
        tabIndex={0}
        aria-label="Crop area. Drag, or use the arrow keys, to position the image."
        className="relative aspect-[3/1] w-full cursor-move touch-none overflow-hidden rounded-md bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          move(e.clientX - drag.current.x, e.clientY - drag.current.y);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = 12;
          const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
          if (map[e.key]) {
            e.preventDefault();
            move(...map[e.key]);
          }
        }}
      >
        {img && region && scale && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{ width: region.W * scale, height: region.H * scale, left: -region.x * scale, top: -region.y * scale }}
          />
        )}
        <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-slate-900/70 px-2 py-1 text-caption text-white">
          <Move size={12} aria-hidden="true" /> Drag to position
        </span>
      </div>
      <label className="flex items-center gap-3 text-[0.8125rem] text-slate-600">
        Zoom
        <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-teal" />
      </label>
      {region && (
        <p className="text-caption text-slate-500 tabular">
          Result: {Math.round(Math.min(MAX_OUTPUT_WIDTH, region.w))} × {Math.round(Math.min(MAX_OUTPUT_WIDTH, region.w) / 3)} px from a {Math.round(region.w)} × {Math.round(region.h)} px area of the original.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={apply} pending={saving} disabled={!region}>
          Use this crop
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
