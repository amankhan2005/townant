import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

export function useFavorites() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ids, setIds] = useState(new Set());
  useEffect(() => {
    if (user?.role !== 'customer') return;
    api('/favorites/ids')
      .then((r) => setIds(new Set(r.data)))
      .catch(() => {});
  }, [user]);
  const toggle = useCallback(
    async (company) => {
      if (user?.role !== 'customer') {
        navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      const on = ids.has(company.id);
      setIds((s) => {
        const next = new Set(s);
        if (on) next.delete(company.id);
        else next.add(company.id);
        return next;
      });
      try {
        await api(`/favorites/${company.id}`, { method: on ? 'DELETE' : 'PUT' });
      } catch {
        setIds((s) => {
          const next = new Set(s);
          if (on) next.add(company.id);
          else next.delete(company.id);
          return next;
        });
      }
    },
    [ids, user, navigate],
  );
  return { ids, toggle };
}
