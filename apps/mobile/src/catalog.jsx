import { createContext, useContext, useMemo } from 'react';
import { categoryLook } from './categories.js';
import { useApi } from './ui.jsx';

const CatalogContext = createContext(null);

// Published categories, loaded once and shared by every screen (Home tiles, Explore, category
// pages, company cards). The list is whatever the Super Admin has published — nothing is invented.
export function CatalogProvider({ children }) {
  const categories = useApi('/catalog/categories');
  const value = useMemo(() => {
    const all = categories.data ?? [];
    const byId = new Map(all.map((c) => [c.id, c]));
    const bySlug = new Map(all.map((c) => [c.slug, c]));
    const parents = all.filter((c) => !c.parentId);
    const childrenOf = (id) => all.filter((c) => c.parentId === id);
    // Icon and accent for any category reference ({ id, slug } from a company, or a full record).
    const look = (ref) => {
      const c = (ref?.id && byId.get(ref.id)) || (ref?.slug && bySlug.get(ref.slug)) || ref;
      return categoryLook(c, c?.parentId ? byId.get(c.parentId) : null);
    };
    return { ...categories, all, byId, bySlug, parents, childrenOf, look };
  }, [categories]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export const useCatalog = () => useContext(CatalogContext);
