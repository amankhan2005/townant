import { SiteSettings } from '../models/index.js';

const KEY = 'site';

export async function siteSettings() {
  return (await SiteSettings.findOne({ key: KEY })) ?? new SiteSettings({ key: KEY });
}

// Upsert-free read for public traffic: a missing document simply means nothing is configured.
export async function publicSite() {
  const doc = await SiteSettings.findOne({ key: KEY }, { 'hero.published': 1, promoBanner: 1 }).lean();
  return { hero: serializeHero(doc?.hero?.published), banner: serializeBanner(doc?.promoBanner) };
}

export function serializeHero(h) {
  if (!h?.image?.url) return null;
  return { image: { url: h.image.url, width: h.image.width ?? null, height: h.image.height ?? null }, alt: h.alt || '', focal: { x: h.focalX ?? 50, y: h.focalY ?? 50 } };
}

// Empty optional fields are returned as null so clients never render blank title/description gaps.
export function serializeBanner(b) {
  if (!b?.image?.url) return null;
  return {
    image: { url: b.image.url, width: b.image.width ?? null, height: b.image.height ?? null },
    alt: b.alt || '',
    title: b.title || null,
    description: b.description || null,
    link: b.linkUrl ? { url: b.linkUrl, label: b.linkLabel || null } : null,
  };
}

export function serializeSiteForAdmin(doc) {
  return {
    hero: {
      draft: serializeHero(doc.hero?.draft),
      published: serializeHero(doc.hero?.published),
      publishedAt: doc.hero?.publishedAt ?? null,
    },
    banner: doc.promoBanner?.image?.url ? { ...serializeBanner(doc.promoBanner), publishedAt: doc.promoBanner.publishedAt ?? null } : null,
  };
}
