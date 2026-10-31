import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { imageUrl } from '../lib/format.js';

// Homepage "In the spotlight" card. Shared by the public homepage and the admin preview so the
// preview is exactly what customers see.
export function SpotlightCard({ company: c }) {
  const image = c.cover ?? c.logo;
  return (
    <article className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-navy shadow-card sm:aspect-[16/10]">
      {image && <img src={imageUrl(image.url, { w: 880, h: 550 })} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-90 transition duration-500 group-hover:scale-[1.03]" />}
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/55 to-transparent" aria-hidden="true" />
      <div className="relative flex h-full flex-col justify-end p-5 text-white sm:p-6">
        {c.category?.name && <p className="text-caption font-semibold uppercase tracking-[0.1em] text-amber">{c.category.name}</p>}
        <h3 className="mt-1 font-heading text-[1.3125rem] font-bold leading-tight">{c.spotlight?.headline || c.name}</h3>
        {(c.spotlight?.blurb || c.summary) && <p className="mt-1 line-clamp-2 text-secondary text-white/80">{c.spotlight?.blurb || c.summary}</p>}
        <Link to={`/b/${c.slug}`} className="mt-3.5 inline-flex w-fit items-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-secondary font-semibold text-navy after:absolute after:inset-0 hover:bg-cloud">
          {c.spotlight?.headline ? `Explore ${c.name}` : 'Explore business'} <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
