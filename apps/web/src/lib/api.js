// Thin client for the TownAnt API. Session cookies are HttpOnly (JavaScript never sees the
// token); state-changing requests echo the per-session CSRF token held in memory.
const BASE = `${import.meta.env.VITE_API_ORIGIN ?? ''}/api/v1`;

let csrfToken = null;
let companyId = null;
export const setCsrfToken = (token) => {
  csrfToken = token ?? null;
};
export const getCsrfToken = () => csrfToken;
export const apiUrl = (path) => `${BASE}${path}`;
export const setCompanyId = (id) => {
  companyId = id ?? null;
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? 'Something went wrong. Please try again.');
    this.status = status;
    this.code = body?.error?.code ?? (status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN');
    this.details = body?.error?.details;
    this.requestId = body?.error?.requestId;
  }
}

export async function api(path, { method = 'GET', body, query, headers = {}, form, signal } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) h['X-CSRF-Token'] = csrfToken;
  if (companyId && path.startsWith('/vendor')) h['X-Company-Id'] = companyId;

  let res;
  try {
    res = await fetch(url, { method, headers: h, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), credentials: 'include', signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { error: { message: "You appear to be offline. Check your connection and try again." } });
  }
  if (res.status === 204) return { data: null };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new ApiError(res.status, json);
    if (res.status === 429) error.retryAfter = Number(res.headers.get('Retry-After')) || null;
    throw error;
  }
  return json;
}

export const newIdempotencyKey = () => crypto.randomUUID().replaceAll('-', '');

// Downloads a file the API generates (e.g. an .xlsx export) with the session cookie, then hands it
// to the browser's save flow. Errors come back as ApiError like any other request.
export async function downloadFile(path, { query, fallbackName = 'download', onProgress, signal } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(url, { credentials: 'include', headers: { Accept: '*/*' }, signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { error: { message: 'You appear to be offline. Check your connection and try again.' } });
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const total = Number(res.headers.get('content-length')) || 0;
  let blob;
  if (res.body && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(total ? received / total : null);
    }
    blob = new Blob(chunks, { type: res.headers.get('content-type') ?? 'application/octet-stream' });
  } else {
    blob = await res.blob();
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return { name, rows: Number(res.headers.get('x-export-rows')) || null, total: Number(res.headers.get('x-export-total')) || null, truncated: res.headers.get('x-export-truncated') === 'true' };
}
