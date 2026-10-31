import { ApiError, apiUrl, getCsrfToken } from './api.js';

// Image uploads for the admin console: large photos are downscaled in the browser before they are
// sent (a 12 MP phone photo becomes a few hundred KB), then posted with progress events. The API
// still validates the bytes, type and size; this only makes uploads smaller and faster.

const MAX_EDGE = 2560;
// Files already this small and this size are sent untouched.
const SMALL_BYTES = 700 * 1024;

const loadBitmap = async (file) => {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function prepareImage(file, { maxEdge = MAX_EDGE, quality = 0.86 } = {}) {
  let bitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    // Can't decode here (unusual format or browser): let the server decide.
    return { file, originalBytes: file.size, bytes: file.size, resized: false };
  }
  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (scale === 1 && file.size <= SMALL_BYTES) {
    bitmap.close?.();
    return { file, originalBytes: file.size, bytes: file.size, width, height, resized: false };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  // WebP keeps transparency and is smaller; JPEG is the fallback where WebP encoding is missing.
  let blob = await toBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
  if (!blob || (scale === 1 && blob.size >= file.size)) return { file, originalBytes: file.size, bytes: file.size, width, height, resized: false };
  const ext = blob.type.split('/')[1].replace('jpeg', 'jpg');
  const out = new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.${ext}`, { type: blob.type });
  return { file: out, originalBytes: file.size, bytes: out.size, width: canvas.width, height: canvas.height, resized: true };
}

// POSTs multipart form data with upload progress (fetch can't report it). Resolves to the JSON body;
// rejects with ApiError, or with an AbortError when `signal` aborts.
export function uploadForm(path, form, { onProgress, signal, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, new URL(apiUrl(path), window.location.origin));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    const csrf = getCsrfToken();
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let json;
      try {
        json = JSON.parse(xhr.responseText || '{}');
      } catch {
        json = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json);
      else reject(new ApiError(xhr.status, json));
    };
    xhr.onerror = () => reject(new ApiError(0, { error: { message: 'The upload was interrupted. Check your connection and try again.' } }));
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export const formatBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
