// Mobile theme: the same brand tokens as the web (packages/shared/src/tokens.js), plus the few
// mobile-only values the app needs: accent hues for category tiles, the type scale with the
// embedded fonts (Manrope headings, Inter text — as on the website) and elevation presets.
import { tokens } from '@townant/shared';

export const colors = {
  ...tokens.colors,
  white: '#FFFFFF',
  tealSoft: tokens.colors.teal50,
  teal100: '#CFE7E3',
  teal300: '#6CC3B8',
  amber100: '#FDE7B8',
  scrim: 'rgba(20,36,58,0.55)',
};
export const space = tokens.space;
export const radii = tokens.radius;
export const type = tokens.type;
export const radius = 18;

// Category accents. Each foreground passes WCAG AA (4.5:1) on its own tint and on white, so the
// tint is decoration and the label never depends on it.
export const accents = {
  teal: { fg: '#0F655D', bg: '#E2F3F0' },
  sky: { fg: '#035E8F', bg: '#E1F1FB' },
  magenta: { fg: '#A3285C', bg: '#FCE9F1' },
  green: { fg: '#166534', bg: '#E4F5EA' },
  orange: { fg: '#B23A0C', bg: '#FDEDE4' },
  blue: { fg: '#1E56A8', bg: '#E6EFFC' },
  amber: { fg: '#875800', bg: '#FEF2D6' },
  violet: { fg: '#5338C2', bg: '#EEEBFC' },
  indigo: { fg: '#3F35B5', bg: '#E9E9FC' },
  rose: { fg: '#B0153B', bg: '#FFE6EB' },
};

export const fonts = { text: 'Inter', heading: 'Manrope' };

export const text = {
  display: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 19, lineHeight: 25, letterSpacing: -0.2 },
  cardTitle: { fontFamily: fonts.heading, fontWeight: '700', fontSize: 16, lineHeight: 21 },
  body: { fontFamily: fonts.text, fontWeight: '400', fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.text, fontWeight: '600', fontSize: 15, lineHeight: 22 },
  secondary: { fontFamily: fonts.text, fontWeight: '400', fontSize: 13, lineHeight: 18 },
  label: { fontFamily: fonts.text, fontWeight: '600', fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.text, fontWeight: '500', fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: fonts.text, fontWeight: '700', fontSize: 11, lineHeight: 14, letterSpacing: 0.9, textTransform: 'uppercase' },
};

export const shadow = {
  sm: { shadowColor: '#14243A', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  md: { shadowColor: '#14243A', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
};
