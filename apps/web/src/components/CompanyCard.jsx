import { BadgeCheck, Heart, MapPin, Store } from 'lucide-react';
import { Link } from 'react-router';
import { imageUrl } from '../lib/format.js';
import { Badge, cx, RatingInline } from './ui.jsx';

// Business card. Every field comes from the API; optional details are simply omitted.
export function CompanyCard({ company, favorite, onToggleFavorite, compact }) {
  const place = [company.location?.area, company.location?.city].filter(Boolean).join(', ');
  const image = company.cover ?? company.logo;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-white transition-[box-shadow,border-color] duration-200 hover:border-line-strong hover:shadow-raised focus-within:border-line-strong">
      <div className="relative aspect-[4/3] overflow-hidden bg-teal-50">
        {image ? (
          <img src={imageUrl(image.url, { w: 640, h: 480 })} alt="" width="640" height="480" loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-teal-50 text-teal-700/70" aria-hidden="true">
            <Store size={34} strokeWidth={1.5} />
            <span className="text-caption font-semibold uppercase tracking-wide">{company.category?.name ?? 'Local business'}</span>
          </div>
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">{company.isNew && <Badge tone="navy">New</Badge>}</div>
        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(company)}
            aria-pressed={favorite}
            aria-label={favorite ? `Remove ${company.name} from favorites` : `Save ${company.name} to favorites`}
            className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center rounded-full bg-white text-navy shadow-raised transition-transform hover:scale-105 motion-reduce:transition-none"
          >
            <Heart size={18} aria-hidden="true" className={favorite ? 'fill-danger text-danger' : ''} />
          </button>
        )}
      </div>
      <div className={cx('flex flex-1 flex-col gap-1 px-4', compact ? 'pb-3 pt-2.5' : 'pb-4 pt-3.5')}>
        <h3 className="flex items-center gap-1.5 text-card font-semibold text-navy">
          <Link to={`/b/${company.slug}`} className="truncate after:absolute after:inset-0 after:rounded-xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-teal/50">
            {company.name}
          </Link>
          {company.verified && <BadgeCheck size={17} className="shrink-0 text-teal" aria-label="Verified by TownAnt" />}
        </h3>
        <p className="truncate text-secondary text-muted">{company.category?.name ?? 'Local service'}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RatingInline rating={company.rating} />
          {company.distanceKm != null && <span className="text-secondary text-muted tabular">{company.distanceKm} km away</span>}
        </div>
        {!compact && (place || company.serviceMode !== 'fixed') && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-secondary text-muted">
            <MapPin size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate">
              {place}
              {company.serviceMode !== 'fixed' && `${place ? ' · ' : ''}Comes to you`}
            </span>
          </p>
        )}
      </div>
    </article>
  );
}

export { CompanyCardSkeleton } from './ui.jsx';
