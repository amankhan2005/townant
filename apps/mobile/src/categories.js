import { accents } from './theme.js';

// Visual identity for categories: an icon and an accent hue. Categories come from the API with an
// `icon` key chosen by the Super Admin (the same keys the website maps to its own icon set); a few
// well-known slugs get a more specific glyph. Anything unknown still gets a stable look derived from
// its slug, so new categories never render blank.
const BY_ICON = {
  home: ['home-outline', 'teal'],
  sparkles: ['broom', 'sky'],
  scissors: ['content-cut', 'magenta'],
  'heart-pulse': ['heart-pulse', 'green'],
  wrench: ['wrench-outline', 'orange'],
  car: ['car-outline', 'blue'],
  paw: ['paw', 'amber'],
  dumbbell: ['dumbbell', 'violet'],
  book: ['book-open-page-variant-outline', 'indigo'],
  party: ['party-popper', 'rose'],
};

// Specific glyph and hue for well-known slugs (the website's icon set is smaller, so several
// categories share an icon key there).
const LOOK_BY_SLUG = {
  'home-cleaning': ['broom', 'teal'],
  plumbing: ['pipe-wrench', 'blue'],
  'electrical-services': ['flash-outline', 'amber'],
  'beauty-salon': ['content-cut', 'magenta'],
  'massage-wellness': ['spa-outline', 'green'],
  photography: ['camera-outline', 'violet'],
  'hvac-services': ['air-conditioner', 'sky'],
  'lawn-garden': ['sprout-outline', 'green'],
  'handyman-services': ['hammer-wrench', 'orange'],
  'moving-services': ['truck-outline', 'indigo'],
};

const BY_SLUG = {
  tutoring: 'school-outline',
  'car-detailing': 'car-wash',
  'pet-grooming': 'dog-side',
  hair: 'hair-dryer-outline',
  handyman: 'hammer-wrench',
  'house-cleaning': 'broom',
  massage: 'spa-outline',
  'personal-training': 'run-fast',
  photography: 'camera-outline',
  plumbing: 'pipe-wrench',
  'carpet-cleaning': 'vacuum-outline',
  catering: 'silverware-fork-knife',
  dental: 'tooth-outline',
  electrical: 'flash-outline',
  mechanic: 'car-wrench',
  moving: 'truck-outline',
  'music-lessons': 'music-note-outline',
  nails: 'hand-back-right-outline',
  'pet-sitting': 'dog',
  yoga: 'yoga',
  'appliance-repair': 'tools',
  barber: 'content-cut',
  landscaping: 'sprout-outline',
  physiotherapy: 'human-handsup',
};

const HUES = Object.keys(accents);
const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

export function categoryLook(category, parent) {
  const known = LOOK_BY_SLUG[category?.slug] ?? LOOK_BY_SLUG[parent?.slug];
  if (known) return { icon: known[0], ...accents[known[1]] };
  const key = category?.icon ?? parent?.icon;
  const [icon, hue] = BY_ICON[key] ?? ['shape-outline', HUES[hash(category?.slug ?? '') % HUES.length]];
  return { icon: BY_SLUG[category?.slug] ?? icon, ...accents[hue] };
}
