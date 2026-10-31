// Display helpers for public catalog data (prices and service modes), worded as on the website.

export function formatPrice(p) {
  if (!p) return null;
  if (p.display === 'quote') return 'Price on quote';
  const amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'USD', maximumFractionDigits: 0 }).format(p.amount);
  return p.display === 'from' ? `From ${amount}` : amount;
}

// "From $35" across a business's services — only from prices the business has actually set.
export function lowestPrice(services) {
  const priced = services.filter((s) => s.price && s.price.display !== 'quote' && Number.isFinite(s.price.amount));
  if (!priced.length) return services.some((s) => s.price?.display === 'quote') ? 'Price on quote' : null;
  const min = priced.reduce((a, b) => (b.price.amount < a.price.amount ? b : a));
  const amount = formatPrice({ ...min.price, display: 'fixed' });
  return priced.length === 1 && services.length === 1 && min.price.display === 'fixed' ? amount : `From ${amount}`;
}

// "From $45" for a business card (`priceFrom` from the catalog API), or null when no price is published.
export const priceFromLabel = (priceFrom) => (priceFrom ? `From ${formatPrice({ ...priceFrom, display: 'fixed' })}` : null);

const MODES = {
  fixed: 'Customers visit the business',
  mobile: 'Travels to customers',
  both: 'At the business, or travels to customers',
};
export const serviceModeLabel = (mode) => MODES[mode] ?? MODES.fixed;

// Avatar initials for a customer: from the display name, else the email or phone.
export const initials = (u) =>
  (u.displayName || u.email || u.phone || '?')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';
