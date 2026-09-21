/** Thème unique de l'application : sombre, sobre, professionnel. */

export const colors = {
  bg: '#0F1622',
  surface: '#16202E',
  surfaceAlt: '#1D2A3A',
  border: '#2A3A4F',
  text: '#E8EEF6',
  textMuted: '#8FA3BD',
  textFaint: '#64788F',
  primary: '#3B82F6',
  primaryDark: '#1D4ED8',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  overlay: 'rgba(6,10,16,0.72)',
  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.text },
  h1: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  label: { fontSize: 12, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 0.4 },
  caption: { fontSize: 12.5, fontWeight: '400' as const, color: colors.textMuted },
};

/** Hauteur minimale des zones tactiles (accessibilité). */
export const TOUCH_TARGET = 48;
