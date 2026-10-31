// TownAnt design tokens shared by the web (mirrored in apps/web/src/index.css @theme) and the
// mobile app. Change both together.
export const colors = Object.freeze({
  navy: '#14243A',
  navy800: '#1B2F4A',
  teal: '#147D73',
  teal700: '#0F655D',
  teal50: '#E7F3F1',
  amber: '#F5A623',
  amber50: '#FEF5E4',
  amberText: '#7A4F00',
  cloud: '#F5F7FA',
  slate: '#263445',
  muted: '#5B6878',
  subtle: '#8A95A3',
  line: '#E3E8EF',
  lineStrong: '#CDD5DF',
  surface: '#FFFFFF',
  danger: '#B42318',
  danger50: '#FDECEA',
  success: '#0F7B4A',
});

// 4-point spacing scale.
export const space = Object.freeze({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 });

export const radius = Object.freeze({ sm: 8, md: 10, lg: 14, xl: 20, pill: 999 });

export const type = Object.freeze({
  display: { size: 44, lineHeight: 50, weight: '800' },
  title: { size: 26, lineHeight: 32, weight: '800' },
  heading: { size: 20, lineHeight: 26, weight: '700' },
  cardTitle: { size: 16, lineHeight: 22, weight: '700' },
  body: { size: 15, lineHeight: 22, weight: '400' },
  secondary: { size: 13, lineHeight: 18, weight: '400' },
  label: { size: 14, lineHeight: 20, weight: '600' },
  caption: { size: 12, lineHeight: 16, weight: '500' },
});

export const controlHeight = Object.freeze({ sm: 36, md: 44, lg: 52 });

export const motion = Object.freeze({ fast: 120, base: 180, slow: 260 });
