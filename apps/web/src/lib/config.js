// Public site links. Values come from VITE_* build variables (public by nature) and are only
// shown when they are real https URLs, so the site never links to placeholder destinations.
const url = (v) => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v.trim()) ? v.trim() : null);
const env = import.meta.env;

export const storeLinks = {
  appStore: url(env.VITE_APP_STORE_URL),
  googlePlay: url(env.VITE_PLAY_STORE_URL),
};
export const hasStoreLinks = Boolean(storeLinks.appStore || storeLinks.googlePlay);

export const socialLinks = [
  ['Instagram', url(env.VITE_SOCIAL_INSTAGRAM)],
  ['Facebook', url(env.VITE_SOCIAL_FACEBOOK)],
  ['LinkedIn', url(env.VITE_SOCIAL_LINKEDIN)],
  ['X', url(env.VITE_SOCIAL_X)],
].filter(([, href]) => href);

// Legal documents are linked only once real, approved pages exist (no placeholders).
export const legalLinks = [
  ['Privacy notice', url(env.VITE_PRIVACY_URL)],
  ['Terms of use', url(env.VITE_TERMS_URL)],
].filter(([, href]) => href);
