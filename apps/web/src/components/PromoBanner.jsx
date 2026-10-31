import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { imageUrl } from '../lib/format.js';

const WIDTHS = [640, 960, 1280, 1920];
const isInternal = (url) => url.startsWith('/') && !url.startsWith('//');

// Same-site paths navigate in the app; https links open in a new tab.
function Anchor({ url, className, children }) {
  return isInternal(url) ? (
    <Link to={url} className={className}>
      {children}
    </Link>
  ) : (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

// Homepage promotional banner published by a Super Admin (GET /catalog/site). Renders nothing until
// a banner is published, and nothing if its image fails to load. Title, text and link are optional;
// absent ones leave no empty space. Banners are 3:1 (enforced on upload); the 3:1 frame is reserved
// up front so the page doesn't jump, an older off-ratio image is cropped rather than stretched, and
// the browser picks a width-appropriate Cloudinary variant.
export function PromoBanner({ banner }) {
  const [failed, setFailed] = useState(false);
  if (!banner?.image?.url || failed) return null;
  const { image, alt, title, description, link } = banner;
  const hasText = Boolean(title || description || (link && link.label));
  const img = (
    <img
      src={imageUrl(image.url, { w: 1280, crop: 'limit' })}
      srcSet={WIDTHS.map((w) => `${imageUrl(image.url, { w, crop: 'limit' })} ${w}w`).join(', ')}
      sizes="(min-width: 1280px) 1216px, calc(100vw - 2rem)"
      alt={link && !link.label ? alt || title || 'Promotion' : alt}
      width={1200}
      height={400}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="block aspect-[3/1] h-auto w-full bg-cloud object-cover"
    />
  );
  // Without button text the whole image is the link; with it, the button is.
  const wrapImage = link && !link.label;
  return (
    <section aria-label={title || 'Promotion'} className="overflow-hidden rounded-xl bg-white ring-1 ring-line">
      {wrapImage ? (
        <Anchor url={link.url} className="block transition hover:opacity-95 focus-visible:outline-offset-[-4px]">
          {img}
        </Anchor>
      ) : (
        img
      )}
      {hasText && (
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            {title && <h2 className="text-heading font-bold text-navy">{title}</h2>}
            {description && <p className="mt-0.5 text-body text-muted">{description}</p>}
          </div>
          {link?.label && (
            <Anchor url={link.url} className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 self-start rounded-md bg-navy px-5 text-body font-semibold text-white transition hover:bg-navy-800 sm:self-auto">
              {link.label}
              <ArrowRight size={16} aria-hidden="true" />
              {!isInternal(link.url) && <span className="sr-only">(opens in a new tab)</span>}
            </Anchor>
          )}
        </div>
      )}
    </section>
  );
}
