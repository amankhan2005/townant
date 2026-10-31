import { Heart } from 'lucide-react';
import { Link } from 'react-router';
import { CompanyCard } from '../../components/CompanyCard.jsx';
import { RequireCustomer } from '../../components/RequireCustomer.jsx';
import { CardGridSkeleton, EmptyState, ErrorState, PageHeader } from '../../components/ui.jsx';
import { useFavorites } from '../../lib/favorites.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';

export default function Favorites() {
  useDocumentTitle('Favorites');
  return (
    <RequireCustomer>
      <List />
    </RequireCustomer>
  );
}

function List() {
  const list = useApi('/favorites');
  const favorites = useFavorites();
  const visible = list.data?.filter((c) => favorites.ids.size === 0 || favorites.ids.has(c.id)) ?? [];
  return (
    <div className="mx-auto max-w-6xl gutter py-8">
      <PageHeader title="Saved businesses" />
      {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <CardGridSkeleton count={3} label="Loading saved businesses" />}
      {list.data && visible.length === 0 && <EmptyState icon={Heart} title="Nothing saved yet" body="Tap the heart on any business to keep it here." action={<Link to="/search" className="font-semibold text-teal">Explore businesses</Link>} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => (
          <CompanyCard key={c.id} company={c} favorite={favorites.ids.has(c.id)} onToggleFavorite={favorites.toggle} />
        ))}
      </div>
    </div>
  );
}
