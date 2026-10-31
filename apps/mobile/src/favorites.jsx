import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { KEYS, readJson, writeJson } from './storage.js';

const FavoritesContext = createContext(null);

// Saved businesses. Anyone can save: businesses saved on this device are kept in device storage
// ({ id, slug } only), so they survive restarts and sign-out. When a customer is signed in, the
// device list is merged into their account with the existing favorites API (PUT is idempotent, so
// nothing is duplicated) and later saves go to both. The device list only ever contains what was
// saved on this device; it never receives another device's account favorites.
export function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const [local, setLocal] = useState([]);
  const [remote, setRemote] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const localRef = useRef([]);

  const persist = useCallback((next) => {
    localRef.current = next;
    setLocal(next);
    writeJson(KEYS.favorites, next);
  }, []);

  useEffect(() => {
    readJson(KEYS.favorites, []).then((saved) => {
      const list = Array.isArray(saved) ? saved.filter((f) => f?.id && f?.slug) : [];
      localRef.current = list;
      setLocal(list);
      setHydrated(true);
    });
  }, []);

  // Sign-in (or launch while signed in): merge device saves into the account, then load the account.
  useEffect(() => {
    if (!hydrated) return undefined;
    let live = true;
    if (!user) {
      Promise.resolve().then(() => live && setRemote(null));
      return () => {
        live = false;
      };
    }
    (async () => {
      try {
        const { data: ids } = await api('/favorites/ids');
        const have = new Set(ids);
        const missing = localRef.current.filter((f) => !have.has(f.id));
        // Businesses that have since been unpublished can't be saved; skip them quietly.
        await Promise.all(missing.map((f) => api(`/favorites/${f.id}`, { method: 'PUT' }).then(() => have.add(f.id)).catch(() => {})));
        if (live) setRemote(have);
      } catch {
        if (live) setRemote(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [user, hydrated]);

  const ids = useMemo(() => new Set([...local.map((f) => f.id), ...(remote ?? [])]), [local, remote]);

  const toggle = useCallback(
    async (company) => {
      const on = ids.has(company.id);
      persist(on ? localRef.current.filter((f) => f.id !== company.id) : [...localRef.current.filter((f) => f.id !== company.id), { id: company.id, slug: company.slug }]);
      if (!user) return;
      setRemote((prev) => {
        const next = new Set(prev ?? []);
        if (on) next.delete(company.id);
        else next.add(company.id);
        return next;
      });
      await api(`/favorites/${company.id}`, { method: on ? 'DELETE' : 'PUT' }).catch(() => {});
    },
    [ids, user, persist],
  );

  // Drop a device save whose business is no longer listed.
  const forget = useCallback((id) => persist(localRef.current.filter((f) => f.id !== id)), [persist]);

  const value = useMemo(() => ({ ids, local, toggle, forget, hydrated }), [ids, local, toggle, forget, hydrated]);
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export const useFavorites = () => useContext(FavoritesContext);
