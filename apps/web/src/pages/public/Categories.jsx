import { Link } from 'react-router';
import { CategoryCard, CategoryCardSkeleton } from '../../components/CategoryCard.jsx';
import { EmptyState, ErrorState, LoadingRegion, PageHeader } from '../../components/ui.jsx';
import { useApi, useDocumentTitle, usePageMeta } from '../../lib/hooks.js';

// The category tree comes from the Super Admin–managed API; only published (active) categories
// are returned, with the images uploaded for them.
export default function Categories() {
  useDocumentTitle('Categories');
  usePageMeta({ title: 'Categories', description: 'Browse local service categories on TownAnt and find businesses you can book online.' });
  const { data, error, reload } = useApi('/catalog/categories');
  const parents = (data ?? []).filter((c) => !c.parentId);
  return (
    <div className="mx-auto max-w-7xl gutter py-10 md:py-14">
      <PageHeader title="Browse categories" subtitle="Find the right local professional for the job." />
      {error && !data && <ErrorState error={error} onRetry={reload} title="Categories didn't load" />}
      {!data && !error && (
        <LoadingRegion label="Loading categories" className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <CategoryCardSkeleton key={i} />
          ))}
        </LoadingRegion>
      )}
      {data && parents.length === 0 && <EmptyState title="No categories yet" body="Categories will appear here once TownAnt publishes them." />}
      <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {parents.map((p) => {
          const children = data.filter((c) => c.parentId === p.id);
          return (
            <li key={p.id} className="flex flex-col">
              <CategoryCard category={p} />
              {p.description && <p className="mt-1 px-0.5 text-secondary text-muted">{p.description}</p>}
              {children.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${p.name} sub-categories`}>
                  {children.map((c) => (
                    <li key={c.id}>
                      <Link to={`/search?category=${c.slug}`} className="inline-flex h-8 items-center rounded-full border border-line bg-white px-3 text-secondary font-medium text-slate transition hover:border-teal/40 hover:bg-teal-50 hover:text-teal-700">
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
