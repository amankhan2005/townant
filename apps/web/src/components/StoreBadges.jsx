import { Smartphone } from 'lucide-react';
import { storeLinks } from '../lib/config.js';
import { cx } from './ui.jsx';

// Official store badges, rendered only for store listings that are configured (real https URLs).
// The badge artwork may only link to a published app, so an unpublished store gets an honest
// "coming soon" note instead of a badge. Used by the homepage and the footer so both stay in sync.
export function StoreBadges({ compact, className }) {
  const missing = [!storeLinks.appStore && 'the App Store', !storeLinks.googlePlay && 'Google Play'].filter(Boolean);
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {missing.length < 2 && (
        <div className="flex flex-wrap items-center gap-3">
          {storeLinks.appStore && (
            <a href={storeLinks.appStore} target="_blank" rel="noopener noreferrer" aria-label="Download TownAnt on the App Store (opens in a new tab)" className="rounded-md focus-visible:outline-offset-4">
              <img src="/images/badges/app-store.svg" alt="" width="120" height="40" className={compact ? 'h-10 w-auto' : 'h-12 w-auto'} />
            </a>
          )}
          {storeLinks.googlePlay && (
            <a href={storeLinks.googlePlay} target="_blank" rel="noopener noreferrer" aria-label="Get TownAnt on Google Play (opens in a new tab)" className="-my-[10px] rounded-md focus-visible:outline-offset-4">
              <img src="/images/badges/google-play.png" alt="" width="155" height="60" className={compact ? 'h-[58px] w-auto' : 'h-[70px] w-auto'} />
            </a>
          )}
        </div>
      )}
      {missing.length > 0 && (
        <p className={cx('inline-flex w-fit items-center gap-2.5 rounded-md border border-line bg-white text-slate', compact ? 'px-3 py-2 text-secondary' : 'px-4 py-3 text-body')}>
          <Smartphone size={compact ? 16 : 18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-teal-700" />
          <span>
            <span className="font-semibold text-navy">Coming soon</span> to {missing.join(' and ')}
          </span>
        </p>
      )}
    </div>
  );
}
