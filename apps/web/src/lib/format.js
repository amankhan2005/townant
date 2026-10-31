// Presentation helpers. All date text comes from @townant/shared so every surface prints
// MM/DD/YYYY; never format dates with toLocale*/Intl directly in components.
import { formatRelative } from '@townant/shared';

export { formatClock, formatDate, formatDateTime, formatIsoDate, formatTime, todayIso } from '@townant/shared';

export const relativeTime = (iso) => formatRelative(iso);

// Price information is display-only: TownAnt never takes payment.
export function formatPrice(price) {
  if (!price) return null;
  if (price.display === 'quote') return 'Price on quote';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency || 'USD', maximumFractionDigits: price.amount % 1 ? 2 : 0 }).format(price.amount);
  return price.display === 'from' ? `From ${amount}` : amount;
}

export const minutesLabel = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m >= 120 ? 's' : ''}${m % 60 ? ` ${m % 60} min` : ''}`);

// Cloudinary delivery transformation for responsive, metadata-stripped images.
export function imageUrl(url, { w, h, crop = 'fill' } = {}) {
  if (!url || !url.includes('/image/upload/')) return url;
  const t = ['f_auto', 'q_auto', w && `w_${w}`, h && `h_${h}`, (w || h) && `c_${crop}`].filter(Boolean).join(',');
  return url.replace('/image/upload/', `/image/upload/${t}/`);
}
