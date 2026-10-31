import { Link } from 'react-router';
import { imageUrl } from '../lib/format.js';
import { CategoryIcon } from '../lib/icons.js';
import { cx, Skeleton } from './ui.jsx';

// Category tile: the image a Super Admin uploaded for this category, with the category name
// underneath. Categories without an image get a neutral branded tile with their line icon —
// never a stock photo standing in for an upload.
export function CategoryCard({ category, to = `/search?category=${category.slug}`, className }) {
  const image = category.image;
  return (
    <Link to={to} className={cx('group flex flex-col gap-2.5 rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 focus-visible:ring-offset-4', className)}>
      <span className="relative block aspect-[4/3] overflow-hidden rounded-card bg-cloud ring-1 ring-line transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-raised group-hover:ring-line-strong">
        {image ? (
          <img
            src={imageUrl(image.url, { w: 480, h: 360 })}
            srcSet={`${imageUrl(image.url, { w: 480, h: 360 })} 480w, ${imageUrl(image.url, { w: 800, h: 600 })} 800w`}
            sizes="(min-width: 1024px) 15vw, (min-width: 640px) 30vw, 46vw"
            alt={image.alt || ''}
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-gradient-to-br from-teal-50 via-white to-cloud" aria-hidden="true">
            <span className="flex size-14 items-center justify-center rounded-full bg-white text-teal-700 shadow-card ring-1 ring-line">
              <CategoryIcon name={category.icon} size={26} strokeWidth={1.5} />
            </span>
          </span>
        )}
      </span>
      <span className="px-0.5 text-[0.9375rem] font-semibold leading-snug text-navy transition group-hover:text-teal-700">{category.name}</span>
    </Link>
  );
}

export function CategoryCardSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="aspect-[4/3] w-full rounded-card" />
      <Skeleton className="mt-3 h-4 w-2/3" />
    </div>
  );
}

