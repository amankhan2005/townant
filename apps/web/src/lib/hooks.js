import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Loads data from the API with loading/error state. `deps` re-run the request.
export function useApi(path, { query, enabled = true } = {}, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, error: null, loading: enabled });
  // Path, query and extra deps are serialized so the loader only changes when they do.
  const key = JSON.stringify([path, query ?? null, deps]);
  const counter = useRef(0);
  const loadedKey = useRef(null);

  const load = useCallback(async () => {
    const [currentPath, currentQuery] = JSON.parse(key);
    if (!enabled || !currentPath) return;
    const id = (counter.current += 1);
    // A different request (new id, page or filter) must not show the previous request's data.
    const sameRequest = loadedKey.current === key;
    setState((s) => ({ ...s, loading: true, error: null, ...(sameRequest ? {} : { data: null, meta: null }) }));
    try {
      const res = await api(currentPath, { query: currentQuery ?? undefined });
      if (id === counter.current) {
        loadedKey.current = key;
        setState({ data: res.data, meta: res.meta ?? null, error: null, loading: false });
      }
    } catch (error) {
      // Keep previously loaded data so a failed refresh doesn't blank a working page.
      if (id === counter.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, [key, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload: load, setData };
}

// Wraps an async action with pending/error state for buttons and forms.
export function useAction(fn) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(
    async (...args) => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, setError };
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · TownAnt` : 'TownAnt — Find local. Book confidently.';
  }, [title]);
}

const DEFAULT_DESCRIPTION = 'TownAnt helps you find trusted local services and book appointments with confidence.';

function setMeta(selector, attr, key, content) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement(attr === 'rel' ? 'link' : 'meta');
    el.setAttribute(attr, key);
    document.head.append(el);
  }
  el.setAttribute(attr === 'rel' ? 'href' : 'content', content);
}

// Description, canonical URL and social preview tags for public pages. The canonical URL drops
// query strings except the ones that define the page (e.g. ?category=).
export function usePageMeta({ title, description, keep = [] } = {}) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const canonical = new URL(url.pathname, url.origin);
    for (const k of keep) if (url.searchParams.get(k)) canonical.searchParams.set(k, url.searchParams.get(k));
    const desc = (description || DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').trim().slice(0, 160);
    setMeta('meta[name="description"]', 'name', 'description', desc);
    setMeta('link[rel="canonical"]', 'rel', 'canonical', canonical.toString());
    setMeta('meta[property="og:title"]', 'property', 'og:title', title ? `${title} · TownAnt` : 'TownAnt — Find local. Book confidently.');
    setMeta('meta[property="og:description"]', 'property', 'og:description', desc);
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonical.toString());
  }, [title, description, keep.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
}
